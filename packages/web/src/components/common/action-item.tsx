import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  X,
} from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';
import { useDensity } from '../../lib/density';

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

export function ActionItem(props: ActionItemProps) {
  const density = useDensity();
  if (density === 'dense') return <DenseActionRow {...props} />;
  if (density === 'accordion') return <AccordionActionItem {...props} />;
  return <ActionCardItem {...props} compact={density === 'compact'} />;
}

// ── Card form — comfortable (default) and compact (same anatomy, tightened) ──
function ActionCardItem({
  title,
  tag,
  description,
  impact,
  impactColor,
  chatPrompt,
  defaultOpen,
  onDismiss,
  onContextClick,
  compact,
}: ActionItemProps & { compact: boolean }) {
  // Mobile-only accordion: collapsed to tag+title on phones (stacked full cards
  // made pages 5-8 screens tall); desktop stays always-expanded.
  const [expanded, setExpanded] = useState(defaultOpen ?? false);
  const { openChat } = useChatStore();
  const cat = catForTag(tag);
  const Icon = cat.icon;

  return (
    <article
      onClick={() => { if (!expanded) setExpanded(true); }}
      className={`relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-ui-md ${
        compact ? 'p-[13px_15px] sm:p-[15px_18px]' : 'p-[20px_18px] sm:p-[22px_24px]'
      } ${expanded ? '' : 'max-sm:cursor-pointer'}`}
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

      <div className={`flex items-start sm:items-center flex-wrap sm:flex-nowrap ${compact ? 'gap-3.5' : 'gap-5'}`}>
        <div className="flex-1 min-w-0 max-sm:pr-8">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full font-extrabold uppercase tracking-[0.05em] ${
              compact ? 'h-[22px] px-2 text-[10px] mb-1.5' : 'h-[26px] px-2.5 text-[11px] mb-3'
            }`}
            style={{ background: cat.tagBg, color: cat.tagFg }}
          >
            <Icon className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
            {cat.label}
          </span>
          <h3 className={`font-editorial font-bold leading-[1.2] tracking-[-0.018em] text-content ${
            compact ? 'text-[15px] sm:text-[16px]' : 'text-[18px] sm:text-[20px]'
          }`}>
            {title}
          </h3>
          <p className={`text-content-secondary max-w-[52ch] ${
            compact ? 'mt-1 text-[13px] leading-[1.45] line-clamp-1' : 'mt-2 text-[14px] leading-[1.5] line-clamp-2'
          } ${expanded ? '' : 'max-sm:hidden'}`}>
            {description}
          </p>
        </div>

        {/* right-aligned impact — tinted by impactColor; reflows below a hairline on mobile */}
        {impact && (
          <div className={`w-full sm:w-auto sm:mt-0 sm:pt-0 border-t sm:border-t-0 border-line shrink-0 ${
            compact ? 'mt-2.5 pt-2.5' : 'mt-3.5 pt-3.5'
          } ${expanded ? '' : 'max-sm:hidden'}`}>
            <span
              className={`inline-flex items-center gap-1.5 rounded-ui-md font-editorial font-extrabold leading-[1.25] tracking-[-0.01em] ui-tnum whitespace-nowrap ${
                compact ? 'px-2 py-1 text-[13px]' : 'px-2.5 py-1.5 text-[14.5px]'
              }`}
              style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
            >
              {impact}
            </span>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 flex-wrap ${compact ? 'mt-2.5' : 'mt-5'} ${expanded ? '' : 'max-sm:hidden'}`}>
        {/* primary — Ask Lasagna (soft-pill), preserves the openChat prompt */}
        <button
          type="button"
          onClick={() =>
            openChat(
              `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\nImpact: ${impact}\n\n${chatPrompt}`
            )
          }
          className={`touch-target inline-flex items-center gap-1.5 rounded-ui-md font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow] group ${
            compact ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13.5px]'
          }`}
        >
          <Sparkles className={compact ? 'h-[14px] w-[14px]' : 'h-[15px] w-[15px]'} />
          Ask Lasagna about this
          <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
        </button>

        {onContextClick && (
          <button
            type="button"
            onClick={onContextClick}
            className={`touch-target rounded-ui-md font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors ${
              compact ? 'h-8 px-2.5 text-[12.5px]' : 'h-9 px-3 text-[13px]'
            }`}
          >
            See in context →
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className={`touch-target rounded-ui-md font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors ${
              compact ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13px]'
            }`}
          >
            Dismiss
          </button>
        )}
      </div>
    </article>
  );
}

// ── Dense form — one scannable list row per action ──
// Shared inner row so the Accordion's collapsed state is pixel-identical to
// Dense (same height, same chat button). Buttons stopPropagation so a click on
// them never toggles the surrounding accordion.
function DenseRowInner({
  title,
  tag,
  description,
  impact,
  impactColor,
  chatPrompt,
  onDismiss,
  onContextClick,
  hideActions,
  expandable,
  expanded,
}: ActionItemProps & { hideActions?: boolean; expandable?: boolean; expanded?: boolean }) {
  const { openChat } = useChatStore();
  const cat = catForTag(tag);
  const Icon = cat.icon;
  // Accordion rows expand for detail, so on phones we let the title wrap to two
  // lines (no mid-sentence cut) and move the per-row icons into the opened body,
  // leaving just the chevron. Plain dense rows keep their inline icons.
  const hideOnMobile = expandable ? 'max-sm:hidden' : '';

  return (
    <div className="flex items-center gap-3 pl-4 pr-2 py-2.5">
      <span
        className="grid place-items-center h-6 w-6 shrink-0 rounded-ui-sm"
        style={{ background: cat.tagBg, color: cat.tagFg }}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <h3 className={`flex-1 min-w-0 text-[14px] font-semibold leading-tight text-content ${expandable ? 'line-clamp-2 sm:line-clamp-1' : 'truncate'}`}>
        {title}
      </h3>

      {impact && (
        <span
          className="hidden sm:inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none ui-tnum whitespace-nowrap"
          style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
        >
          {impact}
        </span>
      )}

      {/* Collapsed only — when the accordion is open these move to dedicated
          labeled buttons in the body. */}
      {!hideActions && (
        <>
          <button
            type="button"
            aria-label="Ask Lasagna about this"
            onClick={(e) => {
              e.stopPropagation();
              openChat(
                `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\nImpact: ${impact}\n\n${chatPrompt}`
              );
            }}
            className={`touch-target grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-brand hover:bg-brand-softer transition-colors ${hideOnMobile}`}
          >
            <Sparkles className="h-4 w-4" />
          </button>

          {onContextClick && (
            <button
              type="button"
              aria-label="See in context"
              onClick={(e) => { e.stopPropagation(); onContextClick(); }}
              className={`touch-target grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-content-muted hover:bg-canvas-sunken hover:text-content transition-colors ${hideOnMobile}`}
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          )}

          {onDismiss && (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              className={`touch-target grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-content-faint hover:bg-canvas-sunken hover:text-content transition-colors ${hideOnMobile}`}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </>
      )}

      {/* Accordion affordance — points down to expand, flips up when open. */}
      {expandable && (
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-content-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      )}
    </div>
  );
}

function DenseActionRow(props: ActionItemProps) {
  const cat = catForTag(props.tag);
  return (
    <article
      title={props.description}
      className="relative overflow-hidden rounded-ui-md border border-line bg-panel shadow-ui-sm transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-ui-md"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.bar }} aria-hidden />
      <DenseRowInner {...props} />
    </article>
  );
}

// ── Accordion form — collapsed is identical to Dense (same row, same height,
// same chat button); clicking the row reveals the description underneath. ──
function AccordionActionItem(props: ActionItemProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const { openChat } = useChatStore();
  const cat = catForTag(props.tag);
  const toggle = () => setOpen((v) => !v);
  const { title, description, impact, chatPrompt, onDismiss, onContextClick } = props;

  return (
    <article className="relative overflow-hidden rounded-ui-md border border-line bg-panel shadow-ui-sm transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-ui-md">
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.bar }} aria-hidden />

      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className="cursor-pointer"
      >
        <DenseRowInner {...props} hideActions={open} expandable expanded={open} />
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-3">
              <p className="text-[13px] leading-[1.5] text-content-secondary">
                {description}
              </p>
              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() =>
                    openChat(
                      `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\nImpact: ${impact}\n\n${chatPrompt}`
                    )
                  }
                  className="touch-target inline-flex items-center gap-1.5 h-8 px-3 rounded-ui-md text-[12.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow] group"
                >
                  <Sparkles className="h-[14px] w-[14px]" />
                  Ask Lasagna about this
                  <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
                </button>

                {onContextClick && (
                  <button
                    type="button"
                    onClick={onContextClick}
                    className="touch-target h-8 px-2.5 rounded-ui-md text-[12.5px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
                  >
                    See in context →
                  </button>
                )}

                {onDismiss && (
                  <button
                    type="button"
                    onClick={onDismiss}
                    className="touch-target h-8 px-3 rounded-ui-md text-[12.5px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
