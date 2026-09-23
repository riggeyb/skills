import type { TaskOrigin } from "./types.js";
import type { TaskStore } from "./ports.js";

export class TaskBootstrapper {
  constructor(private readonly store: TaskStore) {}

  async start(objective: string, origin: TaskOrigin): Promise<void> {
    await this.store.create(objective, origin, []);
  }
}
