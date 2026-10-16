"use client";
import { ArrowLeft, FileText } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, archiveApi, notesApi } from "@/client/api";
import type { CompletedNoteItem } from "@/lib/types";
import { NotesEditor } from "./NotesEditor";
import { AccountMenu } from "./AccountMenu";

function formatCompleted(iso: string) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function ArchiveView() {
  const [items, setItems] = useState<CompletedNoteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CompletedNoteItem | null>(null);
  const [note, setNote] = useState("");
  const [noteLoading, setNoteLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await archiveApi.list({ limit: 100 });
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t load archive");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setNote("");
      return;
    }
    let cancelled = false;
    setNoteLoading(true);
    void notesApi
      .load(selected.id)
      .then((n) => {
        if (!cancelled) setNote(n.content);
      })
      .catch(() => {
        if (!cancelled) setNote("");
      })
      .finally(() => {
        if (!cancelled) setNoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="shell archive-shell">
      <div className="main archive-main">
        <header className="header">
          <div className="brand">
            <Link href="/" className="wordmark archive-back">
              still.
            </Link>
            <span className="brand-rule" aria-hidden />
            <span className="tagline">Completed notes</span>
          </div>
          <div className="header-right">
            <AccountMenu />
          </div>
        </header>

        <div className="archive-body">
          <aside className="archive-list" aria-label="Completed notes">
            <div className="archive-list-head">
              <Link href="/" className="text-btn">
                <ArrowLeft size={15} strokeWidth={1.5} />
                Focus
              </Link>
              <span className="meta">{total ? `${total} note${total === 1 ? "" : "s"}` : "Archive"}</span>
            </div>

            {loading ? (
              <p className="meta archive-empty">Loading…</p>
            ) : error ? (
              <div className="archive-empty" role="alert">
                <p className="desc">{error}</p>
                <button className="btn-primary" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="archive-empty">
                <FileText size={22} strokeWidth={1.25} className="muted" />
                <p className="desc">Notes from completed tasks will appear here.</p>
                <p className="muted">Finish a task with notes to start your archive.</p>
              </div>
            ) : (
              <ul className="archive-items">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="archive-item"
                      data-active={selected?.id === item.id}
                      onClick={() => setSelected(item)}
                    >
                      <span className="archive-item-title">{item.title}</span>
                      <span className="archive-item-date">{formatCompleted(item.completedAt)}</span>
                      {item.notePreview && <span className="archive-item-preview">{item.notePreview}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="archive-detail" aria-label="Note">
            {!selected ? (
              <div className="archive-empty archive-detail-empty">
                <p className="muted">Select a completed task to read its notes.</p>
              </div>
            ) : (
              <div className="notes-panel archive-note-panel">
                <div className="notes-top">
                  <span className="meta">Notes</span>
                  <span className="grow" />
                  <span className="save-status">{formatCompleted(selected.completedAt)}</span>
                </div>
                <div className="notes-doc">
                  <h2 className="notes-title">{selected.title}</h2>
                  {noteLoading ? (
                    <p className="meta">Loading…</p>
                  ) : (
                    <NotesEditor value={note} onChange={() => {}} readOnly autoFocus={false} />
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
