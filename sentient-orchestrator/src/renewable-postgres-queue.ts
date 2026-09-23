import type { Pool } from "pg";
import type { RenewableJobQueue } from "./ports.js";
import { PostgresJobQueue } from "./postgres.js";

export class RenewablePostgresJobQueue extends PostgresJobQueue implements RenewableJobQueue {
  constructor(private readonly leasePool: Pool) {
    super(leasePool);
  }

  async renew(jobId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const result = await this.leasePool.query(
      `UPDATE jobs
       SET lease_expires_at = now() + ($3 * interval '1 millisecond'),
           updated_at = now()
       WHERE id = $1
         AND status = 'leased'
         AND worker_id = $2
       RETURNING id`,
      [jobId, workerId, leaseMs],
    );
    return result.rowCount === 1;
  }
}
