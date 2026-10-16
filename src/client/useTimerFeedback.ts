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
 * Alarm on expiry only. Native MediaStyle notification is updated on state changes
 * (not every tick) — Android's chronometer handles live countdown without flicker.
 */
export function useTimerFeedback(opts: {
  soundEnabled: boolean;
  seconds: number;
  plannedSeconds: number;
  running: boolean;
  expired: boolean;
  taskId: string | null;
  taskTitle: string;
  seedKey: number | null;
  onTimeUp?: () => void;
  onNotificationAction?: (action: TimerNotificationAction) => void;
}) {
  const {
    soundEnabled,
    seconds,
    plannedSeconds,
    running,
    expired,
    taskId,
    taskTitle,
    seedKey,
    onTimeUp,
    onNotificationAction,
  } = opts;
  const alarmedFor = useRef<string | null>(null);
  const onTimeUpRef = useRef(onTimeUp);
  const onActionRef = useRef(onNotificationAction);
  onTimeUpRef.current = onTimeUp;
  onActionRef.current = onNotificationAction;
  const lastSync = useRef<{
    taskId: string;
    title: string;
    running: boolean;
    seconds: number;
    planned: number;
  } | null>(null);

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

  // Persistent now-playing card — sync only when status meaningfully changes.
  useEffect(() => {
    if (!isNativeApp()) return;

    if (!taskId || expired || seconds <= 0) {
      lastSync.current = null;
      if (!taskId || expired) void clearFocusNotification();
      return;
    }

    const prev = lastSync.current;
    const jumped = !!prev && Math.abs(prev.seconds - seconds) > 2; // extend / seek
    const stateChanged =
      !prev ||
      prev.taskId !== taskId ||
      prev.title !== taskTitle ||
      prev.running !== running ||
      prev.planned !== plannedSeconds;

    // While running, chronometer ticks natively — skip per-second JS updates.
    if (!stateChanged && !jumped && running) return;
    if (!stateChanged && !jumped && !running && prev?.seconds === seconds) return;

    lastSync.current = {
      taskId,
      title: taskTitle,
      running,
      seconds,
      planned: plannedSeconds,
    };

    void ensureNativeNotificationPermission().then((ok) => {
      if (!ok) return;
      void updateFocusNotification({
        title: taskTitle,
        seconds,
        plannedSeconds: plannedSeconds || seconds,
        running,
      });
    });
  }, [taskId, taskTitle, seconds, plannedSeconds, running, expired]);

  // One alarm + time-up notice per expired task seed.
  useEffect(() => {
    if (!expired || !taskId || seedKey == null) return;
    const key = `${taskId}:${seedKey}`;
    if (alarmedFor.current === key) return;
    alarmedFor.current = key;
    lastSync.current = null;
    if (soundEnabled) {
      unlockAudio();
      playAlarm(5_000);
    }
    void notifyNativeTimeUp(taskTitle);
    notifyTimeUp(taskTitle);
    onTimeUpRef.current?.();
  }, [expired, taskId, seedKey, soundEnabled, taskTitle]);

  useEffect(() => {
    if (!expired) stopAlarm();
  }, [expired]);
}
