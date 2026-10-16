import { generateText, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { getPool, withTx } from "./db";
import { HttpError } from "./http-error";
import { createTask } from "./tasks";
import {
  assistantReplySchema,
  normalizeProposedTasks,
  type AssistantChat,
  type AssistantChatSummary,
  type AssistantMessage,
  type ProposedTask,
} from "@/lib/assistant";

const SYSTEM = `You are still.'s calm focus assistant. The user describes work in natural language.
Your job:
1. Reply briefly and warmly (1–3 short sentences).
2. When they describe one or more things to do, extract a clear task list into "tasks".
3. Each task needs a short title, optional description, and a sensible plannedMinutes (default 25, between 1 and 480).
4. If they are only chatting or clarifying (not listing work), return an empty tasks array.
5. Never invent unrelated tasks. Prefer fewer, clearer tasks over many vague ones.
6. Never say you added, queued, or saved tasks — the UI asks the user to confirm before anything is queued. Say you drafted a list they can approve.`;

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
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    proposedTasks: r.proposed_tasks ?? null,
    queued: !!r.queued,
    createdAt: r.created_at.toISOString(),
  };
}

async function assertChat(userId: string, chatId: string) {
  const { rowCount } = await getPool().query(`SELECT 1 FROM assistant_chats WHERE id = $1 AND user_id = $2`, [chatId, userId]);
  if (!rowCount) throw new HttpError(404, "not_found", "Chat not found");
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
    `SELECT id, role, content, proposed_tasks, queued, created_at
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
});

async function callGemini(
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<{ reply: string; tasks: ProposedTask[] }> {
  let lastErr: unknown;
  for (const modelId of GEMINI_MODELS) {
    try {
      const result = await generateText({
        model: google()(modelId),
        output: Output.object({ schema: assistantReplySchema }),
        system: SYSTEM,
        messages,
        temperature: 0.4,
        maxRetries: 1,
      });
      const obj = result.output;
      if (!obj?.reply?.trim()) throw new Error("empty reply");
      return { reply: obj.reply.trim(), tasks: normalizeProposedTasks(obj.tasks) };
    } catch (err) {
      lastErr = err;
      console.error(`gemini assistant error (${modelId})`, err);
    }
  }
  throw lastErr ?? new Error("all gemini models failed");
}

export async function sendMessage(userId: string, chatId: string, content: string): Promise<AssistantMessage> {
  await assertChat(userId, chatId);
  const pool = getPool();

  await pool.query(`INSERT INTO assistant_messages (chat_id, role, content) VALUES ($1, 'user', $2)`, [chatId, content]);

  const history = await pool.query(
    `SELECT role, content FROM assistant_messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 40`,
    [chatId],
  );

  let reply: { reply: string; tasks: ProposedTask[] };
  try {
    reply = await callGemini(
      history.rows.map((r) => ({
        role: r.role as "user" | "assistant",
        content: r.content,
      })),
    );
  } catch (err) {
    // Roll back the orphan user turn so retries don't stack failed messages.
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
  const titleSeed = proposed?.[0]?.title ?? content.slice(0, 48);

  const { rows } = await withTx(async (c) => {
    await c.query(
      `UPDATE assistant_chats SET title = CASE
         WHEN title = 'New chat' THEN $2
         ELSE title
       END, updated_at = now() WHERE id = $1`,
      [chatId, titleSeed],
    );
    return c.query(
      `INSERT INTO assistant_messages (chat_id, role, content, proposed_tasks)
       VALUES ($1, 'assistant', $2, $3)
       RETURNING id, role, content, proposed_tasks, queued, created_at`,
      [chatId, reply.reply, proposed ? JSON.stringify(proposed) : null],
    );
  });

  return toMessage(rows[0]);
}

export const confirmSchema = z.object({
  messageId: z.string().uuid(),
});

/** Queue proposed tasks from an assistant message into the user's focus queue. */
export async function confirmProposedTasks(userId: string, chatId: string, messageId: string, tz: string) {
  await assertChat(userId, chatId);
  const { rows } = await getPool().query(
    `SELECT id, proposed_tasks, queued FROM assistant_messages WHERE id = $1 AND chat_id = $2 AND role = 'assistant'`,
    [messageId, chatId],
  );
  const msg = rows[0];
  if (!msg) throw new HttpError(404, "not_found", "Message not found");
  if (msg.queued) throw new HttpError(409, "already_queued", "Those tasks were already added");
  const tasks = normalizeProposedTasks(msg.proposed_tasks ?? []);
  if (!tasks.length) throw new HttpError(400, "invalid_request", "No tasks to add");

  let state = null as Awaited<ReturnType<typeof createTask>>["state"] | null;
  for (const t of tasks) {
    const created = await createTask(userId, tz, {
      title: t.title,
      description: t.description ?? "",
      plannedSeconds: Math.min(8 * 60 * 60, Math.max(60, (t.plannedMinutes || 25) * 60)),
    });
    state = created.state;
  }

  await getPool().query(`UPDATE assistant_messages SET queued = true WHERE id = $1`, [messageId]);
  await getPool().query(`UPDATE assistant_chats SET updated_at = now() WHERE id = $1`, [chatId]);
  return { state, count: tasks.length };
}
