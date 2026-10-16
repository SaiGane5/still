export type Task = {
  id: string;
  title: string;
  description: string;
  plannedSeconds: number;
  /** Remaining time as of `AppState.serverNow` (already includes elapsed time if running). */
  remainingSeconds: number;
  status: "pending" | "completed";
  position: number;
  timerRunning: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type Progress = {
  completedToday: number;
  pendingCount: number;
  focusedSecondsToday: number;
};

export type AppState = {
  /** Pending tasks in queue order; index 0 is the active task. */
  tasks: Task[];
  progress: Progress;
  serverNow: string;
  /** True when the request was a duplicate of an already-applied completion. */
  alreadyCompleted?: boolean;
};

export type Note = { taskId: string; content: string; version: number };

export const MIN_SECONDS = 60;
export const MAX_SECONDS = 8 * 60 * 60;
