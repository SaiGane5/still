/**
 * Soft synthesized timer sounds (Web Audio). No asset files required.
 * Call `unlockAudio()` from a user gesture so the browser allows playback.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Resume the audio context after a click / timer toggle. */
export function unlockAudio() {
  audio();
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
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 920, t, 0.035, 0.028, "triangle");
}

/** Short chime when a focus session hits zero. */
export function playAlarm() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  tone(c, 523.25, t, 0.18, 0.09); // C5
  tone(c, 659.25, t + 0.16, 0.2, 0.1); // E5
  tone(c, 783.99, t + 0.34, 0.35, 0.11); // G5
}
