import { useState, useRef, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Minimize2, SquarePen, Trash2, Send, Sparkles, ArrowUpRight } from 'lucide-react';
import { useIsMobile } from '../../lib/hooks/use-mobile';
import { useChatStore, setChatExpanded } from '../../lib/chat-store';
import { useGlobalChat } from './use-global-chat';
import { ChatThreadView } from './chat-thread-view';
import { ChatThreadList } from './chat-thread-list';

// Compact composer + suggested prompts shown in the conversation pane when no
// thread is active (the "new chat" state).
function NewChatHero({ suggestions, onSend }: { suggestions: string[]; onSend: (text: string) => void }) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-6 py-10">
      <div className="w-full max-w-[620px] animate-fade-in">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-ui-lg bg-[var(--ui-accent-soft)] grid place-items-center mb-4">
            <Sparkles className="w-[22px] h-[22px] text-[rgb(var(--ui-accent-ink))]" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]">AI Assistant</span>
          <h2 className="font-editorial font-bold text-[30px] sm:text-[34px] text-content mt-2.5 leading-[1.05] tracking-[-0.025em]">
            Ask anything about your finances
          </h2>
          <p className="text-[14px] font-medium text-content-muted mt-3 max-w-md leading-relaxed">
            I can analyze your accounts, spending, and plans — and walk you through what to do next.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-[16px] bg-canvas-sunken border-[1.5px] border-line-heavy transition-[background,border-color,box-shadow] focus-within:bg-panel focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              aria-label="Message Lasagna"
              rows={1}
              className="flex-1 min-w-0 py-2 bg-transparent text-content text-[15px] placeholder:text-content-muted focus:outline-none resize-none overflow-y-auto"
              style={{ maxHeight: 120 }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className={`shrink-0 grid place-items-center w-10 h-10 rounded-full transition-[transform,box-shadow,background-color] ${
                input.trim()
                  ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:-translate-y-px hover:shadow-ui-sm'
                  : 'bg-canvas-sunken text-content-muted cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>

        {suggestions.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted text-center mb-3">
              Try asking
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onSend(s)}
                  className="group inline-flex items-center gap-1.5 min-h-[36px] pl-3.5 pr-3 rounded-full text-[13px] font-semibold bg-panel border border-line-strong text-content-secondary hover:bg-brand-soft hover:text-[rgb(var(--ui-brand-ink))] hover:border-transparent active:scale-[0.98] transition-[background,color,border-color,transform]"
                >
                  {s}
                  <ArrowUpRight className="w-3 h-3 text-content-muted group-hover:text-[rgb(var(--ui-brand-ink))] transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatFullPage() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { openChat, chatReturnPath, setPendingMessage } = useChatStore();
  const {
    threadSummaries, activeThread, activeThreadIndex, setActiveThread, suggestions, loadingThreads,
    handleNewMessage, handleFollowUp, handleRetry, handleSelectThread, handleDeleteThread,
  } = useGlobalChat();

  // Seed prompt forwarded from other pages (e.g. /chat?prompt=…). Hand it to the
  // shared store's pending-message channel so the hook starts the conversation,
  // then strip it from the URL so it doesn't re-fire.
  useEffect(() => {
    const prompt = new URLSearchParams(search).get('prompt');
    if (prompt) {
      setPendingMessage({ text: prompt, nonce: Date.now() });
      setLocation('/chat', { replace: true });
    }
  }, [search, setPendingMessage, setLocation]);

  const handleCollapse = () => {
    setChatExpanded(false);
    openChat();
    setLocation(chatReturnPath || '/');
  };

  // Mobile: single-column, full-screen conversation with the list reachable via
  // the thread view's back affordance.
  if (isMobile) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-canvas">
        {activeThread ? (
          <ChatThreadView
            thread={activeThread.thread}
            messages={activeThread.messages}
            onBack={() => setActiveThread(null)}
            onFollowUp={handleFollowUp}
            onRetry={() => handleRetry(activeThread.thread.id)}
            onDelete={() => handleDeleteThread()}
            onNewChat={() => setActiveThread(null)}
            loading={loadingThreads.has(activeThread.thread.id)}
            variant="mobile"
          />
        ) : (
          <ChatThreadList
            threads={threadSummaries}
            onSelectThread={handleSelectThread}
            onDeleteThread={handleDeleteThread}
            onNewMessage={handleNewMessage}
            suggestions={suggestions}
            variant="mobile"
          />
        )}
      </div>
    );
  }

  // Desktop: history rail + conversation pane.
  return (
    <div className="flex h-full min-h-0">
      {/* History rail */}
      <div className="w-[300px] flex-shrink-0 border-r border-line flex flex-col bg-canvas min-h-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-line flex-shrink-0">
          <button
            onClick={handleCollapse}
            className="flex items-center gap-1.5 px-2 py-2 rounded-ui-md hover:bg-canvas-sunken transition-colors text-content-secondary hover:text-content"
            title="Collapse to sidebar"
          >
            <Minimize2 className="w-4 h-4" />
            <span className="text-xs font-semibold">Collapse</span>
          </button>
          <button
            onClick={() => setActiveThread(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-ui-md bg-brand-soft text-[rgb(var(--ui-brand-ink))] text-xs font-bold hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]"
          >
            <SquarePen className="w-3.5 h-3.5" />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {threadSummaries.length === 0 ? (
            <p className="px-4 py-6 text-xs text-content-muted">No conversations yet.</p>
          ) : (
            <div className="px-2 py-2">
              <p className="px-2.5 pt-2 pb-2 text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted">
                Conversations
              </p>
              <div className="flex flex-col">
              {threadSummaries.map((thread, index) => {
                const active = index === activeThreadIndex;
                return (
                <div
                  key={thread.id}
                  className={`group relative flex items-start border-b border-line last:border-b-0 transition-colors ${
                    active ? 'bg-brand-soft' : 'hover:bg-canvas-sunken'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-brand" />
                  )}
                  {thread.unread && !active && (
                    <span className="absolute left-2 top-[18px] w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                  )}
                  <button
                    onClick={() => handleSelectThread(index)}
                    className={`flex-1 text-left flex flex-col gap-1 py-3 min-w-0 ${thread.unread && !active ? 'pl-4 pr-3' : 'px-4'}`}
                  >
                    <span className={`text-[13.5px] leading-snug line-clamp-2 break-words ${active ? 'font-semibold text-[rgb(var(--ui-brand-ink))]' : thread.unread ? 'font-semibold text-content' : 'font-medium text-content'}`}>
                      {thread.question}
                    </span>
                    {thread.answerPreview && (
                      <span className="text-[12px] text-content-muted leading-snug line-clamp-1 break-words">
                        {thread.answerPreview}
                      </span>
                    )}
                    <span className="text-[11px] text-content-muted mt-0.5">{thread.timestamp}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteThread(index); }}
                    className="flex-shrink-0 p-2 mt-2.5 mr-1.5 rounded-ui-sm opacity-0 group-hover:opacity-100 hover:bg-negative-soft hover:text-negative text-content-muted transition-all"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                );
              })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Conversation pane — min-w-0 so wide content (tables, long lines) stays
          inside the pane and never pushes the layout under the nav/rail. */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {activeThread ? (
          <ChatThreadView
            thread={activeThread.thread}
            messages={activeThread.messages}
            onBack={() => setActiveThread(null)}
            onFollowUp={handleFollowUp}
            onRetry={() => handleRetry(activeThread.thread.id)}
            onDelete={() => handleDeleteThread()}
            loading={loadingThreads.has(activeThread.thread.id)}
            variant="full"
          />
        ) : (
          <NewChatHero suggestions={suggestions} onSend={handleNewMessage} />
        )}
      </div>
    </div>
  );
}
