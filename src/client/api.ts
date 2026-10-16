import { ConflictError } from "@/lib/noteSession";
import type { AppState, Note } from "@/lib/types";

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
