/**
 * Capacitor / native bridge helpers. Safe no-ops on the regular web.
 *
 * Focus countdown uses a native foreground MediaStyle notification (Spotify-like)
 * so the shade entry updates in place — never cancel/reschedule flicker.
 */

import { FocusTimer } from "./focus-timer-plugin";

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

export type TimerNotificationAction = "pause" | "resume";

let actionListenerInstalled = false;
let permissionAsked = false;

/** Listen for Pause / Resume from the ongoing MediaStyle notification. */
export function installNativeTimerActionListener(): void {
  if (!isNativeApp() || actionListenerInstalled) return;
  actionListenerInstalled = true;
  void FocusTimer.addListener("timerAction", (event) => {
    const action = event?.action;
    if (action === "pause" || action === "resume") {
      window.dispatchEvent(new CustomEvent<TimerNotificationAction>("still:timer-action", { detail: action }));
    }
  }).catch((e) => console.warn("focus timer listener failed", e));
}

export async function ensureNativeNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  // POST_NOTIFICATIONS is requested via LocalNotifications once; FocusTimer itself
  // posts through NotificationManager after the user grants.
  if (permissionAsked) return true;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") {
      permissionAsked = true;
      return true;
    }
    const req = await LocalNotifications.requestPermissions();
    permissionAsked = req.display === "granted";
    return permissionAsked;
  } catch {
    return true; // best-effort; older Android doesn't need runtime grant
  }
}

/**
 * Update the persistent now-playing focus card.
 * Call only on start / pause / resume / extend / retitle — not every tick.
 * While running, Android's chronometer counts down inside the notification.
 */
export async function updateFocusNotification(opts: {
  title: string;
  seconds: number;
  plannedSeconds: number;
  running: boolean;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (opts.seconds <= 0) {
      await FocusTimer.stop();
      return;
    }
    await FocusTimer.update({
      title: opts.title || "still.",
      seconds: Math.max(0, Math.floor(opts.seconds)),
      plannedSeconds: Math.max(1, Math.floor(opts.plannedSeconds || opts.seconds)),
      running: opts.running,
    });
  } catch (e) {
    console.warn("focus notification update failed", e);
  }
}

export async function clearFocusNotification(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FocusTimer.stop();
  } catch {
    /* ignore */
  }
}

/** Time-up shade notice (non-ongoing). WebView plays the alarm audio. */
export async function notifyNativeTimeUp(title: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await FocusTimer.stop();
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: "still-alarm",
      name: "Timer finished",
      description: "Alert when a focus session ends",
      importance: 5,
      sound: undefined,
      vibration: true,
    }).catch(() => {});
    await LocalNotifications.schedule({
      notifications: [
        {
          id: 71002,
          title: "still. — time’s up",
          body: title ? `“${title}” finished. Extend or complete?` : "Your focus session finished.",
          channelId: "still-alarm",
          ongoing: false,
          autoCancel: true,
          schedule: { at: new Date(Date.now() + 50) },
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
