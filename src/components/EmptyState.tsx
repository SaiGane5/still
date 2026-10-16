"use client";
import { Plus } from "lucide-react";
import { formatDuration } from "@/lib/timer";
import type { Progress } from "@/lib/types";

export function EmptyState({ progress, onAdd }: { progress: Progress; onAdd: () => void }) {
  const done = progress.completedToday;
  return (
    <div className="empty">
      <p className="meta">{done ? "Everything is done" : "Nothing in the queue"}</p>
      <h1 className="title">{done ? "That’s a wrap for now." : "What’s the one thing?"}</h1>
      <p className="desc">
        {done
          ? `${done} ${done === 1 ? "task" : "tasks"} completed today${progress.focusedSecondsToday >= 60 ? ` · ${formatDuration(progress.focusedSecondsToday)} of focus` : ""}.`
          : "Add a task and give it a time. Only one is ever in front of you."}
      </p>
      <div className="actions">
        <button className="btn-primary" onClick={onAdd}>Add a task <Plus size={16} strokeWidth={1.75} /></button>
      </div>
    </div>
  );
}
