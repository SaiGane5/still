"use client";
import { useEffect, useRef } from "react";
import {
  clearFocusNotification,
  ensureNativeNotificationPermission,
  isNativeApp,
  notifyNativeTimeUp,
  updateFocusNotification,
} from "./native";
import { notifyTimeUp } from "./notify";
import { playAlarm, playTick, stopAlarm, unlockAudio } from "./sounds";

/**
 * Tick each second while running; 5s alarm + notification + extend prompt on expiry.
 * Updates the Android ongoing notification while focusing in the Capacitor app.
 */
export function useTimerFeedback(opts: {
  soundEnabled: boolean;
  seconds: number;
  running: boolean;
  expired: boolean;
  taskId: string | null;
  taskTitle: string;
  seedKey: number | null;
  onTimeUp?: () => void;
}) {
  const { soundEnabled, seconds, running, expired, taskId, taskTitle, seedKey, onTimeUp } = opts;
  const prevSeconds = useRef<number | null>(null);
  const alarmedFor = useRef<string | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

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

  // Ongoing notification bar (native) — refresh about once per second.
  useEffect(() => {
    if (!isNativeApp() || !taskId) {
      void clearFocusNotification();
      return;
    }
    if (expired || seconds <= 0) return;
    void ensureNativeNotificationPermission().then((ok) => {
      if (!ok) return;
      void updateFocusNotification({ title: taskTitle, seconds, running });
    });
  }, [taskId, taskTitle, seconds, running, expired]);

  useEffect(() => () => {
    void clearFocusNotification();
  }, []);

  // One alarm + notification + extend prompt per expired task seed.
  useEffect(() => {
    if (!expired || !taskId || seedKey == null) return;
    const key = `${taskId}:${seedKey}`;
    if (alarmedFor.current === key) return;
    alarmedFor.current = key;
    if (soundEnabled) {
      unlockAudio();
      playAlarm(5_000);
    }
    void notifyNativeTimeUp(taskTitle);
    notifyTimeUp(taskTitle);
    onTimeUpRef.current?.();
  }, [expired, taskId, seedKey, soundEnabled, taskTitle]);

  // Stop looping alarm if the user extends / leaves expiry.
  useEffect(() => {
    if (!expired) stopAlarm();
  }, [expired]);
}
