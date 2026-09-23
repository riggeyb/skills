import assert from "node:assert/strict";
import test from "node:test";
import {
  DagExecutor,
  validateTaskPlan,
  type GraphWorker,
  type TaskGraphStore,
  type TaskNode,
  type TaskPlan,
} from "../src/task-graph.js";

class MemoryGraphStore implements TaskGraphStore {
  private nodes = new Map<string, TaskNode>();

  async persist(_taskId: string, plan: TaskPlan): Promise<void> {
    validateTaskPlan(plan);
    for (const spec of plan.nodes) {
      if (!this.nodes.has(spec.key)) {
        this.nodes.set(spec.key, {
          ...spec,
          dependsOn: spec.dependsOn ?? [],
          priority: spec.priority ?? 0,
          status: "queued",
        });
      }
    }
  }

  async ready(_taskId: string, limit: number): Promise<TaskNode[]> {
    return [...this.nodes.values()]
      .filter(
        (node) =>
          node.status === "queued" &&
          (node.dependsOn ?? []).every(
            (key) => this.nodes.get(key)?.status === "completed",
          ),
      )
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .slice(0, limit)
      .map((node) => structuredClone(node));
  }

  async setStatus(
    _taskId: string,
    nodeKey: string,
    status: TaskNode["status"],
    summary?: string,
  ): Promise<void> {
    const node = this.nodes.get(nodeKey);
    if (!node) throw new Error(`unknown node ${nodeKey}`);
    node.status = status;
    if (summary !== undefined) node.summary = summary;
  }

  async list(_taskId: string): Promise<TaskNode[]> {
    return [...this.nodes.values()].map((node) => structuredClone(node));
  }
}

test("task plan validator rejects dependency cycles", () => {
  assert.throws(
    () =>
      validateTaskPlan({
        nodes: [
          { key: "a", role: "backend", objective: "a", dependsOn: ["b"] },
          { key: "b", role: "frontend", objective: "b", dependsOn: ["a"] },
        ],
      }),
    /cycle/,
  );
});

test("DAG executor runs independent nodes before dependent reviewer", async () => {
  const store = new MemoryGraphStore();
  const events: string[] = [];
  let active = 0;
  let peak = 0;

  const worker = (role: string): GraphWorker => ({
    role,
    async run({ node }) {
      active += 1;
      peak = Math.max(peak, active);
      events.push(`start:${node.key}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`end:${node.key}`);
      active -= 1;
      return { summary: `${node.key} done` };
    },
  });

  const executor = new DagExecutor(
    store,
    [worker("backend"), worker("frontend"), worker("reviewer")],
    2,
  );

  const result = await executor.run("task-1", {
    nodes: [
      { key: "api", role: "backend", objective: "API" },
      { key: "ui", role: "frontend", objective: "UI" },
      {
        key: "review",
        role: "reviewer",
        objective: "Integrate",
        dependsOn: ["api", "ui"],
      },
    ],
  });

  assert.equal(peak, 2);
  assert.ok(events.indexOf("start:review") > events.indexOf("end:api"));
  assert.ok(events.indexOf("start:review") > events.indexOf("end:ui"));
  assert.equal(result.every((node) => node.status === "completed"), true);
});
