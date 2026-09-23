import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionsExecutor,
  parseSentientWorkflow,
  type ActionExecutionContext,
  type ActionJob,
  type ActionJobResult,
  type ActionJobRunner,
} from "../src/actions.js";
import { buildCheckAnnotation } from "../src/github-checks.js";
import { validateRefName } from "../src/github-pr.js";
import { validateSandboxSpec } from "../src/sandbox.js";
import {
  artifactObjectKey,
  cacheObjectKey,
  sha256,
  type StorageScope,
} from "../src/storage-scope.js";
import {
  safeSegment,
  validateGitRef,
  workspaceBranch,
} from "../src/workspace.js";

const digest = "a".repeat(64);
const image = `ghcr.io/sentient/runner@sha256:${digest}`;

test("sandbox requires immutable image, resource limits and unexpired secrets", () => {
  const spec = validateSandboxSpec({
    image,
    cpuCores: 2,
    memoryMb: 4096,
    diskMb: 10_240,
    maxPids: 512,
    timeoutMs: 60_000,
    egress: { mode: "allow-list", hosts: ["github.com"] },
    secrets: [
      {
        name: "GITHUB_TOKEN",
        value: "ephemeral",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    ],
  });
  assert.equal(spec.image, image);
  assert.throws(
    () =>
      validateSandboxSpec({
        ...spec,
        image: "ghcr.io/sentient/runner:latest",
      }),
    /pinned by sha256/,
  );
  assert.throws(
    () =>
      validateSandboxSpec({
        ...spec,
        egress: { mode: "allow-list", hosts: [""] },
      }),
    /Invalid egress host/,
  );
});

test("workspace naming and refs reject traversal-style inputs", () => {
  assert.equal(workspaceBranch("task-1", "backend-1"), "sentient/task-1/backend-1");
  assert.equal(safeSegment("Feature/API"), "feature-api");
  assert.equal(validateGitRef("main"), "main");
  assert.throws(() => validateGitRef("../main"), /Invalid git ref/);
  assert.throws(() => validateGitRef("main lock"), /Invalid git ref/);
  assert.throws(() => validateRefName("refs//heads/main"), /Invalid Git ref/);
});

test("Sentient Actions parses YAML and runs independent jobs before dependent review", async () => {
  const workflow = parseSentientWorkflow(`
version: 1
name: verification
jobs:
  api:
    image: ${image}
    steps:
      - run: npm test
  ui:
    image: ${image}
    steps:
      - run: npm run typecheck
  review:
    image: ${image}
    needs: [api, ui]
    steps:
      - run: npm run lint
`);

  const events: string[] = [];
  let active = 0;
  let peak = 0;
  const runner: ActionJobRunner = {
    async run(job: ActionJob): Promise<ActionJobResult> {
      active += 1;
      peak = Math.max(peak, active);
      events.push(`start:${job.key}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`end:${job.key}`);
      active -= 1;
      return {
        jobKey: job.key,
        status: "completed",
        attempts: 1,
        summary: "ok",
        logs: "",
      };
    },
  };

  const context: ActionExecutionContext = {
    installationId: 1,
    repository: { owner: "riggeyb", repo: "skills" },
    taskId: "task-1",
    cloneUrl: "https://github.com/riggeyb/skills.git",
    baseRef: "main",
  };
  const result = await new ActionsExecutor(runner, 2).execute(workflow, context);

  assert.equal(result.status, "completed");
  assert.equal(peak, 2);
  assert.ok(events.indexOf("start:review") > events.indexOf("end:api"));
  assert.ok(events.indexOf("start:review") > events.indexOf("end:ui"));
});

test("Sentient Actions rejects dependency cycles", () => {
  assert.throws(
    () =>
      parseSentientWorkflow(`
version: 1
name: bad
jobs:
  a:
    image: ${image}
    needs: [b]
    steps: [{run: "true"}]
  b:
    image: ${image}
    needs: [a]
    steps: [{run: "true"}]
`),
    /dependency cycle/,
  );
});

test("artifact and cache namespaces cannot collide across installations", () => {
  const base: StorageScope = {
    installationId: 10,
    repository: { owner: "Riggeyb", repo: "Skills" },
    taskId: "task-1",
    runId: "run-1",
  };
  const other: StorageScope = { ...base, installationId: 11 };
  const dataDigest = sha256(new TextEncoder().encode("payload"));

  assert.notEqual(
    artifactObjectKey(base, "logs", dataDigest),
    artifactObjectKey(other, "logs", dataDigest),
  );
  assert.notEqual(
    cacheObjectKey(base, "npm-linux-node22", dataDigest),
    cacheObjectKey(other, "npm-linux-node22", dataDigest),
  );
});

test("GitHub annotation payload validates file paths and line ranges", () => {
  assert.deepEqual(
    buildCheckAnnotation({
      path: "src/index.ts",
      startLine: 4,
      endLine: 6,
      level: "warning",
      message: "Potential issue",
      title: "Review",
    }),
    {
      path: "src/index.ts",
      start_line: 4,
      end_line: 6,
      annotation_level: "warning",
      message: "Potential issue",
      title: "Review",
    },
  );
  assert.throws(
    () =>
      buildCheckAnnotation({
        path: "../secret",
        startLine: 1,
        level: "failure",
        message: "bad",
      }),
    /Invalid check annotation path/,
  );
});
