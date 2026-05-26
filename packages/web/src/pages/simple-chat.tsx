import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import ReactMarkdown from 'react-markdown';
import { useChatStore } from '../lib/chat-store';
import { api } from '../lib/api';
import type { ChatThread, Message } from '../lib/types';


interface Bubble {
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

const FALLBACK_STARTERS = [
  'What should I focus on first?',
  'Am I on track for retirement?',
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
  // the API assigns a new thread mid-conversation. Keeping a local copy
  // (rather than reading only from the URL) means we don't have to bounce
  // through setLocation on every reply.
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
      if (prompts.length < 2) prompts.push(...FALLBACK_STARTERS);
      setStarters(prompts.slice(0, 3));
    }).catch(() => {});
  }, []);

  // Auto-send a seed prompt from /insights → /chat?prompt=…
  useEffect(() => {
    if (seedPrompt && !autoSentRef.current) {
      autoSentRef.current = true;
      void send(seedPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt]);

  // Load a thread when the URL says so. Tracking which thread we've already
  // loaded prevents re-fetching on every render.
  //
  // We DELIBERATELY do not reset state when urlThreadId clears — that lets
  // the user flip Current ↔ History without losing the loaded conversation
  // (state survives the round-trip, and the Current pill writes the
  // thread back into the URL on re-entry). Wipes happen explicitly via
  // newChat().
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
  // Only show threads created in Simple mode (tagged 'simple-mode') —
  // legacy Advanced threads have jargon-heavy titles that confuse Simple users.
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
      // Reflect the new thread in the URL so flipping to History and back,
      // or sharing the URL, keeps the loaded conversation. Mark it as
      // already-loaded so the URL-driven effect doesn't re-fetch it.
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
    // Going back to "Current" — preserve a loaded thread in the URL so
    // pressing the pill from history doesn't accidentally wipe the
    // conversation the user was just reading.
    setLocation(threadId ? `/chat?thread=${encodeURIComponent(threadId)}` : '/chat');
  }

  function newChat() {
    // Wipe URL + local state. The URL-driven effect intentionally doesn't
    // auto-reset on a thread-param clear (so flipping Current ↔ History
    // preserves the loaded conversation), which means newChat() is the
    // single explicit reset path.
    setLocation('/chat');
    autoSentRef.current = true; // suppress auto-send of any lingering seed
    loadedThreadRef.current = null;
    setMessages([]);
    setThreadId(null);
    setDraft('');
    // Focus on next paint — input may not be mounted yet if view was 'history'.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // Open a thread by pushing to the URL — back-nav from here returns to
  // the history list. This is the whole point of URL-driven state.
  function openThread(t: ChatThread) {
    setLocation(`/chat?thread=${encodeURIComponent(t.id)}`);
  }

  async function deleteThread(id: string) {
    try {
      await api.deleteThread(id);
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === threadId) {
        // If the deleted thread is the one we have loaded, drop it from the URL.
        setLocation('/chat?view=history');
        loadedThreadRef.current = null;
        setThreadId(null);
        setMessages([]);
      }
    } catch {}
  }

  const hasConversation = messages.length > 0;

  const dock = view === 'chat' && (
    <div className="bg-bg/95 backdrop-blur px-4 pt-3 pb-3 border-t border-rule/60">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2 rounded-2xl bg-bg-elevated border border-rule pl-4 pr-1.5 py-1.5 shadow-sm focus-within:border-accent/60 focus-within:shadow-md transition"
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything…"
          disabled={busy}
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder-text-muted/70"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-text text-white w-10 h-10 grid place-items-center text-base disabled:opacity-30 shrink-0"
          aria-label="Send"
        >
          ↑
        </button>
      </form>
      {!hasConversation && (
        <div className="flex flex-wrap gap-2 mt-3">
          {starters.slice(0, 2).map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              disabled={busy}
              className="text-xs px-3 py-1.5 bg-bg-elevated border border-rule rounded-full text-text-secondary"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col" style={{ padding: 'clamp(16px, 4vw, 40px)', maxWidth: 1200, margin: '0 auto', minHeight: 'calc(100dvh - 130px)' }}>
      <h1 className="lf-h1 mb-5">Chat</h1>

      {/* Tab switcher + New chat. Pill heights matched (py-1.5 on both)
          so the row reads as one unit. New-chat is ghost-styled so it
          doesn't visually compete with the active tab. */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-bg-elevated border border-rule p-[3px] text-xs">
          <button
            onClick={() => setView('chat')}
            className={`px-3.5 py-1.5 rounded-full transition ${
              view === 'chat' ? 'bg-text text-white font-medium' : 'text-text-muted'
            }`}
          >
            Current
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-3.5 py-1.5 rounded-full transition ${
              view === 'history' ? 'bg-text text-white font-medium' : 'text-text-muted'
            }`}
          >
            History
          </button>
        </div>
        <button
          onClick={newChat}
          className="text-xs px-3 py-1.5 rounded-full border border-rule text-text-secondary hover:bg-bg-elevated whitespace-nowrap"
        >
          + New chat
        </button>
      </div>

      {view === 'history' ? (
        <HistoryList
          threads={threads}
          loading={loadingThreads}
          activeId={threadId}
          onOpen={openThread}
          onDelete={deleteThread}
          onNew={newChat}
        />
      ) : (
        <div ref={scrollRef} className="space-y-4 pb-32 md:pb-44">
          {!hasConversation && (
            <div className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-cheese/20 grid place-items-center text-sm shrink-0">🥬</div>
              <div className="flex-1 max-w-[85%] bg-bg-elevated border border-rule rounded-3xl px-4 py-3 shadow-sm">
                <p className="text-sm leading-relaxed">
                  Hey — ask me anything about your money. I can see your financial data to answer questions. Your data is processed securely and never stored by the AI provider.
                </p>
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] bg-text text-white rounded-3xl px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2">
                <div className="w-7 h-7 rounded-full bg-cheese/20 grid place-items-center text-sm shrink-0">🥬</div>
                <div className="flex-1 max-w-[85%] bg-bg-elevated border border-rule rounded-3xl px-4 py-3 shadow-sm">
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

      {/* Composer dock — fixed above bottom nav on mobile, sticky on desktop */}
      {dock && (
        <div className="fixed bottom-[56px] left-0 right-0 z-10 md:sticky md:bottom-0 md:left-auto md:right-auto md:mt-auto bg-bg border-t border-rule/40 px-4 pb-[env(safe-area-inset-bottom)]"
             style={{ maxWidth: 1200 }}
        >
          {dock}
        </div>
      )}
    </div>
  );
}

function HistoryList({
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
    return <div className="rounded-2xl bg-bg-elevated border border-rule p-5 animate-pulse h-32" />;
  }
  if (threads.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-elevated border border-rule p-6 text-center">
        <div className="text-3xl mb-2">💬</div>
        <div className="text-base font-serif font-medium">No conversations yet.</div>
        <p className="text-sm text-text-muted mt-2">Start a new chat — your history will show up here.</p>
        <button
          onClick={onNew}
          className="mt-4 rounded-xl bg-text text-white px-4 py-2 text-sm font-medium"
        >
          Start chatting
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden pb-1">
      {threads.map((t, i) => {
        const isActive = t.id === activeId;
        const title = stripMarkdown(t.title || t.firstMessage || 'Untitled conversation');
        const when = new Date(t.updatedAt).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        return (
          <div
            key={t.id}
            className={`group relative flex items-center transition ${
              isActive ? 'bg-cheese/10' : ''
            } ${i < threads.length - 1 ? 'border-b border-rule/50' : ''}`}
          >
            <button
              onClick={() => onOpen(t)}
              className="flex-1 min-w-0 text-left px-3 py-2.5 flex items-center justify-between gap-3 min-h-[44px]"
            >
              <div className="text-sm font-medium line-clamp-1 flex-1">{title}</div>
              <div className="text-[10px] text-text-muted whitespace-nowrap tabular-nums shrink-0">
                {when}
              </div>
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this conversation?')) onDelete(t.id);
              }}
              aria-label="Delete conversation"
              className="w-9 h-11 grid place-items-center text-text-muted/60 hover:text-accent text-sm shrink-0"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Strip a small set of markdown tokens so chat-thread previews don't show
 *  raw asterisks, backticks, or hashes in the History list. Intentionally
 *  conservative — we only render plain text here, not HTML. */
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
  // Render markdown in assistant bubbles so headings, lists, bold, links, etc.
  // appear formatted instead of as raw asterisks/hashes. Styles are tuned for
  // a chat bubble — tight spacing, smaller headings, readable inline code.
  return (
    <div className="text-sm leading-relaxed text-text [&_p:not(:last-child)]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_li]:my-0 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_strong]:font-semibold [&_em]:italic [&_a]:text-accent [&_a]:underline [&_code]:bg-bg [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-bg [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-rule [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function TypingIndicator() {
  // Pulsing cheese dot + plain "thinking" label. Earlier version used
  // background-clip:text for a shimmer; Safari iOS rendered the text as
  // transparent with no fallback, leaving an empty bubble. Plain text +
  // opacity pulse is bulletproof.
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="relative flex w-2 h-2 shrink-0">
        <span className="absolute inset-0 rounded-full bg-cheese animate-ping opacity-75" />
        <span className="relative rounded-full w-2 h-2 bg-cheese" />
      </span>
      <span className="text-sm text-text-secondary lf-thinking">Lasagna is thinking…</span>
    </div>
  );
}
