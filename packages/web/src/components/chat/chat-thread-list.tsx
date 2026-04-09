import { useState, useRef } from 'react';
import { Send } from 'lucide-react';

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
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0">
        <h2 className="font-display text-[15px] font-semibold">Conversations</h2>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-3 py-1">
        {threads.length === 0 ? (
          <div className="text-center text-text-muted py-10 px-5 text-sm">
            No conversations yet. Ask a question to get started.
          </div>
        ) : (
          threads.map((thread, index) => (
            <button
              key={thread.id}
              onClick={() => onSelectThread(index)}
              className="w-full text-left flex flex-col gap-1 px-3 py-3 rounded-lg border-b border-border last:border-b-0 hover:bg-white/[0.03] transition-colors"
            >
              <span className="text-sm font-medium text-text leading-snug">
                {thread.question}
              </span>
              <span className="text-[13px] text-text-muted leading-snug line-clamp-2">
                {thread.answerPreview}
              </span>
              <span className="text-xs text-text-muted mt-1">
                {thread.timestamp}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Suggestion chips */}
      {suggestions && suggestions.length > 0 && (
        <div className="px-3 py-2 flex flex-wrap gap-1.5 flex-shrink-0">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onNewMessage(s)}
              className="px-3 py-1.5 rounded-2xl text-xs font-medium bg-surface border border-border text-text-muted hover:bg-surface-hover hover:text-text hover:border-border-light transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="px-4 py-2.5 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Lasagna anything..."
            className="flex-1 px-4 py-2.5 rounded-3xl border border-border bg-surface text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-30"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
