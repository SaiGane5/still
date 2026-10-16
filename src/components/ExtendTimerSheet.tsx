"use client";
import { AnimatePresence, motion } from "framer-motion";
import { stopAlarm } from "@/client/sounds";

const OPTIONS = [
  { label: "+5 min", seconds: 5 * 60 },
  { label: "+10 min", seconds: 10 * 60 },
  { label: "+15 min", seconds: 15 * 60 },
] as const;

export function ExtendTimerSheet({
  open,
  title,
  onExtend,
  onDismiss,
}: {
  open: boolean;
  title: string;
  onExtend: (seconds: number) => void;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              stopAlarm();
              onDismiss();
            }
          }}
        >
          <motion.div
            role="dialog"
            aria-label="Extend timer"
            className="composer extend-sheet"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                stopAlarm();
                onDismiss();
              }
            }}
          >
            <p className="meta">Time’s up</p>
            <p className="confirm-title">Keep going on “{title}”?</p>
            <p className="muted">Alarm plays for 5 seconds. Extend the focus block or dismiss.</p>
            <div className="extend-options">
              {OPTIONS.map((o) => (
                <button
                  key={o.seconds}
                  type="button"
                  className="btn-primary extend-chip"
                  onClick={() => {
                    stopAlarm();
                    onExtend(o.seconds);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="composer-foot">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  stopAlarm();
                  onDismiss();
                }}
              >
                Not now
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
