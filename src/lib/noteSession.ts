import type { Note } from "./types";

export type SaveStatus = "loading" | "idle" | "dirty" | "saving" | "saved" | "error" | "conflict" | "load-error";

export type NotesApi = {
  load(taskId: string): Promise<Note>;
  /** Must throw `ConflictError` on HTTP 409. */
  save(taskId: string, content: string, baseVersion: number): Promise<Note>;
};

export class ConflictError extends Error {
  constructor(public note: Note) {
    super("version conflict");
  }
}

export type DraftStore = {
  get(taskId: string): { content: string; baseVersion: number } | null;
  set(taskId: string, d: { content: string; baseVersion: number }): void;
  remove(taskId: string): void;
};

export type NoteSnapshot = { content: string; status: SaveStatus; loaded: boolean };

type Opts = { debounceMs?: number; retryDelaysMs?: number[] };

/**
 * One editing session for a single task's note.
 *
 *  - Autosave is debounced; at most ONE request is in flight, and every request carries the
 *    latest content with the version returned by the previous save. Requests are therefore
 *    strictly ordered and a stale one can neither be sent nor accepted (server also enforces
 *    the version).
 *  - Unsaved text is mirrored to a local draft store on every edit and only removed after the
 *    server confirms exactly that text. Failures keep the text and surface a retry.
 */
export class NoteSession {
  private content = "";
  private version = 0;
  private status: SaveStatus = "loading";
  private loaded = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snap: NoteSnapshot;
  private readonly debounceMs: number;
  private readonly retryDelays: number[];

  constructor(
    readonly taskId: string,
    private api: NotesApi,
    private drafts: DraftStore,
    opts: Opts = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 700;
    this.retryDelays = opts.retryDelaysMs ?? [2000, 5000, 15000];
    this.snap = { content: "", status: "loading", loaded: false };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private emit(status = this.status) {
    this.status = status;
    this.snap = { content: this.content, status, loaded: this.loaded };
    this.listeners.forEach((l) => l());
  }

  get hasUnsaved() {
    return this.dirty;
  }

  /** Content + version for a best-effort keepalive flush on page hide. */
  pending(): { content: string; baseVersion: number } | null {
    return this.dirty && this.loaded ? { content: this.content, baseVersion: this.version } : null;
  }

  async load(): Promise<void> {
    this.emit("loading");
    try {
      const note = await this.api.load(this.taskId);
      this.version = note.version;
      this.content = note.content;
      this.loaded = true;
      const draft = this.drafts.get(this.taskId);
      if (draft && draft.content !== note.content) {
        // Unsaved text from an earlier session/crash: never discard it.
        this.content = draft.content;
        this.dirty = true;
        if (draft.baseVersion !== note.version) {
          this.emit("conflict");
          return;
        }
        this.emit("dirty");
        this.schedule();
        return;
      }
      if (draft) this.drafts.remove(this.taskId);
      this.emit("idle");
    } catch {
      this.emit("load-error");
    }
  }

  setContent(text: string) {
    if (!this.loaded || text === this.content) return;
    this.content = text;
    this.dirty = true;
    this.attempts = 0;
    this.drafts.set(this.taskId, { content: text, baseVersion: this.version });
    if (this.status !== "conflict") this.emit("dirty");
    else this.emit();
    if (this.status !== "conflict") this.schedule();
  }

  /** Apply a server-confirmed note write (e.g. from the assistant). */
  applyServerNote(content: string, version: number) {
    this.content = content;
    this.version = version;
    this.dirty = false;
    this.loaded = true;
    this.drafts.remove(this.taskId);
    this.emit("saved");
  }

  private schedule() {
    this.clearTimers();
    this.timer = setTimeout(() => void this.persist(), this.debounceMs);
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }

  /** Save now. Resolves when everything typed so far is saved, or the save failed. */
  flush(): Promise<void> {
    this.clearTimers();
    if (!this.dirty || this.status === "conflict") return this.running ?? Promise.resolve();
    return this.persist();
  }

  private persist(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        while (this.dirty) {
          const sent = this.content;
          this.emit("saving");
          try {
            const note = await this.api.save(this.taskId, sent, this.version);
            this.version = note.version;
            this.attempts = 0;
            if (this.content === sent) {
              this.dirty = false;
              this.drafts.remove(this.taskId);
              this.emit("saved");
            } else {
              // typed more while saving: keep draft pointing at the new version and go again
              this.drafts.set(this.taskId, { content: this.content, baseVersion: this.version });
            }
          } catch (err) {
            if (err instanceof ConflictError) {
              this.emit("conflict");
              this.conflict = err.note;
            } else {
              this.emit("error");
              const delay = this.retryDelays[Math.min(this.attempts++, this.retryDelays.length - 1)];
              this.retryTimer = setTimeout(() => void this.persist(), delay);
            }
            return;
          }
        }
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private conflict: Note | null = null;

  /** User-initiated retry. After a conflict this deliberately overwrites with the local text. */
  retry(): Promise<void> {
    if (this.status === "load-error") return this.load();
    if (this.status === "conflict" && this.conflict) {
      this.version = this.conflict.version;
      this.conflict = null;
      this.drafts.set(this.taskId, { content: this.content, baseVersion: this.version });
    }
    this.clearTimers();
    return this.persist();
  }
}
