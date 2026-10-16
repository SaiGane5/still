import type { PoolClient } from "pg";
import { z } from "zod";
import { getPool, withUserLock } from "./db";
import { HttpError } from "./http-error";
import { MAX_SECONDS, MIN_SECONDS, type AppState, type Task } from "@/lib/types";

type Q = Pick<PoolClient, "query">;

/** Remaining time right now, derived from the stored anchor (never trusts the client clock). */
const REMAINING = "COALESCE(remaining_seconds, planned_duration_seconds)";
const EFFECTIVE = `CASE WHEN timer_running
  THEN GREATEST(0, ${REMAINING} - FLOOR(EXTRACT(EPOCH FROM (now() - timer_anchor_at)))::int)
  ELSE ${REMAINING} END`;

const COLS = `id, title, COALESCE(description, '') AS description, planned_duration_seconds AS planned_seconds, ${EFFECTIVE} AS remaining_seconds, status, queue_position AS position,
  timer_running, created_at, updated_at, completed_at`;

function toTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    plannedSeconds: r.planned_seconds,
    remainingSeconds: r.remaining_seconds,
    status: r.status,
    position: r.position,
    timerRunning: r.timer_running,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  };
}

export const durationSchema = z.number().int().min(MIN_SECONDS).max(MAX_SECONDS);
export const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  plannedSeconds: durationSchema,
});
export const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000),
    plannedSeconds: durationSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "nothing to update");

const uuid = z.string().uuid();
export const parseId = (id: string) => {
  const r = uuid.safeParse(id);
  if (!r.success) throw new HttpError(404, "not_found", "Task not found");
  return r.data;
};

export async function loadState(q: Q, userId: string, timezone = "UTC", extra: Partial<AppState> = {}): Promise<AppState> {
  const tasks = await q.query(`SELECT ${COLS} FROM tasks WHERE user_id = $1 AND status = 'pending' ORDER BY queue_position, created_at`, [userId]);
  const prog = await q.query(
      `SELECT
         (SELECT count(*)::int FROM tasks WHERE user_id = $1 AND status = 'completed'
            AND (completed_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS completed_today,
         (SELECT COALESCE(sum(elapsed_seconds), 0)::int FROM focus_sessions WHERE user_id = $1 AND status = 'completed'
            AND (ended_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date) AS focused_today`,
      [userId, timezone],
  );
  const now = await q.query("SELECT now() AS now");
  return {
    tasks: tasks.rows.map(toTask),
    progress: {
      completedToday: prog.rows[0].completed_today,
      pendingCount: tasks.rowCount ?? 0,
      focusedSecondsToday: prog.rows[0].focused_today,
    },
    serverNow: now.rows[0].now.toISOString(),
    ...extra,
  };
}

export const getState = (userId: string, tz: string) => loadState(getPool(), userId, tz);

async function headId(c: Q, userId: string): Promise<string | null> {
  const { rows } = await c.query(
    "SELECT id FROM tasks WHERE user_id = $1 AND status = 'pending' ORDER BY queue_position, created_at LIMIT 1",
    [userId],
  );
  return rows[0]?.id ?? null;
}

/** Freeze a task's timer at its current effective remaining time. */
async function freeze(c: Q, taskId: string) {
  await c.query(
    `UPDATE tasks SET remaining_seconds = ${EFFECTIVE}, timer_running = false, timer_anchor_at = now(), updated_at = now()
     WHERE id = $1 AND timer_running`,
    [taskId],
  );
}

/** After any queue change: make sure only the head may run, and promote it if it changed. */
async function settleHead(c: Q, userId: string, prevHead: string | null, startNext: boolean) {
  const head = await headId(c, userId);
  if (head === prevHead || !head) return;
  // Any other pending task that is somehow running is frozen so two timers can never tick.
  await c.query(
    `UPDATE tasks SET remaining_seconds = ${EFFECTIVE}, timer_running = false, timer_anchor_at = now()
     WHERE user_id = $1 AND status = 'pending' AND timer_running AND id <> $2`,
    [userId, head],
  );
  await c.query(
    `UPDATE tasks SET remaining_seconds = CASE WHEN ${REMAINING} = 0 THEN planned_duration_seconds ELSE ${REMAINING} END,
       timer_running = $2, timer_anchor_at = now(), updated_at = now() WHERE id = $1`,
    [head, startNext],
  );
}

async function lockTask(c: Q, userId: string, id: string) {
  const { rows } = await c.query(
    `SELECT id, status, planned_duration_seconds AS planned_seconds, ${EFFECTIVE} AS effective, timer_running FROM tasks WHERE id = $1 AND user_id = $2 FOR UPDATE`,
    [id, userId],
  );
  if (!rows[0]) throw new HttpError(404, "not_found", "Task not found");
  return rows[0] as { id: string; status: string; planned_seconds: number; effective: number; timer_running: boolean };
}

async function record(c: Q, userId: string, t: { id: string; planned_seconds: number; effective: number }, outcome: string) {
  const focused = Math.max(0, t.planned_seconds - t.effective);
  await c.query(
    `INSERT INTO focus_sessions (task_id, user_id, status, planned_duration_seconds, elapsed_seconds, started_at, ended_at)
     VALUES ($1,$2,$3,$4,$5, now() - make_interval(secs => $5::int), now())`,
    [t.id, userId, outcome === "completed" ? "completed" : "interrupted", t.planned_seconds, focused],
  );
}

export async function createTask(userId: string, tz: string, input: z.infer<typeof createSchema>) {
  return withUserLock(userId, async (c) => {
    const { rows } = await c.query(
      `SELECT COALESCE(max(queue_position), -1) + 1 AS next, count(*)::int AS n FROM tasks WHERE user_id = $1 AND status = 'pending'`,
      [userId],
    );
    const first = rows[0].n === 0;
    const { rows: created } = await c.query(
      `INSERT INTO tasks (user_id, title, description, planned_duration_seconds, remaining_seconds, queue_position, timer_running)
       VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
      [userId, input.title, input.description, input.plannedSeconds, rows[0].next, first],
    );
    return { state: await loadState(c, userId, tz), id: created[0].id as string };
  });
}

export async function updateTask(userId: string, tz: string, id: string, patch: z.infer<typeof patchSchema>) {
  return withUserLock(userId, async (c) => {
    const t = await lockTask(c, userId, id);
    if (t.status !== "pending") throw new HttpError(409, "not_pending", "Completed tasks cannot be edited");
    const planned = patch.plannedSeconds ?? t.planned_seconds;
    // Keep elapsed time constant when the plan changes: remaining shifts by the same delta.
    const remaining = Math.min(planned, Math.max(0, t.effective + (planned - t.planned_seconds)));
    await c.query(
      `UPDATE tasks SET title = COALESCE($3, title), description = COALESCE($4, description),
         planned_duration_seconds = $5, remaining_seconds = $6, timer_anchor_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, patch.title ?? null, patch.description ?? null, planned, remaining],
    );
    return loadState(c, userId, tz);
  });
}

export async function deleteTask(userId: string, tz: string, id: string, startNext = true) {
  return withUserLock(userId, async (c) => {
    const prev = await headId(c, userId);
    const t = await lockTask(c, userId, id).catch((e) => {
      if (e instanceof HttpError && e.status === 404) return null; // idempotent delete
      throw e;
    });
    if (t) {
      if (t.status === "pending" && id === prev && t.planned_seconds - t.effective > 0) await record(c, userId, t, "interrupted");
      // notes and focus sessions are removed by ON DELETE CASCADE
      await c.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2", [id, userId]);
      await settleHead(c, userId, id === prev ? null : prev, startNext);
    }
    return loadState(c, userId, tz);
  });
}

export async function completeTask(userId: string, tz: string, id: string, startNext = true) {
  return withUserLock(userId, async (c) => {
    const t = await lockTask(c, userId, id);
    if (t.status === "completed") return loadState(c, userId, tz, { alreadyCompleted: true });
    const prev = await headId(c, userId);
    await record(c, userId, t, "completed");
    await c.query(
      `UPDATE tasks SET status = 'completed', completed_at = now(), remaining_seconds = $3, timer_running = false,
         timer_anchor_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2`,
      [id, userId, t.effective],
    );
    await settleHead(c, userId, id === prev ? null : prev, startNext);
    return loadState(c, userId, tz);
  });
}

export async function skipTask(userId: string, tz: string, id: string, startNext = true) {
  return withUserLock(userId, async (c) => {
    const t = await lockTask(c, userId, id);
    if (t.status !== "pending") throw new HttpError(409, "not_pending", "Task is already completed");
    const prev = await headId(c, userId);
    const { rows } = await c.query("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (rows[0].n < 2) return loadState(c, userId, tz); // nothing to skip to
    await record(c, userId, t, "skipped");
    await c.query(
      `UPDATE tasks SET remaining_seconds = $3, timer_running = false, timer_anchor_at = now(), updated_at = now(),
         queue_position = (SELECT max(queue_position) + 1 FROM tasks WHERE user_id = $2 AND status = 'pending') WHERE id = $1 AND user_id = $2`,
      [id, userId, t.effective],
    );
    await settleHead(c, userId, id === prev ? null : prev, startNext);
    return loadState(c, userId, tz);
  });
}

export const reorderSchema = z.object({ orderedIds: z.array(z.string().uuid()).min(1).max(1000) });

export async function reorderTasks(userId: string, tz: string, orderedIds: string[]) {
  return withUserLock(userId, async (c) => {
    const prev = await headId(c, userId);
    const { rows } = await c.query("SELECT id FROM tasks WHERE user_id = $1 AND status = 'pending'", [userId]);
    const current = new Set<string>(rows.map((r) => r.id));
    const unique = new Set(orderedIds);
    if (unique.size !== orderedIds.length || unique.size !== current.size || orderedIds.some((i) => !current.has(i))) {
      throw new HttpError(409, "queue_changed", "The queue changed; please refresh", { state: await loadState(c, userId, tz) });
    }
    await c.query(
      `UPDATE tasks t SET queue_position = o.pos - 1, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, pos) WHERE t.id = o.id AND t.user_id = $1`,
      [userId, orderedIds],
    );
    await settleHead(c, userId, prev, true);
    return loadState(c, userId, tz);
  });
}

export const timerSchema = z.object({
  remainingSeconds: z.number().int().min(0).max(MAX_SECONDS),
  running: z.boolean(),
});

export async function updateTimer(userId: string, tz: string, id: string, input: z.infer<typeof timerSchema>) {
  return withUserLock(userId, async (c) => {
    const t = await lockTask(c, userId, id);
    if (t.status !== "pending") return loadState(c, userId, tz, { alreadyCompleted: true }); // late sync after completion: ignore
    if (input.remainingSeconds > t.planned_seconds) throw new HttpError(400, "invalid_request", "remainingSeconds exceeds planned duration");
    if (input.running && id !== (await headId(c, userId))) throw new HttpError(409, "not_active", "Only the active task can run");
    await c.query(
      `UPDATE tasks SET remaining_seconds = $3, timer_running = $4 AND $3 > 0, timer_anchor_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, userId, input.remainingSeconds, input.running],
    );
    return loadState(c, userId, tz);
  });
}

export type CompletedNoteItem = {
  id: string;
  title: string;
  completedAt: string;
  hasNotes: boolean;
  notePreview: string;
};

/** Completed tasks with their notes — the archive / “completed notes” folder. */
export async function listCompletedWithNotes(
  userId: string,
  opts: { limit?: number; offset?: number; notesOnly?: boolean } = {},
): Promise<{ items: CompletedNoteItem[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const notesOnly = opts.notesOnly ?? true;
  const pool = getPool();
  const filter = notesOnly
    ? `AND n.content IS NOT NULL AND length(trim(n.content)) > 0`
    : "";
  const count = await pool.query(
    `SELECT count(*)::int AS n FROM tasks t
     LEFT JOIN task_notes n ON n.task_id = t.id
     WHERE t.user_id = $1 AND t.status = 'completed' ${filter}`,
    [userId],
  );
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.completed_at,
            (n.content IS NOT NULL AND length(trim(n.content)) > 0) AS has_notes,
            left(regexp_replace(COALESCE(n.content, ''), E'[\\n\\r]+', ' ', 'g'), 140) AS note_preview
     FROM tasks t
     LEFT JOIN task_notes n ON n.task_id = t.id
     WHERE t.user_id = $1 AND t.status = 'completed' ${filter}
     ORDER BY t.completed_at DESC NULLS LAST
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return {
    total: count.rows[0].n,
    items: rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : "",
      hasNotes: !!r.has_notes,
      notePreview: ((r.note_preview as string) ?? "").trim(),
    })),
  };
}
