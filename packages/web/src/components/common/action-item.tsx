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
import { TONE_STYLE, type AreaTone } from '../../lib/action-destination';

interface ActionItemProps {
  title: string;
  tag: string;
  description: string;
  impact: string;
  impactColor: 'green' | 'amber' | 'red';
  chatPrompt: string;
  defaultOpen?: boolean;
  /**
   * The page this action belongs to, named and toned. Its tone is the row's
   * one colour: the edge, this tag and the figure all wear it. Comes from
   * `actionArea()` so the name and the colour have a single source.
   */
  area?: { label: string; tone: AreaTone };
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

// Action cards render as one accordion row per action: a scannable collapsed
// row that expands to reveal the details.
export function ActionItem(props: ActionItemProps) {
  return <AccordionActionItem {...props} />;
}

// Collapsed accordion row. Buttons stopPropagation so a click on them never
// toggles the surrounding accordion.
function DenseRowInner({
  title,
  tag,
  description,
  impact,
  impactColor,
  chatPrompt,
  area,
  onDismiss,
  onContextClick,
  expandable,
  expanded,
}: ActionItemProps & { expandable?: boolean; expanded?: boolean }) {
  const { openChat } = useChatStore();
  const cat = catForTag(tag);
  const Icon = cat.icon;

  return (
    <div className="flex items-center gap-3 pl-4 pr-2 py-2.5">
      {/* The chip wears the row's colour too. Its own category tint measured
          1.12:1 against the card, so it read as a hole punched in the row
          rather than as a mark. */}
      <span
        className="grid place-items-center h-6 w-6 shrink-0 rounded-ui-sm"
        style={
          area
            ? { background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }
            : { background: cat.tagBg, color: cat.tagFg }
        }
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      {/* Wrap fully instead of truncating: the inline impact pill squeezes the
          title, so a one-line (or even two-line) clamp cut long headings even on
          desktop where there's vertical room. Short titles still stay one line, so
          the list keeps its dense feel. */}
      {/* The impact used to be desktop-only, so the dollar figure — the reason
          to act — was missing entirely on phones. It wraps under the title
          instead of disappearing. */}
      <div className="flex-1 min-w-0">
        <h3 className="text-[14px] font-semibold leading-tight text-content">
          {title}
        </h3>
        {(area || impact) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {area && (
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none"
                style={{ background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }}
              >
                {area.label}
              </span>
            )}
            {impact && (
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none ui-tnum"
                style={
                  area
                    ? { background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }
                    : { background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }
                }
              >
                {impact}
              </span>
            )}
          </span>
        )}
      </div>


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

// Accordion — a collapsed row that expands to reveal the description + actions.
function AccordionActionItem(props: ActionItemProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const { openChat } = useChatStore();
  const cat = catForTag(props.tag);
  // The edge wears the row's colour, the same one the two pills wear. It used
  // to carry a category colour of its own while the pills carried another, so a
  // row said two different things about itself at once.
  const edge = props.area ? TONE_STYLE[props.area.tone].solid : cat.bar;
  const toggle = () => setOpen((v) => !v);
  const { title, description, impact, chatPrompt, onDismiss, onContextClick } = props;

  return (
    <article className="relative overflow-hidden rounded-ui-md border border-line bg-panel shadow-ui-sm transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-ui-md">
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: edge }} aria-hidden />

      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        // Inset ring, not `ui-focus`: that one paints an OUTWARD box-shadow and
        // the article above clips it (`overflow-hidden`), so the ring vanished
        // on a collapsed row and left a hairline across an expanded one.
        className="cursor-pointer rounded-ui-md focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]"
      >
        <DenseRowInner {...props} expandable expanded={open} />
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
            {/* Aligned to the title, not to the icon, so the body hangs under
                the row it belongs to. Capped to a readable measure: it ran ~130
                characters a line at 1280 with nothing to stop it. */}
            <div className="pl-[52px] pr-4 pb-3">
              <p className="max-w-[70ch] text-[13px] leading-[1.5] text-content-secondary">
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
