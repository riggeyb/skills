import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { RemoteSentientRuntime } from "../src/remote-sentient-runtime.js";
import type { RuntimeRequirements, SentientWorker } from "../src/worker-control.js";

const worker: SentientWorker = {
  id: "11111111-1111-4111-8111-111111111111",
  spawnRequestId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  tenant: "tenant-a",
  role: "backend",
  assignment: { objective: "bounded change" },
  status: "assigned",
  attemptCount: 1,
  spentUsd: 0,
  correlationId: "44444444-4444-4444-8444-444444444444",
};
const requirements: RuntimeRequirements = { capabilities: ["remote-worker"], maxCostUsd: 0.25 };
const handoff = {
  handoffId: "handoff-1",
  objective: "bounded change",
  completedWork: ["implemented"],
  filesCommitsArtifacts: ["commit:abc"],
  findings: [],
  unresolvedQuestions: [],
  dependencies: [],
  testsResults: ["pass"],
  risks: [],
  recommendedNextAction: "review",
};

test("remote Sentient runtime exchanges identity, assignment contract and typed result", async () => {
  const seen: Array<{method?: string; url?: string; authorization?: string; body?: any}> = [];
  const server = createServer(async (req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: await body(req) });
    if (req.method === "POST" && req.url === "/v1/workers") return json(res, { handle: "h1" });
    if (req.method === "POST" && req.url === "/v1/workers/h1/assignment") return json(res, {});
    if (req.method === "GET" && req.url === "/v1/workers/h1") return json(res, { status: "completed", spentUsd: 0.01, result: handoff });
    return json(res, {}, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const runtime = new RemoteSentientRuntime({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "secret",
      capabilities: ["remote-worker"],
      timeoutMs: 2_000,
    });

    const { handle } = await runtime.spawn(worker, requirements);
    await runtime.assign(handle, worker.assignment);
    const state = await runtime.inspect(handle);

    assert.equal(handle, "h1");
    assert.equal(state.status, "completed");
    assert.equal(state.spentUsd, 0.01);
    assert.deepEqual(state.result, handoff);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((entry) => entry.authorization === "Bearer secret"));
    assert.equal(seen[0].body.protocolVersion, "1.0");
    assert.equal(seen[0].body.sentient.workerId, worker.id);
    assert.equal(seen[0].body.sentient.taskId, worker.taskId);
    assert.equal(seen[0].body.sentient.role, "backend");
    assert.equal(seen[1].body.reportingContract.terminalResult.format, "sentient-handoff-v1");
    assert.ok(seen[1].body.reportingContract.terminalResult.fields.includes("handoffId"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("remote Sentient runtime rejects unsafe HTTP and invalid state", async () => {
  assert.throws(() => new RemoteSentientRuntime({ baseUrl: "http://example.com" }), /must use HTTPS/);
  const server = createServer((_req, res) => json(res, { status: "invented" }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const runtime = new RemoteSentientRuntime({ baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 2_000 });
    await assert.rejects(() => runtime.inspect("bad"), /invalid status/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}
function json(res: ServerResponse, value: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}
