import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { MessageBubble } from './message-bubble';
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
      {/* Header with back button */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-text-muted" />
        </button>
        <span className="text-sm font-medium text-text truncate">
          {thread.question}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-2xl px-4 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Follow-up input */}
      <form onSubmit={handleSubmit} className="px-4 py-2.5 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Follow up..."
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-3xl border border-border bg-surface text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-30"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
