"use client";
import type { SaveStatus as Status } from "@/lib/noteSession";

export function SaveStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  let text = "";
  let action: string | null = null;
  switch (status) {
    case "loading": text = "Loading…"; break;
    case "dirty":
    case "saving": text = "Saving…"; break;
    case "saved": text = "Saved"; break;
    case "error": text = "Couldn’t save"; action = "Retry"; break;
    case "conflict": text = "Edited elsewhere"; action = "Keep mine"; break;
    case "load-error": text = "Couldn’t load"; action = "Retry"; break;
  }
  const bad = status === "error" || status === "conflict" || status === "load-error";
  return (
    <span className="save-status" data-bad={bad} role="status" aria-live="polite">
      {text}
      {action && <button className="link-btn tiny" onClick={onRetry}>{action}</button>}
    </span>
  );
}
