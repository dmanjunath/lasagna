import { ChevronDown } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface ExpandButtonProps {
  expanded: boolean;
  onToggle: () => void;
  label?: string;
}

export function ExpandButton({ expanded, onToggle, label }: ExpandButtonProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-[13px] text-accent hover:text-accent/80 transition-colors"
    >
      <span>{expanded ? (label ? 'Hide' : 'Less') : (label || 'Show more')}</span>
      <ChevronDown
        className={cn(
          'w-3.5 h-3.5 transition-transform duration-200',
          expanded && 'rotate-180'
        )}
      />
    </button>
  );
}
