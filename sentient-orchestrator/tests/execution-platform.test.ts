import assert from "node:assert/strict";
import test from "node:test";
import {
  validateSandboxSpec,
  type SandboxSpec,
} from "../src/sandbox.js";
import {
  safeSegment,
  validateGitRef,
  workspaceBranch,
} from "../src/workspace.js";
import {
  ActionsExecutor,
  parseSentientWorkflow,
  type ActionJob,
  type ActionJobResult,
  type ActionJobRunner,
  type ActionExecutionContext,
} from "../src/actions.js";
import {
  artifactObjectKey,
  cacheObjectKey,
  sha256,
} from "../src/storage-scope.js";
import { buildCheckAnnotation } from "../src/github-checks.js";

const image = `ghcr.io/sentient/runner@sha256:${compact = "a".repeat(64)}`;

function sandbox(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image,
    cpuCores: 2,
    memoryMb: 4096,
    diskMb: 10_240,
    maxPids: 512,
    timeoutMs: 60_000,
    egress: { mode: "deny-all" },
    ...overrides,
  };
}

test("sandbox policy requires pinned images and unexpired secrets", () => {
  assert.throws(
    () => validateSandboxSpec(sandbox({ image: "ghcr.io/sentient/runner:latest" })),
    /sha256/,
  );
  assert.throws(
    () =>
      validateSandboxSpec(
        sandbox({
          secrets: [
            {
              name: "TOKEN",
              value: "secret",
              expiresAt: new Date(Date.now() - 1_000).toISOString(),
            },
          ],
        }),
      ),
     /expired/,
  );
});

test("sandbox egress allow-list validates hosts", () => {
  assert.throws(
    () =>
      validateSandboxSpec(
        sandbox({ egress: { mode: "allow-list", hosts: ["../metadata"] } }),
      ),
    /Invalid egress host/,
  );
});

test("workspace naming and refs reject traversal-like inputs", () => {
  assert.equal(workspaceBranch("Task 123", "Backend Agent"), "sentient/task-123/backend-agent");
  assert.equal(safeSegment("Org/Repo"), "org-repo");
  assert.equal(validateGitRef("main"), "main");
  assert.throws(() => validateGitRef("../main"), /Invalid git ref/);
  assert.throws(() => validateGitRef("-danger"), /Invalid git ref/);
  assert.throws(() => validateGitRef("feature bad"), /Invalid git ref/);
});

class RecordingRunner implements ActionJobRunner {
  active = 0;
  peak = 0;
  starts: string[] = [];

  async run(job: ActionJob, _context: ActionExecutionContext): Promise<ActionJobResult> {
    this.active += 1;
    this.peak = Math.max(this.peak, this.active);
    this.starts.push(job.key);
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.active -= 1;
    return { jobKey: job.key, status: "completed", attempts: 1, summary: "ok", logs: "" };
  }
}

test("Sentient Actions parses YAML and runs independent jobs in parallel", async () => {
  const workflow = parseSentientWorkflow(`
version: 1
name: ci
jobs:
  lint:
    image: ${image}
    steps:
      - run: npm run lint
  test:
    image: ${image}
    steps:
      - run: npm test
  build:
    image: ${image}
    needs: [lint, test]
    steps:
      - run: npm run build
`);

  const runner = new RecordingRunner();
  const result = await new ActionsExecutor(runner, 2).execute(workflow, {
    installationId: 1,
    repository: { owner: "riggeyb", repo: "skills" },
    taskId: "task-1",
    cloneUrl: "https://github.com/riggeyb/skills.git",
    baseRef: "main",
  });

  assert.equal(result.status, "completed");
  assert.equal(runner.peak, 2);
  assert.ok(runner.starts.indexOf("build") > runner.starts.indexOf("lint"));
  assert.ok(runner.starts.indexOf("build") > runner.starts.indexOf("test"));
});

test("storage object keys cannot collide across installations", () => {
  const data = new TextEncoder().encode("payload");
  const digest = sha256(data);
  const scope1 = { installationId: 1, repository: { owner: "riggeyb", repo: "skills" }, taskId: "task", runId: "run" };
  const scope2 = { ...scope1, installationId: 2 };

  assert.notEqual(artifactObjectKey(scope1, "logs", digest), artifactObjectKey(scope2, "logs", digest));
  assert.notEqual(cacheObjectKey(scope1, "pnpm-lock", digest), cacheObjectKey(scope2, "pnpm-lock", digest));
});

test("GitHub check annotations normalize valid lines and reject unsafe paths", () => {
  assert.deepEqual(buildCheckAnnotation({ path: "src/index.ts", startLine: 4, level: "warning", message: "example" }), { path: "src/index.ts", start_line: 4, end_line: 4, annotation_level: "warning", message: "example" });
  assert.throws(() => buildCheckAnnotation({ path: "../secret", startLine: 1, level: "failure", message: "bad" }), /Invalid check annotation path/);
});
