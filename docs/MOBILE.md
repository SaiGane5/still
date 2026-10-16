# still. — Android APK conversion log

This document records every step used to wrap the Next.js web app as an Android APK with Capacitor, plus fullscreen timer, native notifications, bundled sounds, and extend-timer UX.

**Production web URL loaded by the app:** `https://still-navy.vercel.app`

---

## Why Capacitor (not a rewrite)

| Option | Fit |
|--------|-----|
| **Capacitor WebView** | Reuses the existing Next.js UI + Neon/API backend; adds native plugins for notifications, background, and sounds. |
| React Native rewrite | Would rebuild the whole product — out of scope. |
| Static TWA only | Weak background timer / custom notification control. |

The APK is a native Android shell. The UI is the live web app (or a local `npm run dev` URL during development). Auth, tasks, and notes stay on Vercel + Neon.

---

## Step 1 — Install build tools (this machine)

1. Install **JDK 17** (Temurin) via Homebrew.
2. Install **Android SDK command-line tools** and accept licenses.
3. Set `JAVA_HOME` / `ANDROID_HOME` for Gradle.

*(Commands and outcomes are appended below as they are run.)*

---

## Step 2 — Add Capacitor to the repo

1. `npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/app @capacitor/local-notifications @capacitor/haptics @capacitor/status-bar`
2. Create `capacitor.config.ts` with `appId`, `appName`, and `server.url` pointing at the deployed site.
3. Create a minimal `mobile/www/index.html` fallback so `webDir` exists for CLI sync.
4. `npx cap add android` then `npx cap sync android`.

---

## Step 3 — Download sound assets

1. Download free tick + alarm WAVs/MP3s into `public/sounds/` (served by Next.js / Capacitor).
2. Copy the same files into `android/app/src/main/res/raw/` for native notification channels.
3. Wire the web audio layer to prefer these files; alarm loops/plays for **5 seconds**.

---

## Step 4 — Fullscreen timer + extend prompt (web, used inside APK)

1. Add a mobile fullscreen focus overlay: task title on top, large clock, pause/exit.
2. On timer expiry: play 5s alarm, show push/local notification, open **Extend timer** sheet (5 / 10 / 15 min).
3. Extend calls the existing `/api/tasks/:id/timer` endpoint with new remaining seconds.

---

## Step 5 — Background + notification bar

1. Request notification permission via Capacitor Local Notifications.
2. While a focus session runs, show an **ongoing** Android notification with title + remaining time (updated periodically).
3. On expiry, fire a high-priority notification with the alarm sound.
4. Keep the WebView from sleeping while focusing via `KeepAwake` / app state hooks where available.

---

## Step 6 — Build the APK

```bash
cd android
./gradlew assembleDebug
# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a device:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Runtime notes

- Google Sign-In inside the WebView uses the same OAuth redirect URIs as the website.
- Ship env vars on Vercel (`GOOGLE_*`, `APP_URL`, `DATABASE_URL`, `AUTH_SECRET`) before relying on production auth in the APK.
- Debug APK is unsigned for Play Store; use `assembleRelease` + a keystore for store distribution.

---

## Changelog of actions (automated)

_Entries appended by the conversion session._
