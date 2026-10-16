"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Check, Loader2, MessageCircle, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, assistantApi } from "@/client/api";
import type { AssistantChat, AssistantChatSummary, AssistantMessage, ProposedTask } from "@/lib/assistant";
import type { AppState } from "@/lib/types";

type View = "history" | "chat";

const THINKING_LINES = ["Listening…", "Sorting the noise…", "Drafting a quiet list…", "Almost ready…"];

function ThinkingDots({ label }: { label: string }) {
  return (
    <div className="asst-msg asst-msg--assistant asst-thinking" aria-live="polite" aria-busy>
      <span className="asst-thinking-label">{label}</span>
      <span className="asst-dots" aria-hidden>
        <i /><i /><i />
      </span>
    </div>
  );
}

function ProposedCard({
  tasks,
  queued,
  busy,
  onConfirm,
  onDiscard,
}: {
  tasks: ProposedTask[];
  queued: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="asst-propose" data-queued={queued || undefined}>
      <p className="meta">{queued ? "Added to your queue" : "Proposed for your queue"}</p>
      <ul>
        {tasks.map((t, i) => (
          <li key={`${t.title}-${i}`}>
            <span className="asst-propose-title">{t.title}</span>
            <span className="asst-propose-mins">{t.plannedMinutes} min</span>
            {t.description ? <span className="asst-propose-desc">{t.description}</span> : null}
          </li>
        ))}
      </ul>
      {!queued && (
        <div className="asst-propose-actions">
          <button type="button" className="link-btn" disabled={busy} onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="btn-primary asst-confirm-btn" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 size={16} className="asst-spin" /> : <Check size={16} strokeWidth={1.75} />}
            Add to queue
          </button>
        </div>
      )}
    </div>
  );
}

export function Assistant({ onQueued }: { onQueued: (state: AppState) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [chats, setChats] = useState<AssistantChatSummary[]>([]);
  const [chat, setChat] = useState<AssistantChat | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinkIx, setThinkIx] = useState(0);
  const [boot, setBoot] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const refreshList = useCallback(async () => {
    const { chats: list } = await assistantApi.list();
    setChats(list);
    return list;
  }, []);

  const openChat = useCallback(async (id: string) => {
    setError(null);
    const full = await assistantApi.get(id);
    setChat(full);
    setView("chat");
  }, []);

  const ensureChat = useCallback(async () => {
    const list = await refreshList();
    if (list[0]) {
      await openChat(list[0].id);
      return;
    }
    const created = await assistantApi.create();
    setChats([created]);
    setChat(created);
    setView("chat");
  }, [openChat, refreshList]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open || boot) return;
    setBoot(true);
    void ensureChat().catch((e) => setError(e instanceof ApiError ? e.message : "Couldn’t open assistant"));
  }, [open, boot, ensureChat]);

  useEffect(() => {
    if (!sending) return;
    const id = setInterval(() => setThinkIx((i) => (i + 1) % THINKING_LINES.length), 1400);
    return () => clearInterval(id);
  }, [sending]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat?.messages, sending, open]);

  useEffect(() => {
    if (open && view === "chat") {
      const t = setTimeout(() => inputRef.current?.focus(), 280);
      return () => clearTimeout(t);
    }
  }, [open, view, chat?.id]);

  const startNew = async () => {
    setError(null);
    try {
      const created = await assistantApi.create();
      setChats((c) => [created, ...c.filter((x) => x.id !== created.id)]);
      setChat(created);
      setView("chat");
      setInput("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t start a chat");
    }
  };

  const removeChat = async (id: string) => {
    try {
      await assistantApi.remove(id);
      const next = chats.filter((c) => c.id !== id);
      setChats(next);
      if (chat?.id === id) {
        if (next[0]) await openChat(next[0].id);
        else await startNew();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t delete chat");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !chat || sending) return;
    setSending(true);
    setError(null);
    setInput("");
    const optimistic: AssistantMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      proposedTasks: null,
      queued: false,
      createdAt: new Date().toISOString(),
    };
    setChat((c) => (c ? { ...c, messages: [...c.messages, optimistic] } : c));
    try {
      const reply = await assistantApi.send(chat.id, text);
      const fresh = await assistantApi.get(chat.id);
      setChat(fresh);
      setChats((list) => {
        const rest = list.filter((c) => c.id !== fresh.id);
        return [{ id: fresh.id, title: fresh.title, createdAt: fresh.createdAt, updatedAt: fresh.updatedAt }, ...rest];
      });
      void reply;
    } catch (e) {
      setChat((c) => (c ? { ...c, messages: c.messages.filter((m) => m.id !== optimistic.id) } : c));
      setInput(text);
      setError(e instanceof ApiError ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const confirm = async (messageId: string) => {
    if (!chat) return;
    setConfirming(messageId);
    setError(null);
    try {
      const res = await assistantApi.confirm(chat.id, messageId);
      if (res.state) onQueued(res.state);
      setChat((c) =>
        c
          ? {
              ...c,
              messages: c.messages.map((m) => (m.id === messageId ? { ...m, queued: true } : m)),
            }
          : c,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t add tasks");
    } finally {
      setConfirming(null);
    }
  };

  const discard = (messageId: string) => {
    setChat((c) =>
      c
        ? {
            ...c,
            messages: c.messages.map((m) =>
              m.id === messageId ? { ...m, proposedTasks: null } : m,
            ),
          }
        : c,
    );
  };

  const close = () => setOpen(false);

  return (
    <>
      {!open && (
        <motion.button
          type="button"
          className="asst-fab"
          aria-label="Open assistant"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          whileTap={{ scale: 0.94 }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
        >
          <Sparkles size={22} strokeWidth={1.5} />
        </motion.button>
      )}

      <AnimatePresence>
        {open && (
          <>
          <motion.button
            type="button"
            className="asst-scrim"
            aria-label="Dismiss assistant"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            className="asst-panel"
            role="dialog"
            aria-modal="true"
            aria-label="still. assistant"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="asst-sheet-handle" aria-hidden />
            <header className="asst-head">
              {view === "history" ? (
                <button type="button" className="icon-btn small" aria-label="Back to chat" onClick={() => setView("chat")}>
                  <ArrowLeft size={18} strokeWidth={1.5} />
                </button>
              ) : (
                <button type="button" className="icon-btn small" aria-label="Chat history" onClick={() => { void refreshList(); setView("history"); }}>
                  <MessageCircle size={18} strokeWidth={1.5} />
                </button>
              )}
              <div className="asst-head-title">
                <span className="meta">Assistant</span>
                <strong>{view === "history" ? "Your chats" : chat?.title || "New chat"}</strong>
              </div>
              <button type="button" className="icon-btn small" aria-label="New chat" onClick={() => void startNew()}>
                <Plus size={18} strokeWidth={1.5} />
              </button>
              <button type="button" className="icon-btn small asst-close" aria-label="Close assistant" onClick={close}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </header>

            {error && (
              <p className="asst-error" role="alert">{error}</p>
            )}

            {view === "history" ? (
              <div className="asst-history">
                {chats.length === 0 ? (
                  <p className="muted asst-empty">No chats yet. Start one with +.</p>
                ) : (
                  <ul>
                    {chats.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="asst-history-item" data-active={chat?.id === c.id} onClick={() => void openChat(c.id)}>
                          <span>{c.title}</span>
                          <time>{new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
                        </button>
                        <button type="button" className="icon-btn tiny" aria-label="Delete chat" onClick={() => void removeChat(c.id)}>
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <>
                <div className="asst-thread" ref={scroller}>
                  {!chat?.messages.length && !sending && (
                    <div className="asst-empty">
                      <Sparkles size={20} strokeWidth={1.25} className="muted" />
                      <p className="desc">Tell me what you need to get done. I’ll draft a focus queue — you confirm before anything is added.</p>
                    </div>
                  )}
                  {chat?.messages.map((m) => (
                    <div key={m.id} className={`asst-msg asst-msg--${m.role}`}>
                      <p>{m.content}</p>
                      {m.role === "assistant" && m.proposedTasks && m.proposedTasks.length > 0 && (
                        <ProposedCard
                          tasks={m.proposedTasks}
                          queued={m.queued}
                          busy={confirming === m.id}
                          onConfirm={() => void confirm(m.id)}
                          onDiscard={() => discard(m.id)}
                        />
                      )}
                    </div>
                  ))}
                  <AnimatePresence>
                    {sending && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                        <ThinkingDots label={THINKING_LINES[thinkIx]} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <form
                  className="asst-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    placeholder="Describe your tasks…"
                    disabled={sending || !chat}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button type="submit" className="asst-send" disabled={sending || !input.trim() || !chat} aria-label="Send">
                    {sending ? <Loader2 size={18} className="asst-spin" /> : <Send size={18} strokeWidth={1.5} />}
                  </button>
                </form>
              </>
            )}
          </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
