import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface MetricPillProps {
  value: string;
  context?: string;
}

export function MetricPill({ value, context }: MetricPillProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span className="relative inline-flex group">
      <button
        onClick={handleCopy}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md',
          'bg-accent/10 text-accent font-semibold text-[15px]',
          'hover:bg-accent/20 transition-colors cursor-pointer'
        )}
      >
        {value}
        {copied ? (
          <Check className="w-3 h-3" />
        ) : (
          <Copy className="w-3 h-3 opacity-0 group-hover:opacity-50" />
        )}
      </button>
      {context && (
        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 text-xs bg-surface-elevated text-text-muted rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          {context}
        </span>
      )}
    </span>
  );
}
