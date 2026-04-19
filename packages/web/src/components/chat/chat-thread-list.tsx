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
              <MessageSquare className="w-3.5 h-3.5 text-text-secondary" />
              <span className="text-xs font-medium text-text-secondary">Suggested</span>
            </div>
            {DEFAULT_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onNewMessage(prompt)}
                className="w-full text-left px-3.5 py-3 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white/70 hover:bg-white/[0.07] hover:border-accent/40 hover:text-white/90 transition-all leading-snug"
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
                className="w-full text-left flex flex-col gap-1 px-4 py-3.5 border-b border-border/50 last:border-b-0 hover:bg-white/[0.04] transition-colors"
              >
                <span className="text-sm font-medium text-white/90 leading-snug line-clamp-1">
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
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/[0.04] border border-white/10 text-text-secondary hover:bg-white/[0.07] hover:text-text hover:border-accent/30 transition-all"
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
            className="flex-1 px-4 py-2.5 rounded-2xl border border-white/10 bg-white/[0.06] text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:bg-white/[0.08] transition-all"
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
