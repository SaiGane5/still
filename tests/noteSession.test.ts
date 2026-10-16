import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NoteSession, type DraftStore, type NotesApi } from "@/lib/noteSession";
import type { Note } from "@/lib/types";

function memoryDrafts(): DraftStore & { map: Map<string, any> } {
  const map = new Map<string, any>();
  return { map, get: (id) => map.get(id) ?? null, set: (id, d) => void map.set(id, d), remove: (id) => void map.delete(id) };
}

/** In-memory server with the same versioning rules as the real API. */
function fakeServer(initial: Note = { taskId: "t1", content: "", version: 0 }) {
  const state = { ...initial };
  const calls: { content: string; baseVersion: number }[] = [];
  let failNext = 0;
  let gate: Promise<void> | null = null;
  const api: NotesApi = {
    load: async () => ({ ...state }),
    async save(_id, content, baseVersion) {
      calls.push({ content, baseVersion });
      if (gate) await gate;
      if (failNext > 0) {
        failNext--;
        throw new Error("network");
      }
      if (baseVersion !== state.version) throw new ConflictError({ ...state });
      state.content = content;
      state.version += 1;
      return { ...state };
    },
  };
  return {
    api, state, calls,
    failNext: (n: number) => (failNext = n),
    hold: () => {
      let release!: () => void;
      gate = new Promise((r) => (release = () => { gate = null; r(); }));
      return release;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function open(server = fakeServer(), drafts = memoryDrafts()) {
  const s = new NoteSession("t1", server.api, drafts, { debounceMs: 700, retryDelaysMs: [1000] });
  await s.load();
  return { s, server, drafts };
}

describe("NoteSession autosave", () => {
  it("debounces: many keystrokes produce one write after inactivity", async () => {
    const { s, server } = await open();
    for (const t of ["h", "he", "hel", "hell", "hello"]) {
      s.setContent(t);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(server.calls).toHaveLength(0);
    expect(s.getSnapshot().status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(700);
    expect(server.calls).toEqual([{ content: "hello", baseVersion: 0 }]);
    expect(s.getSnapshot().status).toBe("saved");
    expect(server.state).toMatchObject({ content: "hello", version: 1 });
  });

  it("serialises saves: edits during an in-flight save go out afterwards with the new version", async () => {
    const { s, server } = await open();
    const release = server.hold();
    s.setContent("one");
    await vi.advanceTimersByTimeAsync(700);
    s.setContent("one two");
    await vi.advanceTimersByTimeAsync(700); // second debounce fires while first still in flight
    expect(server.calls).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await s.flush();
    expect(server.calls).toEqual([
      { content: "one", baseVersion: 0 },
      { content: "one two", baseVersion: 1 },
    ]);
    expect(server.state.content).toBe("one two");
  });

  it("keeps text, shows an error, and retries automatically then on demand", async () => {
    const drafts = memoryDrafts();
    const { s, server } = await open(fakeServer(), drafts);
    server.failNext(2);
    s.setContent("precious");
    await vi.advanceTimersByTimeAsync(700);
    expect(s.getSnapshot()).toMatchObject({ status: "error", content: "precious" });
    expect(drafts.map.get("t1").content).toBe("precious"); // survives reload
    await vi.advanceTimersByTimeAsync(1000); // auto retry fails again
    expect(s.getSnapshot().status).toBe("error");
    await s.retry(); // manual retry succeeds
    expect(s.getSnapshot().status).toBe("saved");
    expect(server.state.content).toBe("precious");
    expect(drafts.map.has("t1")).toBe(false);
  });

  it("flush() saves pending edits immediately (task switch / close)", async () => {
    const { s, server } = await open();
    s.setContent("draft");
    await s.flush();
    expect(server.state.content).toBe("draft");
    expect(s.hasUnsaved).toBe(false);
  });

  it("a stale session cannot overwrite newer server content; local text is kept", async () => {
    const server = fakeServer({ taskId: "t1", content: "base", version: 1 });
    const { s } = await open(server);
    server.state.content = "edited in another tab";
    server.state.version = 2;
    s.setContent("my edit");
    await vi.advanceTimersByTimeAsync(700);
    expect(s.getSnapshot()).toMatchObject({ status: "conflict", content: "my edit" });
    expect(server.state.content).toBe("edited in another tab");
    await s.retry(); // explicit user choice rebases onto the new version
    expect(server.state.content).toBe("my edit");
    expect(server.state.version).toBe(3);
  });

  it("restores an unsaved local draft after a reload and saves it", async () => {
    const drafts = memoryDrafts();
    drafts.set("t1", { content: "lost on crash", baseVersion: 0 });
    const { s, server } = await open(fakeServer(), drafts);
    expect(s.getSnapshot().content).toBe("lost on crash");
    await vi.advanceTimersByTimeAsync(700);
    expect(server.state.content).toBe("lost on crash");
  });

  it("does not accept edits before the note has loaded (no clobbering)", async () => {
    const server = fakeServer({ taskId: "t1", content: "existing", version: 4 });
    const s = new NoteSession("t1", server.api, memoryDrafts(), { debounceMs: 700 });
    s.setContent("typed too early");
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls).toHaveLength(0);
    await s.load();
    expect(s.getSnapshot().content).toBe("existing");
  });

  it("separate sessions never share content across tasks", async () => {
    const a = fakeServer({ taskId: "a", content: "note A", version: 1 });
    const b = fakeServer({ taskId: "b", content: "", version: 0 });
    const sa = new NoteSession("a", a.api, memoryDrafts());
    const sb = new NoteSession("b", b.api, memoryDrafts());
    await Promise.all([sa.load(), sb.load()]);
    sb.setContent("note B");
    expect(sa.getSnapshot().content).toBe("note A");
    expect(sb.getSnapshot().content).toBe("note B");
  });
});
