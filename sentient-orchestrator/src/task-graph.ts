import type { Pool } from "pg";

export interface TaskNodeSpec {
  key: string;
  role: string;
  objective: string;
  dependsOn?: string[];
  priority?: number;
}

export interface TaskPlan {
  nodes: TaskNodeSpec[];
}

export interface TaskNode extends TaskNodeSpec {
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";
  summary?: string;
}

export function validateTaskPlan(plan: TaskPlan, maxNodes = 32): TaskPlan {
  if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    throw new Error("Task plan must contain at least one node");
  }
  if (plan.nodes.length > maxNodes) {
    throw new Error(`Task plan exceeds maximum node count ${maxNodes}`);
  }

  const keys = new Set<string>();
  for (const node of plan.nodes) {
    if (!node.key || !node.role || !node.objective) {
      throw new Error("Every task node requires key, role, and objective");
    }
    if (keys.has(node.key)) throw new Error(`Duplicate task node key ${node.key}`);
    keys.add(node.key);
  }

  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (!keys.has(dependency)) {
        throw new Error(`Node ${node.key} depends on unknown node ${dependency}`);
      }
      if (dependency === node.key) {
        throw new Error(`Node ${node.key} cannot depend on itself`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.nodes.map((node) => [node.key, node]));

  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Task plan contains a dependency cycle at ${key}`);
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of keys) visit(key);
  return plan;
}

export interface TaskGraphStore {
  persist(taskId: string, plan: TaskPlan): Promise<void>;
  ready(taskId: string, limit: number): Promise<TaskNode[]>;
  setStatus(
    taskId: string,
    nodeKey: string,
    status: TaskNode["status"],
    summary?: string,
  ): Promise<void>;
  list(taskId: string): Promise<TaskNode[]>;
}

export class PostgresTaskGraphStore implements TaskGraphStore {
  constructor(private readonly pool: Pool) {}

  async persist(taskId: string, plan: TaskPlan): Promise<void> {
    validateTaskPlan(plan);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const node of plan.nodes) {
        await client.query(
          `INSERT INTO task_nodes(task_id, node_key, role, objective, priority)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (task_id, node_key) DO NOTHING`,
          [taskId, node.key, node.role, node.objective, node.priority ?? 0],
        );
      }
      for (const node of plan.nodes) {
        for (const dependency of node.dependsOn ?? []) {
          await client.query(
            `INSERT INTO task_node_dependencies(task_id, node_key, depends_on_key)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [taskId, node.key, dependency],
          );
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ready(taskId: string, limit: number): Promise<TaskNode[]> {
    const result = await this.pool.query(
      `SELECT n.*
       FROM task_nodes n
       WHERE n.task_id = $1
         AND n.status = 'queued'
         AND NOT EXISTS (
           SELECT 1
           FROM task_node_dependencies d
           JOIN task_nodes dependency
             ON dependency.task_id = d.task_id
            AND dependency.node_key = d.depends_on_key
           WHERE d.task_id = n.task_id
             AND d.node_key = n.node_key
             AND dependency.status <> 'completed'
         )
       ORDER BY n.priority DESC, n.created_at, n.node_key
       LIMIT $2`,
      [taskId, limit],
    );
    return result.rows.map(mapNode);
  }

  async setStatus(
    taskId: string,
    nodeKey: string,
    status: TaskNode["status"],
    summary?: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE task_nodes
       SET status = $3,
           summary = COALESCE($4, summary),
           started_at = CASE WHEN $3 = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
           completed_at = CASE WHEN $3 IN ('completed', 'failed', 'cancelled') THEN now() ELSE completed_at END
       WHERE task_id = $1 AND node_key = $2`,
      [taskId, nodeKey, status, summary ?? null],
    );
    if (result.rowCount !== 1) throw new Error(`Unknown task node ${taskId}/${nodeKey}`);
  }

  async list(taskId: string): Promise<TaskNode[]> {
    const result = await this.pool.query(
      `SELECT n.*,
              COALESCE(array_agg(d.depends_on_key) FILTER (WHERE d.depends_on_key IS NOT NULL), '{}') AS dependencies
       FROM task_nodes n
       LEFT JOIN task_node_dependencies d
         ON d.task_id = n.task_id AND d.node_key = n.node_key
       WHERE n.task_id = $1
       GROUP BY n.id
       ORDER BY n.created_at, n.node_key`,
      [taskId],
    );
    return result.rows.map(mapNode);
  }
}

export interface GraphWorker {
  role: string;
  run(input: { taskId: string; node: TaskNode }): Promise<{ summary: string }>;
}

export class DagExecutor {
  private readonly workers: Map<string, GraphWorker>;

  constructor(
    private readonly store: TaskGraphStore,
    workers: GraphWorker[],
    private readonly maxParallel = 4,
  ) {
    this.workers = new Map(workers.map((worker) => [worker.role, worker]));
  }

  async run(taskId: string, plan: TaskPlan): Promise<TaskNode[]> {
    await this.store.persist(taskId, validateTaskPlan(plan));

    while (true) {
      const nodes = await this.store.list(taskId);
      if (nodes.every((node) => node.status === "completed")) return nodes;
      const failed = nodes.find((node) => node.status === "failed");
      if (failed) throw new Error(`Task node ${failed.key} failed: ${failed.summary ?? "unknown error"}`);

      const ready = await this.store.ready(taskId, this.maxParallel);
      if (ready.length === 0) {
        throw new Error("Task graph has no ready nodes; graph is blocked or deadlocked");
      }

      const results = await Promise.allSettled(
        ready.map((node) => this.runNode(taskId, node)),
      );
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (rejected) throw rejected.reason;
    }
  }

  private async runNode(taskId: string, node: TaskNode): Promise<void> {
    const worker = this.workers.get(node.role);
    if (!worker) {
      await this.store.setStatus(taskId, node.key, "failed", `No worker for role ${node.role}`);
      throw new Error(`No worker registered for role ${node.role}`);
    }

    await this.store.setStatus(taskId, node.key, "running");
    try {
      const result = await worker.run({ taskId, node });
      await this.store.setStatus(taskId, node.key, "completed", result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.store.setStatus(taskId, node.key, "failed", message);
      throw error;
    }
  }
}

function mapNode(row: any): TaskNode {
  return {
    key: row.node_key,
    role: row.role,
    objective: row.objective,
    dependsOn: row.dependencies ?? [],
    priority: Number(row.priority ?? 0),
    status: row.status,
    summary: row.summary ?? undefined,
  };
}
