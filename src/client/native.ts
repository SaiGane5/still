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
const FOCUS_CHANNEL = "still-focus-silent";
const ALARM_CHANNEL = "still-alarm";
const ACTION_TYPE = "FOCUS_CONTROLS";

let channelsReady = false;
let actionsReady = false;
let actionListenerInstalled = false;
/** True once we've successfully posted the ongoing focus notification. */
let focusPosted = false;

export type TimerNotificationAction = "pause" | "resume";

async function ensureChannels(): Promise<void> {
  if (channelsReady) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  // Silent channel for live countdown — no sound/vibration on each refresh.
  await LocalNotifications.createChannel({
    id: FOCUS_CHANNEL,
    name: "Focus timer",
    description: "Live countdown while focusing",
    importance: 3,
    visibility: 1,
    sound: undefined,
    vibration: false,
    lights: false,
  });
  await LocalNotifications.createChannel({
    id: ALARM_CHANNEL,
    name: "Timer finished",
    description: "Plays when a focus session ends",
    importance: 5,
    visibility: 1,
    sound: "alarm.wav",
    vibration: true,
  });
  channelsReady = true;
}

async function ensureActionTypes(): Promise<void> {
  if (actionsReady) return;
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: ACTION_TYPE,
        actions: [
          { id: "pause", title: "Pause", foreground: true },
          { id: "resume", title: "Resume", foreground: true },
        ],
      },
    ],
  });
  actionsReady = true;
}

/** Listen for Pause / Resume from the ongoing notification. Call once on boot. */
export function installNativeTimerActionListener(): void {
  if (!isNativeApp() || actionListenerInstalled) return;
  actionListenerInstalled = true;
  void (async () => {
    try {
      await ensureActionTypes();
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      await LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
        const action = event.actionId;
        if (action === "pause" || action === "resume") {
          window.dispatchEvent(new CustomEvent<TimerNotificationAction>("still:timer-action", { detail: action }));
        }
      });
    } catch (e) {
      console.warn("native timer action listener failed", e);
    }
  })();
}

export async function ensureNativeNotificationPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const cur = await LocalNotifications.checkPermissions();
    if (cur.display === "granted") {
      await ensureChannels();
      await ensureActionTypes();
      return true;
    }
    const req = await LocalNotifications.requestPermissions();
    if (req.display === "granted") {
      await ensureChannels();
      await ensureActionTypes();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function focusPayload(opts: { title: string; seconds: number; running: boolean }) {
  const clock = formatClock(opts.seconds);
  const body = opts.running ? `${clock} remaining` : `Paused · ${clock} left`;
  return {
    id: ONGOING_ID,
    title: opts.title || "still.",
    body,
    largeBody: body,
    summaryText: opts.running ? "Focusing" : "Paused",
    channelId: FOCUS_CHANNEL,
    actionTypeId: ACTION_TYPE,
    ongoing: true,
    autoCancel: false,
    // Empty sound — channel is silent; never play on refresh.
    sound: undefined,
    extra: { kind: "focus-progress", running: opts.running },
    // Immediate post (not a future AlarmManager one-shot that can vanish).
    schedule: { at: new Date(Date.now() + 10) },
  };
}

/**
 * Ongoing status-bar notification with remaining focus time.
 * Uses update() after the first post so the shade entry stays put.
 */
export async function updateFocusNotification(opts: {
  title: string;
  seconds: number;
  running: boolean;
}): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await ensureChannels();
    await ensureActionTypes();

    if (opts.seconds <= 0) {
      focusPosted = false;
      await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }] });
      return;
    }

    const payload = focusPayload(opts);

    if (focusPosted) {
      try {
        await LocalNotifications.update({ notifications: [payload] });
        return;
      } catch {
        // Fall through to schedule if update isn't available / notification gone.
      }
    }

    await LocalNotifications.schedule({ notifications: [payload] });
    focusPosted = true;
  } catch (e) {
    console.warn("focus notification update failed", e);
  }
}

export async function clearFocusNotification(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    focusPosted = false;
    await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }, { id: DONE_ID }] });
    try {
      await LocalNotifications.removeDeliveredNotificationsById?.({ ids: [ONGOING_ID, DONE_ID] });
    } catch {
      /* older plugin */
    }
  } catch {
    /* ignore */
  }
}

/** High-priority “time’s up” notification (alarm channel only — no tick/refresh sounds). */
export async function notifyNativeTimeUp(title: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await ensureChannels();
    focusPosted = false;
    await LocalNotifications.cancel({ notifications: [{ id: ONGOING_ID }] });
    try {
      await LocalNotifications.removeDeliveredNotificationsById?.({ ids: [ONGOING_ID] });
    } catch {
      /* ignore */
    }
    // Silent alert in the shade — the WebView plays the 5s alarm once to avoid double sound.
    await LocalNotifications.schedule({
      notifications: [
        {
          id: DONE_ID,
          title: "still. — time’s up",
          body: title ? `“${title}” finished. Extend or complete?` : "Your focus session finished.",
          channelId: FOCUS_CHANNEL,
          ongoing: false,
          autoCancel: true,
          schedule: { at: new Date(Date.now() + 10) },
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
