import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Trash2, Plus, Loader2 } from 'lucide-react';
import { MessageBubble } from './message-bubble';
import { cn } from '../../lib/utils';
import type { ChatMessage } from '../../lib/chat-store';
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
  messages: ChatMessage[];
  onBack: () => void;
  onFollowUp: (text: string) => void;
  onDelete?: () => void;
  onNewChat?: () => void;
  onRetry?: () => void;
  loading?: boolean;
  // 'sidebar' (default) = compact 340px rail; 'full' = desktop full page with a
  // centered reading column; 'mobile' = full-screen mobile with comfortable gutters.
  variant?: 'sidebar' | 'full' | 'mobile';
}

export function ChatThreadView({ thread, messages, onBack, onFollowUp, onDelete, onNewChat, onRetry, loading, variant = 'sidebar' }: ChatThreadViewProps) {
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

  const isFull = variant === 'full';
  const isMobile = variant === 'mobile';
  // Fill the conversation pane on the desktop full page (same feel as a laptop
  // width); only cap on very large monitors so prose doesn't run absurdly wide.
  const measure = isFull ? 'max-w-[1400px] w-full mx-auto' : 'w-full';
  const headerPad = isFull ? 'px-4 py-4' : isMobile ? 'px-4 py-3.5' : 'px-3 py-3';
  const bodyPad = isFull ? 'px-4 py-6 space-y-5' : isMobile ? 'px-4 py-5 space-y-4' : 'px-4 py-4 space-y-4';
  const composerPad = isFull ? 'px-4 py-4' : isMobile ? 'px-4 py-3' : 'px-3 pt-2 pb-3';
  const iconBtn = isMobile ? 'p-2.5' : 'p-1.5';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="border-b border-border flex-shrink-0">
        <div className={cn('flex items-center gap-2', headerPad, measure)}>
          <button
            onClick={onBack}
            className={cn('rounded-lg hover:bg-surface-hover transition-colors flex-shrink-0', iconBtn)}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="w-4 h-4 text-text-secondary" />
          </button>
          <span className={cn('flex-1 font-medium text-text truncate leading-snug', isFull ? 'text-[15px]' : 'text-sm')}>
            {thread.question}
          </span>
          {onNewChat && (
            <button
              onClick={onNewChat}
              className={cn('rounded-lg hover:bg-surface-hover transition-colors flex-shrink-0', iconBtn)}
              aria-label="New conversation"
              title="New conversation"
            >
              <Plus className="w-4 h-4 text-text-secondary" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className={cn('rounded-lg hover:bg-surface-hover hover:text-danger transition-colors flex-shrink-0', iconBtn)}
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              <Trash2 className="w-4 h-4 text-text-secondary hover:text-danger" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className={cn(measure, bodyPad)}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onRetry={onRetry} />
          ))}
          {loading && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Follow-up input */}
      <form onSubmit={handleSubmit} className="border-t border-border flex-shrink-0">
        <div className={cn('flex items-end gap-2', composerPad, measure)}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Follow up…"
            aria-label="Message Lasagna"
            disabled={loading}
            rows={1}
            className={cn(
              'flex-1 rounded-2xl border border-border bg-bg-elevated text-text text-sm placeholder:text-text-muted focus:outline-none focus:border-accent/40 focus:bg-surface-hover focus:ring-2 focus:ring-accent/15 transition-all disabled:opacity-50 resize-none overflow-y-auto',
              isMobile ? 'px-4 py-3' : 'px-4 py-2.5'
            )}
            style={{ maxHeight: 80 }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send message"
            className={cn(
              "rounded-full flex items-center justify-center flex-shrink-0 transition-all mb-0.5",
              isMobile ? "w-11 h-11" : "w-9 h-9",
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
