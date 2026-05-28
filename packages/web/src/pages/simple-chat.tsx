import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import ReactMarkdown from 'react-markdown';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useChatStore } from '../lib/chat-store';
import { api } from '../lib/api';
import type { ChatThread, Message } from '../lib/types';
import {
  Page,
  Button,
  Eyebrow,
  EmptyState,
} from '../components/ds';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

const FALLBACK_STARTERS = [
  'What should I focus on first?',
  'Am I on track for retirement?',
  'How am I spending each month?',
];

type View = 'chat' | 'history';

export function SimpleChat() {
  // URL is the source of truth for view + selected thread so the browser
  // back button restores the prior chat state instead of leaving the page.
  // /chat            → current chat (in-memory thread, may be empty)
  // /chat?view=history → history list
  // /chat?thread=<id>  → load that thread in the chat view
  // /chat?prompt=<msg> → auto-send seed prompt from /insights
  // NOTE: read query via useSearch — useLocation strips it (was a fixed bug).
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { sendMessage } = useChatStore();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const seedPrompt = params.get('prompt');
  const urlThreadId = params.get('thread');
  const view: View = params.get('view') === 'history' ? 'history' : 'chat';

  const [draft, setDraft] = useState('');
  const [starters, setStarters] = useState(FALLBACK_STARTERS);
  const [messages, setMessages] = useState<Bubble[]>([]);
  // Active thread ID — initialized from URL, then updated by send() when
  // the API assigns a new thread mid-conversation.
  const [threadId, setThreadId] = useState<string | null>(urlThreadId);
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSentRef = useRef(false);
  const loadedThreadRef = useRef<string | null>(null);

  // Build tailored starter prompts from the user's financial data
  useEffect(() => {
    api.getBalances().then(({ balances }) => {
      let cash = 0, investments = 0, debts = 0;
      for (const b of balances) {
        const v = parseFloat(b.balance ?? '0');
        if (Number.isNaN(v)) continue;
        if (b.type === 'depository') cash += v;
        else if (b.type === 'investment') investments += v;
        else if (b.type === 'credit' || b.type === 'loan') debts += v;
      }
      const fmt = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`;
      const prompts: string[] = [];
      if (debts > 0 && investments > 0)
        prompts.push(`Should I pay off my ${fmt(debts)} in debt or keep investing?`);
      else if (debts > 0)
        prompts.push(`What's the fastest way to pay off ${fmt(debts)} in debt?`);
      if (investments > 0)
        prompts.push(`If I retired today on ${fmt(investments)}, what withdrawal rate is safe?`);
      if (cash > 0 && investments > 0) {
        const nw = cash + investments - debts;
        if (nw > 0 && cash / nw > 0.3)
          prompts.push(`I have ${Math.round(cash / nw * 100)}% in cash — should I invest more?`);
      }
      if (prompts.length < 3) prompts.push(...FALLBACK_STARTERS);
      setStarters(prompts.slice(0, 4));
    }).catch(() => {});
  }, []);

  // Auto-send a seed prompt
  useEffect(() => {
    if (seedPrompt && !autoSentRef.current) {
      autoSentRef.current = true;
      void send(seedPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  // Load a thread when the URL says so
  useEffect(() => {
    if (urlThreadId && loadedThreadRef.current !== urlThreadId) {
      loadedThreadRef.current = urlThreadId;
      void loadThread(urlThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlThreadId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  // Load thread list when switching to history view.
  useEffect(() => {
    if (view === 'history') {
      setLoadingThreads(true);
      api
        .getThreads()
        .then((d) => setThreads(d.threads.filter((t) => t.tags?.includes('simple-mode'))))
        .catch(() => {})
        .finally(() => setLoadingThreads(false));
    }
  }, [view]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setDraft('');
    setMessages((m) => [
      ...m,
      { role: 'user', text: trimmed },
      { role: 'assistant', text: '', pending: true },
    ]);
    setBusy(true);
    try {
      const result = await sendMessage(trimmed, threadId, '', null, ['simple-mode']);
      const nextThreadId = result.threadId || threadId;
      setThreadId(nextThreadId);
      if (nextThreadId && nextThreadId !== urlThreadId) {
        loadedThreadRef.current = nextThreadId;
        setLocation(`/chat?thread=${encodeURIComponent(nextThreadId)}`, { replace: true });
      }
      setMessages((m) => {
        const next = [...m];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant' && next[i].pending) {
            next[i] = { role: 'assistant', text: result.response };
            break;
          }
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  async function loadThread(id: string) {
    setMessages([]);
    setBusy(true);
    try {
      const { messages: msgs } = await api.getThread(id);
      setThreadId(id);
      setMessages(
        (msgs as Message[]).map((m) => ({
          role: m.role,
          text: m.content,
        })),
      );
    } catch {
      setMessages([{ role: 'assistant', text: "Couldn't load that conversation." }]);
    } finally {
      setBusy(false);
    }
  }

  function setView(next: View) {
    if (next === 'history') {
      setLocation('/chat?view=history');
      return;
    }
    setLocation(threadId ? `/chat?thread=${encodeURIComponent(threadId)}` : '/chat');
  }

  function newChat() {
    setLocation('/chat');
    autoSentRef.current = true;
    loadedThreadRef.current = null;
    setMessages([]);
    setThreadId(null);
    setDraft('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openThread(t: ChatThread) {
    setLocation(`/chat?thread=${encodeURIComponent(t.id)}`);
  }

  async function deleteThread(id: string) {
    try {
      await api.deleteThread(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === threadId) {
        setLocation('/chat?view=history');
        loadedThreadRef.current = null;
        setThreadId(null);
        setMessages([]);
      }
    } catch {}
  }

  const hasConversation = messages.length > 0;

  return (
    <Page>
      {/* C1: PageHeader title dropped — the AppHeader already shows "Chat", and
          PageHeader was a third duplicate of it. We keep only the segmented tab
          control + "New chat" button as the page's top row. C2: this row is now
          position: sticky so it stays visible as the user scrolls history. */}
      <div className="ds-chat-subheader">
        <div className="ds-chat-segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'chat'}
            onClick={() => setView('chat')}
            className={`ds-chat-segmented__btn ${view === 'chat' ? 'is-active' : ''}`}
          >
            Current
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'history'}
            onClick={() => setView('history')}
            className={`ds-chat-segmented__btn ${view === 'history' ? 'is-active' : ''}`}
          >
            History
          </button>
        </div>
        <Button variant="ghost" onClick={newChat} icon={<Plus size={14} />}>New chat</Button>
      </div>

      {view === 'history' ? (
        <HistoryListView
          threads={threads}
          loading={loadingThreads}
          activeId={threadId}
          onOpen={openThread}
          onDelete={deleteThread}
          onNew={newChat}
        />
      ) : (
        <div ref={scrollRef} className="ds-chat-thread">
          {!hasConversation ? (
            <ChatStartHero
              starters={starters}
              busy={busy}
              onPick={(s) => void send(s)}
            />
          ) : (
            <div className="ds-chat-messages">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ds-chat-bubble ds-chat-bubble--user">
                    <p>{m.text}</p>
                  </div>
                ) : (
                  <div key={i} className="ds-chat-bubble-row">
                    <div className="ds-chat-avatar">🥬</div>
                    <div className="ds-chat-bubble ds-chat-bubble--assistant">
                      {m.pending ? (
                        <TypingIndicator />
                      ) : (
                        <AssistantMarkdown text={m.text} />
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Composer dock — fixed above bottom nav on mobile, sticky on desktop */}
      {view === 'chat' && (
        <div className="ds-chat-dock">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="ds-chat-composer"
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything about your finances…"
              disabled={busy}
              className="ds-chat-composer__input"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="ds-chat-composer__send"
              aria-label="Send"
            >
              ↑
            </button>
          </form>
        </div>
      )}

      <style>{`
        /* Sub-header — tabs + New chat, sticky to the top of the page's scroll
           container so it stays visible as history scrolls. */
        .ds-chat-subheader {
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 0;
          margin-bottom: 16px;
          background: var(--lf-paper);
          border-bottom: 1px solid var(--lf-rule);
        }
        .ds-chat-segmented {
          display: inline-flex;
          gap: 2px;
          padding: 3px;
          border: 1px solid var(--lf-rule);
          border-radius: 999px;
          background: var(--lf-paper);
        }
        .ds-chat-segmented__btn {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 999px;
          border: 0;
          background: transparent;
          color: var(--lf-muted);
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }
        .ds-chat-segmented__btn.is-active {
          background: var(--lf-ink);
          color: var(--lf-paper);
        }
        .ds-chat-thread {
          padding-bottom: 160px;
        }
        @media (min-width: 768px) {
          .ds-chat-thread { padding-bottom: 200px; }
        }
        .ds-chat-messages {
          display: flex; flex-direction: column; gap: 16px;
        }
        .ds-chat-bubble-row {
          display: flex; gap: 8px; align-items: flex-start;
        }
        .ds-chat-avatar {
          width: 28px; height: 28px;
          border-radius: 50%;
          background: rgba(230,184,92,0.18);
          display: grid; place-items: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .ds-chat-bubble {
          max-width: 85%;
          padding: 12px 16px;
          border-radius: 20px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.55;
        }
        .ds-chat-bubble--user {
          align-self: flex-end;
          background: var(--lf-ink);
          color: var(--lf-paper);
          margin-left: auto;
        }
        .ds-chat-bubble--user p {
          margin: 0;
          white-space: pre-wrap;
        }
        .ds-chat-bubble--assistant {
          background: var(--lf-paper);
          border: 1px solid var(--lf-rule);
          color: var(--lf-ink);
          flex: 1;
        }
        .ds-chat-dock {
          position: fixed;
          bottom: 56px;
          left: 0; right: 0;
          z-index: 10;
          background: var(--lf-paper);
          border-top: 1px solid var(--lf-rule);
          padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        }
        @media (min-width: 768px) {
          .ds-chat-dock {
            position: sticky;
            bottom: 0;
            left: auto; right: auto;
            max-width: 1200px;
            margin: 0 auto;
            padding: 16px 0;
            border-top: 1px solid var(--lf-rule);
          }
        }
        .ds-chat-composer {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--lf-paper);
          border: 1px solid var(--lf-rule);
          border-radius: 999px;
          padding: 6px 6px 6px 18px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .ds-chat-composer:focus-within {
          border-color: var(--lf-ink);
          box-shadow: 0 0 0 4px rgba(31,26,22,0.06);
        }
        .ds-chat-composer__input {
          flex: 1;
          background: transparent;
          border: 0;
          outline: none;
          font-family: 'Geist', system-ui, sans-serif;
          /* C5: 16px prevents iOS Safari from auto-zooming the viewport on focus. */
          font-size: 16px;
          color: var(--lf-ink);
          min-width: 0;
        }
        .ds-chat-composer__input::placeholder { color: var(--lf-muted); }
        .ds-chat-composer__send {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: var(--lf-sauce);
          color: var(--lf-paper);
          border: 0;
          cursor: pointer;
          font-size: 16px;
          font-weight: 600;
          display: grid; place-items: center;
          flex-shrink: 0;
          transition: background 0.15s, color 0.15s;
        }
        .ds-chat-composer__send:hover:not(:disabled) { background: var(--lf-sauce-deep); }
        /* C4: when empty, use a clear neutral gray instead of low-opacity sauce
           (which read as "soft pink, looks disabled when active"). The sauce
           state now only shows when there's content to send. */
        .ds-chat-composer__send:disabled {
          background: var(--lf-rule);
          color: var(--lf-muted);
          cursor: not-allowed;
        }

        /* Assistant markdown */
        .ds-chat-md p:not(:last-child) { margin: 0 0 8px; }
        .ds-chat-md ul, .ds-chat-md ol { padding-left: 20px; margin: 0 0 8px; }
        .ds-chat-md ul { list-style: disc; }
        .ds-chat-md ol { list-style: decimal; }
        .ds-chat-md li { margin: 2px 0; }
        .ds-chat-md h1, .ds-chat-md h2, .ds-chat-md h3 {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px; font-weight: 600;
          margin: 8px 0 4px; color: var(--lf-ink);
        }
        .ds-chat-md h1 { font-size: 15px; }
        .ds-chat-md strong { font-weight: 600; }
        .ds-chat-md em { font-style: italic; }
        .ds-chat-md a { color: var(--lf-sauce); text-decoration: underline; text-underline-offset: 2px; }
        .ds-chat-md code {
          background: var(--lf-cream);
          padding: 1px 5px; border-radius: 4px;
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
        }
        .ds-chat-md pre {
          background: var(--lf-cream);
          padding: 10px 12px; border-radius: 8px;
          overflow-x: auto;
          font-family: 'JetBrains Mono', monospace; font-size: 12px;
          margin: 8px 0;
        }
        .ds-chat-md blockquote {
          border-left: 2px solid var(--lf-rule);
          padding-left: 12px;
          color: var(--lf-ink-soft);
          margin: 8px 0;
        }
      `}</style>
    </Page>
  );
}

// ─── Editorial empty-state hero ──────────────────────────────────────────────

function ChatStartHero({
  starters, busy, onPick,
}: { starters: string[]; busy: boolean; onPick: (q: string) => void }) {
  return (
    <section className="ds-chat-hero" aria-labelledby="ds-chat-hero-title">
      <Eyebrow>Ask Lasagna</Eyebrow>
      <h2 id="ds-chat-hero-title" className="ds-chat-hero__title">
        What do you want to know?
      </h2>
      <p className="ds-chat-hero__lede">
        Lasagna can see your accounts, goals, and history. Ask anything —
        from "how am I doing?" to "should I refinance this loan?"
      </p>

      {starters.length > 0 && (
        <ul className="ds-chat-hero__prompts">
          {starters.map((q, i) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onPick(q)}
                disabled={busy}
                className="ds-chat-hero__prompt"
              >
                <span className="ds-chat-hero__prompt-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="ds-chat-hero__prompt-text">{q}</span>
                <span className="ds-chat-hero__prompt-arrow" aria-hidden="true">→</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .ds-chat-hero {
          padding: 24px 0 40px;
        }
        .ds-chat-hero__title {
          font-family: 'Instrument Serif', Georgia, serif;
          font-weight: 500;
          font-size: clamp(32px, 5vw, 48px);
          line-height: 1.05;
          letter-spacing: -0.015em;
          color: var(--lf-ink);
          margin: 12px 0 16px;
        }
        .ds-chat-hero__lede {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.6;
          color: var(--lf-ink-soft);
          max-width: 60ch;
          margin: 0 0 28px;
        }
        .ds-chat-hero__prompts {
          list-style: none;
          margin: 0;
          padding: 0;
          border-top: 1px solid var(--lf-ink);
        }
        .ds-chat-hero__prompts li {
          border-bottom: 1px solid var(--lf-rule);
        }
        .ds-chat-hero__prompt {
          display: flex;
          align-items: baseline;
          gap: 16px;
          width: 100%;
          background: none;
          border: 0;
          padding: 12px 0;
          text-align: left;
          cursor: pointer;
          transition: color 0.15s;
          color: inherit;
        }
        .ds-chat-hero__prompt:disabled { opacity: 0.5; cursor: not-allowed; }
        .ds-chat-hero__prompt:hover:not(:disabled) .ds-chat-hero__prompt-text { color: var(--lf-sauce); }
        .ds-chat-hero__prompt:hover:not(:disabled) .ds-chat-hero__prompt-arrow {
          transform: translateX(4px);
          color: var(--lf-sauce);
        }
        .ds-chat-hero__prompt-num {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--lf-muted);
          flex-shrink: 0;
          width: 22px;
        }
        /* C3: drop the "01" numeric prefix on mobile — visual noise that pushes
           the prompts to wrap and forces fewer above the fold. */
        @media (max-width: 640px) {
          .ds-chat-hero__prompt-num { display: none; }
          .ds-chat-hero__prompt { gap: 0; padding: 10px 0; }
        }
        .ds-chat-hero__prompt-text {
          flex: 1;
          font-family: 'Instrument Serif', Georgia, serif;
          /* C3: 17px instead of clamp(18, 22) so more starters fit above the fold on mobile. */
          font-size: 17px;
          font-weight: 400;
          color: var(--lf-ink);
          line-height: 1.35;
          letter-spacing: -0.005em;
          transition: color 0.15s;
        }
        @media (min-width: 768px) {
          .ds-chat-hero__prompt-text { font-size: 20px; }
        }
        .ds-chat-hero__prompt-arrow {
          font-size: 16px;
          color: var(--lf-muted);
          flex-shrink: 0;
          transition: transform 0.15s, color 0.15s;
        }
      `}</style>
    </section>
  );
}

// ─── History list — editorial feed ───────────────────────────────────────────

function HistoryListView({
  threads,
  loading,
  activeId,
  onOpen,
  onDelete,
  onNew,
}: {
  threads: ChatThread[];
  loading: boolean;
  activeId: string | null;
  onOpen: (t: ChatThread) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  if (loading) {
    return (
      <div style={{ height: 200, background: 'var(--lf-cream)', borderRadius: 8 }} className="animate-pulse" />
    );
  }
  if (threads.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare size={28} />}
        title="No conversations yet"
        body="Start a new chat — your history will show up here."
        cta={<Button variant="primary" onClick={onNew}>Start chatting</Button>}
      />
    );
  }
  return (
    <div className="ds-chat-history">
      <ul className="ds-chat-history__feed">
        {threads.map((t) => {
          const isActive = t.id === activeId;
          const title = stripMarkdown(t.title || t.firstMessage || 'Untitled conversation');
          const preview = t.firstMessage && t.title ? stripMarkdown(t.firstMessage) : null;
          const when = new Date(t.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: new Date(t.updatedAt).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
          }).toUpperCase();
          return (
            <li key={t.id} className={isActive ? 'is-active' : undefined}>
              <button
                type="button"
                onClick={() => onOpen(t)}
                className="ds-chat-history__link"
              >
                <div className="ds-chat-history__body">
                  <div className="ds-chat-history__eyebrow">{when}{isActive ? ' · OPEN' : ''}</div>
                  <div className="ds-chat-history__title">{title}</div>
                  {preview && preview !== title && (
                    <p className="ds-chat-history__preview">{preview}</p>
                  )}
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('Delete this conversation?')) onDelete(t.id);
                }}
                aria-label="Delete conversation"
                className="ds-chat-history__delete"
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>

      <style>{`
        .ds-chat-history {
          padding-bottom: 80px;
        }
        .ds-chat-history__feed {
          list-style: none;
          margin: 0;
          padding: 0;
          border-top: 1px solid var(--lf-ink);
        }
        .ds-chat-history__feed li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          border-bottom: 1px solid var(--lf-rule);
          padding: 18px 0;
        }
        .ds-chat-history__feed li.is-active { background: rgba(230,184,92,0.05); }
        .ds-chat-history__link {
          flex: 1; min-width: 0;
          display: block;
          background: none;
          border: 0;
          padding: 0;
          text-align: left;
          cursor: pointer;
          color: inherit;
        }
        .ds-chat-history__body { min-width: 0; }
        .ds-chat-history__eyebrow {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--lf-muted);
          margin-bottom: 6px;
        }
        .ds-chat-history__title {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 19px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.3;
          transition: color 0.15s;
        }
        .ds-chat-history__link:hover .ds-chat-history__title { color: var(--lf-sauce); }
        .ds-chat-history__preview {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.5;
          color: var(--lf-muted);
          margin: 6px 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ds-chat-history__delete {
          width: 30px; height: 30px;
          border: 0; background: transparent;
          color: var(--lf-muted);
          cursor: pointer;
          border-radius: 6px;
          flex-shrink: 0;
          display: grid; place-items: center;
          transition: background 0.15s, color 0.15s;
        }
        .ds-chat-history__delete:hover {
          background: rgba(201,84,58,0.08);
          color: var(--lf-sauce);
        }
      `}</style>
    </div>
  );
}

/** Strip a small set of markdown tokens so chat-thread previews don't show
 *  raw asterisks, backticks, or hashes in the History list. */
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')      // fenced code → space
    .replace(/`([^`]+)`/g, '$1')           // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // bold
    .replace(/__([^_]+)__/g, '$1')         // bold (underscore)
    .replace(/\*([^*]+)\*/g, '$1')         // italic
    .replace(/_([^_]+)_/g, '$1')           // italic (underscore)
    .replace(/^#+\s*/gm, '')               // headings
    .replace(/^\s*[-*+]\s+/gm, '')         // bullets
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
    .replace(/\s+/g, ' ')                  // collapse whitespace
    .trim();
}

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="ds-chat-md">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      <span style={{ position: 'relative', display: 'flex', width: 8, height: 8, flexShrink: 0 }}>
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'var(--lf-cheese)', opacity: 0.75,
          animation: 'lf-chat-ping 1s ease-out infinite',
        }} />
        <span style={{
          position: 'relative', borderRadius: '50%',
          width: 8, height: 8, background: 'var(--lf-cheese)',
        }} />
      </span>
      <span style={{ fontSize: 14, color: 'var(--lf-ink-soft)', fontFamily: "'Geist', system-ui, sans-serif" }}>
        Lasagna is thinking…
      </span>
      <style>{`@keyframes lf-chat-ping { 75%, 100% { transform: scale(2.2); opacity: 0; } }`}</style>
    </div>
  );
}
