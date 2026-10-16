"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PanelRightClose } from "lucide-react";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getNoteSession } from "@/client/notesRegistry";
import { useMediaQuery } from "@/client/useMediaQuery";
import { NotesEditor } from "./NotesEditor";
import { SaveStatus } from "./SaveStatus";

export const NOTES_WIDTH = 460;
const ease = [0.22, 1, 0.36, 1] as const;

function NotesPanel({ taskId, title, onClose, onUnsafe }: { taskId: string; title: string; onClose: () => void; onUnsafe: (u: boolean) => void }) {
  const session = useMemo(() => getNoteSession(taskId), [taskId]);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const reduce = useReducedMotion();
  const coarse = useMediaQuery("(pointer: coarse)");

  // save pending edits for this task when switching away or closing
  useEffect(() => () => void session.flush(), [session]);
  const unsafe = snap.status === "error" || snap.status === "conflict";
  useEffect(() => onUnsafe(unsafe), [unsafe, onUnsafe]);

  return (
    <div className="notes-panel">
      <div className="notes-top">
        <button className="icon-btn" onClick={() => { void session.flush(); onClose(); }} aria-label="Close notes"><PanelRightClose size={18} strokeWidth={1.5} /></button>
        <span className="meta">Notes</span>
        <span className="grow" />
        <SaveStatus status={snap.status} onRetry={() => void session.retry()} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={taskId} className="notes-doc" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2, ease }}>
          <h2 className="notes-title">{title}</h2>
          <NotesEditor value={snap.content} onChange={(v) => session.setContent(v)} readOnly={!snap.loaded} autoFocus={!coarse} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function TaskNotesSidebar({ open, taskId, title, onClose, onUnsafe }: { open: boolean; taskId: string | null; title: string; onClose: () => void; onUnsafe: (u: boolean) => void }) {
  const inline = useMediaQuery("(min-width: 1100px)");
  const reduce = useReducedMotion();
  const d = reduce ? 0 : 0.36;
  return (
    <AnimatePresence initial={false}>
      {open && taskId && (inline ? (
        <motion.aside key="inline" className="notes notes--inline" aria-label="Task notes" initial={{ width: 0, opacity: 0 }} animate={{ width: NOTES_WIDTH, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: d, ease }}>
          <div className="notes-inner" style={{ width: NOTES_WIDTH }}>
            <NotesPanel taskId={taskId} title={title} onClose={onClose} onUnsafe={onUnsafe} />
          </div>
        </motion.aside>
      ) : (
        <motion.aside key="overlay" className="notes notes--overlay" aria-label="Task notes" initial={{ x: "100%", opacity: 0.6 }} animate={{ x: 0, opacity: 1 }} exit={{ x: "100%", opacity: 0 }} transition={{ duration: d, ease }}>
          <NotesPanel taskId={taskId} title={title} onClose={onClose} onUnsafe={onUnsafe} />
        </motion.aside>
      ))}
    </AnimatePresence>
  );
}
