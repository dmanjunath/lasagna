import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../../lib/utils.js';

interface ActionCardProps {
  action: string;
  context?: string;
  priority?: 'high' | 'medium' | 'low';
  onClick?: () => void;
}

const priorityStyles = {
  high: 'border-[rgb(var(--ui-accent))]/30 bg-[var(--ui-accent-soft)]',
  medium: 'border-line bg-canvas-sunken',
  low: 'border-line bg-transparent',
};

export function ActionCard({ action, context, priority = 'medium', onClick }: ActionCardProps) {
  const [completed, setCompleted] = useState(false);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      setCompleted(!completed);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full text-left rounded-ui-lg border p-4 transition-all duration-200 min-h-touch',
        'hover:border-[rgb(var(--ui-accent))]/50 hover:shadow-ui-sm',
        priorityStyles[priority],
        completed && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5',
          completed ? 'bg-[rgb(var(--ui-accent))] border-[rgb(var(--ui-accent))]' : 'border-line-strong'
        )}>
          {completed ? (
            <Check className="w-3 h-3 text-white" />
          ) : (
            <ArrowRight className="w-3 h-3 text-[rgb(var(--ui-accent-ink))]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[15px] font-semibold text-content',
            completed && 'line-through'
          )}>
            {action}
          </p>
          {context && (
            <p className="text-[13px] text-content-secondary mt-1">{context}</p>
          )}
        </div>
      </div>
    </button>
  );
}
