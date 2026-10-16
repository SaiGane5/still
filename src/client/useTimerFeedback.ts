"use client";
import { useEffect, useRef } from "react";
import { notifyTimeUp } from "./notify";
import { playAlarm, playTick, unlockAudio } from "./sounds";

/**
 * Tick each second while running; alarm + notification once when time hits zero.
 * Respects the mute / sound setting.
 */
export function useTimerFeedback(opts: {
  soundEnabled: boolean;
  seconds: number;
  running: boolean;
  expired: boolean;
  taskId: string | null;
  taskTitle: string;
  seedKey: number | null;
}) {
  const { soundEnabled, seconds, running, expired, taskId, taskTitle, seedKey } = opts;
  const prevSeconds = useRef<number | null>(null);
  const alarmedFor = useRef<string | null>(null);

  // Do not prompt for notifications on mount — Safari throws without a user gesture
  // and that error can stall the load UI. Permission is requested from mute/settings clicks.

  // Soft tick on each whole-second change while counting down.
  useEffect(() => {
    if (!soundEnabled || !running || expired || !taskId) {
      prevSeconds.current = seconds;
      return;
    }
    const prev = prevSeconds.current;
    if (prev != null && seconds < prev && seconds > 0) playTick();
    prevSeconds.current = seconds;
  }, [seconds, running, expired, soundEnabled, taskId]);

  // One alarm + notification per expired task seed.
  useEffect(() => {
    if (!expired || !taskId || seedKey == null) return;
    const key = `${taskId}:${seedKey}`;
    if (alarmedFor.current === key) return;
    alarmedFor.current = key;
    if (!soundEnabled) return;
    unlockAudio();
    playAlarm();
    notifyTimeUp(taskTitle);
  }, [expired, taskId, seedKey, soundEnabled, taskTitle]);
}
