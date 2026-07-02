import { Check, X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';

interface ComparisonOption {
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  metric?: { label: string; value: string };
}

interface ComparisonCardProps {
  options: ComparisonOption[];
  onSelect?: (index: number) => void;
  selectedIndex?: number;
}

export function ComparisonCard({ options, onSelect, selectedIndex }: ComparisonCardProps) {
  return (
    <div className={cn(
      'grid gap-4',
      options.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'
    )}>
      {options.map((option, i) => (
        <button
          key={i}
          onClick={() => onSelect?.(i)}
          className={cn(
            'text-left rounded-ui-lg border p-5 transition-all duration-200',
            selectedIndex === i
              ? 'border-[rgb(var(--ui-accent))] bg-[var(--ui-accent-soft)]'
              : 'border-line hover:border-line-strong bg-canvas-sunken'
          )}
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-[16px] font-bold text-content">{option.title}</h4>
              <p className="text-[13px] text-content-secondary mt-1">{option.summary}</p>
            </div>

            <div className="space-y-2">
              {option.pros.map((pro, j) => (
                <div key={`pro-${j}`} className="flex items-start gap-2 text-[13px]">
                  <Check className="w-3.5 h-3.5 text-[rgb(var(--ui-brand-ink))] mt-0.5 flex-shrink-0" />
                  <span className="text-content-secondary">{pro}</span>
                </div>
              ))}
              {option.cons.map((con, j) => (
                <div key={`con-${j}`} className="flex items-start gap-2 text-[13px]">
                  <X className="w-3.5 h-3.5 text-[rgb(var(--ui-negative))] mt-0.5 flex-shrink-0" />
                  <span className="text-content-secondary">{con}</span>
                </div>
              ))}
            </div>

            {option.metric && (
              <div className="pt-3 border-t border-line">
                <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-content-muted">{option.metric.label}</span>
                <p className="mt-1 font-editorial text-[18px] font-extrabold tracking-[-0.01em] text-content ui-tnum">{option.metric.value}</p>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
