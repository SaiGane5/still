import { z } from "zod";
import { getPool, withTx } from "./db";
import { HttpError } from "./http-error";
import type { Note } from "@/lib/types";

export const noteSchema = z.object({
  content: z.string().max(200_000),
  baseVersion: z.number().int().min(0),
});

async function assertOwned(taskId: string, userId: string) {
  const { rowCount } = await getPool().query("SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
  if (!rowCount) throw new HttpError(404, "not_found", "Task not found");
}

async function current(q: { query: Function }, taskId: string, userId: string): Promise<Note> {
  const { rows } = await q.query("SELECT content, version FROM notes WHERE task_id = $1 AND user_id = $2", [taskId, userId]);
  return { taskId, content: rows[0]?.content ?? "", version: rows[0]?.version ?? 0 };
}

export async function getNote(userId: string, taskId: string): Promise<Note> {
  await assertOwned(taskId, userId);
  return current(getPool(), taskId, userId);
}

/**
 * Optimistic concurrency: a write only applies if `baseVersion` equals the stored version.
 * A stale request therefore cannot overwrite newer content; it gets 409 with the current note.
 * A retry whose content already matches (response lost after a successful write) is accepted.
 */
export async function saveNote(userId: string, taskId: string, content: string, baseVersion: number): Promise<Note> {
  await assertOwned(taskId, userId);
  return withTx(async (c) => {
    let rows;
    if (baseVersion === 0) {
      ({ rows } = await c.query(
        `INSERT INTO notes (task_id, user_id, content, version) VALUES ($1,$2,$3,1)
         ON CONFLICT (task_id) DO NOTHING RETURNING version`,
        [taskId, userId, content],
      ));
    } else {
      ({ rows } = await c.query(
        `UPDATE notes SET content = $3, version = version + 1, updated_at = now()
         WHERE task_id = $1 AND user_id = $2 AND version = $4 RETURNING version`,
        [taskId, userId, content, baseVersion],
      ));
    }
    if (rows[0]) return { taskId, content, version: rows[0].version as number };
    const cur = await current(c, taskId, userId);
    if (cur.content === content) return cur;
    throw new HttpError(409, "version_conflict", "Notes were changed elsewhere", { note: cur });
  });
}
