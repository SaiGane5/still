import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@/server/migrate";
import { closePool, getPool } from "@/server/db";
import { sessionCookieFor } from "@/server/auth";
import * as state from "@/app/api/state/route";
import * as tasks from "@/app/api/tasks/route";
import * as task from "@/app/api/tasks/[id]/route";
import * as complete from "@/app/api/tasks/[id]/complete/route";
import * as skip from "@/app/api/tasks/[id]/skip/route";
import * as timer from "@/app/api/tasks/[id]/timer/route";
import * as notes from "@/app/api/tasks/[id]/notes/route";
import * as reorder from "@/app/api/tasks/reorder/route";
import * as completed from "@/app/api/completed/route";
import * as me from "@/app/api/auth/me/route";

const HOST = "http://localhost:3100";

type Client = { cookie: string };
async function newClient(): Promise<Client> {
  const res = await state.GET(new Request(`${HOST}/api/state`));
  const set = res.headers.get("set-cookie")!;
  expect(set).toMatch(/HttpOnly/);
  return { cookie: set.split(";")[0] };
}
function call(c: Client | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${HOST}${path}`, {
    method,
    headers: { "content-type": "application/json", host: "localhost:3100", ...(c ? { cookie: c.cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function add(c: Client, title: string, plannedSeconds = 600) {
  const res = await tasks.POST(call(c, "POST", "/api/tasks", { title, plannedSeconds }));
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; state: any };
}
const getState = async (c: Client) => (await state.GET(call(c, "GET", "/api/state"))).json();

beforeAll(async () => {
  await migrate();
});
afterAll(async () => {
  await closePool();
});

describe("access control", () => {
  it("scopes data by authenticated identity", async () => {
    const a = await newClient();
    const b = await newClient();
    const { id } = await add(a, "A's secret task");
    await notes.PUT(call(a, "PUT", `/api/tasks/${id}/notes`, { content: "private", baseVersion: 0 }), ctx(id));

    expect((await getState(b)).tasks).toHaveLength(0);
    for (const res of [
      await notes.GET(call(b, "GET", `/api/tasks/${id}/notes`), ctx(id)),
      await notes.PUT(call(b, "PUT", `/api/tasks/${id}/notes`, { content: "x", baseVersion: 0 }), ctx(id)),
      await task.PATCH(call(b, "PATCH", `/api/tasks/${id}`, { title: "hacked" }), ctx(id)),
      await task.DELETE(call(b, "DELETE", `/api/tasks/${id}`), ctx(id)),
      await complete.POST(call(b, "POST", `/api/tasks/${id}/complete`, {}), ctx(id)),
      await skip.POST(call(b, "POST", `/api/tasks/${id}/skip`, {}), ctx(id)),
      await timer.PUT(call(b, "PUT", `/api/tasks/${id}/timer`, { remainingSeconds: 1, running: false }), ctx(id)),
    ]) {
      // delete is idempotent (200) but must not remove another user's data
      expect([200, 404]).toContain(res.status);
    }
    const s = await getState(a);
    expect(s.tasks[0].title).toBe("A's secret task");
    const n = await (await notes.GET(call(a, "GET", `/api/tasks/${id}/notes`), ctx(id))).json();
    expect(n.content).toBe("private");
  });

  it("rejects forged cookies and ignores client-supplied user ids", async () => {
    const a = await newClient();
    const forged = { cookie: "still_session=" + a.cookie.split("=")[1].split(".")[0] + ".AAAA" };
    const res = await state.GET(call(forged, "GET", "/api/state"));
    expect(res.headers.get("set-cookie")).toBeTruthy(); // treated as a brand-new guest, not as user A
    const { id } = await add(a, "mine");
    const leaked = await tasks.POST(call(a, "POST", "/api/tasks", { title: "t", plannedSeconds: 600, userId: "someone-else" }));
    expect(leaked.status).toBe(200);
    expect((await getState(forged)).tasks.map((t: any) => t.id)).not.toContain(id);
  });

  it("blocks cross-origin mutations and validates input", async () => {
    const a = await newClient();
    const evil = await tasks.POST(call(a, "POST", "/api/tasks", { title: "x", plannedSeconds: 600 }, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    expect((await tasks.POST(call(a, "POST", "/api/tasks", { title: "", plannedSeconds: 600 }))).status).toBe(400);
    expect((await tasks.POST(call(a, "POST", "/api/tasks", { title: "x", plannedSeconds: 5 }))).status).toBe(400);
    expect((await tasks.POST(call(a, "POST", "/api/tasks", { title: "x", plannedSeconds: 10 ** 7 }))).status).toBe(400);
    expect((await notes.GET(call(a, "GET", "/api/tasks/not-a-uuid/notes"), ctx("not-a-uuid"))).status).toBe(404);
  });
});

describe("queue and task advancement", () => {
  it("completes, promotes the next task with its planned duration, and is idempotent", async () => {
    const c = await newClient();
    const first = await add(c, "one", 1500);
    await add(c, "two", 900);
    let s = await getState(c);
    expect(s.tasks.map((t: any) => t.title)).toEqual(["one", "two"]);
    expect(s.tasks[0].timerRunning).toBe(true);
    expect(s.tasks[1].timerRunning).toBe(false);

    const [r1, r2] = await Promise.all([
      complete.POST(call(c, "POST", `/api/tasks/${first.id}/complete`, {}), ctx(first.id)),
      complete.POST(call(c, "POST", `/api/tasks/${first.id}/complete`, {}), ctx(first.id)),
    ]);
    const [b1, b2] = [await r1.json(), await r2.json()];
    expect([b1.alreadyCompleted, b2.alreadyCompleted].filter(Boolean)).toHaveLength(1);
    s = await getState(c);
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ title: "two", plannedSeconds: 900, remainingSeconds: 900, timerRunning: true });
    expect(s.progress.completedToday).toBe(1);

    const { rows } = await getPool().query("SELECT status, elapsed_seconds FROM focus_sessions WHERE task_id = $1", [first.id]);
    expect(rows).toMatchObject([{ status: "completed" }]); // exactly one session despite duplicate requests
  });

  it("completing the last task leaves an empty queue and a daily count", async () => {
    const c = await newClient();
    const only = await add(c, "only");
    await complete.POST(call(c, "POST", `/api/tasks/${only.id}/complete`, {}), ctx(only.id));
    const s = await getState(c);
    expect(s.tasks).toHaveLength(0);
    expect(s.progress).toMatchObject({ completedToday: 1, pendingCount: 0 });
  });

  it("skip moves the head to the back and promotes the next task", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    await add(c, "b");
    await add(c, "c");
    await skip.POST(call(c, "POST", `/api/tasks/${a.id}/skip`, {}), ctx(a.id));
    const s = await getState(c);
    expect(s.tasks.map((t: any) => t.title)).toEqual(["b", "c", "a"]);
    expect(s.tasks.filter((t: any) => t.timerRunning)).toHaveLength(1);
    expect(s.tasks[0].timerRunning).toBe(true);
  });

  it("persists reorder and rejects a stale ordering", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    const b = await add(c, "b");
    const d = await add(c, "c");
    const res = await reorder.POST(call(c, "POST", "/api/tasks/reorder", { orderedIds: [a.id, d.id, b.id] }));
    expect(res.status).toBe(200);
    expect((await getState(c)).tasks.map((t: any) => t.title)).toEqual(["a", "c", "b"]);
    const stale = await reorder.POST(call(c, "POST", "/api/tasks/reorder", { orderedIds: [a.id, d.id] }));
    expect(stale.status).toBe(409);
  });

  it("edits keep notes; deleting cascades notes and sessions", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    await notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content: "kept", baseVersion: 0 }), ctx(a.id));
    await task.PATCH(call(c, "PATCH", `/api/tasks/${a.id}`, { title: "renamed", plannedSeconds: 1200 }), ctx(a.id));
    const n = await (await notes.GET(call(c, "GET", `/api/tasks/${a.id}/notes`), ctx(a.id))).json();
    expect(n.content).toBe("kept");
    await task.DELETE(call(c, "DELETE", `/api/tasks/${a.id}`), ctx(a.id));
    const { rowCount } = await getPool().query("SELECT 1 FROM task_notes WHERE task_id = $1", [a.id]);
    expect(rowCount).toBe(0);
  });
});

describe("timer persistence", () => {
  it("stores remaining time and derives elapsed time server-side while running", async () => {
    const c = await newClient();
    const a = await add(c, "a", 600);
    await timer.PUT(call(c, "PUT", `/api/tasks/${a.id}/timer`, { remainingSeconds: 500, running: false }), ctx(a.id));
    expect((await getState(c)).tasks[0]).toMatchObject({ remainingSeconds: 500, timerRunning: false });
    await timer.PUT(call(c, "PUT", `/api/tasks/${a.id}/timer`, { remainingSeconds: 500, running: true }), ctx(a.id));
    await getPool().query("UPDATE tasks SET timer_anchor_at = now() - interval '30 seconds' WHERE id = $1", [a.id]);
    const t = (await getState(c)).tasks[0];
    expect(t.timerRunning).toBe(true);
    expect(t.remainingSeconds).toBe(470); // survives refresh/restart: time kept passing
  });

  it("rejects remaining time above the plan and running a non-active task", async () => {
    const c = await newClient();
    const a = await add(c, "a", 600);
    const b = await add(c, "b", 600);
    expect((await timer.PUT(call(c, "PUT", `/api/tasks/${a.id}/timer`, { remainingSeconds: 601, running: false }), ctx(a.id))).status).toBe(400);
    expect((await timer.PUT(call(c, "PUT", `/api/tasks/${b.id}/timer`, { remainingSeconds: 100, running: true }), ctx(b.id))).status).toBe(409);
  });

  it("ignores late timer syncs after completion", async () => {
    const c = await newClient();
    const a = await add(c, "a", 600);
    await complete.POST(call(c, "POST", `/api/tasks/${a.id}/complete`, {}), ctx(a.id));
    const res = await timer.PUT(call(c, "PUT", `/api/tasks/${a.id}/timer`, { remainingSeconds: 300, running: true }), ctx(a.id));
    expect(res.status).toBe(200);
    const { rows } = await getPool().query("SELECT timer_running, status FROM tasks WHERE id = $1", [a.id]);
    expect(rows[0]).toMatchObject({ timer_running: false, status: "completed" });
  });
});

describe("notes versioning", () => {
  it("creates one document per task and bumps the version", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    const put = async (content: string, baseVersion: number) =>
      notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content, baseVersion }), ctx(a.id));
    expect(await (await put("v1", 0)).json()).toMatchObject({ version: 1 });
    expect(await (await put("v2", 1)).json()).toMatchObject({ version: 2, content: "v2" });
    const { rows } = await getPool().query("SELECT count(*)::int AS n FROM task_notes WHERE task_id = $1", [a.id]);
    expect(rows[0].n).toBe(1);
  });

  it("a stale save cannot overwrite newer content", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    const put = (content: string, baseVersion: number) =>
      notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content, baseVersion }), ctx(a.id));
    await put("first", 0);
    await put("newer", 1);
    const stale = await put("older edit", 1);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.note).toMatchObject({ content: "newer", version: 2 });
    const n = await (await notes.GET(call(c, "GET", `/api/tasks/${a.id}/notes`), ctx(a.id))).json();
    expect(n.content).toBe("newer");
  });

  it("concurrent writers with the same base version: exactly one wins", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    await notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content: "base", baseVersion: 0 }), ctx(a.id));
    const results = await Promise.all(
      ["x", "y", "z"].map((v) => notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content: v, baseVersion: 1 }), ctx(a.id))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it("treats a retried identical save as success", async () => {
    const c = await newClient();
    const a = await add(c, "a");
    const put = () => notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content: "same", baseVersion: 0 }), ctx(a.id));
    expect((await put()).status).toBe(200);
    expect((await put()).status).toBe(200);
  });
});

describe("completed notes archive", () => {
  it("lists notes from completed tasks and keeps them readable", async () => {
    const c = await newClient();
    const withNotes = await add(c, "done with notes");
    const bare = await add(c, "done without notes");
    await notes.PUT(call(c, "PUT", `/api/tasks/${withNotes.id}/notes`, { content: "shipped it", baseVersion: 0 }), ctx(withNotes.id));
    await complete.POST(call(c, "POST", `/api/tasks/${withNotes.id}/complete`, {}), ctx(withNotes.id));
    await complete.POST(call(c, "POST", `/api/tasks/${bare.id}/complete`, {}), ctx(bare.id));

    const archived = await (await completed.GET(call(c, "GET", "/api/completed"))).json();
    expect(archived.total).toBe(1);
    expect(archived.items).toHaveLength(1);
    expect(archived.items[0]).toMatchObject({ id: withNotes.id, title: "done with notes", hasNotes: true });
    expect(archived.items[0].notePreview).toContain("shipped");

    const all = await (await completed.GET(call(c, "GET", "/api/completed?all=1"))).json();
    expect(all.total).toBe(2);

    const n = await (await notes.GET(call(c, "GET", `/api/tasks/${withNotes.id}/notes`), ctx(withNotes.id))).json();
    expect(n.content).toBe("shipped it");
  });

  it("does not leak another user's completed notes", async () => {
    const a = await newClient();
    const b = await newClient();
    const t = await add(a, "secret archive");
    await notes.PUT(call(a, "PUT", `/api/tasks/${t.id}/notes`, { content: "private", baseVersion: 0 }), ctx(t.id));
    await complete.POST(call(a, "POST", `/api/tasks/${t.id}/complete`, {}), ctx(t.id));
    const leaked = await (await completed.GET(call(b, "GET", "/api/completed"))).json();
    expect(leaked.items.map((i: any) => i.id)).not.toContain(t.id);
  });

  it("searches completed notes by title and content", async () => {
    const c = await newClient();
    const a = await add(c, "Write proposal");
    const b = await add(c, "Buy groceries");
    await notes.PUT(call(c, "PUT", `/api/tasks/${a.id}/notes`, { content: "include budget section", baseVersion: 0 }), ctx(a.id));
    await notes.PUT(call(c, "PUT", `/api/tasks/${b.id}/notes`, { content: "milk and eggs", baseVersion: 0 }), ctx(b.id));
    await complete.POST(call(c, "POST", `/api/tasks/${a.id}/complete`, {}), ctx(a.id));
    await complete.POST(call(c, "POST", `/api/tasks/${b.id}/complete`, {}), ctx(b.id));

    const byTitle = await (await completed.GET(call(c, "GET", "/api/completed?q=proposal"))).json();
    expect(byTitle.items.map((i: any) => i.id)).toEqual([a.id]);

    const byBody = await (await completed.GET(call(c, "GET", "/api/completed?q=budget"))).json();
    expect(byBody.items.map((i: any) => i.id)).toEqual([a.id]);

    const miss = await (await completed.GET(call(c, "GET", "/api/completed?q=xyzzy"))).json();
    expect(miss.total).toBe(0);
  });
});

describe("auth profile", () => {
  it("returns a guest profile until Google is linked", async () => {
    const c = await newClient();
    const res = await me.GET(call(c, "GET", "/api/auth/me"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.signedIn).toBe(false);
    expect(typeof body.googleEnabled).toBe("boolean");
  });
});
