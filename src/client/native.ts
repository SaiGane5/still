/**
 * Capacitor / native bridge helpers. Safe no-ops on the regular web.
 */

import { formatClock } from "@/lib/timer";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

const ONGOING_ID = 71001;
const DONE_ID = 71002;

export async function ensureNativeNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === "granted";
  } catch {
    return false;
  }
}

/** Ongoing status-bar style notification with remaining focus time. */
export async function updateFocusNotification(opts: {
  title: string;
  seconds: number;
  running: boolean;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    if (opts.seconds <= 0) {
      await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }] });
      return;
    }
    const body = opts.running
      ? `${formatClock(opts.seconds)} remaining`
      : `Paused · ${formatClock(opts.seconds)} left`;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: ONGOING_ID,
          title: opts.title || "still.",
          body,
          ongoing: true,
          autoCancel: false,
          extra: { kind: "focus-progress" },
          // Replacing same id refreshes the shade notification
          schedule: { at: new Date(Date.now() + 250) },
        },
      ],
    });
  } catch (e) {
    console.warn("focus notification update failed", e);
  }
}

export async function clearFocusNotification(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }, { id: DONE_ID }] });
  } catch {
    /* ignore */
  }
}

/** High-priority “time’s up” notification (uses bundled alarm sound on Android). */
export async function notifyNativeTimeUp(title: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: DONE_ID,
          title: "still. — time’s up",
          body: title ? `“${title}” finished. Extend or complete?` : "Your focus session finished.",
          sound: "alarm.wav",
          schedule: { at: new Date(Date.now() + 200) },
          extra: { kind: "focus-done" },
        },
      ],
    });
  } catch (e) {
    console.warn("time-up notification failed", e);
  }
}

export async function hapticLight(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* ignore */
  }
}
