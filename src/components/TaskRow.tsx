"use client";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { formatDuration } from "@/lib/timer";
import type { Task } from "@/lib/types";

export function TaskRow({ task, number, isFirst, isLast, onUp, onDown, onEdit, onDelete }: {
  task: Task; number: number; isFirst: boolean; isLast: boolean;
  onUp: () => void; onDown: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="row">
      <span className="row-dot" aria-hidden />
      <span className="row-num">{String(number).padStart(2, "0")}</span>
      <span className="row-title" title={task.title}>{task.title}</span>
      <span className="row-actions">
        <button className="icon-btn tiny" aria-label={`Move “${task.title}” up`} disabled={isFirst} onClick={onUp}><ChevronUp size={14} strokeWidth={1.5} /></button>
        <button className="icon-btn tiny" aria-label={`Move “${task.title}” down`} disabled={isLast} onClick={onDown}><ChevronDown size={14} strokeWidth={1.5} /></button>
        <button className="icon-btn tiny" aria-label={`Edit “${task.title}”`} onClick={onEdit}><Pencil size={13} strokeWidth={1.5} /></button>
        <button className="icon-btn tiny" aria-label={`Delete “${task.title}”`} onClick={onDelete}><Trash2 size={13} strokeWidth={1.5} /></button>
      </span>
      <span className="row-dur">{formatDuration(task.plannedSeconds)}</span>
    </div>
  );
}
