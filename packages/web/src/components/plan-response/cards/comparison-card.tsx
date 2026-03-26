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
            'text-left rounded-xl border p-5 transition-all duration-200',
            selectedIndex === i
              ? 'border-accent bg-accent/10'
              : 'border-border hover:border-accent/50 bg-surface/30'
          )}
        >
          <div className="space-y-4">
            <div>
              <h4 className="text-[16px] font-semibold text-[#f5f5f5]">{option.title}</h4>
              <p className="text-[13px] text-[#6b6b6b] mt-1">{option.summary}</p>
            </div>

            <div className="space-y-2">
              {option.pros.map((pro, j) => (
                <div key={`pro-${j}`} className="flex items-start gap-2 text-[13px]">
                  <Check className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <span className="text-[#a3a3a3]">{pro}</span>
                </div>
              ))}
              {option.cons.map((con, j) => (
                <div key={`con-${j}`} className="flex items-start gap-2 text-[13px]">
                  <X className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <span className="text-[#a3a3a3]">{con}</span>
                </div>
              ))}
            </div>

            {option.metric && (
              <div className="pt-3 border-t border-white/5">
                <span className="response-label">{option.metric.label}</span>
                <p className="response-metric-small mt-1">{option.metric.value}</p>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
