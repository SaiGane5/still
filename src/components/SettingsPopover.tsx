"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import type { Settings } from "@/client/useStill";

export function SettingsPopover({ open, onClose, settings, onChange }: { open: boolean; onClose: () => void; settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-haspopup='dialog']")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div ref={ref} role="dialog" aria-label="Settings" className="popover" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          <label className="field-row">
            <span>New task duration</span>
            <span className="stepper">
              <input type="number" min={1} max={480} value={settings.defaultMinutes} aria-label="Default minutes"
                onChange={(e) => onChange({ defaultMinutes: Math.min(480, Math.max(1, Number(e.target.value) || 1)) })} />
              <span className="muted">min</span>
            </span>
          </label>
          <label className="field-row">
            <span>Start next task automatically</span>
            <input type="checkbox" className="switch" checked={settings.autoStart} onChange={(e) => onChange({ autoStart: e.target.checked })} />
          </label>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
