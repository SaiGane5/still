"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { AppState, Task } from "@/lib/types";
import { ActiveTask } from "./ActiveTask";
import { EmptyState } from "./EmptyState";
import { FocusTimer } from "./FocusTimer";
import { UpcomingQueue } from "./UpcomingQueue";

type Timer = { seconds: number; fraction: number; running: boolean; expired: boolean; toggle: () => void };

export function FocusView({ state, timer, notesOpen, onComplete, onSkip, onNotes, onEdit, onDelete, onAdd, onMove }: {
  state: AppState; timer: Timer; notesOpen: boolean;
  onComplete: () => void; onSkip: () => void; onNotes: () => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void; onAdd: () => void; onMove: (id: string, d: -1 | 1) => void;
}) {
  const reduce = useReducedMotion();
  const head = state.tasks[0];
  const { completedToday } = state.progress;
  const ease = [0.22, 1, 0.36, 1] as const;
  return (
    <main className="focus">
      <div className="focus-inner">
        <AnimatePresence mode="wait" initial={false}>
          {head ? (
            <motion.section key={head.id} className="composition"
              initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16, filter: "blur(2px)" }} transition={{ duration: reduce ? 0 : 0.34, ease }}>
              <ActiveTask task={head} index={completedToday + 1} total={completedToday + state.tasks.length} canSkip={state.tasks.length > 1} notesOpen={notesOpen}
                onComplete={onComplete} onSkip={onSkip} onNotes={onNotes} onEdit={() => onEdit(head)} onDelete={() => onDelete(head)} />
              <FocusTimer {...timer} onToggle={timer.toggle} />
            </motion.section>
          ) : (
            <motion.section key="empty" className="composition composition--empty"
              initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.5, ease }}>
              <EmptyState progress={state.progress} onAdd={onAdd} />
            </motion.section>
          )}
        </AnimatePresence>
        <UpcomingQueue tasks={state.tasks.slice(1)} startNumber={completedToday + 2} onMove={onMove} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </main>
  );
}
