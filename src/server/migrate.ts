import { getPool } from "./db";
import { MIGRATIONS } from "./migrations";

/**
 * Apply pending migrations once per process.
 *
 * Uses a transaction-scoped advisory lock so it works with Neon's PgBouncer
 * pooler. Session-level `pg_advisory_lock` previously stuck under pooling and
 * made every `ensureSchema()` API hang until the Vercel 300s timeout (infinite
 * Loading… / missing Sign in on web + Android).
 *
 * If the lock cannot be taken (another migrator, or a leftover session lock),
 * we skip when the schema is already present rather than blocking forever.
 */
export async function migrate(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const locked = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_xact_lock(727274) AS ok");
    if (!locked.rows[0]?.ok) {
      const ready = await client.query<{ ok: boolean }>(
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok",
      );
      await client.query("COMMIT");
      if (ready.rows[0]?.ok) return [];
      throw new Error("Could not acquire migration lock and schema is not ready");
    }

    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [m.name]);
      applied.push(m.name);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
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
