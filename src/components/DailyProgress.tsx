"use client";
import type { Progress } from "@/lib/types";

export function DailyProgress({ progress }: { progress: Progress }) {
  const total = progress.completedToday + progress.pendingCount;
  const pct = total ? Math.round((progress.completedToday / total) * 100) : 0;
  return (
    <div className="progress">
      <span>{progress.completedToday} {progress.completedToday === 1 ? "task" : "tasks"} completed today</span>
      <div className="bar" role="progressbar" aria-label="Daily progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
