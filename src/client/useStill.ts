"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, Task } from "@/lib/types";
import { api, ApiError } from "./api";
import { forgetSession, localDrafts } from "./notesRegistry";

export type Seed = { key: number; taskId: string | null; remainingSeconds: number; running: boolean };
export type Settings = { defaultMinutes: number; autoStart: boolean; soundEnabled: boolean };
export type TimerReading = { id: string; remainingSeconds: number; running: boolean } | null;

const SETTINGS_KEY = "still:settings";
const DEFAULTS: Settings = { defaultMinutes: 25, autoStart: true, soundEnabled: true };

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {}
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);
  return [settings, update] as const;
}

const messageOf = (e: unknown) => (e instanceof ApiError ? (e.status === 0 ? "You appear to be offline." : e.message) : "Something went wrong.");

let seedCounter = 0;
const seedFor = (s: AppState): Seed => ({
  key: ++seedCounter,
  taskId: s.tasks[0]?.id ?? null,
  remainingSeconds: s.tasks[0]?.remainingSeconds ?? 0,
  running: s.tasks[0]?.timerRunning ?? false,
});

/**
 * Queue + mutation state. Complete/skip are optimistic and strictly serialised through a
 * promise chain, so rapid or duplicate clicks can never interleave or double-advance.
 */
export function useStill(settings: Settings, readTimer: () => TimerReading) {
  const [state, setState] = useState<AppState | null>(null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const readTimerRef = useRef(readTimer);
  readTimerRef.current = readTimer;
  const stateRef = useRef<AppState | null>(null);

  const apply = useCallback((s: AppState) => {
    stateRef.current = s;
    setState(s);
    setSeed(seedFor(s));
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      apply(await api.state());
    } catch (e) {
      setLoadError(messageOf(e));
    }
  }, [apply]);

  // StrictMode runs effects twice; two parallel first requests would mint two guest accounts.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const enqueue = useCallback(
    <T,>(job: () => Promise<T>): Promise<T> => {
      pending.current++;
      const run = chain.current.then(job, job);
      chain.current = run.catch(() => {}).finally(() => void pending.current--);
      return run;
    },
    [],
  );

  const syncTimerFirst = async () => {
    const t = readTimerRef.current();
    if (t) await api.timer(t.id, t.remainingSeconds, t.running).catch(() => {});
  };

  /** Reconcile with the server only when nothing newer is waiting in the queue. */
  const settle = (s: AppState) => {
    if (pending.current <= 1) apply(s);
  };

  const recover = async (e: unknown) => {
    setToast(messageOf(e));
    try {
      apply(await api.state());
    } catch {}
  };

  const advanceLocal = (s: AppState, completed: boolean): AppState => {
    const [head, ...rest] = s.tasks;
    const auto = settingsRef.current.autoStart;
    const tasks: Task[] = completed ? rest : [...rest, { ...head, timerRunning: false }];
    if (tasks[0] && head && tasks[0].id !== head.id) {
      const n = tasks[0];
      tasks[0] = { ...n, remainingSeconds: n.remainingSeconds || n.plannedSeconds, timerRunning: auto };
    }
    return {
      ...s,
      tasks,
      progress: {
        ...s.progress,
        completedToday: s.progress.completedToday + (completed ? 1 : 0),
        pendingCount: tasks.length,
      },
    };
  };

  const complete = useCallback(() => {
    const s = stateRef.current;
    const head = s?.tasks[0];
    if (!s || !head) return;
    const timer = readTimerRef.current();
    const next = advanceLocal(s, true);
    apply(next);
    void enqueue(async () => {
      try {
        if (timer && timer.id === head.id) await api.timer(head.id, timer.remainingSeconds, timer.running).catch(() => {});
        settle(await api.complete(head.id, settingsRef.current.autoStart));
      } catch (e) {
        await recover(e);
      }
    });
  }, [apply, enqueue]);

  const skip = useCallback(() => {
    const s = stateRef.current;
    const head = s?.tasks[0];
    if (!s || !head || s.tasks.length < 2) return;
    const timer = readTimerRef.current();
    apply(advanceLocal(s, false));
    void enqueue(async () => {
      try {
        if (timer && timer.id === head.id) await api.timer(head.id, timer.remainingSeconds, timer.running).catch(() => {});
        settle(await api.skip(head.id, settingsRef.current.autoStart));
      } catch (e) {
        await recover(e);
      }
    });
  }, [apply, enqueue]);

  const add = useCallback(
    async (input: { title: string; description: string; plannedSeconds: number }) => {
      const res = await enqueue(() => api.createTask(input));
      apply(res.state);
      return res.id;
    },
    [apply, enqueue],
  );

  const edit = useCallback(
    async (id: string, patch: { title?: string; description?: string; plannedSeconds?: number }) => {
      const res = await enqueue(async () => {
        const t = readTimerRef.current();
        if (t && t.id === id) await api.timer(t.id, t.remainingSeconds, t.running).catch(() => {});
        return api.updateTask(id, patch);
      });
      apply(res);
    },
    [apply, enqueue],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        const res = await enqueue(async () => {
          await syncTimerFirst();
          return api.deleteTask(id);
        });
        forgetSession(id);
        localDrafts.remove(id);
        apply(res);
      } catch (e) {
        setToast(messageOf(e));
      }
    },
    [apply, enqueue],
  );

  const move = useCallback(
    (id: string, delta: -1 | 1) => {
      const s = stateRef.current;
      if (!s) return;
      const ids = s.tasks.map((t) => t.id);
      const i = ids.indexOf(id);
      const j = i + delta;
      if (i < 1 || j < 1 || j >= ids.length) return; // the active task (index 0) stays put
      [ids[i], ids[j]] = [ids[j], ids[i]];
      const byId = new Map(s.tasks.map((t) => [t.id, t]));
      apply({ ...s, tasks: ids.map((x) => byId.get(x)!) });
      void enqueue(async () => {
        try {
          settle(await api.reorder(ids));
        } catch (e) {
          if (e instanceof ApiError && e.body?.state) apply(e.body.state);
          else await recover(e);
        }
      });
    },
    [apply, enqueue],
  );

  return { state, seed, loadError, toast, dismissToast: () => setToast(null), setToast, load, complete, skip, add, edit, remove, move };
}
