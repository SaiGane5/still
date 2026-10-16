"use client";
import { Settings as Gear, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { ensureNotificationPermission } from "@/client/notify";
import { unlockAudio } from "@/client/sounds";
import type { Settings } from "@/client/useStill";
import { AccountMenu } from "./AccountMenu";
import { SettingsPopover } from "./SettingsPopover";

export function Header({ settings, onSettings }: { settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  const [authFlash, setAuthFlash] = useState<string | null>(null);

  useEffect(() => {
    const fmt = () => setDate(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()));
    fmt();
    const id = setInterval(fmt, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (!auth) return;
    if (auth === "ok") setAuthFlash("Signed in — your tasks sync across devices");
    else if (auth === "unavailable") setAuthFlash("Google sign-in isn’t configured yet");
    else setAuthFlash("Sign-in didn’t complete. Try again.");
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", url.pathname + url.search);
    const t = setTimeout(() => setAuthFlash(null), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <header className="header">
      <div className="brand">
        <span className="wordmark">still.</span>
        <span className="brand-rule" aria-hidden />
        <span className="tagline">One thing at a time</span>
      </div>
      <div className="header-right">
        {authFlash && <span className="auth-flash" role="status">{authFlash}</span>}
        <time className="date" suppressHydrationWarning>{date}</time>
        <AccountMenu />
        <button
          className="icon-btn"
          aria-label={settings.soundEnabled ? "Mute timer sounds" : "Unmute timer sounds"}
          aria-pressed={!settings.soundEnabled}
          title={settings.soundEnabled ? "Sound on" : "Muted"}
          onClick={() => {
            const next = !settings.soundEnabled;
            if (next) {
              unlockAudio();
              void ensureNotificationPermission();
            }
            onSettings({ soundEnabled: next });
          }}
        >
          {settings.soundEnabled ? <Volume2 size={18} strokeWidth={1.5} /> : <VolumeX size={18} strokeWidth={1.5} />}
        </button>
        <div className="popover-anchor">
          <button className="icon-btn" aria-label="Settings" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
            <Gear size={18} strokeWidth={1.5} />
          </button>
          <SettingsPopover open={open} onClose={() => setOpen(false)} settings={settings} onChange={onSettings} />
        </div>
      </div>
    </header>
  );
}
