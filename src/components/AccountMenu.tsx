"use client";
import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/client/useAuth";

export function AccountMenu() {
  const { user, googleEnabled, loaded, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!loaded) return null;

  if (!user?.signedIn) {
    return (
      <div className="account-slot">
        <Link href="/archive" className="text-btn account-link" title="Completed notes">
          <FolderOpen size={15} strokeWidth={1.5} />
          <span className="account-link-label">Archive</span>
        </Link>
        {googleEnabled && (
          <a href="/api/auth/google" className="text-btn account-link">
            Sign in
          </a>
        )}
      </div>
    );
  }

  const label = user.displayName || user.email || "Account";
  const initial = label.trim().charAt(0).toUpperCase() || "S";

  return (
    <div className="popover-anchor account-slot" ref={ref}>
      <Link href="/archive" className="text-btn account-link" title="Completed notes">
        <FolderOpen size={15} strokeWidth={1.5} />
        <span className="account-link-label">Archive</span>
      </Link>
      <button
        className="avatar-btn"
        aria-label={`Account: ${label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="avatar-img" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar-fallback">{initial}</span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Account"
            className="popover account-popover"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            <div className="account-identity">
              <p className="account-name">{label}</p>
              {user.email && user.displayName && <p className="muted account-email">{user.email}</p>}
              <p className="meta account-sync">Synced across devices</p>
            </div>
            <button
              className="account-action"
              onClick={() => {
                setOpen(false);
                void logout();
              }}
            >
              <LogOut size={15} strokeWidth={1.5} />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
