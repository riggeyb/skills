import type { Pool } from "pg";
import type { RuntimeRegistry } from "./worker-control.js";
import { WorkerStore } from "./worker-store.js";

export interface WorkerRuntimeReconcilerOptions {
  leaseMs?: number;
  batchSize?: number;
}

export class WorkerRuntimeReconciler {
  private readonly leaseMs: number;
  private readonly batchSize: number;

  constructor(\n` |