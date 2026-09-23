import type { Pool } from "pg";
import type { ObjectStore } from "./object-store.js";
import {
  artifactObjectKey,
  safeStorageSegment,
  sha256,
  type StorageScope,
  validateStorageScope,
} from "./storage-scope.js";

export interface ArtifactRecord {
  id: string;
  installationId: number;
  repository: { owner: string; repo: string };
  taskId?: string;
  runId?: string;
  kind: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class ArtifactStore {
  constructor(
    private readonly pool: Pool,
    private readonly objects: ObjectStore,
  ) {}

  async put(
    scope: StorageScope,
    kind: string,
    data: Uint8Array,
    metadata: Record<string, unknown> = {},
  ): Promise<ArtifactRecord> {
    validateStorageScope(scope);
    const safeKind = safeStorageSegment(kind);
    const digest = sha256(data);
    const objectKey = artifactObjectKey(scope, safeKind, digest);
    await this.objects.put(objectKey, data);

    const result = await this.pool.query(
      `INSERT INTO artifacts(
         installation_id, repository_owner, repository_name, task_id, run_id,
         kind, object_key, sha256, size_bytes, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (object_key) DO UPDATE
       SET metadata = artifacts.metadata || EXCLUDED.metadata
       RETURNING id, installation_id, repository_owner, repository_name,
                 task_id, run_id, kind, object_key, sha256, size_bytes, metadata, created_at`,
      [
        scope.installationId,
        scope.repository.owner,
        scope.repository.repo,
        scope.taskId ?? null,
        scope.runId ?? null,
        safeKind,
        objectKey,
        digest,
        data.byteLength,
        JSON.stringify(metadata),
      ],
    );
    return mapArtifact(result.rows[0]);
  }

  async get(record: ArtifactRecord): Promise<Uint8Array> {
    const data = await this.objects.get(record.objectKey);
    if (!data) throw new Error(`Artifact object ${record.objectKey} is missing`);
    if (sha256(data) !== record.sha256) {
      throw new Error(`Artifact ${record.id} failed SHA-256 verification`);
    }
    return data;
  }
}

function mapArtifact(row: any): ArtifactRecord {
  return {
    id: row.id,
    installationId: Number(row.installation_id),
    repository: { owner: row.repository_owner, repo: row.repository_name },
    taskId: row.task_id ?? undefined,
    runId: row.run_id ?? undefined,
    kind: row.kind,
    objectKey: row.object_key,
    sha256: row.sha256,
    sizeBytes: Number(row.size_bytes),
    metadata: row.metadata ?? {},
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}
