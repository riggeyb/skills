import {
  GitHubApiClient,
  GitHubAppTokenProvider,
  GitHubRateLimitError,
} from "./github.js";
import type { AuthorizationService } from "./authorization.js";
import type {
  PostgresProgressOutbox,
  ProgressDelivery,
} from "./progress-outbox.js";
import { SecretRedactor } from "./redaction.js";

export class GitHubProgressDestination {
  constructor(
    private readonly tokens: GitHubAppTokenProvider,
    private readonly authorization: AuthorizationService,
  ) {}

  async deliver(delivery: ProgressDelivery): Promise<void> {
    await this.authorization.require({
      principal: {
        installationId: delivery.installationId,
        principalId: "sentient-reporter",
        principalType: "service",
      },
      scope: {
        installationId: delivery.installationId,
        repository: delivery.repository,
      },
      action: "progress.publish",
      metadata: {
        taskId: delivery.taskId,
        destination: delivery.destination,
      },
    });

    if (delivery.destination === "issue_comment") {
      await this.issueComment(delivery);
      return;
    }
    await this.discussionComment(delivery);
  }

  private async issueComment(delivery: ProgressDelivery): Promise<void> {
    if (!delivery.issueNumber || delivery.issueNumber < 1) {
      throw new Error(`Progress delivery ${delivery.id} is missing issueNumber`);
    }
    const token = await this.tokens.getToken(delivery.installationId, {
      permissions: { issues: "write" },
    });
    const client = new GitHubApiClient(token);
    await client.request(
      `/repos/${encodeURIComponent(delivery.repository.owner)}/${encodeURIComponent(delivery.repository.repo)}/issues/${delivery.issueNumber}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body: delivery.body }),
      },
    );
  }

  private async discussionComment(delivery: ProgressDelivery): Promise<void> {
    if (!delivery.destinationRef) {
      throw new Error(`Progress delivery ${delivery.id} is missing discussion node id`);
    }
    const token = await this.tokens.getToken(delivery.installationId, {
      permissions: { discussions: "write" },
    });
    const client = new GitHubApiClient(token);
    const response = await client.request("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query:
          "mutation SentientProgress($discussionId: ID!, $body: String!, $clientMutationId: String!) {" +
          " addDiscussionComment(input: {discussionId: $discussionId, body: $body, clientMutationId: $clientMutationId}) {" +
          " comment { id } } }",
        variables: {
          discussionId: delivery.destinationRef,
          body: delivery.body,
          clientMutationId: delivery.id,
        },
      }),
    });
    const body = (await response.json()) as {
      errors?: Array<{ message?: string }>;
      data?: { addDiscussionComment?: { comment?: { id?: string } } };
    };
    if (body.errors?.length) {
      throw new Error(
        `GitHub discussion comment failed: ${body.errors
          .map((error) => error.message ?? "unknown error")
          .join("; ")}`,
      );
    }
    if (!body.data?.addDiscussionComment?.comment?.id) {
      throw new Error("GitHub discussion comment returned no comment id");
    }
  }
}

export async function runProgressReporterLoop(
  outbox: PostgresProgressOutbox,
  destination: GitHubProgressDestination,
  options: {
    workerId: string;
    leaseMs?: number;
    idlePollMs?: number;
    signal?: AbortSignal;
    redactor?: SecretRedactor;
  },
): Promise<void> {
  const leaseMs = options.leaseMs ?? 60_000;
  const idlePollMs = options.idlePollMs ?? 750;
  const redactor = options.redactor ?? new SecretRedactor();

  while (!options.signal?.aborted) {
    const delivery = await outbox.lease(options.workerId, leaseMs);
    if (!delivery) {
      await sleep(idlePollMs, options.signal);
      continue;
    }

    try {
      await destination.deliver(delivery);
      await outbox.complete(delivery.id, options.workerId);
    } catch (error) {
      const message = redactor
        .redact(error instanceof Error ? error.message : String(error))
        .slice(0, 8_000);
      const retryAt =
        error instanceof GitHubRateLimitError
          ? error.retryAt
          : undefined;
      const result = await outbox.fail(
        delivery.id,
        options.workerId,
        message,
        retryAt,
      );
      if (result.deadLettered) {
        console.error(
          `[sentient] progress delivery ${delivery.id} dead-lettered: ${message}`,
        );
      }
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
