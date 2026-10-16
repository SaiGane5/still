"use client";
import { Settings as Gear } from "lucide-react";
import { useEffect, useState } from "react";
import type { Settings } from "@/client/useStill";
import { SettingsPopover } from "./SettingsPopover";

export function Header({ settings, onSettings }: { settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const [date, setDate] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const fmt = () => setDate(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()));
    fmt();
    const id = setInterval(fmt, 60_000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="header">
      <div className="brand">
        <span className="wordmark">still.</span>
        <span className="brand-rule" aria-hidden />
        <span className="tagline">One thing at a time</span>
      </div>
      <div className="header-right">
        <time className="date" suppressHydrationWarning>{date}</time>
        <div className="popover-anchor">
          <button className="icon-btn" aria-label="Settings" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
            <Gear size={18} strokeWidth={1.5} />
          </button>
          <SettingsPopover open={open} onClose={() => setOpen(false)} settings={settings} onChange={onSettings} />
        </div>
      </div>
    </header>
  );
}
