import { Pool, type PoolClient } from "pg";

const globalForPg = globalThis as unknown as { __stillPool?: Pool };

export function getPool(): Pool {
  if (!globalForPg.__stillPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not configured");
    globalForPg.__stillPool = new Pool({
      connectionString: url,
      // Neon's pooler (pgbouncer) is happiest with a small client pool and no named statements.
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
    });
    globalForPg.__stillPool.on("error", (err) => console.error("pg pool error", err.message));
  }
  return globalForPg.__stillPool;
}

export async function closePool() {
  await globalForPg.__stillPool?.end();
  globalForPg.__stillPool = undefined;
}

export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Transaction that first takes a row lock on the user. Every state-changing queue
 * operation goes through this, so concurrent/duplicate requests for one user serialise.
 */
export async function withUserLock<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withTx(async (c) => {
    const { rowCount } = await c.query("SELECT 1 FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
    if (!rowCount) throw new Error("user not found");
    return fn(c);
  });
}
