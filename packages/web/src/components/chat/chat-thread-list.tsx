import { useState, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Thread {
  id: string;
  question: string;
  answerPreview: string;
  timestamp: string;
}

interface ChatThreadListProps {
  threads: Thread[];
  onSelectThread: (index: number) => void;
  onNewMessage: (text: string) => void;
  suggestions?: string[];
}

const DEFAULT_PROMPTS = [
  'Summarize my financial situation',
  'What should I focus on this month?',
  'Where am I losing money?',
];

export function ChatThreadList({ threads, onSelectThread, onNewMessage, suggestions }: ChatThreadListProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onNewMessage(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Thread list */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 px-1 mb-1">
              <MessageSquare className="w-3.5 h-3.5 text-text-muted" />
              <span className="text-xs font-medium text-text-muted">Suggested</span>
            </div>
            {DEFAULT_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onNewMessage(prompt)}
                className="w-full text-left px-3.5 py-3 rounded-xl border border-border bg-surface text-sm text-text-secondary hover:bg-surface-hover hover:border-accent/30 hover:text-text transition-all leading-snug"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : (
          <div className="py-1">
            {threads.map((thread, index) => (
              <button
                key={thread.id}
                onClick={() => onSelectThread(index)}
                className="w-full text-left flex flex-col gap-1 px-4 py-3.5 border-b border-border/50 last:border-b-0 hover:bg-surface-hover/60 transition-colors group"
              >
                <span className="text-sm font-medium text-text leading-snug line-clamp-1">
                  {thread.question}
                </span>
                <span className="text-xs text-text-muted leading-snug line-clamp-2">
                  {thread.answerPreview}
                </span>
                <span className="text-[11px] text-text-muted/60 mt-0.5">
                  {thread.timestamp}
                </span>
              </button>
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
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface-hover border border-border text-text-muted hover:bg-surface hover:text-text hover:border-accent/30 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything…"
            className="flex-1 px-4 py-2.5 rounded-2xl border border-border bg-surface-hover text-text text-sm placeholder:text-text-muted/60 focus:outline-none focus:border-accent/40 focus:bg-surface transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
              input.trim()
                ? "bg-accent hover:bg-accent/90 shadow-sm shadow-accent/20"
                : "bg-surface-hover opacity-40 cursor-not-allowed"
            )}
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
