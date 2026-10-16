"use client";
import { useEffect, useRef } from "react";
import {
  clearFocusNotification,
  ensureNativeNotificationPermission,
  installNativeTimerActionListener,
  isNativeApp,
  notifyNativeTimeUp,
  updateFocusNotification,
  type TimerNotificationAction,
} from "./native";
import { notifyTimeUp } from "./notify";
import { playAlarm, stopAlarm, unlockAudio } from "./sounds";

/**
 * Alarm + notification + extend prompt on expiry only (no per-second ticks).
 * Keeps a silent ongoing Android notification with live remaining time and pause/resume actions.
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
  onNotificationAction?: (action: TimerNotificationAction) => void;
}) {
  const { soundEnabled, seconds, running, expired, taskId, taskTitle, seedKey, onTimeUp, onNotificationAction } = opts;
  const alarmedFor = useRef<string | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  const onActionRef = useRef(onNotificationAction);
  onTimeUpRef.current = onTimeUp;
  onActionRef.current = onNotificationAction;
  const lastPosted = useRef<{ seconds: number; running: boolean; title: string } | null>(null);

  useEffect(() => {
    installNativeTimerActionListener();
  }, []);

  useEffect(() => {
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<TimerNotificationAction>).detail;
      if (action === "pause" || action === "resume") onActionRef.current?.(action);
    };
    window.addEventListener("still:timer-action", onAction);
    return () => window.removeEventListener("still:timer-action", onAction);
  }, []);

  // Ongoing notification — update in place; never clear while a focus task is active.
  useEffect(() => {
    if (!isNativeApp()) return;
    if (!taskId) {
      lastPosted.current = null;
      void clearFocusNotification();
      return;
    }
    if (expired || seconds <= 0) return;

    const prev = lastPosted.current;
    // Always refresh running clock; while paused only refresh if state/title changed.
    if (prev && !running && prev.running === running && prev.seconds === seconds && prev.title === taskTitle) {
      return;
    }

    void ensureNativeNotificationPermission().then((ok) => {
      if (!ok) return;
      lastPosted.current = { seconds, running, title: taskTitle };
      void updateFocusNotification({ title: taskTitle, seconds, running });
    });
  }, [taskId, taskTitle, seconds, running, expired]);

  // One alarm + notification + extend prompt per expired task seed.
  useEffect(() => {
    if (!expired || !taskId || seedKey == null) return;
    const key = `${taskId}:${seedKey}`;
    if (alarmedFor.current === key) return;
    alarmedFor.current = key;
    lastPosted.current = null;
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
