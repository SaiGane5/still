"use client";
import { ArrowRight, NotebookPen, Pencil, Trash2 } from "lucide-react";
import type { Task } from "@/lib/types";

export function ActiveTask({ task, index, total, canSkip, notesOpen, onComplete, onSkip, onNotes, onEdit, onDelete }: {
  task: Task; index: number; total: number; canSkip: boolean; notesOpen: boolean;
  onComplete: () => void; onSkip: () => void; onNotes: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="active">
      <p className="meta">Now focusing <span aria-hidden>·</span> <span aria-label={`Task ${index} of ${total}`}>{pad(index)} / {pad(total)}</span></p>
      <h1 className="title">{task.title}</h1>
      {task.description && <p className="desc">{task.description}</p>}
      <div className="actions">
        <button className="btn-primary" onClick={onComplete}>Complete task <ArrowRight size={16} strokeWidth={1.75} /></button>
        <button className="link-btn" onClick={onSkip} disabled={!canSkip} title={canSkip ? "Move to the end of the queue" : "Add another task to skip"}>Skip</button>
        <span className="actions-spacer" />
        <button className="text-btn" onClick={onNotes} aria-pressed={notesOpen}>
          <NotebookPen size={16} strokeWidth={1.5} /> {notesOpen ? "Close notes" : "Open notes"}
        </button>
        <button className="icon-btn small" onClick={onEdit} aria-label="Edit task"><Pencil size={15} strokeWidth={1.5} /></button>
        <button className="icon-btn small" onClick={onDelete} aria-label="Delete task"><Trash2 size={15} strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}
