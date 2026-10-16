"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { archiveApi } from "@/client/api";
import type { CompletedNoteItem, Progress } from "@/lib/types";

function formatWhen(iso: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function DailyProgress({ progress }: { progress: Progress }) {
  const total = progress.completedToday + progress.pendingCount;
  const pct = total ? Math.round((progress.completedToday / total) * 100) : 0;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CompletedNoteItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecent = useCallback(async () => {
    if (items) return;
    setLoading(true);
    try {
      const data = await archiveApi.list({ limit: 3, all: true });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [items]);

  const show = useCallback(() => {
    setOpen(true);
    void loadRecent();
  }, [loadRecent]);

  const hideSoon = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 160);
  }, []);

  const keepOpen = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setOpen(true);
  }, []);

  // Refresh list when today's count changes (e.g. after completing a task)
  useEffect(() => {
    setItems(null);
  }, [progress.completedToday]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  return (
    <div
      className="progress progress-anchor"
      ref={root}
      onMouseEnter={() => {
        keepOpen();
        show();
      }}
      onMouseLeave={hideSoon}
    >
      <button
        type="button"
        className="progress-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) setOpen(false);
          else show();
        }}
      >
        <span>
          {progress.completedToday} {progress.completedToday === 1 ? "task" : "tasks"} completed today
        </span>
        <div className="bar" role="progressbar" aria-label="Daily progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Recently completed"
            className="popover progress-popover"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            onMouseEnter={keepOpen}
            onMouseLeave={hideSoon}
          >
            <p className="meta">Last completed</p>
            {loading && !items ? (
              <p className="muted progress-popover-empty">Loading…</p>
            ) : !items?.length ? (
              <p className="muted progress-popover-empty">No completed tasks yet.</p>
            ) : (
              <ul className="progress-recent">
                {items.map((item) => (
                  <li key={item.id}>
                    <span className="progress-recent-title">{item.title}</span>
                    <span className="progress-recent-when">{formatWhen(item.completedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/archive" className="progress-archive-link" onClick={() => setOpen(false)}>
              Open archive
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
