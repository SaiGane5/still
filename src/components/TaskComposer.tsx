"use client";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/types";

const PRESETS = [5, 10, 15, 25, 45];

export type ComposerValue = { title: string; description: string; plannedSeconds: number };

export function TaskComposer({ open, task, defaultMinutes, onClose, onSubmit }: {
  open: boolean; task: Task | null; defaultMinutes: number; onClose: () => void; onSubmit: (v: ComposerValue) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(defaultMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setMinutes(task ? Math.round(task.plannedSeconds / 60) : defaultMinutes);
    setError(null);
    setBusy(false);
    const id = setTimeout(() => titleRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [open, task, defaultMinutes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const valid = title.trim().length > 0 && minutes >= 1 && minutes <= 480;
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), description: description.trim(), plannedSeconds: Math.round(minutes) * 60 });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the task");
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.form role="dialog" aria-modal="true" aria-label={task ? "Edit task" : "New task"} className="composer" onSubmit={submit}
            initial={{ opacity: 0, y: 14, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
            <div className="composer-head">
              <span className="meta">{task ? "Edit task" : "New task"}</span>
              <button type="button" className="icon-btn small" aria-label="Close" onClick={onClose}><X size={16} strokeWidth={1.5} /></button>
            </div>
            <input ref={titleRef} className="composer-title" placeholder="What needs your focus?" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" />
            <textarea className="composer-desc" placeholder="Add a short description (optional)" rows={2} value={description} maxLength={2000}
              onChange={(e) => setDescription(e.target.value)} aria-label="Description"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(); }} />
            <div className="duration">
              <span className="meta">Duration</span>
              <div className="chips" role="group" aria-label="Duration presets">
                {PRESETS.map((m) => (
                  <button type="button" key={m} className="chip" aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m}</button>
                ))}
              </div>
              <span className="stepper">
                <input type="number" min={1} max={480} value={minutes} aria-label="Minutes" onChange={(e) => setMinutes(Number(e.target.value))} />
                <span className="muted">min</span>
              </span>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="composer-foot">
              <span className="muted hint">⌘↵ to save</span>
              <button type="submit" className="btn-primary" disabled={!valid || busy}>{task ? "Save changes" : "Add task"}</button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
