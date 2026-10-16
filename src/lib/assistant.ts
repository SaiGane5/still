import { z } from "zod";

export const proposedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  plannedMinutes: z.number().int().min(1).max(480).default(25),
});

export type ProposedTask = z.infer<typeof proposedTaskSchema>;

export const assistantReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  tasks: z.array(proposedTaskSchema).max(20).default([]),
});

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
  queued: boolean;
  createdAt: string;
};

export type AssistantChat = AssistantChatSummary & {
  messages: AssistantMessage[];
};
