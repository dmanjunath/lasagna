import { useState, useRef, useEffect } from 'react';
import { useLocation, useSearch } from 'wouter';
import { Minimize2, Plus, Trash2, Send, Sparkles } from 'lucide-react';
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
    <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-6">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-11 h-11 rounded-2xl bg-accent/10 grid place-items-center mb-3">
            <Sparkles className="w-5 h-5 text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-text">Ask anything about your finances</h2>
          <p className="text-sm text-text-secondary mt-1">I can analyze your accounts, spending, and plans.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-2 p-2 rounded-2xl border border-border bg-surface shadow-card">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              aria-label="Message Lasagna"
              rows={1}
              className="flex-1 px-3 py-2 bg-transparent text-text text-sm placeholder:text-text-muted focus:outline-none resize-none overflow-y-auto"
              style={{ maxHeight: 120 }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                input.trim()
                  ? 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/20'
                  : 'bg-border text-text-secondary cursor-not-allowed'
              }`}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </form>

        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center mt-4">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSend(s)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface border border-border text-text-secondary hover:bg-surface-hover hover:text-text hover:border-accent/30 transition-all"
              >
                {s}
              </button>
            ))}
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
      <div className="flex flex-col h-full min-h-0 bg-bg">
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
      <div className="w-[300px] flex-shrink-0 border-r border-border flex flex-col bg-surface min-h-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border flex-shrink-0">
          <button
            onClick={handleCollapse}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-surface-hover transition-colors text-text-secondary hover:text-text"
            title="Collapse to sidebar"
          >
            <Minimize2 className="w-4 h-4" />
            <span className="text-xs font-medium">Collapse</span>
          </button>
          <button
            onClick={() => setActiveThread(null)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {threadSummaries.length === 0 ? (
            <p className="px-4 py-6 text-xs text-text-muted">No conversations yet.</p>
          ) : (
            <div className="py-1">
              {threadSummaries.map((thread, index) => (
                <div
                  key={thread.id}
                  className={`group flex items-start gap-1 border-b border-border/50 last:border-b-0 transition-colors relative ${
                    index === activeThreadIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                  }`}
                >
                  {thread.unread && (
                    <span className="absolute left-1.5 top-5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                  )}
                  <button
                    onClick={() => handleSelectThread(index)}
                    className="flex-1 text-left flex flex-col gap-1 px-4 py-3.5 min-w-0"
                  >
                    <span className={`text-sm leading-snug line-clamp-2 ${thread.unread ? 'font-semibold text-text' : 'font-medium text-text'}`}>
                      {thread.question}
                    </span>
                    {thread.answerPreview && (
                      <span className="text-xs text-text-secondary leading-snug line-clamp-2">
                        {thread.answerPreview}
                      </span>
                    )}
                    <span className="text-[11px] text-text-muted mt-0.5">{thread.timestamp}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteThread(index); }}
                    className="flex-shrink-0 p-2 mt-3 mr-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger text-text-muted transition-all"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
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
