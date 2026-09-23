import { createHash } from "node:crypto";

export interface StorageScope {
  installationId: number;
  repository: { owner: string; repo: string };
  taskId?: string;
  runId?: string;
}

export function artifactObjectKey(
  scope: StorageScope,
  kind: string,
  sha256: string,
): string {
  validateStorageScope(scope);
  validateSha256(sha256);
  const task = safeStorageSegment(scope.taskId ?? "unscoped");
  const run = safeStorageSegment(scope.runId ?? "unscoped");
  return `${storageScopePrefix(scope)}/artifacts/${task}/${run}/${safeStorageSegment(kind)}/${sha256}`;
}

export function cacheObjectKey(
  scope: StorageScope,
  cacheKey: string,
  sha256: string,
): string {
  validateStorageScope(scope);
  validateCacheKey(cacheKey);
  validateSha256(sha256);
  const keyHash = createHash("sha256").update(cacheKey).digest("hex");
  return `${storageScopePrefix(scope)}/cache/${keyHash}/${sha256}`;
}

export function storageScopePrefix(scope: StorageScope): string {
  validateStorageScope(scope);
  return `installations/${scope.installationId}/repos/${safeStorageSegment(scope.repository.owner)}/${safeStorageSegment(scope.repository.repo)}`;
}

export function validateStorageScope(scope: StorageScope): StorageScope {
  if (!Number.isSafeInteger(scope.installationId) || scope.installationId <= 0) {
    throw new Error("Storage scope requires a positive installationId");
  }
  safeStorageSegment(scope.repository.owner);
  safeStorageSegment(scope.repository.repo);
  if (scope.taskId !== undefined) safeStorageSegment(scope.taskId);
  if (scope.runId !== undefined) safeStorageSegment(scope.runId);
  return scope;
}

export function validateCacheKey(cacheKey: string): string {
  if (!cacheKey || cacheKey.length > 512 || cacheKey.includes("\0")) {
    throw new Error("Invalid cache key");
  }
  return cacheKey;
}

export function safeStorageSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Unsafe storage namespace segment");
  }
  return normalized.slice(0, 128);
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function validateSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid SHA-256 digest");
}
