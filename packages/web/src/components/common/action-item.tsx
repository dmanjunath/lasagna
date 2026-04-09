import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePageContext } from '../../lib/page-context';

interface ActionItemProps {
  title: string;
  tag: string;
  description: string;
  impact: string;
  impactColor: 'green' | 'amber' | 'red';
  chatPrompt: string;
  defaultOpen?: boolean;
}

const tagColors: Record<string, string> = {
  DEBT: 'text-danger',
  INVEST: 'text-success',
  TAX: 'text-warning',
  SAVINGS: 'text-warning',
};

const impactBgColors: Record<string, string> = {
  green: 'bg-success/10 text-success',
  amber: 'bg-warning/10 text-warning',
  red: 'bg-danger/10 text-danger',
};

export function ActionItem({
  title,
  tag,
  description,
  impact,
  impactColor,
  chatPrompt,
  defaultOpen = false,
}: ActionItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [done, setDone] = useState(false);
  const { openChat } = usePageContext();

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center gap-3 py-3 px-1 text-left group"
      >
        {/* Checkbox circle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDone((prev) => !prev);
          }}
          className={cn(
            'w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors',
            done
              ? 'border-success bg-success text-white'
              : 'border-border hover:border-text-muted'
          )}
        >
          {done && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        {/* Title */}
        <span
          className={cn(
            'flex-1 text-sm font-medium transition-all',
            done && 'line-through text-text-muted'
          )}
        >
          {title}
        </span>

        {/* Tag badge */}
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded transition-opacity',
            tagColors[tag.toUpperCase()] || 'text-text-muted',
            done && 'opacity-40'
          )}
        >
          {tag}
        </span>

        {/* Chevron */}
        <ChevronDown
          className={cn(
            'w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-3 pl-8 pr-1">
              <p className="text-xs text-text-secondary mb-2">{description}</p>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'text-[11px] font-semibold px-2 py-0.5 rounded-full',
                    impactBgColors[impactColor]
                  )}
                >
                  {impact}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChat(chatPrompt);
                  }}
                  className="text-xs text-accent hover:text-accent/80 font-medium transition-colors"
                >
                  Walk me through this &rarr;
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
