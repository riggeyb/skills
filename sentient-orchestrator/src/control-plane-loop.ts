import type { WorkerScheduler, WorkerSupervisor } from "./worker-scheduler.js";
import type { AutomaticLeadSupervisor } from "./automatic-lead-supervisor.js";
import type { WorkerRuntimeReconciler } from "./worker-runtime-reconciler.js";

export interface ControlPlaneLoopOptions {
  idlePollMs?: number;
  signal?: AbortSignal;
}

export async function runControlPlaneLoop(
  scheduler: WorkerScheduler,
  reconciler: WorkerRuntimeReconciler,
  lead: AutomaticLeadSupervisor,
  supervisor: WorkerSupervisor,
  options: ControlPlaneLoopOptions = {},
): Promise<void> {
  const idlePollMs = options.idlePollMs ?? 250;

  while (!options.signal?.aborted) {
    let active = false;
    try {
      const scheduled = await scheduler.tick();
      active = Boolean(scheduled) || active;

      const reconciled = await reconciler.tick();
      active = reconciled > 0 || active;

      const leadResult = await lead.tick();
      active = Boolean(leadResult) || active;

      const recovered = await supervisor.recoverStale();
      active = recovered > 0 || active;
    } catch (error) {
      console.error("[sentient] control-plane tick failed", error);
    }

    if (!active) await sleep(idlePollMs, options.signal);
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
