import { randomUUID } from "node:crypto";
import type { EnqueueOptions, RenewableJobQueue, QueueJob, SentientJobPayload } from "./ports.js";

interface InternalJob extends QueueJob {
  idempotencyKey: string;
  status: "queued" | "leased" | "completed" | "dead" | "cancelled";
  priority: number;
  workerId?: string;
  lastError?: string;
}

export class InMemoryJobQueue implements RenewableJobQueue {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly idempotency = new Map<string, string>();

  async enqueue(payload: SentientJobPayload, options: EnqueueOptions): Promise<{ accepted: boolean; jobId: string }> {
    const existing = this.idempotency.get(options.idempotencyKey);
    if (existing) return { accepted: false, jobId: existing };

    const id = randomUUID();
    const job: InternalJob = {
      id,
      idempotencyKey: options.idempotencyKey,
      payload: structuredClone(payload),
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 5,
      availableAt: new Date().toISOString(),
      status: "queued",
      priority: options.priority ?? 0,
    };
    this.jobs.set(id, job);
    this.idempotency.set(options.idempotencyKey, id);
    return { accepted: true, jobId: id };
  }

  async lease(workerId: string, leaseMs: number): Promise<QueueJob | null> {
    const now = Date.now();
    const eligible = [...this.jobs.values()]
      .filter(
        (job) =>
          (job.status === "queued" ||
            (job.status === "leased" && Date.parse(job.leaseExpiresAt ?? "") <= now)) &&
          Date.parse(job.availableAt) <= now,
      )
      .sort(
        (a, b) =>
          b.priority - a.priority || Date.parse(a.availableAt) - Date.parse(b.availableAt),
      );

    const job = eligible[0];
    if (!job) return null;

    job.status = "leased";
    job.workerId = workerId;
    job.attempts += 1;
    job.leaseExpiresAt = new Date(now + leaseMs).toISOString();
    return structuredClone(job);
  }

  async renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "leased" || job.workerId !== workerId) return false;
    job.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    return true;
  }

  async complete(jobId: string, workerId: string): Promise<void> {
    const job = this.requireOwned(jobId, workerId);
    job.status = "completed";
    job.leaseExpiresAt = undefined;
  }

  async fail(jobId: string, workerId: string, error: string): Promise<{ deadLettered: boolean; retryAt?: string }> {
    const job = this.requireOwned(jobId, workerId);
    job.lastError = error;
    job.leaseExpiresAt = undefined;

    if (job.attempts >= job.maxAttempts) {
      job.status = "dead";
      return { deadLettered: true };
    }

    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
    job.status = "queued";
    job.availableAt = new Date(Date.now() + delayMs).toISOString();
    return { deadLettered: false, retryAt: job.availableAt };
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "completed" || job.status === "dead") return false;
    job.status = "cancelled";
    job.leaseExpiresAt = undefined;
    return true;
  }

  private requireOwned(jobId: string, workerId: string): InternalJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown job ${jobId}`);
    if (job.status !== "leased" || job.workerId !== workerId) {
      throw new Error(`Job ${jobId} is not leased by ${workerId}`);
    }
    return job;
  }
}
