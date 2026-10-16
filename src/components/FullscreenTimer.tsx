"use client";
import { Minimize2, Pause, Play } from "lucide-react";
import { formatClock } from "@/lib/timer";

const R = 118;
const C = 2 * Math.PI * R;

export function FullscreenTimer({
  title,
  seconds,
  fraction,
  running,
  expired,
  onToggle,
  onExit,
}: {
  title: string;
  seconds: number;
  fraction: number;
  running: boolean;
  expired: boolean;
  onToggle: () => void;
  onExit: () => void;
}) {
  const label = expired ? "Time’s up" : running ? "Focus remaining" : "Paused";
  return (
    <div className="fs-timer" role="dialog" aria-label="Fullscreen timer">
      <header className="fs-timer-top">
        <p className="meta">Now focusing</p>
        <button type="button" className="icon-btn" aria-label="Exit fullscreen" onClick={onExit}>
          <Minimize2 size={20} strokeWidth={1.5} />
        </button>
      </header>
      <h1 className="fs-timer-title">{title}</h1>
      <div className="fs-timer-face-wrap">
        <button
          type="button"
          className="timer-face fs-timer-face"
          data-running={running}
          data-expired={expired}
          onClick={onToggle}
          disabled={expired}
          aria-label={expired ? "Timer finished" : `${running ? "Pause" : "Resume"}, ${formatClock(seconds)}`}
        >
          <svg viewBox="0 0 260 260" aria-hidden>
            <circle cx="130" cy="130" r={R} className="ring-track" />
            <circle
              cx="130"
              cy="130"
              r={R}
              className="ring-progress"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - fraction)}
              transform="rotate(-90 130 130)"
            />
          </svg>
          <span className="timer-inner">
            <span className="clock fs-clock" role="timer" aria-live="off">
              {formatClock(seconds)}
            </span>
            <span className="timer-label">{label}</span>
          </span>
        </button>
      </div>
      {!expired && (
        <button type="button" className="btn-primary fs-timer-action" onClick={onToggle}>
          {running ? <Pause size={16} strokeWidth={0} fill="currentColor" /> : <Play size={16} strokeWidth={0} fill="currentColor" />}
          {running ? "Pause" : "Resume"}
        </button>
      )}
    </div>
  );
}
