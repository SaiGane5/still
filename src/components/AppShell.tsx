"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushAllKeepalive, hasUnsavedNotes } from "@/client/notesRegistry";
import { useFocusTimer } from "@/client/useFocusTimer";
import { useSettings, useStill, type TimerReading } from "@/client/useStill";
import { useTimerFeedback } from "@/client/useTimerFeedback";
import type { Task } from "@/lib/types";
import { DailyProgress } from "./DailyProgress";
import { FocusView } from "./FocusView";
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

  useTimerFeedback({
    soundEnabled: settings.soundEnabled,
    seconds: timer.seconds,
    running: timer.running,
    expired: timer.expired,
    taskId: head?.id ?? null,
    taskTitle: head?.title ?? "",
    seedKey: seed?.key ?? null,
  });

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesUnsafe, setNotesUnsafe] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  // Esc closes notes only when nothing is unsaved-with-error and no dialog is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !notesOpen || composer.open || confirmDelete) return;
      if (notesUnsafe) return;
      setNotesOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [notesOpen, notesUnsafe, composer.open, confirmDelete]);

  // last-chance protection for notes
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

  // closing notes when the queue empties
  useEffect(() => {
    if (state && !head) setNotesOpen(false);
  }, [state, head]);

  const openAdd = () => setComposer({ open: true, task: null });
  const closeComposer = useCallback(() => setComposer((c) => ({ ...c, open: false })), []);

  return (
    <div className="shell">
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
          />
        )}
        <footer className="footer">
          {state ? <DailyProgress progress={state.progress} /> : <span />}
          <button className="text-btn" onClick={openAdd} disabled={!state}>Add task <Plus size={15} strokeWidth={1.5} /></button>
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
    </div>
  );
}
