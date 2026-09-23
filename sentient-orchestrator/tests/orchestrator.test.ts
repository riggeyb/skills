import assert from "node:assert/strict";
import test from "node:test";
import { createDemoAgents } from "../src/agents.js";
import { ModelRouter } from "../src/model-router.js";
import { Orchestrator } from "../src/orchestrator.js";
import { InMemoryTaskStore } from "../src/store.js";
import type { ProgressEvent, ProgressSink } from "../src/types.js";

class RecordingProgressSink implements ProgressSink {
  readonly events: ProgressEvent[] = [];
  async publish(event: ProgressEvent): Promise<void> {
    this.events.push(structuredClone(event));
  }
}

test("orchestrator completes planner, parallel agents, then reviewer", async () => {
  const store = new InMemoryTaskStore();
  const progress = new RecordingProgressSink();
  const orchestrator = new Orchestrator(store, createDemoAgents(), new ModelRouter(), progress);

  const task = await orchestrator.start("Build organization API keys", {
    repository: { owner: "riggeyb", repo: "skills" },
    issueNumber: 1,
    installationId: 123,
    deliveryId: "delivery-1",
    requestedBy: "tester",
  });

  assert.equal(task.status, "completed");
  assert.equal(task.agents.every((agent) => agent.status === "completed"), true);
  assert.equal(task.messages.some((message) => message.role === "backend"), true);
  assert.equal(task.messages.at(-1)?.role, "system");
  assert.equal(progress.events.at(-1)?.headline, "Task completed");
});

test("delivery retries resolve to the same durable task", async () => {
  const store = new InMemoryTaskStore();
  const orchestrator = new Orchestrator(
    store,
    createDemoAgents(),
    new ModelRouter(),
    new RecordingProgressSink(),
  );
  const origin = {
    repository: { owner: "riggeyb", repo: "skills" },
    issueNumber: 1,
    installationId: 123,
    deliveryId: "same-delivery",
    requestedBy: "tester",
  };

  const first = await orchestrator.start("first", origin);
  const retry = await orchestrator.start("second", origin);

  assert.equal(retry.id, first.id);
  assert.equal(retry.objective, "first");
  assert.equal(retry.status, "completed");
});
