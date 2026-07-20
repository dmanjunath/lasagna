import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Trash2, SquarePen, Sparkles } from 'lucide-react';
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
    <div className="flex gap-3 items-start animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-[var(--ui-accent-soft)] grid place-items-center flex-shrink-0 mt-0.5">
        <Sparkles className="w-3.5 h-3.5 text-[rgb(var(--ui-accent-ink))]" />
      </div>
      <div className="flex items-center gap-2.5 pt-1">
        <div className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--ui-accent))] lf-thinking"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
        <span key={step} className="text-sm text-content-muted animate-fade-in">
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
  // Cap the desktop full-page conversation to a comfortable reading column
  // (~68ch) so assistant prose never runs edge-to-edge across a wide pane.
  // Header and composer share the same centered measure so the whole surface
  // lines up on one column.
  const measure = isFull ? 'max-w-[760px] w-full mx-auto' : 'w-full';
  const headerPad = isFull ? 'px-6 py-4' : isMobile ? 'px-4 py-3.5' : 'px-3 py-3';
  const bodyPad = isFull ? 'px-6 py-8 space-y-6' : isMobile ? 'px-4 py-5 space-y-5' : 'px-4 py-4 space-y-4';
  const composerPad = isFull ? 'px-6 py-4' : isMobile ? 'px-4 py-3' : 'px-3 pt-2 pb-3';
  const iconBtn = isMobile ? 'w-11 h-11 grid place-items-center' : 'p-1.5';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="border-b border-line flex-shrink-0">
        <div className={cn('flex items-center gap-2', headerPad, measure)}>
          {!isFull && (
            <button
              onClick={onBack}
              className={cn('rounded-ui-md hover:bg-canvas-sunken transition-colors flex-shrink-0', iconBtn)}
              aria-label="Back to conversations"
            >
              <ArrowLeft className="w-4 h-4 text-content-secondary" />
            </button>
          )}
          <span className={cn('flex-1 font-medium text-content truncate leading-snug', isFull ? 'text-[15px]' : 'text-sm')}>
            {thread.question}
          </span>
          {onNewChat && (
            <button
              onClick={onNewChat}
              className={cn('rounded-ui-md hover:bg-canvas-sunken transition-colors flex-shrink-0', iconBtn)}
              aria-label="New conversation"
              title="New conversation"
            >
              <SquarePen className="w-4 h-4 text-content-secondary" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className={cn('rounded-ui-md hover:bg-canvas-sunken hover:text-negative transition-colors flex-shrink-0', iconBtn)}
              aria-label="Delete conversation"
              title="Delete conversation"
            >
              <Trash2 className="w-4 h-4 text-content-secondary hover:text-negative" />
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

      {/* Follow-up input — on mobile a heavier top border plus a soft upward
          shadow clearly divides the composer from the scrollable messages. */}
      <form
        onSubmit={handleSubmit}
        className={cn(
          'flex-shrink-0',
          isMobile
            ? 'border-t-2 border-line-heavy shadow-[0_-6px_16px_-8px_rgba(20,33,61,0.18)]'
            : 'border-t border-line'
        )}
      >
        <div className={cn(composerPad, measure)}>
          <div className="flex items-end gap-2 pl-4 pr-2 py-2 rounded-[16px] bg-canvas-sunken border-[1.5px] border-line-heavy transition-[background,border-color,box-shadow] focus-within:bg-panel focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft">
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
                'flex-1 min-w-0 bg-transparent text-content placeholder:text-content-muted focus:outline-none disabled:opacity-50 resize-none overflow-y-auto py-2',
                // ≥16px on mobile so iOS doesn't auto-zoom the viewport on focus.
                isMobile ? 'text-[16px]' : 'text-[15px]'
              )}
              style={{ maxHeight: 80 }}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              aria-label="Send message"
              className={cn(
                "shrink-0 grid place-items-center rounded-full transition-[transform,box-shadow,background-color]",
                isMobile ? "w-11 h-11 min-w-[44px] min-h-[44px]" : "w-10 h-10",
                input.trim() && !loading
                  ? "bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:-translate-y-px hover:shadow-ui-sm"
                  : "bg-canvas-sunken text-content-muted cursor-not-allowed"
              )}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
