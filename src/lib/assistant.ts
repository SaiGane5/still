import { z } from "zod";

/** LLM-facing schema — keep JSON-schema friendly (avoid .trim() / heavy defaults). */
export const proposedTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  plannedMinutes: z.number().min(1).max(480).optional(),
});

export type ProposedTask = {
  title: string;
  description: string;
  plannedMinutes: number;
};

export const proposedNoteSchema = z.object({
  content: z.string().min(1).max(20_000),
  mode: z.enum(["append", "replace"]).optional(),
});

export type ProposedNote = {
  content: string;
  mode: "append" | "replace";
};

export const assistantReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  tasks: z.array(proposedTaskSchema).max(20).optional(),
  note: proposedNoteSchema.optional().nullable(),
});

export function normalizeProposedTasks(
  tasks: z.infer<typeof proposedTaskSchema>[] | undefined | null,
): ProposedTask[] {
  if (!tasks?.length) return [];
  return tasks
    .map((t) => ({
      title: String(t.title ?? "").trim().slice(0, 200),
      description: String(t.description ?? "").trim().slice(0, 2000),
      plannedMinutes: Math.min(480, Math.max(1, Math.round(Number(t.plannedMinutes) || 25))),
    }))
    .filter((t) => t.title.length > 0);
}

export function normalizeProposedNote(
  note: z.infer<typeof proposedNoteSchema> | undefined | null,
): ProposedNote | null {
  if (!note?.content?.trim()) return null;
  return {
    content: String(note.content).trim().slice(0, 20_000),
    mode: note.mode === "replace" ? "replace" : "append",
  };
}

export type AssistantChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedTasks: ProposedTask[] | null;
  proposedNote: ProposedNote | null;
  queued: boolean;
  createdAt: string;
};

export type AssistantChat = AssistantChatSummary & {
  messages: AssistantMessage[];
};
