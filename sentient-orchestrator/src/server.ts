import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createDemoAgents } from "./agents.js";
import { GitHubAppTokenProvider, GitHubIssueProgressSink, ConsoleProgressSink } from "./github.js";
import { ModelRouter } from "./model-router.js";
import { Orchestrator } from "./orchestrator.js";
import { InMemoryTaskStore } from "./store.js";
import { handleGitHubWebhook } from "./webhook.js";

const webhookSecret = required("GITHUB_WEBHOOK_SECRET");
const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n");

const progress =
  appId && privateKey
    ? new GitHubIssueProgressSink(new GitHubAppTokenProvider(appId, privateKey))
    : new ConsoleProgressSink();

const orchestrator = new Orchestrator(
  new InMemoryTaskStore(),
  createDemoAgents(),
  new ModelRouter(),
  progress,
);

const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      return json(response, 200, { ok: true });
    }

    if (request.method === "POST" && request.url === "/api/github/webhooks") {
      const rawBody = await readBody(request);
      const result = await handleGitHubWebhook({
        eventName: header(request, "x-github-event"),
        deliveryId: header(request, "x-github-delivery"),
        signature: header(request, "x-hub-signature-256"),
        rawBody,
        webhookSecret,
        orchestrator,
      });
      return json(response, result.accepted ? 202 : 200, result);
    }

    json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    json(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}).listen(port, () => {
  console.log(`Sentient orchestrator listening on :${port}`);
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
