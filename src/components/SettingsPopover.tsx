"use client";
import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, LogIn, LogOut, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { startGoogleSignIn } from "@/client/native-auth";
import { ensureNotificationPermission } from "@/client/notify";
import { unlockAudio } from "@/client/sounds";
import { useAuth } from "@/client/useAuth";
import type { Settings } from "@/client/useStill";

export function SettingsPopover({
  open,
  onClose,
  settings,
  onChange,
  dateLabel,
}: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (p: Partial<Settings>) => void;
  dateLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { user, googleEnabled, loaded, logout } = useAuth();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-haspopup='dialog']")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="dialog"
          aria-label="Settings"
          className="popover settings-popover"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {dateLabel && (
            <p className="settings-date meta" suppressHydrationWarning>
              {dateLabel}
            </p>
          )}

          <Link href="/archive" className="settings-nav-link" onClick={onClose}>
            <FolderOpen size={15} strokeWidth={1.5} />
            Archive
          </Link>

          <label className="field-row">
            <span>New task duration</span>
            <span className="stepper">
              <input
                type="number"
                min={1}
                max={480}
                value={settings.defaultMinutes}
                aria-label="Default minutes"
                onChange={(e) => onChange({ defaultMinutes: Math.min(480, Math.max(1, Number(e.target.value) || 1)) })}
              />
              <span className="muted">min</span>
            </span>
          </label>
          <label className="field-row">
            <span>Start next task automatically</span>
            <input type="checkbox" className="switch" checked={settings.autoStart} onChange={(e) => onChange({ autoStart: e.target.checked })} />
          </label>
          <label className="field-row">
            <span className="settings-sound-label">
              {settings.soundEnabled ? <Volume2 size={14} strokeWidth={1.5} /> : <VolumeX size={14} strokeWidth={1.5} />}
              Timer sounds
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={settings.soundEnabled}
              aria-label="Timer sounds"
              onChange={(e) => {
                const on = e.target.checked;
                if (on) {
                  unlockAudio();
                  void ensureNotificationPermission();
                }
                onChange({ soundEnabled: on });
              }}
            />
          </label>
          <p className="muted settings-hint">Alarm and notification only when the timer reaches zero.</p>

          {loaded && (user?.signedIn || googleEnabled) && (
            <div className="settings-account">
              {user?.signedIn ? (
                <>
                  <div className="settings-account-identity">
                    {user.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.avatarUrl} alt="" className="settings-avatar" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="settings-avatar settings-avatar-fallback">
                        {(user.displayName || user.email || "S").trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div>
                      <p className="account-name">{user.displayName || user.email || "Signed in"}</p>
                      {user.email && user.displayName && <p className="muted account-email">{user.email}</p>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="account-action"
                    onClick={() => {
                      onClose();
                      void logout();
                    }}
                  >
                    <LogOut size={15} strokeWidth={1.5} />
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="account-action"
                  onClick={() => {
                    onClose();
                    void startGoogleSignIn();
                  }}
                >
                  <LogIn size={15} strokeWidth={1.5} />
                  Sign in with Google
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
