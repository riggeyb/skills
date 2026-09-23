import type { WorkerScheduler, WorkerSupervisor } from "./worker-scheduler.js";
import type { AutomaticLeadSupervisor } from "./automatic-lead-supervisor.js";
import type { WorkerRuntimeReconciler } from "./worker-runtime-reconciler.js";

export interface ControlPlaneLoopOptions {
  pollMs?: number;
  signal?: AbortSignal;
}

export async function runControlPlaneLoop(
  scheduler: WorkerScheduler,
  reconciler: WorkerRuntimeReconciler,
  lead: AutomaticLeadSupervisor,
  supervisor: WorkerSupervisor,
  options: ControlPlaneLoopOptions = {},
): Promise<void> {
  const pollMs = options.pollMs ?? 250;

  while (!options.signal?.aborted) {
    try {
      await scheduler.tick();
      await reconciler.tick();
      await lead.tick();
      await supervisor.recoverStale();
    } catch (error) {
      console.error("[sentient] control-plane tick failed", error);
    }
    await sleep(pollMs, options.signal);
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
