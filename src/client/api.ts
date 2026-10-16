import type { AssistantChat, AssistantChatSummary, AssistantMessage } from "@/lib/assistant";
import { ConflictError } from "@/lib/noteSession";
import type { AppState, CompletedNoteItem, Note, UserProfile } from "@/lib/types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: any) {
    super(message);
  }
}

const tz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-timezone": tz() },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, "network", "You appear to be offline");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Request failed", data?.error);
  return data as T;
}

export const api = {
  state: () => request<AppState>("GET", "/api/state"),
  createTask: (b: { title: string; description: string; plannedSeconds: number }) =>
    request<{ state: AppState; id: string }>("POST", "/api/tasks", b),
  updateTask: (id: string, b: { title?: string; description?: string; plannedSeconds?: number }) =>
    request<AppState>("PATCH", `/api/tasks/${id}`, b),
  deleteTask: (id: string) => request<AppState>("DELETE", `/api/tasks/${id}`),
  complete: (id: string, startNext: boolean) => request<AppState>("POST", `/api/tasks/${id}/complete`, { startNext }),
  skip: (id: string, startNext: boolean) => request<AppState>("POST", `/api/tasks/${id}/skip`, { startNext }),
  reorder: (orderedIds: string[]) => request<AppState>("POST", "/api/tasks/reorder", { orderedIds }),
  timer: (id: string, remainingSeconds: number, running: boolean, keepalive = false) =>
    request<AppState>("PUT", `/api/tasks/${id}/timer`, { remainingSeconds, running }, { keepalive }),
};

export const notesApi = {
  load: (taskId: string) => request<Note>("GET", `/api/tasks/${taskId}/notes`),
  async save(taskId: string, content: string, baseVersion: number, keepalive = false): Promise<Note> {
    try {
      return await request<Note>("PUT", `/api/tasks/${taskId}/notes`, { content, baseVersion }, { keepalive });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.note) throw new ConflictError(e.body.note);
      throw e;
    }
  },
};

export const authApi = {
  me: () => request<{ user: UserProfile; googleEnabled: boolean }>("GET", "/api/auth/me"),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
};

export const archiveApi = {
  list: (opts: { limit?: number; offset?: number; all?: boolean; q?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.offset != null) q.set("offset", String(opts.offset));
    if (opts.all) q.set("all", "1");
    if (opts.q?.trim()) q.set("q", opts.q.trim());
    const qs = q.toString();
    return request<{ items: CompletedNoteItem[]; total: number }>("GET", `/api/completed${qs ? `?${qs}` : ""}`);
  },
};

export const assistantApi = {
  list: () => request<{ chats: AssistantChatSummary[] }>("GET", "/api/assistant/chats"),
  create: () => request<AssistantChat>("POST", "/api/assistant/chats"),
  get: (id: string) => request<AssistantChat>("GET", `/api/assistant/chats/${id}`),
  remove: (id: string) => request<{ ok: boolean }>("DELETE", `/api/assistant/chats/${id}`),
  send: (id: string, content: string) =>
    request<AssistantMessage>("POST", `/api/assistant/chats/${id}/messages`, { content }),
  confirm: (id: string, messageId: string) =>
    request<{ state: AppState; count: number }>("POST", `/api/assistant/chats/${id}/confirm`, { messageId }),
};
