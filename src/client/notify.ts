/** Browser push notification when a focus session ends. */

export type NotifyPermission = NotificationPermission | "unsupported";

export function notificationSupport(): NotifyPermission {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** Ask for permission (no-op if already granted/denied/unsupported). */
export async function ensureNotificationPermission(): Promise<NotifyPermission> {
  const current = notificationSupport();
  if (current !== "default") return current;
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationSupport();
  }
}

export function notifyTimeUp(title: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  // Skip if the tab is focused — the on-screen timer already says "Time's up".
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const n = new Notification("still. — time's up", {
      body: title ? `“${title}” is ready to complete.` : "Your focus session finished.",
      tag: "still-timer-done",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers reject Notification construction outside a service worker */
  }
}
