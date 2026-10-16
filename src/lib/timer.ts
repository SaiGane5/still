/**
 * Timestamp-based countdown. The snapshot stores the remaining time at an anchor instant;
 * the displayed value is always recomputed from `now`, so it never drifts when tabs are
 * throttled or the machine sleeps.
 */
export type TimerSnap = { remainingMs: number; anchorAt: number; running: boolean };

export const snapFrom = (remainingSeconds: number, running: boolean, now: number): TimerSnap => ({
  remainingMs: remainingSeconds * 1000,
  anchorAt: now,
  running: running && remainingSeconds > 0,
});

export function remainingMs(s: TimerSnap, now: number): number {
  return s.running ? Math.max(0, s.remainingMs - (now - s.anchorAt)) : s.remainingMs;
}

/** Whole seconds shown on the clock (rounded up so 00:00 only appears at the end). */
export const remainingSeconds = (s: TimerSnap, now: number) => Math.ceil(remainingMs(s, now) / 1000);

export const pause = (s: TimerSnap, now: number): TimerSnap => ({ remainingMs: remainingMs(s, now), anchorAt: now, running: false });

export const resume = (s: TimerSnap, now: number): TimerSnap =>
  s.remainingMs > 0 ? { remainingMs: s.remainingMs, anchorAt: now, running: true } : s;

export const isExpired = (s: TimerSnap, now: number) => remainingMs(s, now) <= 0;

/** 0 → 1 elapsed fraction for the progress ring. */
export const elapsedFraction = (s: TimerSnap, now: number, plannedSeconds: number) =>
  plannedSeconds <= 0 ? 0 : Math.min(1, Math.max(0, 1 - remainingMs(s, now) / (plannedSeconds * 1000)));

export function formatClock(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
