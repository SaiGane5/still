"use client";
import { Bold, Italic, List, Quote } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderDoc } from "@/lib/liveMarkdown";
import { continueList, prefixLines, wrapSelection } from "@/lib/markdown";

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

export function NotesEditor({ value, onChange, readOnly, autoFocus }: { value: string; onChange: (v: string) => void; readOnly: boolean; autoFocus: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const undo = useRef<{ v: string; c: number }[]>([]);
  const redo = useRef<{ v: string; c: number }[]>([]);
  const lastPush = useRef(0);

  /** Render `text` into the DOM and place the caret, without losing it. */
  const paint = useCallback((text: string, caret?: number | null, selEnd?: number) => {
    const el = ref.current;
    if (!el) return;
    const html = renderDoc(text);
    if (el.innerHTML !== html) el.innerHTML = html;
    el.dataset.empty = text === "" ? "true" : "false";
    if (caret != null && document.activeElement === el) {
      caretTo(el, caret);
      if (selEnd != null && selEnd !== caret) {
        // extend selection to selEnd
        const s = window.getSelection()!;
        const anchor = s.getRangeAt(0).cloneRange();
        caretTo(el, selEnd);
        const end = s.getRangeAt(0);
        anchor.setEnd(end.startContainer, end.startOffset);
        setSel(anchor);
      }
    }
  }, []);

  // sync from props (task switch / load / external change)
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

  const step = (from: typeof undo, to: typeof undo) => {
    const el = ref.current!;
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push({ v: readText(el), c: selection(el)?.start ?? 0 });
    paint(prev.v, prev.c);
    onChange(prev.v);
  };

  return (
    <div className="editor" onMouseDown={(e) => { if (e.target === e.currentTarget) { ref.current?.focus(); caretTo(ref.current!, readText(ref.current!).length); } }}>
      <div className="format-bar" data-visible={selected && !readOnly} role="toolbar" aria-label="Formatting">
        {([["bold", Bold, "Bold"], ["italic", Italic, "Italic"], ["list", List, "Bulleted list"], ["quote", Quote, "Quote"]] as const).map(([k, Icon, label]) => (
          <button key={k} className="icon-btn tiny" aria-label={label} tabIndex={selected ? 0 : -1} onMouseDown={(e) => e.preventDefault()} onClick={() => format(k)}>
            <Icon size={14} strokeWidth={1.75} />
          </button>
        ))}
      </div>
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
