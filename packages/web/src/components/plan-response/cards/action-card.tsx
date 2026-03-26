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
  high: 'border-accent/30 bg-accent/5',
  medium: 'border-border bg-surface/50',
  low: 'border-border/50 bg-transparent',
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
        'w-full text-left rounded-xl border p-4 transition-all duration-200',
        'hover:border-accent/50 hover:bg-accent/5',
        priorityStyles[priority],
        completed && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          'w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5',
          completed ? 'bg-accent border-accent' : 'border-border'
        )}>
          {completed ? (
            <Check className="w-3 h-3 text-white" />
          ) : (
            <ArrowRight className="w-3 h-3 text-accent" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-[15px] text-[#f5f5f5]',
            completed && 'line-through'
          )}>
            {action}
          </p>
          {context && (
            <p className="text-[13px] text-[#6b6b6b] mt-1">{context}</p>
          )}
        </div>
      </div>
    </button>
  );
}
