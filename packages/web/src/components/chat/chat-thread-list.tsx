import { useState, useRef } from 'react';
import { Send, Trash2, Sparkles, ArrowUpRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Thread {
  id: string;
  question: string;
  answerPreview: string;
  timestamp: string;
  unread?: boolean;
}

interface ChatThreadListProps {
  threads: Thread[];
  onSelectThread: (index: number) => void;
  onDeleteThread: (index: number) => void;
  onNewMessage: (text: string) => void;
  suggestions?: string[];
  // 'sidebar' (default) = compact rail; 'mobile' = full-screen with comfortable
  // gutters and larger touch targets.
  variant?: 'sidebar' | 'mobile';
}

const DEFAULT_PROMPTS = [
  'Summarize my financial situation',
  'What should I focus on this month?',
  'Where am I losing money?',
];

export function ChatThreadList({ threads, onSelectThread, onDeleteThread, onNewMessage, suggestions, variant = 'sidebar' }: ChatThreadListProps) {
  const isMobile = variant === 'mobile';
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onNewMessage(input.trim());
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 80)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-4 space-y-5">
            <div className="flex flex-col items-center text-center pt-6 pb-1">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 ring-1 ring-accent/15 grid place-items-center mb-3">
                <Sparkles className="w-5 h-5 text-accent" />
              </div>
              <h2 className="font-serif font-semibold text-2xl text-text leading-tight">Ask anything about your finances</h2>
              <p className="text-sm text-text-secondary mt-1.5">I can analyze your accounts, spending, and plans.</p>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted px-1">Try asking</p>
              {DEFAULT_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onNewMessage(prompt)}
                  className="group w-full text-left flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:border-accent/40 hover:text-text transition-all leading-snug"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-1">
            <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
              Conversations
            </p>
            {threads.map((thread, index) => (
              <div
                key={thread.id}
                className="group flex items-start gap-1 border-b border-border/50 last:border-b-0 hover:bg-surface-hover transition-colors relative"
              >
                {thread.unread && (
                  <span className="absolute left-1.5 top-5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
                )}
                <button
                  onClick={() => onSelectThread(index)}
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
                  <span className="text-[11px] text-text-muted mt-0.5">
                    {thread.timestamp}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteThread(index); }}
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

      {/* Suggestion chips */}
      {suggestions && suggestions.length > 0 && (
        <div className="px-3 py-2 flex flex-wrap gap-1.5 flex-shrink-0 border-t border-border/50">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onNewMessage(s)}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface border border-border text-text-secondary hover:bg-surface-hover hover:text-text hover:border-accent/30 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={cn('flex-shrink-0 border-t border-border/50', isMobile ? 'px-4 py-3' : 'px-3 pt-2 pb-3')}>
        <form onSubmit={handleSubmit}>
          <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-2xl border border-border bg-surface shadow-[var(--shadow-card)] transition-all focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              aria-label="Message Lasagna"
              rows={1}
              className="flex-1 bg-transparent text-text text-sm placeholder:text-text-muted focus:outline-none resize-none overflow-y-auto py-1.5"
              style={{ maxHeight: 80 }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className={cn(
                'rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                isMobile ? 'w-11 h-11' : 'w-9 h-9',
                input.trim()
                  ? 'bg-accent hover:bg-accent/90 shadow-sm shadow-accent/20'
                  : 'bg-border text-text-muted cursor-not-allowed'
              )}
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
