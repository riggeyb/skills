import { Pool } from "pg";

export function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable DATABASE_URL");
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 5_000),
    ssl: process.env.DB_SSL === "require" ? { rejectUnauthorized: true } : undefined,
  });
}
