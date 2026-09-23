import { randomUUID } from "node:crypto";
import type { JobQueue } from "./ports.js";
import type { Orchestrator } from "./orchestrator.js";

export interface WorkerLoopOptions {
  leaseMs?: number;
  idlePollMs?: number;
  workerId?: string;
  signal?: AbortSignal;
}

export async function runWorkerLoop(
  queue: JobQueue,
  orchestrator: Orchestrator,
  options: WorkerLoopOptions = {},
): Promise<void> {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const leaseMs = options.leaseMs ?? 60_000;
  const idlePollMs = options.idlePollMs ?? 500;

  while (!options.signal?.aborted) {
    const job = await queue.lease(workerId, leaseMs);
    if (!job) {
      await sleep(idlePollMs, options.signal);
      continue;
    }

    try {
      if (job.payload.type === "task.start") {
        await orchestrator.start(job.payload.objective, job.payload.origin);
      } else {
        const exhaustive: never = job.payload;
        throw new Error(`Unsupported job payload ${(exhaustive as { type?: string }).type ?? "unknown"}`);
      }
      await queue.complete(job.id, workerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = await queue.fail(job.id, workerId, message);
      const disposition = result.deadLettered ? "dead-lettered" : `retry scheduled at ${result.retryAt}`;
      console.error(`[sentient] job ${job.id} failed: ${message}; ${disposition}`);
    }
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
