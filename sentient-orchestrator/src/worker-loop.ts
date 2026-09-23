import { randomUUID } from "node:crypto";
import type { RenewableJobQueue } from "./ports.js";
import type { TaskOrigin } from "./types.js";

export interface TaskStarter {
  start(objective: string, origin: TaskOrigin): Promise<unknown>;
}

export interface WorkerLoopOptions {
  leaseMs?: number;
  idlePollMs?: number;
  workerId?: string;
  signal?: AbortSignal;
}

export async function runWorkerLoop(
  queue: RenewableJobQueue,
  starter: TaskStarter,
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

    let leaseLost = false;
    const heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3));
    const heartbeat = setInterval(() => {
      void queue
        .renew(job.id, workerId, leaseMs)
        .then((renewed) => {
          if (!renewed) leaseLost = true;
        })
        .catch((error) => {
          leaseLost = true;
          console.error(`[sentient] lease renewal failed for job ${job.id}`, error);
        });
    }, heartbeatMs);
    heartbeat.unref();

    try {
      await starter.start(job.payload.objective, job.payload.origin);

      if (leaseLost) throw new Error(`Lease lost while processing job ${job.id}`);
      await queue.complete(job.id, workerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        const result = await queue.fail(job.id, workerId, message);
        const disposition = result.deadLettered ? "dead-lettered" : `retry scheduled at ${result.retryAt}`;
        console.error(`[sentient] job ${job.id} failed: ${message}; ${disposition}`);
      } catch (leaseError) {
        const leaseMessage = leaseError instanceof Error ? leaseError.message : String(leaseError);
        console.error(
          `[sentient] job ${job.id} failed after losing queue ownership: ${message}; ${leaseMessage}`,
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
