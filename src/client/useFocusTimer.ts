"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedFraction, isExpired, pause, remainingSeconds, resume, snapFrom, type TimerSnap } from "@/lib/timer";
import { api } from "./api";
import { unlockAudio } from "./sounds";
import type { Seed, TimerReading } from "./useStill";

const SYNC_EVERY_MS = 20_000;
const TICK_MS = 250;

/**
 * Drives the countdown from timestamps. One interval runs only while the timer is running;
 * the server is told about changes (pause/resume/expiry), every 20 s, and when the page hides.
 */
export function useFocusTimer(seed: Seed | null, plannedSeconds: number) {
  const [seedKey, setSeedKey] = useState<number | null>(null);
  const [snap, setSnap] = useState<TimerSnap>(() => snapFrom(0, false, 0));
  const [now, setNow] = useState(0);
  const taskId = seed?.taskId ?? null;

  // Re-seed during render (derived state) so a new task never flashes the previous task's time.
  if (seed && seed.key !== seedKey) {
    const t = Date.now();
    setSeedKey(seed.key);
    setSnap(snapFrom(seed.remainingSeconds, seed.running, t));
    setNow(t);
  }

  const live = useRef({ snap, taskId, dirty: false });
  live.current.snap = snap;
  live.current.taskId = taskId;

  const read = useCallback((): TimerReading => {
    const { snap: s, taskId: id } = live.current;
    return id ? { id, remainingSeconds: remainingSeconds(s, Date.now()), running: s.running && !isExpired(s, Date.now()) } : null;
  }, []);

  const sync = useCallback(async (keepalive = false) => {
    const r = read();
    if (!r) return;
    live.current.dirty = true;
    try {
      await api.timer(r.id, r.remainingSeconds, r.running, keepalive);
      if (live.current.taskId === r.id) live.current.dirty = false;
    } catch {
      /* retried on the next interval; server state is only ever behind by a few seconds */
    }
  }, [read]);

  const running = snap.running;

  // single interval while running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running, taskId, seedKey]);

  // expiry
  const expiredNow = running && isExpired(snap, now);
  useEffect(() => {
    if (!expiredNow) return;
    setSnap((s) => pause(s, Date.now()));
    void sync();
  }, [expiredNow, sync]);

  // periodic persistence + retry of failed syncs
  useEffect(() => {
    if (!taskId) return;
    const id = setInterval(() => {
      if (live.current.snap.running || live.current.dirty) void sync();
    }, SYNC_EVERY_MS);
    return () => clearInterval(id);
  }, [taskId, sync]);

  // page visibility: persist when hidden, refresh display when visible
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") void sync(true);
      else setNow(Date.now());
    };
    const onHide = () => void sync(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [sync]);

  const toggle = useCallback(() => {
    unlockAudio(); // user gesture — allow tick / alarm later
    const t = Date.now();
    const cur = live.current.snap;
    const next = cur.running ? pause(cur, t) : resume(cur, t);
    if (next === cur) return;
    live.current.snap = next;
    setSnap(next);
    setNow(t);
    void sync();
  }, [sync]);

  /** Add more focus time (e.g. after expiry) and optionally start running. */
  const extend = useCallback(
    (extraSeconds: number, start = true) => {
      unlockAudio();
      const t = Date.now();
      const cur = live.current.snap;
      const left = remainingSeconds(cur, t);
      const next: TimerSnap = {
        remainingMs: (left + Math.max(0, extraSeconds)) * 1000,
        anchorAt: t,
        running: start,
      };
      live.current.snap = next;
      setSnap(next);
      setNow(t);
      void sync();
    },
    [sync],
  );

  const secs = remainingSeconds(snap, now || Date.now());
  return {
    seconds: secs,
    fraction: elapsedFraction(snap, now || Date.now(), plannedSeconds),
    running: snap.running,
    expired: secs <= 0,
    toggle,
    extend,
    read,
  };
}
