import type { Pool, PoolClient } from "pg";
import { LeadOrchestrationError, LeadOrchestrationStore, type LeadershipRecord } from "./lead-orchestration.js";
import type { TaskOrigin, TaskStatus } from "./types.js";
import { WorkerStore } from "./worker-store.js";

const SPECIALISTS = ["backend", "frontend", "tests"] as const;
type AutomaticRole = "planner" | typeof SPECIALISTS[number] | "reviewer";

export interface AutomaticLeadSupervisorOptions {
  leaseMs?: number;
  maxAttempts?: number;
  leadCapabilities?: string[];
  workerCapabilities?: string[];
}

export interface AutomaticLeadTickResult {
  taskId: string;
  action: string;
}

interface TaskRow {
  id: string;
  objective: string;
  status: TaskStatus;
  origin: TaskOrigin;
}

interface AssignmentRow {
  id: string;
  external_id: string;
  status: string;
  target_worker_id: string | null;
  spawn_request_id: string | null;
  handoff: Record<string, unknown> | null;
  request_status: string | null;
  worker_id: string | null;
  worker_status: string | null;
  attempt_count: number | null;
}

export class AutomaticLeadSupervisor {
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly leadCapabilities: string[];
  private readonly workerCapabilities: string[];

  constructor(
    private readonly db: Pool,
    private readonly workers: WorkerStore,
    private readonly leads: LeadOrchestrationStore,
    options: AutomaticLeadSupervisorOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.leadCapabilities = options.leadCapabilities ?? ["lead-control"];
    this.workerCapabilities = options.workerCapabilities ?? ["demo-agent"];
  }

  async tick(): Promise<AutomaticLeadTickResult | null> {
    const task = await this.nextTask();
    if (!task) return null;

    const tenant = this.tenant(task.origin);
    const repository = this.repository(task.origin);
    const leadRequest = await this.workers.request({
      taskId: task.id,
      tenant,
      repository,
      role: "lead",
      assignment: { kind: "lead", objective: task.objective },
      requiredCapabilities: this.leadCapabilities,
      idempotencyKey: `task:${task.id}:lead`,
      correlationId: task.id,
      maxAttempts: this.maxAttempts,
    });

    const leadWorker = await this.latestWorker(leadRequest.id);
    if (!leadWorker) return { taskId: task.id, action: "lead_requested" };
    if (leadWorker.status !== "running") {
      return { taskId: task.id, action: `lead_${leadWorker.status}` };
    }

    const leadership = await this.ensureLeadership(task.id, leadWorker.id);
    await this.reconcileAssignments(task, leadership);

    const assignments = await this.assignmentStatuses(task.id);
    const planner = assignments.get("phase:planner");
    if (!planner) {
      await this.ensureAssignment(task, leadership, "planner");
      await this.setTaskStatus(task.id, "planning");
      return { taskId: task.id, action: "planner_assigned" };
    }
    if (planner !== "accepted") {
      await this.setTaskStatus(task.id, "planning");
      return { taskId: task.id, action: `planner_${planner}` };
    }

    const missingSpecialists = SPECIALISTS.filter((role) => !assignments.has(`phase:${role}`));
    if (missingSpecialists.length) {
      for (const role of missingSpecialists) await this.ensureAssignment(task, leadership, role);
      await this.setTaskStatus(task.id, "running");
      return { taskId: task.id, action: "specialists_assigned" };
    }
    const specialistsAccepted = SPECIALISTS.every((role) => assignments.get(`phase:${role}`) === "accepted");
    if (!specialistsAccepted) {
      await this.setTaskStatus(task.id, "running");
      return { taskId: task.id, action: "specialists_running" };
    }

    const reviewer = assignments.get("phase:reviewer");
    if (!reviewer) {
      await this.ensureAssignment(task, leadership, "reviewer");
      await this.setTaskStatus(task.id, "reviewing");
      return { taskId: task.id, action: "reviewer_assigned" };
    }
    if (reviewer !== "accepted") {
      await this.setTaskStatus(task.id, "reviewing");
      return { taskId: task.id, action: `reviewer_${reviewer}` };
    }

    const integration = await this.leads.integrationStatus(task.id);
    if (!integration.ready) {
      return { taskId: task.id, action: `integration_blocked:${integration.blockers.join(",")}` };
    }
    await this.leads.markIntegrationReady(task.id, leadership.leadWorkerId, leadership.epoch);
    await this.setTaskStatus(task.id, "completed");
    await this.systemMessage(task.id, "Lead Sentient accepted all required handoffs and marked integration ready.");
    return { taskId: task.id, action: "integration_ready" };
  }

  private async nextTask(): Promise<TaskRow | null> {
    const result = await this.db.query(
      `SELECT id,objective,status,origin
       FROM tasks
       WHERE status IN ('queued','planning','running','reviewing')
       ORDER BY created_at,id
       LIMIT 1`,
    );
    return (result.rows[0] as TaskRow | undefined) ?? null;
  }

  private tenant(origin: TaskOrigin): string {
    return `github-installation:${origin.installationId}`;
  }

  private repository(origin: TaskOrigin): { owner: string; repo: string } {
    if (!origin.repository?.owner || !origin.repository?.repo) {
      throw new Error("Task origin is missing repository identity");
    }
    return origin.repository;
  }

  private async latestWorker(spawnRequestId: string): Promise<{ id: string; status: string; attempt_count: number } | null> {
    const result = await this.db.query(
      `SELECT id,status,attempt_count
       FROM sentient_workers
       WHERE spawn_request_id=$1
       ORDER BY attempt_count DESC,created_at DESC
       LIMIT 1`,
      [spawnRequestId],
    );
    return result.rows[0] ?? null;
  }

  private async ensureLeadership(taskId: string, leadWorkerId: string): Promise<LeadershipRecord> {
    const existing = await this.db.query(
      `SELECT task_id,lead_worker_id,epoch,lease_expires_at
       FROM task_leadership
       WHERE task_id=$1
         AND lead_worker_id=$2
         AND lease_expires_at > now() + ($3 * interval '1 millisecond')`,
      [taskId, leadWorkerId, Math.floor(this.leaseMs / 2)],
    );
    if (existing.rowCount === 1) {
      const row = existing.rows[0];
      return {
        taskId: row.task_id,
        leadWorkerId: row.lead_worker_id,
        epoch: Number(row.epoch),
        leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
      };
    }
    return this.leads.acquireLeadership(taskId, leadWorkerId, this.leaseMs);
  }

  private async assignmentStatuses(taskId: string): Promise<Map<string, string>> {
    const result = await this.db.query(
      `SELECT external_id,status
       FROM worker_assignments
       WHERE task_id=$1`,
      [taskId],
    );
    return new Map(result.rows.map((row) => [row.external_id as string, row.status as string]));
  }

  private async reconcileAssignments(task: TaskRow, leadership: LeadershipRecord): Promise<void> {
    const result = await this.db.query(
      `SELECT
         wa.*,
         wr.status AS request_status,
         latest.id AS worker_id,
         latest.status AS worker_status,
         latest.attempt_count
       FROM worker_assignments wa
       LEFT JOIN worker_spawn_requests wr ON wr.id=wa.spawn_request_id
       LEFT JOIN LATERAL (
         SELECT id,status,attempt_count
         FROM sentient_workers sw
         WHERE sw.spawn_request_id=wa.spawn_request_id
         ORDER BY attempt_count DESC,created_at DESC
         LIMIT 1
       ) latest ON true
       WHERE wa.task_id=$1
       ORDER BY wa.created_at,wa.id`,
      [task.id],
    );

    for (const row of result.rows as AssignmentRow[]) {
      if (!row.spawn_request_id || !row.worker_id) continue;

      if (row.target_worker_id !== row.worker_id) {
        await this.bindAssignmentTarget({
          taskId: task.id,
          leadWorkerId: leadership.leadWorkerId,
          epoch: leadership.epoch,
          assignment: row,
          workerId: row.worker_id,
        });
        row.target_worker_id = row.worker_id;
      }

      if (row.status === "handed_off") {
        const handoffId = row.handoff?.handoffId;
        if (typeof handoffId === "string" && handoffId.length) {
          await this.leads.review({
            taskId: task.id,
            leadWorkerId: leadership.leadWorkerId,
            epoch: leadership.epoch,
            assignmentId: row.external_id,
            handoffId,
            decision: "accepted",
            reason: "automatic deterministic verification passed",
          });
        }
        continue;
      }

      if (row.worker_status === "completed" && ["assigned","acknowledged","in_progress","blocked","rework"].includes(row.status)) {
        const fallbackHandoff = {
          handoffId: `worker:${row.worker_id}:attempt:${row.attempt_count ?? 1}`,
          objective: row.external_id,
          completedWork: ["worker runtime completed assigned work"],
          filesCommitsArtifacts: [],
          findings: [],
          unresolvedQuestions: [],
          dependencies: [],
          testsResults: ["runtime reported completed"],
          risks: [],
          recommendedNextAction: "lead review",
        };
        const execution = await this.db.query(
          `SELECT result
           FROM worker_runtime_executions
           WHERE worker_id=$1 AND status='completed'`,
          [row.worker_id],
        );
        const runtimeHandoff = execution.rows[0]?.result?.handoff;
        const handoff =
          runtimeHandoff && typeof runtimeHandoff === "object" && !Array.isArray(runtimeHandoff)
            ? runtimeHandoff
            : fallbackHandoff;
        const handoffId =
          typeof handoff.handoffId === "string" && handoff.handoffId.length
            ? handoff.handoffId
            : fallbackHandoff.handoffId;
        await this.leads.submitHandoff(task.id, row.external_id, row.worker_id, {
          ...handoff,
          handoffId,
        });
        await this.leads.review({
          taskId: task.id,
          leadWorkerId: leadership.leadWorkerId,
          epoch: leadership.epoch,
          assignmentId: row.external_id,
          handoffId,
          decision: "accepted",
          reason: runtimeHandoff
            ? "automatic structured runtime handoff accepted"
            : "automatic deterministic verification passed",
        });
      }
    }
  }

  private async bindAssignmentTarget(input: {
    taskId: string;
    leadWorkerId: string;
    epoch: number;
    assignment: AssignmentRow;
    workerId: string;
  }): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await this.assertActiveLeadTx(client, input.taskId, input.leadWorkerId, input.epoch);
      const assignment = await client.query(
        `SELECT id,external_id,target_worker_id,spawn_request_id
         FROM worker_assignments
         WHERE task_id=$1 AND external_id=$2
         FOR UPDATE`,
        [input.taskId, input.assignment.external_id],
      );
      if (assignment.rowCount !== 1) throw new LeadOrchestrationError("UNKNOWN_ASSIGNMENT", "assignment not found");
      const current = assignment.rows[0];
      if (!current.spawn_request_id) throw new LeadOrchestrationError("INVALID_TARGET", "assignment has no spawn request");

      const candidate = await client.query(
        `SELECT id,status
         FROM sentient_workers
         WHERE id=$1 AND task_id=$2 AND spawn_request_id=$3`,
        [input.workerId, input.taskId, current.spawn_request_id],
      );
      if (candidate.rowCount !== 1) {
        throw new LeadOrchestrationError("INVALID_TARGET", "worker does not match assignment spawn request");
      }

      if (current.target_worker_id && current.target_worker_id !== input.workerId) {
        const prior = await client.query(
          `SELECT status,spawn_request_id
           FROM sentient_workers
           WHERE id=$1 AND task_id=$2`,
          [current.target_worker_id, input.taskId],
        );
        const terminal = prior.rowCount === 1 &&
          prior.rows[0].spawn_request_id === current.spawn_request_id &&
          ["failed","cancelled","expired"].includes(prior.rows[0].status);
        if (!terminal) {
          throw new LeadOrchestrationError("ASSIGNMENT_OWNERSHIP", "assignment is already bound to an active or unrelated worker");
        }
      }

      if (current.target_worker_id !== input.workerId) {
        await client.query(
          `UPDATE worker_assignments
           SET target_worker_id=$2,updated_at=now()
           WHERE id=$1`,
          [current.id, input.workerId],
        );
        await client.query(
          `INSERT INTO lead_assignment_events(
             task_id,assignment_id,lead_worker_id,leadership_epoch,event_type,actor,payload
           ) VALUES($1,$2,$3,$4,'ASSIGNMENT_TARGET_BOUND',$5,$6::jsonb)`,
          [
            input.taskId,
            current.id,
            input.leadWorkerId,
            input.epoch,
            `worker:${input.leadWorkerId}`,
            JSON.stringify({
              assignmentId: current.external_id,
              workerId: input.workerId,
              spawnRequestId: current.spawn_request_id,
            }),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertActiveLeadTx(client: PoolClient, taskId: string, leadWorkerId: string, epoch: number): Promise<void> {
    const result = await client.query(
      `SELECT 1
       FROM task_leadership
       WHERE task_id=$1 AND lead_worker_id=$2 AND epoch=$3 AND lease_expires_at>now()
       FOR UPDATE`,
      [taskId, leadWorkerId, epoch],
    );
    if (result.rowCount !== 1) throw new LeadOrchestrationError("STALE_LEAD", "not active lead for epoch");
  }

  private async ensureAssignment(task: TaskRow, leadership: LeadershipRecord, role: AutomaticRole): Promise<void> {
    const tenant = this.tenant(task.origin);
    const repository = this.repository(task.origin);
    const assignmentId = `phase:${role}`;
    const request = await this.workers.request({
      taskId: task.id,
      tenant,
      repository,
      role,
      assignment: {
        assignmentId,
        objective: task.objective,
        role,
        supervisedBy: leadership.leadWorkerId,
      },
      requiredCapabilities: this.workerCapabilities,
      parentWorkerId: leadership.leadWorkerId,
      coordinatorId: leadership.leadWorkerId,
      correlationId: task.id,
      idempotencyKey: `task:${task.id}:worker:${role}`,
      maxAttempts: this.maxAttempts,
    });
    await this.leads.assign({
      taskId: task.id,
      leadWorkerId: leadership.leadWorkerId,
      epoch: leadership.epoch,
      externalId: assignmentId,
      idempotencyKey: `task:${task.id}:assignment:${role}`,
      spawnRequestId: request.id,
      objective: `${role}: ${task.objective}`,
      assignment: { role, objective: task.objective },
      acceptanceCriteria: ["worker completes", "handoff reviewed by Lead Sentient"],
      dependencies: [],
      required: true,
    });
  }

  private async setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.db.query(
      `UPDATE tasks SET status=$2,updated_at=now() WHERE id=$1 AND status<>$2`,
      [taskId, status],
    );
  }

  private async systemMessage(taskId: string, body: string): Promise<void> {
    await this.db.query(
      `INSERT INTO task_messages(task_id,role,body) VALUES($1,'system',$2)`,
      [taskId, body],
    );
  }
}
