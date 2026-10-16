"use client";
import { Bold, Italic, List, Loader2, MessageSquarePlus, Quote, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** Markdown source of the editor, one DOM block per line. */
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

type Panel =
  | null
  | { kind: "ai"; start: number; end: number; quote: string }
  | { kind: "comment-new"; start: number; end: number; quote: string }
  | { kind: "comment-view"; id: string; body: string; x: number; y: number };

export function NotesEditor({ value, onChange, readOnly, autoFocus }: { value: string; onChange: (v: string) => void; readOnly: boolean; autoFocus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
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
    check();
  };

  const check = () => {
    const el = ref.current;
    const s = el && selection(el);
    setSelected(!!s && s.start !== s.end);
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
    const e = kind === "bold" ? wrapSelection(v, s.start, s.end, "**") : kind === "italic" ? wrapSelection(v, s.start, s.end, "_") : prefixLines(v, s.start, s.end, kind === "list" ? "- " : "> ");
    el.focus();
    replace(e.start, e.end, e.text, e.selStart, e.selEnd);
  };

  const openAi = () => {
    const el = ref.current!;
    const s = selection(el);
    if (!s || s.start === s.end) return;
    const v = readText(el);
    setError(null);
    setDraft("");
    setPanel({ kind: "ai", start: s.start, end: s.end, quote: v.slice(s.start, s.end) });
  };

  const openCommentNew = () => {
    const el = ref.current!;
    const s = selection(el);
    if (!s || s.start === s.end) return;
    const v = readText(el);
    setError(null);
    setDraft("");
    setPanel({ kind: "comment-new", start: s.start, end: s.end, quote: v.slice(s.start, s.end) });
  };

  const runAi = async () => {
    if (!panel || panel.kind !== "ai") return;
    setBusy(true);
    setError(null);
    try {
      const full = readText(ref.current!);
      const ctx = stripCommentMarkers(full).slice(Math.max(0, panel.start - 280), panel.end + 280);
      const res = await notesApi.aiRewrite(panel.quote, draft.trim() || undefined, ctx);
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
      setError("Write a short comment first");
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

  // Hover / focus on highlighted comments → popover
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const show = (mark: HTMLElement) => {
      const id = mark.dataset.commentId;
      const body = mark.dataset.comment ?? "";
      if (!id) return;
      const wrap = wrapRef.current?.getBoundingClientRect();
      const r = mark.getBoundingClientRect();
      if (!wrap) return;
      setPanel({
        kind: "comment-view",
        id,
        body,
        x: Math.min(Math.max(8, r.left - wrap.left), wrap.width - 260),
        y: r.bottom - wrap.top + 8,
      });
      setDraft(body);
      setError(null);
    };

    const onOver = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const mark = t?.closest?.(".note-hl") as HTMLElement | null;
      if (!mark || !el.contains(mark)) return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => show(mark), 140);
    };
    const onOut = (e: Event) => {
      const t = e.target as HTMLElement | null;
      const mark = t?.closest?.(".note-hl");
      if (!mark) return;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => {
        setPanel((p) => (p?.kind === "comment-view" ? null : p));
      }, 220);
    };
    const onFocusIn = (e: FocusEvent) => {
      const mark = (e.target as HTMLElement | null)?.closest?.(".note-hl") as HTMLElement | null;
      if (mark && el.contains(mark)) show(mark);
    };

    el.addEventListener("mouseover", onOver);
    el.addEventListener("mouseout", onOut);
    el.addEventListener("focusin", onFocusIn);
    return () => {
      el.removeEventListener("mouseover", onOver);
      el.removeEventListener("mouseout", onOut);
      el.removeEventListener("focusin", onFocusIn);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, [value, readOnly]);

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
      <div className="format-bar" data-visible={selected && !readOnly && !panel} role="toolbar" aria-label="Formatting">
        {([["bold", Bold, "Bold"], ["italic", Italic, "Italic"], ["list", List, "Bulleted list"], ["quote", Quote, "Quote"]] as const).map(([k, Icon, label]) => (
          <button key={k} className="icon-btn tiny" aria-label={label} tabIndex={selected ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={() => format(k)}>
            <Icon size={14} strokeWidth={1.75} />
          </button>
        ))}
        <span className="format-bar-sep" aria-hidden />
        <button className="icon-btn tiny" aria-label="Rewrite with AI" title="Rewrite with AI" tabIndex={selected ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={openAi}>
          <Sparkles size={14} strokeWidth={1.75} />
        </button>
        <button className="icon-btn tiny" aria-label="Add comment" title="Add comment" tabIndex={selected ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={openCommentNew}>
          <MessageSquarePlus size={14} strokeWidth={1.75} />
        </button>
      </div>

      {panel?.kind === "ai" && (
        <div className="note-float note-float--ai" role="dialog" aria-label="Rewrite with AI">
          <div className="note-float-head">
            <Sparkles size={14} strokeWidth={1.75} />
            <strong>Rewrite selection</strong>
            <button type="button" className="icon-btn tiny" aria-label="Close" onClick={() => setPanel(null)}>
              <X size={14} />
            </button>
          </div>
          <p className="note-float-quote">{panel.quote.slice(0, 160)}{panel.quote.length > 160 ? "…" : ""}</p>
          <input
            className="note-float-input"
            placeholder="Optional: make shorter, fix tone…"
            value={draft}
            disabled={busy}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void runAi();
              }
              if (e.key === "Escape") setPanel(null);
            }}
          />
          {error && <p className="note-float-error">{error}</p>}
          <div className="note-float-actions">
            <button type="button" className="link-btn" disabled={busy} onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" className="btn-primary asst-confirm-btn" disabled={busy} onClick={() => void runAi()}>
              {busy ? <Loader2 size={15} className="asst-spin" /> : <Sparkles size={15} strokeWidth={1.75} />}
              Rewrite
            </button>
          </div>
        </div>
      )}

      {panel?.kind === "comment-new" && (
        <div className="note-float note-float--ai" role="dialog" aria-label="Add comment">
          <div className="note-float-head">
            <MessageSquarePlus size={14} strokeWidth={1.75} />
            <strong>Comment</strong>
            <button type="button" className="icon-btn tiny" aria-label="Close" onClick={() => setPanel(null)}>
              <X size={14} />
            </button>
          </div>
          <p className="note-float-quote">{panel.quote.slice(0, 160)}{panel.quote.length > 160 ? "…" : ""}</p>
          <textarea
            className="note-float-input note-float-textarea"
            placeholder="Add a note on this highlight…"
            rows={3}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPanel(null);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                saveComment();
              }
            }}
          />
          {error && <p className="note-float-error">{error}</p>}
          <div className="note-float-actions">
            <button type="button" className="link-btn" onClick={() => setPanel(null)}>Cancel</button>
            <button type="button" className="btn-primary asst-confirm-btn" onClick={saveComment}>Save comment</button>
          </div>
        </div>
      )}

      {panel?.kind === "comment-view" && (
        <div
          className="note-float note-float--hover"
          role="dialog"
          aria-label="Comment"
          style={{ left: panel.x, top: panel.y }}
          onMouseEnter={() => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={() => {
            hoverTimer.current = setTimeout(() => setPanel(null), 180);
          }}
        >
          {readOnly ? (
            <p className="note-float-body">{panel.body}</p>
          ) : (
            <>
              <textarea
                className="note-float-input note-float-textarea"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="note-float-actions">
                <button type="button" className="icon-btn tiny" aria-label="Delete comment" onClick={deleteComment}>
                  <Trash2 size={14} />
                </button>
                <span className="grow" />
                <button type="button" className="link-btn" onClick={() => setPanel(null)}>Close</button>
                <button type="button" className="btn-primary asst-confirm-btn" onClick={saveCommentEdit}>Save</button>
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
        data-placeholder="Start writing…"
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
        onKeyUp={check}
        onMouseUp={check}
        onBlur={() => setTimeout(check, 120)}
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
