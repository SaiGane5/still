import { getPool } from "./db";
import { MIGRATIONS } from "./migrations";

export async function migrate(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      try {
        await client.query("BEGIN");
        await client.query(m.sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
        await client.query("COMMIT");
        applied.push(m.name);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
  return applied;
}

let ready: Promise<unknown> | null = null;
/** Applies pending migrations once per server instance (serverless-friendly). */
export function ensureSchema() {
  ready ??= migrate().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
