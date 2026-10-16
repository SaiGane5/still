"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";

export function UpcomingQueue({ tasks, startNumber, onMove, onEdit, onDelete }: {
  tasks: Task[]; startNumber: number; onMove: (id: string, d: -1 | 1) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}) {
  if (!tasks.length) return null;
  return (
    <nav className="queue" aria-label="Up next">
      <ul>
        <AnimatePresence initial={false} mode="popLayout">
          {tasks.map((t, i) => (
            <motion.li key={t.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
              <TaskRow task={t} number={startNumber + i} isFirst={i === 0} isLast={i === tasks.length - 1}
                onUp={() => onMove(t.id, -1)} onDown={() => onMove(t.id, 1)} onEdit={() => onEdit(t)} onDelete={() => onDelete(t)} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </nav>
  );
}
