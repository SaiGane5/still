"use client";
import { Maximize2, Pause, Play } from "lucide-react";
import { formatClock } from "@/lib/timer";

const R = 98;
const C = 2 * Math.PI * R;

export function FocusTimer({
  seconds,
  fraction,
  running,
  expired,
  onToggle,
  onFullscreen,
}: {
  seconds: number;
  fraction: number;
  running: boolean;
  expired: boolean;
  onToggle: () => void;
  onFullscreen?: () => void;
}) {
  const label = expired ? "Time's up" : running ? "Focus remaining" : "Paused";
  const action = running ? "Pause" : "Resume";
  return (
    <div className="timer" data-running={running} data-expired={expired}>
      <button className="timer-face" onClick={onToggle} disabled={expired} aria-label={expired ? "Timer finished" : `${action} timer, ${formatClock(seconds)} remaining`}>
        <svg viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r={R} className="ring-track" />
          <circle cx="100" cy="100" r={R} className="ring-progress" strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} transform="rotate(-90 100 100)" />
        </svg>
        <span className="timer-inner">
          <span className="clock" role="timer" aria-live="off">{formatClock(seconds)}</span>
          <span className="timer-label">{label}</span>
        </span>
      </button>
      <div className="timer-actions">
        {!expired && (
          <button className="pill" onClick={onToggle} tabIndex={-1} aria-hidden>
            {running ? <Pause size={14} strokeWidth={0} fill="currentColor" /> : <Play size={14} strokeWidth={0} fill="currentColor" />}
            {action}
          </button>
        )}
        {onFullscreen && (
          <button type="button" className="pill pill-secondary" onClick={onFullscreen} aria-label="Fullscreen timer">
            <Maximize2 size={14} strokeWidth={1.75} />
            Full screen
          </button>
        )}
      </div>
    </div>
  );
}
