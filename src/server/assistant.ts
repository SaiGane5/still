import { generateText, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getPool, withTx } from "./db";
import { HttpError } from "./http-error";
import { getNote, saveNote } from "./notes";
import { createTask, getState } from "./tasks";
import {
  assistantReplySchema,
  normalizeProposedNote,
  normalizeProposedTasks,
  type AssistantChat,
  type AssistantChatSummary,
  type AssistantMessage,
  type ProposedNote,
  type ProposedTask,
} from "@/lib/assistant";

const SYSTEM = `You are still.'s calm focus assistant. The user describes work in natural language.
Your job:
1. Reply briefly and warmly (1–3 short sentences).
2. When they describe one or more things to do, extract a clear task list into "tasks".
3. Each task needs a short title, optional description, and a sensible plannedMinutes (default 25, between 1 and 480).
4. If they are only chatting or clarifying (not listing work), return an empty tasks array.
5. When they ask you to write, draft, summarize, or take notes for the current focus task, fill "note" with the note text.
   - Use mode "append" to add to existing notes (default). Use "replace" only if they ask to rewrite/replace.
   - Keep notes clear and useful; prefer markdown-friendly plain text.
   - If they are not asking for notes, omit "note" or set it null.
6. Never invent unrelated tasks. Prefer fewer, clearer tasks over many vague ones.
7. Never say you added, queued, or saved tasks/notes — the UI asks the user to confirm first.`;

/** Models known to accept generateContent for this API key; try in order on overload/404. */
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-flash-lite-latest",
  "gemini-3.8-flash",
] as const;

function geminiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "misconfigured", "Gemini is not configured");
  return key;
}

function google() {
  return createGoogleGenerativeAI({ apiKey: geminiKey() });
}

function toSummary(r: any): AssistantChatSummary {
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

function toMessage(r: any): AssistantMessage {
  const tasks = normalizeProposedTasks(r.proposed_tasks ?? null);
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    proposedTasks: tasks.length ? tasks : null,
    proposedNote: normalizeProposedNote(r.proposed_note ?? null),
    queued: !!r.queued,
    createdAt: r.created_at.toISOString(),
  };
}

async function assertChat(userId: string, chatId: string) {
  const { rowCount } = await getPool().query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_id = $2`, [chatId, userId]);
  if (!rowCount) throw new HttpError(404, "not_found", "Chat not found");
}

async function focusContext(userId: string, focusTaskId?: string | null): Promise<string> {
  const pool = getPool();
  let taskId = focusTaskId ?? null;
  if (!taskId) {
    const { rows } = await pool.query(
      `SELECT id FROM tasks WHERE user_id = $1 AND status = 'pending' ORDER BY queue_position ASC LIMIT 1`,
      [userId],
    );
    taskId = rows[0]?.id ?? null;
  }
  if (!taskId) return "Current focus task: (none — queue is empty).";

  const { rows } = await pool.query(
    `SELECT id, title, description FROM tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  const t = rows[0];
  if (!t) return "Current focus task: (none).";
  const note = await getNote(userId, t.id);
  const notePreview = note.content.trim() ? note.content.trim().slice(0, 2500) : "(empty)";
  return `Current focus task id=${t.id}
Title: ${t.title}
Description: ${t.description || "(none)"}
Existing notes:
${notePreview}`;
}

export async function listChats(userId: string): Promise<AssistantChatSummary[]> {
  const { rows } = await getPool().query(
    `SELECT id, title, created_at, updated_at FROM assistant_chats
     WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map(toSummary);
}

export async function getChat(userId: string, chatId: string): Promise<AssistantChat> {
  await assertChat(userId, chatId);
  const chat = await getPool().query(`SELECT id, title, created_at, updated_at FROM assistant_chats WHERE id = $1`, [chatId]);
  const msgs = await getPool().query(
    `SELECT id, role, content, proposed_tasks, proposed_note, queued, created_at
     FROM assistant_messages WHERE chat_id = $1 ORDER BY created_at ASC`,
    [chatId],
  );
  return { ...toSummary(chat.rows[0]), messages: msgs.rows.map(toMessage) };
}

export async function createChat(userId: string): Promise<AssistantChat> {
  const { rows } = await getPool().query(
    `INSERT INTO assistant_chats (user_id, title) VALUES ($1, 'New chat') RETURNING id, title, created_at, updated_at`,
    [userId],
  );
  return { ...toSummary(rows[0]), messages: [] };
}

export async function deleteChat(userId: string, chatId: string) {
  await assertChat(userId, chatId);
  await getPool().query(`DELETE FROM assistant_chats WHERE id = $1 AND user_id = $2`, [chatId, userId]);
}

export const sendSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  focusTaskId: z.string().uuid().optional().nullable(),
});

async function callGemini(
  messages: { role: "user" | "assistant"; content: string }[],
  contextBlock: string,
): Promise<{ reply: string; tasks: ProposedTask[]; note: ProposedNote | null }> {
  let lastErr: unknown;
  const system = `${SYSTEM}\n\n---\n${contextBlock}`;
  for (const modelId of GEMINI_MODELS) {
    try {
      const result = await generateText({
        model: google()(modelId),
        output: Output.object({ schema: assistantReplySchema }),
        system,
        messages,
        temperature: 0.4,
        maxRetries: 1,
      });
      const obj = result.output;
      if (!obj?.reply?.trim()) throw new Error("empty reply");
      return {
        reply: obj.reply.trim(),
        tasks: normalizeProposedTasks(obj.tasks),
        note: normalizeProposedNote(obj.note),
      };
    } catch (err) {
      lastErr = err;
      console.error(`gemini assistant error (${modelId})`, err);
    }
  }
  throw lastErr ?? new Error("all gemini models failed");
}

export async function sendMessage(
  userId: string,
  chatId: string,
  content: string,
  focusTaskId?: string | null,
): Promise<AssistantMessage> {
  await assertChat(userId, chatId);
  const pool = getPool();

  await pool.query(`INSERT INTO assistant_messages (chat_id, role, content) VALUES ($1, 'user', $2)`, [chatId, content]);

  const history = await pool.query(
    `SELECT role, content FROM assistant_messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 40`,
    [chatId],
  );

  const contextBlock = await focusContext(userId, focusTaskId);

  let reply: { reply: string; tasks: ProposedTask[]; note: ProposedNote | null };
  try {
    reply = await callGemini(
      history.rows.map((r) => ({
        role: r.role as "user" | "assistant",
        content: r.content,
      })),
      contextBlock,
    );
  } catch (err) {
    await pool.query(
      `DELETE FROM assistant_messages WHERE chat_id = $1 AND role = 'user' AND content = $2
       AND id = (
         SELECT id FROM assistant_messages WHERE chat_id = $1 AND role = 'user' AND content = $2
         ORDER BY created_at DESC LIMIT 1
       )`,
      [chatId, content],
    );
    console.error("gemini assistant exhausted models", err);
    throw new HttpError(502, "assistant_failed", "The assistant couldn’t reply. Try again in a moment.");
  }

  const proposed = reply.tasks.length ? reply.tasks : null;
  const proposedNote = reply.note;
  const titleSeed = proposed?.[0]?.title ?? (proposedNote ? "Notes" : content.slice(0, 48));

  const { rows } = await withTx(async (c) => {
    await c.query(
      `UPDATE assistant_chats SET title = CASE
         WHEN title = 'New chat' THEN $2
         ELSE title
       END, updated_at = now() WHERE id = $1`,
      [chatId, titleSeed],
    );
    return c.query(
      `INSERT INTO assistant_messages (chat_id, role, content, proposed_tasks, proposed_note)
       VALUES ($1, 'assistant', $2, $3, $4)
       RETURNING id, role, content, proposed_tasks, proposed_note, queued, created_at`,
      [
        chatId,
        reply.reply,
        proposed ? JSON.stringify(proposed) : null,
        proposedNote ? JSON.stringify(proposedNote) : null,
      ],
    );
  });

  return toMessage(rows[0]);
}

export const confirmSchema = z.object({
  messageId: z.string().uuid(),
  applyTasks: z.boolean().optional(),
  applyNote: z.boolean().optional(),
  focusTaskId: z.string().uuid().optional().nullable(),
});

/** Apply proposed tasks and/or note from an assistant message. */
export async function confirmProposedTasks(
  userId: string,
  chatId: string,
  messageId: string,
  tz: string,
  opts: { applyTasks?: boolean; applyNote?: boolean; focusTaskId?: string | null } = {},
) {
  await assertChat(userId, chatId);
  const { rows } = await getPool().query(
    `SELECT id, proposed_tasks, proposed_note, queued FROM assistant_messages WHERE id = $1 AND chat_id = $2 AND role = 'assistant'`,
    [messageId, chatId],
  );
  const msg = rows[0];
  if (!msg) throw new HttpError(404, "not_found", "Message not found");

  const tasks = normalizeProposedTasks(msg.proposed_tasks ?? []);
  const note = normalizeProposedNote(msg.proposed_note);
  const wantTasks = opts.applyTasks !== false && tasks.length > 0;
  const wantNote = opts.applyNote !== false && !!note;

  if (!wantTasks && !wantNote) {
    throw new HttpError(400, "invalid_request", "Nothing to apply");
  }
  if (msg.queued && wantTasks && !wantNote) {
    throw new HttpError(409, "already_queued", "Those tasks were already added");
  }

  let state = null as Awaited<ReturnType<typeof getState>> | null;
  let taskCount = 0;
  if (wantTasks) {
    for (const t of tasks) {
      const created = await createTask(userId, tz, {
        title: t.title,
        description: t.description ?? "",
        plannedSeconds: Math.min(8 * 60 * 60, Math.max(60, (t.plannedMinutes || 25) * 60)),
      });
      state = created.state;
      taskCount++;
    }
  }

  let noteResult: { taskId: string; content: string; version: number } | null = null;
  if (wantNote && note) {
    let taskId = opts.focusTaskId ?? null;
    if (!taskId) {
      const { rows: head } = await getPool().query(
        `SELECT id FROM tasks WHERE user_id = $1 AND status = 'pending' ORDER BY queue_position ASC LIMIT 1`,
        [userId],
      );
      taskId = head[0]?.id ?? null;
    }
    if (!taskId) throw new HttpError(400, "invalid_request", "No focus task to write notes on");
    const current = await getNote(userId, taskId);
    const next =
      note.mode === "replace"
        ? note.content
        : current.content.trim()
          ? `${current.content.trim()}\n\n${note.content}`
          : note.content;
    noteResult = await saveNote(userId, taskId, next, current.version);
  }

  if (wantNote) {
    await getPool().query(`UPDATE assistant_messages SET proposed_note = NULL WHERE id = $1`, [messageId]);
  }
  if (wantTasks) {
    await getPool().query(`UPDATE assistant_messages SET proposed_tasks = NULL, queued = true WHERE id = $1`, [messageId]);
  } else if (wantNote && !tasks.length) {
    await getPool().query(`UPDATE assistant_messages SET queued = true WHERE id = $1`, [messageId]);
  }

  await getPool().query(`UPDATE assistant_chats SET updated_at = now() WHERE id = $1`, [chatId]);
  if (!state) state = await getState(userId, tz);
  return { state, count: taskCount, note: noteResult };
}
