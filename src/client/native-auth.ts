/**
 * Google sign-in for the Capacitor Android shell.
 * Custom Tabs don't share cookies with the WebView, so we open Google in the
 * system browser and complete the session via a deep-link handoff token.
 */

import { isNativeApp } from "./native";

const HANDOFF_PATH = "/api/auth/native";

function parseHandoffToken(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "app.still.focus:" && !u.hostname.includes("still")) {
      // app.still.focus://auth?t=…
      if (!url.startsWith("app.still.focus://")) return null;
    }
    const q = url.includes("?") ? new URLSearchParams(url.split("?")[1] ?? "") : u.searchParams;
    return q.get("t") || q.get("code");
  } catch {
    return null;
  }
}

/** Exchange a handoff token inside the WebView so the session cookie lands here. */
async function completeHandoff(token: string): Promise<void> {
  window.location.assign(`${HANDOFF_PATH}?t=${encodeURIComponent(token)}`);
}

/** Listen for OAuth deep links (call once on app boot). */
export function installNativeAuthListener(): void {
  if (!isNativeApp()) return;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      const { Browser } = await import("@capacitor/browser");

      await App.addListener("appUrlOpen", async ({ url }) => {
        const token = parseHandoffToken(url);
        if (!token) return;
        try {
          await Browser.close();
        } catch {
          /* ignore */
        }
        await completeHandoff(token);
      });

      // Cold start via deep link
      const launch = await App.getLaunchUrl();
      if (launch?.url) {
        const token = parseHandoffToken(launch.url);
        if (token) await completeHandoff(token);
      }
    } catch (e) {
      console.warn("native auth listener failed", e);
    }
  })();
}

/** Start Google OAuth in a Custom Tab; falls back to full-page redirect on web. */
export async function startGoogleSignIn(): Promise<void> {
  if (!isNativeApp()) {
    window.location.href = "/api/auth/google";
    return;
  }
  try {
    const res = await fetch("/api/auth/google/native", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
    });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!res.ok || !data?.url) {
      throw new Error(data?.error?.message || "Couldn’t start Google sign-in");
    }
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.url, presentationStyle: "popover" });
  } catch (e) {
    console.error("native google sign-in failed", e);
    // Last resort: in-app navigation (may still fail to return cookies)
    window.location.href = "/api/auth/google";
  }
}
