import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send } from 'lucide-react';
import { MessageBubble } from './message-bubble';
import { cn } from '../../lib/utils';
import type { Message } from '../../lib/types';
import type { Thread } from './chat-thread-list';

interface ChatThreadViewProps {
  thread: Thread;
  messages: Message[];
  onBack: () => void;
  onFollowUp: (text: string) => void;
  loading?: boolean;
}

export function ChatThreadView({ thread, messages, onBack, onFollowUp, loading }: ChatThreadViewProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onFollowUp(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors flex-shrink-0"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="w-4 h-4 text-text-muted" />
        </button>
        <span className="text-sm font-medium text-text truncate leading-snug">
          {thread.question}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted/60 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Follow-up input */}
      <form onSubmit={handleSubmit} className="px-3 py-3 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Follow up…"
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-2xl border border-border bg-surface-hover text-text text-sm placeholder:text-text-muted/60 focus:outline-none focus:border-accent/40 focus:bg-surface transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all",
              input.trim() && !loading
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
