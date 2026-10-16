"use client";
import { Bold, Italic, List, Loader2, MessageSquare, MessageSquarePlus, Quote, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ApiError, notesApi } from "@/client/api";
import { renderDoc } from "@/lib/liveMarkdown";
import { continueList, prefixLines, wrapSelection } from "@/lib/markdown";
import {
  removeComment,
  stripCommentMarkers,
  updateCommentBody,
  wrapWithComment,
} from "@/lib/noteAnnotations";

const lines = (root: HTMLElement) => Array.from(root.children) as HTMLElement[];

function readText(root: HTMLElement): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) out[out.length - 1] += c.textContent ?? "";
    });
  };
  for (const el of lines(root)) {
    out.push("");
    if (el.children.length === 0 && el.childNodes.length && el.textContent !== "") walk(el);
    else out[out.length - 1] = el.textContent ?? "";
  }
  if (!out.length) return root.textContent ?? "";
  return out.join("\n");
}

function offsetOf(root: HTMLElement, node: Node, off: number): number {
  const ls = lines(root);
  let total = 0;
  for (const el of ls) {
    if (el === node || el.contains(node)) {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.setEnd(node, off);
      return total + r.toString().length;
    }
    total += (el.textContent ?? "").length + 1;
  }
  return total;
}

function caretTo(root: HTMLElement, pos: number) {
  const ls = lines(root);
  let rem = pos;
  for (let i = 0; i < ls.length; i++) {
    const len = (ls[i].textContent ?? "").length;
    if (rem <= len || i === ls.length - 1) {
      const w = document.createTreeWalker(ls[i], NodeFilter.SHOW_TEXT);
      let n: Node | null;
      let left = Math.min(rem, len);
      const r = document.createRange();
      while ((n = w.nextNode())) {
        const l = n.textContent!.length;
        if (left <= l) {
          r.setStart(n, left);
          r.collapse(true);
          setSel(r);
          return;
        }
        left -= l;
      }
      r.setStart(ls[i], 0);
      r.collapse(true);
      setSel(r);
      return;
    }
    rem -= len + 1;
  }
}

const setSel = (r: Range) => {
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
};

function selection(root: HTMLElement): { start: number; end: number } | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
  const a = offsetOf(root, s.anchorNode!, s.anchorOffset);
  const b = offsetOf(root, s.focusNode!, s.focusOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function selectionRect(root: HTMLElement): DOMRect | null {
  const s = window.getSelection();
  if (!s || !s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return null;
  const rects = r.getClientRects();
  if (rects.length) {
    const first = rects[0];
    const last = rects[rects.length - 1];
    return new DOMRect(
      Math.min(first.left, last.left),
      Math.min(first.top, last.top),
      Math.max(first.right, last.right) - Math.min(first.left, last.left),
      Math.max(first.bottom, last.bottom) - Math.min(first.top, last.top),
    );
  }
  return r.getBoundingClientRect();
}

const AI_CHIPS = ["Clearer", "Shorter", "Fix grammar", "More formal", "More casual"] as const;

type Bubble = { x: number; y: number; place: "above" | "below" };

type Panel =
  | null
  | { kind: "ai"; start: number; end: number; quote: string; bubble: Bubble }
  | { kind: "comment-new"; start: number; end: number; quote: string; bubble: Bubble }
  | { kind: "comment-view"; id: string; body: string; bubble: Bubble; pinned: boolean };

function clampBubble(wrap: DOMRect, prefer: { left: number; top: number; height: number }, width = 300): Bubble {
  const pad = 10;
  const spaceAbove = prefer.top - wrap.top;
  const place: "above" | "below" = spaceAbove > 120 ? "above" : "below";
  const x = Math.min(Math.max(pad, prefer.left - wrap.left - width / 2), wrap.width - width - pad);
  const y =
    place === "above"
      ? Math.max(pad, prefer.top - wrap.top - 12)
      : prefer.top - wrap.top + prefer.height + 10;
  return { x, y, place };
}

export function NotesEditor({ value, onChange, readOnly, autoFocus }: { value: string; onChange: (v: string) => void; readOnly: boolean; autoFocus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<Bubble | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = useRef<{ v: string; c: number }[]>([]);
  const redo = useRef<{ v: string; c: number }[]>([]);
  const lastPush = useRef(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paint = useCallback((text: string, caret?: number | null, selEnd?: number) => {
    const el = ref.current;
    if (!el) return;
    const html = renderDoc(text);
    if (el.innerHTML !== html) el.innerHTML = html;
    el.dataset.empty = text === "" ? "true" : "false";
    if (caret != null && document.activeElement === el) {
      caretTo(el, caret);
      if (selEnd != null && selEnd !== caret) {
        const s = window.getSelection()!;
        const anchor = s.getRangeAt(0).cloneRange();
        caretTo(el, selEnd);
        const end = s.getRangeAt(0);
        anchor.setEnd(end.startContainer, end.startOffset);
        setSel(anchor);
      }
    }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (readText(el) !== value || !el.innerHTML) {
      const c = selection(el);
      paint(value, c ? Math.min(c.start, value.length) : null);
    }
  }, [value, paint]);

  useEffect(() => {
    if (!autoFocus || readOnly) return;
    const id = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      caretTo(el, readText(el).length);
    }, 380);
    return () => clearTimeout(id);
  }, [autoFocus, readOnly]);

  const placeToolbar = useCallback(() => {
    const el = ref.current;
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!el || !wrap || readOnly || panel) {
      setToolbar(null);
      return;
    }
    const s = selection(el);
    if (!s || s.start === s.end) {
      setToolbar(null);
      return;
    }
    const rect = selectionRect(el);
    if (!rect || rect.width + rect.height === 0) {
      setToolbar(null);
      return;
    }
    const mid = rect.left + rect.width / 2;
    const spaceAbove = rect.top - wrap.top;
    const place: "above" | "below" = spaceAbove > 56 ? "above" : "below";
    const barW = 280;
    setToolbar({
      x: Math.min(Math.max(8, mid - wrap.left - barW / 2), wrap.width - barW - 8),
      y: place === "above" ? rect.top - wrap.top - 48 : rect.bottom - wrap.top + 10,
      place,
    });
  }, [readOnly, panel]);

  const commit = (text: string, caret: number, selEnd?: number, record = true) => {
    const el = ref.current!;
    if (record) {
      const now = Date.now();
      if (now - lastPush.current > 600 || !undo.current.length) undo.current.push({ v: readText(el), c: selection(el)?.start ?? 0 });
      lastPush.current = now;
      redo.current = [];
      if (undo.current.length > 200) undo.current.shift();
    }
    paint(text, caret, selEnd);
    onChange(text);
    placeToolbar();
  };

  const replace = (start: number, end: number, text: string, selStart: number, selEnd: number) => {
    const v = readText(ref.current!);
    commit(v.slice(0, start) + text + v.slice(end), selStart, selEnd);
  };

  const format = (kind: "bold" | "italic" | "list" | "quote") => {
    const el = ref.current!;
    const s = selection(el);
    if (!s) return;
    const v = readText(el);
    const e =
      kind === "bold"
        ? wrapSelection(v, s.start, s.end, "**")
        : kind === "italic"
          ? wrapSelection(v, s.start, s.end, "_")
          : prefixLines(v, s.start, s.end, kind === "list" ? "- " : "> ");
    el.focus();
    replace(e.start, e.end, e.text, e.selStart, e.selEnd);
  };

  const bubbleFromSelection = (): Bubble | null => {
    const el = ref.current;
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!el || !wrap) return null;
    const rect = selectionRect(el);
    if (!rect) return null;
    return clampBubble(wrap, { left: rect.left + rect.width / 2, top: rect.top, height: rect.height });
  };

  const openAi = () => {
    const el = ref.current!;
    const s = selection(el);
    if (!s || s.start === s.end) return;
    const bubble = bubbleFromSelection() ?? { x: 16, y: 24, place: "below" as const };
    const v = readText(el);
    setError(null);
    setDraft("");
    setToolbar(null);
    setPanel({ kind: "ai", start: s.start, end: s.end, quote: v.slice(s.start, s.end), bubble });
  };

  const openCommentNew = () => {
    const el = ref.current!;
    const s = selection(el);
    if (!s || s.start === s.end) return;
    const bubble = bubbleFromSelection() ?? { x: 16, y: 24, place: "below" as const };
    const v = readText(el);
    setError(null);
    setDraft("");
    setToolbar(null);
    setPanel({ kind: "comment-new", start: s.start, end: s.end, quote: v.slice(s.start, s.end), bubble });
  };

  const runAi = async (instruction?: string) => {
    if (!panel || panel.kind !== "ai") return;
    setBusy(true);
    setError(null);
    try {
      const full = readText(ref.current!);
      const ctx = stripCommentMarkers(full).slice(Math.max(0, panel.start - 280), panel.end + 280);
      const res = await notesApi.aiRewrite(panel.quote, (instruction ?? draft).trim() || undefined, ctx);
      const next = res.text;
      replace(panel.start, panel.end, next, panel.start, panel.start + next.length);
      setPanel(null);
      setDraft("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rewrite failed");
    } finally {
      setBusy(false);
    }
  };

  const saveComment = () => {
    if (!panel || panel.kind !== "comment-new") return;
    const body = draft.trim();
    if (!body) {
      setError("Add a short comment");
      return;
    }
    const v = readText(ref.current!);
    const wrapped = wrapWithComment(v, panel.start, panel.end, body);
    commit(wrapped.text, wrapped.selStart, wrapped.selEnd);
    setPanel(null);
    setDraft("");
  };

  const saveCommentEdit = () => {
    if (!panel || panel.kind !== "comment-view") return;
    const body = draft.trim();
    if (!body) return;
    const v = readText(ref.current!);
    commit(updateCommentBody(v, panel.id, body), selection(ref.current!)?.start ?? 0);
    setPanel(null);
    setDraft("");
  };

  const deleteComment = () => {
    if (!panel || panel.kind !== "comment-view") return;
    const v = readText(ref.current!);
    const next = removeComment(v, panel.id);
    commit(next, Math.min(selection(ref.current!)?.start ?? 0, next.length));
    setPanel(null);
    setDraft("");
  };

  const step = (from: typeof undo, to: typeof undo) => {
    const el = ref.current!;
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push({ v: readText(el), c: selection(el)?.start ?? 0 });
    paint(prev.v, prev.c);
    onChange(prev.v);
  };

  const showCommentAt = useCallback((mark: HTMLElement, pinned = false) => {
    const id = mark.dataset.commentId;
    const body = mark.dataset.comment ?? "";
    if (!id) return;
    const wrap = wrapRef.current?.getBoundingClientRect();
    const r = mark.getBoundingClientRect();
    if (!wrap) return;
    const bubble = clampBubble(wrap, { left: r.left + r.width / 2, top: r.top, height: r.height }, 280);
    setToolbar(null);
    setPanel({ kind: "comment-view", id, body, bubble, pinned });
    setDraft(body);
    setError(null);
  }, []);

  // Selection → floating toolbar
  useEffect(() => {
    const onSel = () => {
      if (panel && panel.kind !== "comment-view") return;
      // Delay so mobile selection handles settle
      requestAnimationFrame(() => placeToolbar());
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [placeToolbar, panel]);

  // Hover / tap highlights
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onOver = (e: Event) => {
      if (panel && (panel.kind === "ai" || panel.kind === "comment-new" || panel.pinned)) return;
      const mark = (e.target as HTMLElement | null)?.closest?.(".note-hl") as HTMLElement | null;
      if (!mark || !el.contains(mark)) return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => showCommentAt(mark, false), 120);
    };
    const onOut = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (related?.closest?.(".note-float") || related?.closest?.(".note-hl")) return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        setPanel((p) => (p?.kind === "comment-view" && !p.pinned ? null : p));
      }, 200);
    };
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement | null)?.closest?.(".note-hl") as HTMLElement | null;
      if (mark && el.contains(mark)) {
        e.preventDefault();
        showCommentAt(mark, true);
      }
    };

    el.addEventListener("mouseover", onOver);
    el.addEventListener("mouseout", onOut);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("mouseover", onOver);
      el.removeEventListener("mouseout", onOut);
      el.removeEventListener("click", onClick);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, [value, readOnly, panel, showCommentAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel(null);
        setToolbar(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const panelStyle = (b: Bubble, width = 300): CSSProperties => ({
    left: b.x,
    top: b.place === "above" ? undefined : b.y,
    bottom: b.place === "above" ? `calc(100% - ${b.y}px)` : undefined,
    width: Math.min(width, (wrapRef.current?.clientWidth ?? 320) - 16),
  });

  return (
    <div
      className="editor"
      ref={wrapRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          ref.current?.focus();
          caretTo(ref.current!, readText(ref.current!).length);
        }
      }}
    >
      {toolbar && !panel && (
        <div
          className="note-toolbar"
          role="toolbar"
          aria-label="Selection actions"
          style={{ left: toolbar.x, top: toolbar.y }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="note-toolbar-group">
            {([["bold", Bold, "Bold"], ["italic", Italic, "Italic"], ["list", List, "List"], ["quote", Quote, "Quote"]] as const).map(([k, Icon, label]) => (
              <button key={k} type="button" className="note-toolbar-btn" aria-label={label} onClick={() => format(k)}>
                <Icon size={15} strokeWidth={1.75} />
              </button>
            ))}
          </div>
          <span className="note-toolbar-sep" aria-hidden />
          <button type="button" className="note-toolbar-action" onClick={openAi}>
            <Sparkles size={14} strokeWidth={1.75} />
            AI
          </button>
          <button type="button" className="note-toolbar-action" onClick={openCommentNew}>
            <MessageSquarePlus size={14} strokeWidth={1.75} />
            Comment
          </button>
        </div>
      )}

      {(panel?.kind === "ai" || panel?.kind === "comment-new") && (
        <button type="button" className="note-sheet-scrim" aria-label="Dismiss" onClick={() => !busy && setPanel(null)} />
      )}

      {panel?.kind === "ai" && (
        <div className="note-float note-float--sheet" role="dialog" aria-label="Rewrite with AI" style={panelStyle(panel.bubble, 320)}>
          <div className="note-float-head">
            <span className="note-float-badge note-float-badge--ai"><Sparkles size={13} strokeWidth={1.75} /> AI rewrite</span>
            <button type="button" className="icon-btn tiny" aria-label="Close" disabled={busy} onClick={() => setPanel(null)}>
              <X size={14} />
            </button>
          </div>
          <p className="note-float-quote">“{panel.quote.slice(0, 140)}{panel.quote.length > 140 ? "…" : ""}”</p>
          <div className="note-chip-row">
            {AI_CHIPS.map((chip) => (
              <button key={chip} type="button" className="note-chip" disabled={busy} onClick={() => void runAi(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <input
            className="note-float-input"
            placeholder="Or describe the change…"
            value={draft}
            disabled={busy}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runAi();
              }
            }}
          />
          {error && <p className="note-float-error" role="alert">{error}</p>}
          <div className="note-float-actions">
            <button type="button" className="link-btn" disabled={busy} onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" className="btn-primary note-float-primary" disabled={busy} onClick={() => void runAi()}>
              {busy ? <Loader2 size={15} className="asst-spin" /> : <Sparkles size={15} strokeWidth={1.75} />}
              {busy ? "Rewriting…" : "Rewrite"}
            </button>
          </div>
        </div>
      )}

      {panel?.kind === "comment-new" && (
        <div className="note-float note-float--sheet" role="dialog" aria-label="Add comment" style={panelStyle(panel.bubble, 300)}>
          <div className="note-float-head">
            <span className="note-float-badge"><MessageSquare size={13} strokeWidth={1.75} /> Comment</span>
            <button type="button" className="icon-btn tiny" aria-label="Close" onClick={() => setPanel(null)}>
              <X size={14} />
            </button>
          </div>
          <p className="note-float-quote">“{panel.quote.slice(0, 120)}{panel.quote.length > 120 ? "…" : ""}”</p>
          <textarea
            className="note-float-input note-float-textarea"
            placeholder="What should you remember about this?"
            rows={3}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveComment();
              }
            }}
          />
          {error && <p className="note-float-error" role="alert">{error}</p>}
          <div className="note-float-actions">
            <button type="button" className="link-btn" onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" className="btn-primary note-float-primary" onClick={saveComment}>Save comment</button>
          </div>
        </div>
      )}

      {panel?.kind === "comment-view" && (
        <div
          className={`note-float note-float--bubble note-float--${panel.bubble.place}`}
          role="dialog"
          aria-label="Comment"
          style={panelStyle(panel.bubble, 280)}
          onMouseEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={() => {
            if (panel.pinned) return;
            hoverTimer.current = setTimeout(() => setPanel(null), 160);
          }}
        >
          <div className="note-float-caret" aria-hidden />
          {readOnly ? (
            <p className="note-float-body">{panel.body}</p>
          ) : (
            <>
              <textarea
                className="note-float-input note-float-textarea"
                rows={3}
                value={draft}
                aria-label="Edit comment"
                onChange={(e) => setDraft(e.target.value)}
                onFocus={() => setPanel((p) => (p?.kind === "comment-view" ? { ...p, pinned: true } : p))}
              />
              <div className="note-float-actions">
                <button type="button" className="icon-btn tiny" aria-label="Delete comment" onClick={deleteComment}>
                  <Trash2 size={14} />
                </button>
                <span className="grow" />
                <button type="button" className="link-btn" onClick={() => setPanel(null)}>Close</button>
                <button type="button" className="btn-primary note-float-primary" onClick={saveCommentEdit}>Save</button>
              </div>
            </>
          )}
        </div>
      )}

      <div
        ref={ref}
        className="editor-area"
        role="textbox"
        aria-multiline="true"
        aria-label="Task notes"
        data-placeholder="Start writing… Select text for AI or comments"
        data-empty="true"
        contentEditable={readOnly ? false : "plaintext-only"}
        suppressContentEditableWarning
        spellCheck
        onInput={(e) => {
          const el = e.currentTarget;
          const text = readText(el);
          const c = selection(el)?.start ?? text.length;
          commit(text, c, undefined, true);
        }}
        onPaste={(e) => {
          e.preventDefault();
          const t = e.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
          const s = selection(e.currentTarget);
          if (s) replace(s.start, s.end, t, s.start + t.length, s.start + t.length);
        }}
        onKeyUp={() => placeToolbar()}
        onMouseUp={() => placeToolbar()}
        onTouchEnd={() => setTimeout(placeToolbar, 50)}
        onBlur={() => setTimeout(() => {
          if (!panel) setToolbar(null);
        }, 160)}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.key.toLowerCase() === "z") {
            e.preventDefault();
            e.shiftKey ? step(redo, undo) : step(undo, redo);
            return;
          }
          if (mod && e.key.toLowerCase() === "y") {
            e.preventDefault();
            step(redo, undo);
            return;
          }
          if (e.key !== "Enter" || e.shiftKey || mod || e.altKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          const s = selection(el);
          if (!s) return;
          const v = readText(el);
          const list = s.start === s.end ? continueList(v, s.start) : null;
          if (list) replace(list.start, list.end, list.text, list.selStart, list.selEnd);
          else replace(s.start, s.end, "\n", s.start + 1, s.start + 1);
        }}
      />
    </div>
  );
}
