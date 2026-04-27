import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Trash2, Plus, Loader2 } from 'lucide-react';
import { MessageBubble } from './message-bubble';
import { ModelSelector } from './model-selector';
import { cn } from '../../lib/utils';
import type { Message } from '../../lib/types';
import type { Thread } from './chat-thread-list';

const THINKING_STEPS = [
  'Thinking…',
  'Reading your data…',
  'Crunching numbers…',
  'Analyzing patterns…',
  'Preparing response…',
];

function ThinkingIndicator() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % THINKING_STEPS.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex justify-start">
      <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-2.5">
        <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
        <span
          key={step}
          className="text-sm text-text-secondary animate-fade-in"
        >
          {THINKING_STEPS[step]}
        </span>
      </div>
    </div>
  );
}

interface ChatThreadViewProps {
  thread: Thread;
  messages: Message[];
  onBack: () => void;
  onFollowUp: (text: string) => void;
  onDelete?: () => void;
  onNewChat?: () => void;
  onRestartWithLevel?: (level: import('../../lib/chat-store').ModelLevel) => void;
  loading?: boolean;
}

export function ChatThreadView({ thread, messages, onBack, onFollowUp, onDelete, onNewChat, onRestartWithLevel, loading }: ChatThreadViewProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onFollowUp(input.trim());
    setInput('');
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize up to 3 lines
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
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border flex-shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors flex-shrink-0"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="w-4 h-4 text-text-secondary" />
        </button>
        <span className="flex-1 text-sm font-medium text-text truncate leading-snug">
          {thread.question}
        </span>
        {onNewChat && (
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors flex-shrink-0"
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus className="w-4 h-4 text-text-secondary" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-surface-hover hover:text-danger transition-colors flex-shrink-0"
            aria-label="Delete conversation"
            title="Delete conversation"
          >
            <Trash2 className="w-4 h-4 text-text-secondary hover:text-danger" />
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && <ThinkingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Follow-up input */}
      <form onSubmit={handleSubmit} className="px-3 pt-2 pb-3 border-t border-border flex-shrink-0">
        <div className="flex items-center justify-start mb-1.5">
          <ModelSelector threadLocalId={thread.id} onRestart={onRestartWithLevel} />
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Follow up…"
            disabled={loading}
            rows={1}
            className="flex-1 px-4 py-2.5 rounded-2xl border border-border bg-bg-elevated text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:bg-surface-hover transition-all disabled:opacity-50 resize-none overflow-y-auto"
            style={{ maxHeight: 80 }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all mb-0.5",
              input.trim() && !loading
                ? "bg-accent hover:bg-accent/90 shadow-sm shadow-accent/20"
                : "bg-border text-text-secondary cursor-not-allowed"
            )}
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </form>
    </div>
  );
}
