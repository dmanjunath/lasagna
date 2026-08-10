import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Sparkles,
  Receipt,
  Flame,
  TrendingUp,
  PiggyBank,
  CreditCard,
  Target,
} from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';

interface ActionItemProps {
  title: string;
  tag: string;
  description: string;
  impact: string;
  impactColor: 'green' | 'amber' | 'red';
  chatPrompt: string;
  defaultOpen?: boolean;
  onDismiss?: () => void;
  onContextClick?: () => void;
}

// Category (tag) → friendly label, icon, tinted tag colors, left accent bar.
// Same anatomy + tokens as the /insights action cards (see insights.tsx CATEGORY).
type CatStyle = {
  label: string;
  icon: typeof Receipt;
  tagBg: string;
  tagFg: string;
  bar: string;
};

const CATEGORY: Record<string, CatStyle> = {
  tax: { label: 'Taxes', icon: Receipt, tagBg: 'var(--ui-caution-soft)', tagFg: 'rgb(var(--ui-caution))', bar: 'var(--ui-viz-3)' },
  debt: { label: 'Debt', icon: Flame, tagBg: 'var(--ui-negative-soft)', tagFg: 'rgb(var(--ui-negative))', bar: 'var(--ui-viz-4)' },
  portfolio: { label: 'Investing', icon: TrendingUp, tagBg: 'var(--ui-info-soft)', tagFg: 'rgb(var(--ui-info))', bar: 'var(--ui-viz-2)' },
  invest: { label: 'Investing', icon: TrendingUp, tagBg: 'var(--ui-info-soft)', tagFg: 'rgb(var(--ui-info))', bar: 'var(--ui-viz-2)' },
  retirement: { label: 'Retirement', icon: Target, tagBg: 'var(--ui-brand-soft)', tagFg: 'rgb(var(--ui-brand))', bar: 'rgb(var(--ui-brand))' },
  savings: { label: 'Savings', icon: PiggyBank, tagBg: 'var(--ui-brand-soft)', tagFg: 'rgb(var(--ui-brand))', bar: 'rgb(var(--ui-brand))' },
  spending: { label: 'Spending', icon: CreditCard, tagBg: 'var(--ui-canvas-sunken)', tagFg: 'rgb(var(--ui-content-secondary))', bar: 'rgb(var(--ui-content-faint))' },
  behavioral: { label: 'Spending', icon: CreditCard, tagBg: 'var(--ui-canvas-sunken)', tagFg: 'rgb(var(--ui-content-secondary))', bar: 'rgb(var(--ui-content-faint))' },
  setup: { label: 'Setup', icon: Sparkles, tagBg: 'var(--ui-brand-soft)', tagFg: 'rgb(var(--ui-brand))', bar: 'rgb(var(--ui-brand))' },
  general: { label: 'Overview', icon: Sparkles, tagBg: 'var(--ui-canvas-sunken)', tagFg: 'rgb(var(--ui-content-secondary))', bar: 'rgb(var(--ui-content-faint))' },
};

function catForTag(tag: string): CatStyle {
  return CATEGORY[tag.toLowerCase()] ?? CATEGORY.general;
}

// impactColor (green / amber / red) → tinted impact-pill colors (matches insights).
function impactColorVar(color: 'green' | 'amber' | 'red'): string {
  if (color === 'red') return 'rgb(var(--ui-negative))';
  if (color === 'amber') return 'rgb(var(--ui-caution))';
  return 'rgb(var(--ui-positive))';
}
function impactSoftVar(color: 'green' | 'amber' | 'red'): string {
  if (color === 'red') return 'var(--ui-negative-soft)';
  if (color === 'amber') return 'var(--ui-caution-soft)';
  return 'var(--ui-positive-soft)';
}

export function ActionItem({
  title,
  tag,
  description,
  impact,
  impactColor,
  chatPrompt,
  defaultOpen,
  onDismiss,
  onContextClick,
}: ActionItemProps) {
  // Mobile-only accordion: collapsed to tag+title on phones (stacked full cards
  // made pages 5-8 screens tall); desktop stays always-expanded.
  const [expanded, setExpanded] = useState(defaultOpen ?? false);
  const { openChat } = useChatStore();
  const cat = catForTag(tag);
  const Icon = cat.icon;

  return (
    <article
      onClick={() => { if (!expanded) setExpanded(true); }}
      className={`relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-[20px_18px] sm:p-[22px_24px] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md ${expanded ? '' : 'max-sm:cursor-pointer'}`}
    >
      {/* left accent bar — tone by category */}
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.bar }} aria-hidden />

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide details' : 'Show details'}
        className="sm:hidden absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-ui-md text-content-faint"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="flex items-start sm:items-center gap-5 flex-wrap sm:flex-nowrap">
        <div className="flex-1 min-w-0 max-sm:pr-8">
          <span
            className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-[0.05em] mb-3"
            style={{ background: cat.tagBg, color: cat.tagFg }}
          >
            <Icon className="h-3 w-3" />
            {cat.label}
          </span>
          <h3 className="font-editorial text-[18px] sm:text-[20px] font-bold leading-[1.2] tracking-[-0.018em] text-content">
            {title}
          </h3>
          <p className={`mt-2 text-[14px] leading-[1.5] text-content-secondary line-clamp-2 max-w-[52ch] ${expanded ? '' : 'max-sm:hidden'}`}>
            {description}
          </p>
        </div>

        {/* right-aligned impact — tinted by impactColor; reflows below a hairline on mobile */}
        {impact && (
          <div className={`w-full sm:w-auto mt-3.5 sm:mt-0 pt-3.5 sm:pt-0 border-t sm:border-t-0 border-line shrink-0 ${expanded ? '' : 'max-sm:hidden'}`}>
            <span
              className="inline-flex items-center gap-1.5 rounded-ui-md px-2.5 py-1.5 font-editorial text-[14.5px] font-extrabold leading-[1.25] tracking-[-0.01em] ui-tnum whitespace-nowrap"
              style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
            >
              {impact}
            </span>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 mt-5 flex-wrap ${expanded ? '' : 'max-sm:hidden'}`}>
        {/* primary — Ask Lasagna (soft-pill), preserves the openChat prompt */}
        <button
          type="button"
          onClick={() =>
            openChat(
              `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\nImpact: ${impact}\n\n${chatPrompt}`
            )
          }
          className="touch-target inline-flex items-center gap-1.5 h-9 px-3.5 rounded-ui-md text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow] group"
        >
          <Sparkles className="h-[15px] w-[15px]" />
          Ask Lasagna about this
          <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
        </button>

        {onContextClick && (
          <button
            type="button"
            onClick={onContextClick}
            className="touch-target h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
          >
            See in context →
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="touch-target h-9 px-3.5 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}
