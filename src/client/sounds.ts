/**
 * Timer sounds: alarm only when a focus session hits zero.
 * Call `unlockAudio()` from a user gesture so the WebView allows playback later.
 */

let ctx: AudioContext | null = null;
let alarmEl: HTMLAudioElement | null = null;
let alarmStopTimer: ReturnType<typeof setTimeout> | null = null;

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

function ensureAlarmElement() {
  if (typeof window === "undefined") return;
  if (!alarmEl) {
    alarmEl = new Audio(ALARM_SRC);
    alarmEl.preload = "auto";
    alarmEl.loop = true;
    alarmEl.volume = 0.7;
  }
}

/** Resume audio context after a click / timer toggle — no audible playback. */
export function unlockAudio() {
  const c = audio();
  if (!c) return;
  // Silent buffer unlocks playback policies without a tick sound.
  try {
    const buf = c.createBuffer(1, 1, c.sampleRate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* ignore */
  }
  ensureAlarmElement();
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

/** @deprecated Ticks removed — only the time-up alarm should play. Kept as no-op for safety. */
export function playTick() {
  /* intentionally silent */
}

/**
 * Alarm when a focus session hits zero — plays bundled sound for 5 seconds
 * (loops the clip if shorter), then stops. Call `stopAlarm()` to cut early.
 */
export function playAlarm(durationMs = ALARM_MS) {
  stopAlarm();
  ensureAlarmElement();
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
