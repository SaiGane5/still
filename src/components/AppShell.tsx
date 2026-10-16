"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureNativeNotificationPermission, isNativeApp } from "@/client/native";
import { flushAllKeepalive, getNoteSession, hasUnsavedNotes } from "@/client/notesRegistry";
import { useFocusTimer } from "@/client/useFocusTimer";
import { useSettings, useStill, type TimerReading } from "@/client/useStill";
import { useTimerFeedback } from "@/client/useTimerFeedback";
import type { Task } from "@/lib/types";
import { Assistant } from "./Assistant";
import { DailyProgress } from "./DailyProgress";
import { ExtendTimerSheet } from "./ExtendTimerSheet";
import { FocusView } from "./FocusView";
import { FullscreenTimer } from "./FullscreenTimer";
import { Header } from "./Header";
import { TaskComposer } from "./TaskComposer";
import { TaskNotesSidebar } from "./TaskNotesSidebar";
import { formatClock } from "@/lib/timer";

export function AppShell() {
  const [settings, updateSettings] = useSettings();
  const readRef = useRef<() => TimerReading>(() => null);
  const still = useStill(settings, useCallback(() => readRef.current(), []));
  const { state, seed } = still;
  const head = state?.tasks[0];
  const timer = useFocusTimer(seed, head?.plannedSeconds ?? 0);
  readRef.current = timer.read;

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesUnsafe, setNotesUnsafe] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);

  useTimerFeedback({
    soundEnabled: settings.soundEnabled,
    seconds: timer.seconds,
    plannedSeconds: head?.plannedSeconds ?? timer.seconds,
    running: timer.running,
    expired: timer.expired,
    taskId: head?.id ?? null,
    taskTitle: head?.title ?? "",
    seedKey: seed?.key ?? null,
    onTimeUp: () => setExtendOpen(true),
    onNotificationAction: (action) => {
      if (action === "pause" && timer.running) timer.toggle();
      else if (action === "resume" && !timer.running && !timer.expired) timer.toggle();
    },
  });

  // Ask for notification permission once inside the native shell (user-gesture friendly: first resume).
  useEffect(() => {
    if (!isNativeApp()) return;
    const ask = () => void ensureNativeNotificationPermission();
    window.addEventListener("pointerdown", ask, { once: true });
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  // Esc closes notes / fullscreen / extend
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (extendOpen) {
        setExtendOpen(false);
        return;
      }
      if (fullscreen) {
        setFullscreen(false);
        return;
      }
      if (!notesOpen || composer.open || confirmDelete) return;
      if (notesUnsafe) return;
      setNotesOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [notesOpen, notesUnsafe, composer.open, confirmDelete, fullscreen, extendOpen]);

  useEffect(() => {
    const onHide = () => flushAllKeepalive();
    const onBefore = (e: BeforeUnloadEvent) => {
      if (hasUnsavedNotes()) {
        flushAllKeepalive();
        e.preventDefault();
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBefore);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBefore);
    };
  }, []);

  useEffect(() => {
    document.title = head && timer.running ? `${formatClock(timer.seconds)} · ${head.title}` : "still.";
  }, [head, timer.running, timer.seconds]);

  useEffect(() => {
    if (!still.toast) return;
    const id = setTimeout(still.dismissToast, 6000);
    return () => clearTimeout(id);
  }, [still.toast, still.dismissToast]);

  useEffect(() => {
    if (state && !head) {
      setNotesOpen(false);
      setFullscreen(false);
      setExtendOpen(false);
    }
  }, [state, head]);

  // Auto-enter fullscreen on narrow / native when a timer is running
  useEffect(() => {
    if (!head) return;
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
    if ((isNativeApp() || narrow) && timer.running && !timer.expired) setFullscreen(true);
  }, [head?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only on task change

  const openAdd = () => setComposer({ open: true, task: null });
  const closeComposer = useCallback(() => setComposer((c) => ({ ...c, open: false })), []);

  return (
    <div className="shell" data-fullscreen={fullscreen || undefined}>
      <div className="main">
        <Header settings={settings} onSettings={updateSettings} />
        {!state ? (
          <main className="focus">
            <div className="focus-inner center-note">
              {still.loadError ? (
                <div role="alert">
                  <p className="desc">Couldn’t load your tasks. {still.loadError}</p>
                  <button className="btn-primary" onClick={() => void still.load()}>Try again</button>
                </div>
              ) : (
                <p className="meta" aria-busy>Loading…</p>
              )}
            </div>
          </main>
        ) : (
          <FocusView
            state={state}
            timer={timer}
            notesOpen={notesOpen}
            onComplete={still.complete}
            onSkip={still.skip}
            onNotes={() => setNotesOpen((o) => !o)}
            onEdit={(t) => setComposer({ open: true, task: t })}
            onDelete={setConfirmDelete}
            onAdd={openAdd}
            onMove={still.move}
            onFullscreen={head ? () => setFullscreen(true) : undefined}
          />
        )}
        <footer className="footer">
          <div className="footer-progress">
            {state ? <DailyProgress progress={state.progress} /> : null}
          </div>
          <button className="text-btn footer-add" onClick={openAdd} disabled={!state}>
            Add task <Plus size={15} strokeWidth={1.5} />
          </button>
          <div className="footer-spacer" aria-hidden />
        </footer>
      </div>

      <TaskNotesSidebar open={notesOpen && !!head} taskId={head?.id ?? null} title={head?.title ?? ""} onClose={() => setNotesOpen(false)} onUnsafe={setNotesUnsafe} />

      <TaskComposer
        open={composer.open}
        task={composer.task}
        defaultMinutes={settings.defaultMinutes}
        onClose={closeComposer}
        onSubmit={async (v) => {
          if (composer.task) await still.edit(composer.task.id, v);
          else await still.add(v);
        }}
      />

      <AnimatePresence>
        {fullscreen && head && (
          <motion.div
            key="fs"
            className="fs-timer-root"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
          >
            <FullscreenTimer
              title={head.title}
              seconds={timer.seconds}
              fraction={timer.fraction}
              running={timer.running}
              expired={timer.expired}
              onToggle={timer.toggle}
              onExit={() => setFullscreen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ExtendTimerSheet
        open={extendOpen && !!head}
        title={head?.title ?? "this task"}
        onExtend={(secs) => {
          timer.extend(secs, true);
          setExtendOpen(false);
          setFullscreen(true);
        }}
        onDismiss={() => setExtendOpen(false)}
      />

      <AnimatePresence>
        {confirmDelete && (
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
            <motion.div role="alertdialog" aria-label="Delete task" className="composer confirm" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              onKeyDown={(e) => e.key === "Escape" && setConfirmDelete(null)}>
              <p className="confirm-title">Delete “{confirmDelete.title}”?</p>
              <p className="muted">Its notes and focus history are deleted with it.</p>
              <div className="composer-foot">
                <button className="link-btn" autoFocus onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => { const t = confirmDelete; setConfirmDelete(null); void still.remove(t.id); }}>Delete</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {still.toast && (
          <motion.div className="toast" role="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {still.toast}
            <button className="link-btn tiny" onClick={still.dismissToast}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>

      {!fullscreen && (
        <Assistant
          focusTaskId={head?.id ?? null}
          onQueued={(s) => {
            still.applyRemote(s);
            still.setToast(`Added to your queue`);
          }}
          onNoteSaved={(taskId, content, version) => {
            getNoteSession(taskId).applyServerNote(content, version);
            setNotesOpen(true);
            still.setToast("Notes updated");
          }}
        />
      )}
    </div>
  );
}
