import { NoteSession, type DraftStore } from "@/lib/noteSession";
import { notesApi } from "./api";

const KEY = (id: string) => `still:draft:${id}`;

export const localDrafts: DraftStore = {
  get(id) {
    try {
      const raw = localStorage.getItem(KEY(id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(id, d) {
    try {
      localStorage.setItem(KEY(id), JSON.stringify(d));
    } catch {}
  },
  remove(id) {
    try {
      localStorage.removeItem(KEY(id));
    } catch {}
  },
};

const sessions = new Map<string, NoteSession>();

/** Sessions outlive the sidebar, so edits for a previous task keep saving after you switch. */
export function getNoteSession(taskId: string): NoteSession {
  let s = sessions.get(taskId);
  if (!s) {
    s = new NoteSession(taskId, notesApi, localDrafts);
    sessions.set(taskId, s);
    void s.load();
  }
  return s;
}

export function evictClean(taskId: string) {
  const s = sessions.get(taskId);
  if (s && !s.hasUnsaved) sessions.delete(taskId);
}

export function forgetSession(taskId: string) {
  sessions.delete(taskId);
}

export const hasUnsavedNotes = () => [...sessions.values()].some((s) => s.hasUnsaved);

/** Best-effort write on page hide; the local draft is the real safety net. */
export function flushAllKeepalive() {
  for (const s of sessions.values()) {
    const p = s.pending();
    if (p && p.content.length < 60_000) void notesApi.save(s.taskId, p.content, p.baseVersion, true).catch(() => {});
  }
}
