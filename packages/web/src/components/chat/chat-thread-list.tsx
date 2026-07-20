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

  // The message composer — rendered inline under the empty-state hero AND
  // pinned to the bottom once a conversation list exists.
  const composer = (
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
          className={cn(
            'flex-1 min-w-0 bg-transparent text-content placeholder:text-content-muted focus:outline-none resize-none overflow-y-auto py-2',
            // ≥16px on mobile so iOS doesn't auto-zoom the viewport on focus.
            isMobile ? 'text-[16px]' : 'text-[15px]'
          )}
          style={{ maxHeight: 80 }}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send message"
          className={cn(
            'shrink-0 grid place-items-center rounded-full transition-[transform,box-shadow,background-color]',
            isMobile ? 'w-11 h-11 min-w-[44px] min-h-[44px]' : 'w-10 h-10',
            input.trim()
              ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:-translate-y-px hover:shadow-ui-sm'
              : 'bg-canvas-sunken text-content-muted cursor-not-allowed'
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </form>
  );

  // Suggested queries — a labelled list of tappable prompts. Placed BELOW the
  // composer in the empty state so the input reads as the primary action.
  const starters = suggestions && suggestions.length > 0 ? suggestions : DEFAULT_PROMPTS;

  // Mobile empty state: a centred hero with the composer directly beneath it and
  // suggested queries under that — so the page never reads as blank and the
  // input is unmistakably the thing to use first.
  if (isMobile && threads.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0 justify-center px-5 pb-6">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-ui-lg bg-[var(--ui-accent-soft)] grid place-items-center mb-4">
            <Sparkles className="w-6 h-6 text-[rgb(var(--ui-accent-ink))]" />
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))] mb-2">AI Assistant</span>
          <h2 className="font-editorial font-bold text-[28px] text-content leading-[1.05] tracking-[-0.025em]">Ask anything about your finances</h2>
          <p className="text-[14px] font-medium text-content-muted mt-2.5 leading-relaxed">I can analyze your accounts, spending, and plans — and walk you through what to do next.</p>
        </div>

        {composer}

        <div className="mt-5 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted px-1">Try asking</p>
          {starters.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onNewMessage(prompt)}
              className="group w-full text-left flex items-center justify-between gap-2 px-4 py-3.5 rounded-ui-md border border-line-strong bg-panel text-[14px] font-medium text-content-secondary hover:bg-brand-soft hover:border-transparent hover:text-[rgb(var(--ui-brand-ink))] active:scale-[0.99] transition-[background,color,border-color,transform] leading-snug"
            >
              <span>{prompt}</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-content-muted group-hover:text-[rgb(var(--ui-brand-ink))] transition-colors flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-4 space-y-6">
            <div className="flex flex-col items-center text-center pt-8 pb-1">
              <div className="w-12 h-12 rounded-ui-lg bg-[var(--ui-accent-soft)] grid place-items-center mb-4">
                <Sparkles className="w-[22px] h-[22px] text-[rgb(var(--ui-accent-ink))]" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))] mb-2">AI Assistant</span>
              <h2 className="font-editorial font-bold text-[26px] text-content leading-[1.05] tracking-[-0.025em]">Ask anything about your finances</h2>
              <p className="text-[14px] font-medium text-content-muted mt-2.5">I can analyze your accounts, spending, and plans.</p>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted px-1">Try asking</p>
              {DEFAULT_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => onNewMessage(prompt)}
                  className="group w-full text-left flex items-center justify-between gap-2 px-4 py-3.5 rounded-ui-md border border-line-strong bg-panel text-[14px] font-medium text-content-secondary hover:bg-brand-soft hover:border-transparent hover:text-[rgb(var(--ui-brand-ink))] active:scale-[0.99] transition-[background,color,border-color,transform] leading-snug"
                >
                  <span>{prompt}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-content-muted group-hover:text-[rgb(var(--ui-brand-ink))] transition-colors flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="px-2 py-2">
            <p className="px-2.5 pt-2 pb-2 text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted">
              Conversations
            </p>
            <div className="flex flex-col">
            {threads.map((thread, index) => (
              <div
                key={thread.id}
                className="group relative flex items-start border-b border-line last:border-b-0 hover:bg-canvas-sunken transition-colors"
              >
                {thread.unread && (
                  <span className="absolute left-2 top-[18px] w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
                )}
                <button
                  onClick={() => onSelectThread(index)}
                  className={`flex-1 text-left flex flex-col gap-1 py-3 min-w-0 ${thread.unread ? 'pl-4 pr-3' : 'px-4'}`}
                >
                  <span className={`text-[13.5px] leading-snug line-clamp-2 break-words ${thread.unread ? 'font-semibold text-content' : 'font-medium text-content'}`}>
                    {thread.question}
                  </span>
                  {thread.answerPreview && (
                    <span className="text-[12px] text-content-muted leading-snug line-clamp-1 break-words">
                      {thread.answerPreview}
                    </span>
                  )}
                  <span className="text-[11px] text-content-muted mt-0.5">
                    {thread.timestamp}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteThread(index); }}
                  className={cn(
                    'flex-shrink-0 grid place-items-center rounded-ui-sm hover:bg-negative-soft hover:text-negative text-content-muted transition-all',
                    // Touch has no hover, so on mobile the delete affordance must
                    // be persistently visible and a full 44px tap target.
                    isMobile
                      ? 'w-11 h-11 mt-1.5 mr-1 opacity-100'
                      : 'w-[30px] h-[30px] mt-2.5 mr-1.5 opacity-0 group-hover:opacity-100'
                  )}
                  aria-label="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            </div>
          </div>
        )}
      </div>

      {/* Suggestion chips */}
      {suggestions && suggestions.length > 0 && (
        <div className="px-3 py-2.5 flex flex-wrap gap-1.5 flex-shrink-0 border-t border-line">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onNewMessage(s)}
              className={cn(
                'inline-flex items-center px-3 rounded-full text-xs font-semibold bg-panel border border-line-strong text-content-secondary hover:bg-brand-soft hover:text-[rgb(var(--ui-brand-ink))] hover:border-transparent active:scale-[0.98] transition-[background,color,border-color,transform]',
                isMobile ? 'min-h-[44px]' : 'min-h-[32px]'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={cn('flex-shrink-0 border-t border-line', isMobile ? 'px-4 py-3' : 'px-3 pt-2 pb-3')}>
        {composer}
      </div>

    </div>
  );
}
