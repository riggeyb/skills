import type { Pool } from "pg";
import type { ObjectStore } from "./object-store.js";
import {
  cacheObjectKey,
  sha256,
  type StorageScope,
  validateCacheKey,
  validateStorageScope,
} from "./storage-scope.js";

export interface CacheHit {
  cacheKey: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  data: Uint8Array;
}

export class CacheStore {
  constructor(
    private readonly pool: Pool,
    private readonly objects: ObjectStore,
  ) {}

  async put(
    scope: StorageScope,
    cacheKey: string,
    data: Uint8Array,
    ttlMs?: number,
  ): Promise<CacheHit> {
    validateStorageScope(scope);
    validateCacheKey(cacheKey);
    if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs < 1_000)) {
      throw new Error("Cache TTL must be an integer of at least 1000ms");
    }

    const digest = sha256(data);
    const objectKey = cacheObjectKey(scope, cacheKey, digest);
    await this.objects.put(objectKey, data);
    const expiresAt = ttlMs === undefined ? null : new Date(Date.now() + ttlMs);

    await this.pool.query(
      `INSERT INTO cache_entries(
         installation_id, repository_owner, repository_name, cache_key,
         object_key, sha256, size_bytes, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (installation_id, repository_owner, repository_name, cache_key)
       DO UPDATE SET
         object_key = EXCLUDED.object_key,
         sha256 = EXCLUDED.sha256,
         size_bytes = EXCLUDED.size_bytes,
         expires_at = EXCLUDED.expires_at,
         last_accessed_at = now()`,
      [
        scope.installationId,
        scope.repository.owner,
        scope.repository.repo,
        cacheKey,
        objectKey,
        digest,
        data.byteLength,
        expiresAt,
      ],
    );

    return { cacheKey, objectKey, sha256: digest, sizeBytes: data.byteLength, data };
  }

  async get(scope: StorageScope, cacheKey: string): Promise<CacheHit | null> {
    validateStorageScope(scope);
    validateCacheKey(cacheKey);
    const result = await this.pool.query(
      `SELECT cache_key, object_key, sha256, size_bytes, expires_at
       FROM cache_entries
       WHERE installation_id = $1
         AND repository_owner = $2
         AND repository_name = $3
         AND cache_key = $4`,
      [scope.installationId, scope.repository.owner, scope.repository.repo, cacheKey],
    );
    if (result.rowCount !== 1) return null;
    const row = result.rows[0];

    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
      await this.pool.query(
        `DELETE FROM cache_entries
         WHERE installation_id = $1 AND repository_owner = $2
           AND repository_name = $3 AND cache_key = $4`,
        [scope.installationId, scope.repository.owner, scope.repository.repo, cacheKey],
      );
      return null;
    }

    const data = await this.objects.get(row.object_key);
    if (!data) return null;
    if (sha256(data) !== row.sha256) {
      throw new Error(`Cache entry ${cacheKey} failed SHA-256 verification`);
    }

    await this.pool.query(
      `UPDATE cache_entries SET last_accessed_at = now()
       WHERE installation_id = $1 AND repository_owner = $2
         AND repository_name = $3 AND cache_key = $4`,
      [scope.installationId, scope.repository.owner, scope.repository.repo, cacheKey],
    );

    return {
      cacheKey: row.cache_key,
      objectKey: row.object_key,
      sha256: row.sha256,
      sizeBytes: Number(row.size_bytes),
      data,
    };
  }
}
