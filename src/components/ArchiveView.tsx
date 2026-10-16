"use client";
import { ArrowLeft, FileText, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ApiError, archiveApi } from "@/client/api";
import { flushAllKeepalive, getNoteSession, hasUnsavedNotes } from "@/client/notesRegistry";
import { useMediaQuery } from "@/client/useMediaQuery";
import type { CompletedNoteItem } from "@/lib/types";
import { AccountMenu } from "./AccountMenu";
import { NotesEditor } from "./NotesEditor";
import { SaveStatus } from "./SaveStatus";

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

function previewOf(content: string) {
  return content.replace(/[\n\r]+/g, " ").trim().slice(0, 140);
}

function ArchiveNotePanel({
  taskId,
  title,
  completedAt,
  onPreview,
}: {
  taskId: string;
  title: string;
  completedAt: string;
  onPreview: (taskId: string, preview: string) => void;
}) {
  const session = useMemo(() => getNoteSession(taskId), [taskId]);
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const coarse = useMediaQuery("(pointer: coarse)");

  useEffect(() => () => void session.flush(), [session]);

  useEffect(() => {
    if (!snap.loaded) return;
    onPreview(taskId, previewOf(snap.content));
  }, [snap.loaded, snap.content, taskId, onPreview]);

  return (
    <div className="notes-panel archive-note-panel">
      <div className="notes-top">
        <span className="meta">Notes</span>
        <span className="grow" />
        <SaveStatus status={snap.status} onRetry={() => void session.retry()} />
        <span className="save-status archive-completed-at">{formatCompleted(completedAt)}</span>
      </div>
      <div className="notes-doc">
        <h2 className="notes-title">{title}</h2>
        <NotesEditor
          value={snap.content}
          onChange={(v) => session.setContent(v)}
          readOnly={!snap.loaded}
          autoFocus={!coarse && snap.loaded}
        />
      </div>
    </div>
  );
}

export function ArchiveView() {
  const [items, setItems] = useState<CompletedNoteItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<CompletedNoteItem | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await archiveApi.list({ limit: 100, q: q || undefined });
      setItems(data.items);
      setTotal(data.total);
      setSelected((cur) => (cur && data.items.some((i) => i.id === cur.id) ? cur : null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t load archive");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(debouncedQuery);
  }, [load, debouncedQuery]);

  useEffect(() => {
    const onHide = () => flushAllKeepalive();
    const onBefore = (e: BeforeUnloadEvent) => {
      if (hasUnsavedNotes()) {
        flushAllKeepalive();
        e.preventDefault();
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onBefore);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onBefore);
    };
  }, []);

  const onPreview = useCallback((taskId: string, preview: string) => {
    setItems((list) =>
      list.map((item) =>
        item.id === taskId
          ? { ...item, notePreview: preview, hasNotes: preview.length > 0 }
          : item,
      ),
    );
  }, []);

  const selectItem = (item: CompletedNoteItem) => {
    if (selected && selected.id !== item.id) {
      void getNoteSession(selected.id).flush();
    }
    setSelected(item);
  };

  const searching = debouncedQuery.length > 0;
  const emptyMessage = searching
    ? `No notes match “${debouncedQuery}”.`
    : "Notes from completed tasks will appear here.";

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
              <span className="meta">
                {loading ? "Searching…" : total ? `${total} note${total === 1 ? "" : "s"}` : searching ? "No matches" : "Archive"}
              </span>
            </div>

            <div className="archive-search">
              <Search size={15} strokeWidth={1.5} aria-hidden className="archive-search-icon" />
              <input
                type="search"
                className="archive-search-input"
                placeholder="Search titles and notes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search completed notes"
                autoComplete="off"
              />
              {query && (
                <button type="button" className="icon-btn tiny" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={14} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {loading && items.length === 0 ? (
              <p className="meta archive-empty">Loading…</p>
            ) : error ? (
              <div className="archive-empty" role="alert">
                <p className="desc">{error}</p>
                <button className="btn-primary" onClick={() => void load(debouncedQuery)}>
                  Try again
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="archive-empty">
                <FileText size={22} strokeWidth={1.25} className="muted" />
                <p className="desc">{emptyMessage}</p>
                {!searching && <p className="muted">Finish a task with notes to start your archive.</p>}
              </div>
            ) : (
              <ul className="archive-items">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="archive-item"
                      data-active={selected?.id === item.id}
                      onClick={() => selectItem(item)}
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
                <p className="muted">Select a completed task to edit its notes.</p>
              </div>
            ) : (
              <ArchiveNotePanel
                key={selected.id}
                taskId={selected.id}
                title={selected.title}
                completedAt={selected.completedAt}
                onPreview={onPreview}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
