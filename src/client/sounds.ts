/**
 * Timer sounds: prefers bundled files under /sounds, falls back to Web Audio synthesis.
 * Call `unlockAudio()` from a user gesture so the browser/WebView allows playback.
 */

let ctx: AudioContext | null = null;
let tickEl: HTMLAudioElement | null = null;
let alarmEl: HTMLAudioElement | null = null;
let alarmStopTimer: ReturnType<typeof setTimeout> | null = null;

const TICK_SRC = "/sounds/tick.mp3";
const ALARM_SRC = "/sounds/alarm.mp3";
const ALARM_MS = 5_000;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function ensureElements() {
  if (typeof window === "undefined") return;
  if (!tickEl) {
    tickEl = new Audio(TICK_SRC);
    tickEl.preload = "auto";
    tickEl.volume = 0.35;
  }
  if (!alarmEl) {
    alarmEl = new Audio(ALARM_SRC);
    alarmEl.preload = "auto";
    alarmEl.loop = true;
    alarmEl.volume = 0.7;
  }
}

/** Resume audio context + unlock HTMLAudio after a click / timer toggle. */
export function unlockAudio() {
  audio();
  ensureElements();
  // Play+pause unlocks HTMLAudio on iOS/Android WebViews
  void tickEl?.play().then(() => {
    tickEl?.pause();
    if (tickEl) tickEl.currentTime = 0;
  }).catch(() => {});
}

function tone(c: AudioContext, freq: number, start: number, dur: number, peak = 0.06, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** Quiet per-second tick while the focus clock is running. */
export function playTick() {
  ensureElements();
  if (tickEl) {
    try {
      tickEl.currentTime = 0;
      void tickEl.play().catch(() => synthTick());
      return;
    } catch {
      /* fall through */
    }
  }
  synthTick();
}

function synthTick() {
  const c = audio();
  if (!c) return;
  tone(c, 920, c.currentTime, 0.035, 0.028, "triangle");
}

/**
 * Alarm when a focus session hits zero — plays bundled sound for 5 seconds
 * (loops the clip if shorter), then stops. Call `stopAlarm()` to cut early.
 */
export function playAlarm(durationMs = ALARM_MS) {
  stopAlarm();
  ensureElements();
  unlockAudio();
  if (alarmEl) {
    try {
      alarmEl.currentTime = 0;
      alarmEl.loop = true;
      void alarmEl.play().catch(() => synthAlarm(durationMs));
      alarmStopTimer = setTimeout(() => stopAlarm(), durationMs);
      return;
    } catch {
      /* fall through */
    }
  }
  synthAlarm(durationMs);
}

function synthAlarm(durationMs: number) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime;
  const end = t0 + durationMs / 1000;
  let t = t0;
  while (t < end) {
    tone(c, 523.25, t, 0.18, 0.09);
    tone(c, 659.25, t + 0.16, 0.2, 0.1);
    tone(c, 783.99, t + 0.34, 0.28, 0.11);
    t += 0.85;
  }
  alarmStopTimer = setTimeout(() => stopAlarm(), durationMs);
}

export function stopAlarm() {
  if (alarmStopTimer) {
    clearTimeout(alarmStopTimer);
    alarmStopTimer = null;
  }
  if (alarmEl) {
    alarmEl.pause();
    alarmEl.currentTime = 0;
    alarmEl.loop = false;
  }
}
