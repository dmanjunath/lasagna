import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'wouter';
import {
  ArrowRight,
  Banknote,
  ChevronDown,
  DollarSign,
  Sparkles,
  Receipt,
  Flame,
  TrendingUp,
  PiggyBank,
  CreditCard,
  Target,
} from 'lucide-react';
import { useChatStore } from '../../lib/chat-store';
import { TONE_STYLE, type AreaTone } from '../../lib/action-destination';
import { maskCurrencyInText } from '../../lib/hide-amounts';
import { amountLabel, type ActionAmount } from '../../lib/spend-cuts';
import { impactNote, type ActionTransaction, type Effort } from '../../lib/action-rows';
import { cn } from '../../lib/utils';
import { MaskedText } from '../uikit/MaskedText';
import { button } from '../uikit/Button';
import { TxnRow } from '../transactions/TransactionList';

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
   *
   * The label is omitted where every row on screen is already that page, so the
   * tag would repeat the filter chip above it once per row. The tone stays, or
   * a filtered list would repaint itself in a different set of colours.
   */
  area?: { label?: string; tone: AreaTone };
  /**
   * The row's id, for the lifecycle's focus handover. Non-visual: it lets undo
   * put focus back on the row it just restored.
   */
  rowId?: string;
  /**
   * The receipt: the counted facts behind the figure, shown AT REST, because it
   * is what makes the figure believable. Never repeated in the body.
   */
  evidence?: string;
  /**
   * The summable figure. Wins over `impact` when both are passed, and renders
   * in the same inline pill slot: the figure was deliberately moved inline so
   * it survives on phones, and a right-aligned column would re-break that.
   */
  amount?: ActionAmount;
  /**
   * How much work the action asks for. No pill at all when it is not passed:
   * an unrated action must not be presented as a quick one.
   */
  effort?: Effort;
  /** The transactions behind the figure, largest first, at most three. */
  transactions?: ActionTransaction[];
  /** How many there are in total, which can exceed the rows served. */
  txnCount?: number;
  /**
   * What those transactions ARE, as the server names them. The count line
   * prints it, so the rows' scope cannot be mistaken for the figure's.
   */
  txnScope?: string;
  /** Where this action opens, named by the server or by the area it belongs to. */
  destination?: { label: string; href: string };
  /**
   * The complete rendering, as /spending and /insights pass it (the same flag
   * PageActions gates its full surface on).
   *
   * It only widens the body below `sm`, and only because these rows carry
   * embedded transactions that cannot spare 52px of a 390px screen. The pages
   * that embed a short list of model-authored advice have no such rows, so they
   * keep the indent they have and stay visually unchanged by this.
   */
  full?: boolean;
  onComplete?: () => void;
  onSnooze?: () => void;
  onDismiss?: () => void;
  onContextClick?: () => void;
}

// Category (tag) → friendly label, icon, tinted tag colors, left accent bar.
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

// impactColor (green / amber / red) → tinted impact-pill colors.
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

const EFFORT_LABEL: Record<Effort, string> = {
  quick: 'Quick',
  moderate: 'Moderate',
  involved: 'Involved',
};

/**
 * What the count line says, once.
 *
 * The full count lives here rather than in a second "and 11 more" line under
 * the block, so the list says what it is showing three of in the same breath as
 * it says how many there are.
 *
 * It names the scope where the server gave one. The pill is the excess over
 * this household's own typical month while the rows beneath it are the whole
 * month's spend, so "The 3 transactions behind this" under a $367 pill, over
 * rows summing to $780.34, made two correct numbers look like a contradiction.
 */
function txnCountLine(shown: number, total: number, scope?: string): string {
  if (total <= 1) return 'The transaction behind this';
  const what = scope ?? 'transactions behind this';
  if (total > shown) return `The ${total} ${what}, largest first`;
  return `The ${total} ${what}`;
}

/**
 * The figure a row prints in its money pill, or null.
 *
 * ON THE FULL SURFACE A PILL IS A SUMMABLE FIGURE. The sentence above the list
 * is the sum of exactly these pills, so anything outside that sum must not wear
 * their paint: `$14,047 spike` did, in the same sky tint at the same weight,
 * and it was the largest number on screen, sat in neither total, described a
 * spend rather than a saving, and its own body said no action was needed. A
 * reader adding the pills up got a different answer from the sentence.
 *
 * The reduced surface has no sentence and no numeric figures at all, so its
 * rows keep printing the model's words there.
 */
function rowFigure(
  { amount, impact, full }: Pick<ActionItemProps, 'amount' | 'impact' | 'full'>,
): string | null {
  if (amount) return amountLabel(amount);
  return full ? null : impact || null;
}

// Action cards render as one accordion row per action: a scannable collapsed
// row that expands to reveal the details.
export function ActionItem(props: ActionItemProps) {
  return <AccordionActionItem {...props} />;
}

// One quiet verb in the expanded body. All three share it, so the set reads as
// one control group rather than three buttons that happen to sit together.
function VerbButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // These carried no resting border or fill, so they read as plain text
      // sitting beside the real button. The inset ring is the row header's.
      className="touch-target h-9 px-3 rounded-ui-md border border-line bg-canvas-sunken text-[12.5px] font-semibold text-content-secondary hover:border-line-strong hover:text-content hover:shadow-ui-sm transition-[color,border-color,box-shadow] focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]"
    >
      {label}
    </button>
  );
}

// Collapsed accordion row.
function DenseRowInner({
  title,
  tag,
  impact,
  impactColor,
  area,
  evidence,
  amount,
  effort,
  full,
  expandable,
  expanded,
}: ActionItemProps & { expandable?: boolean; expanded?: boolean }) {
  const cat = catForTag(tag);
  const Icon = cat.icon;
  const figure = rowFigure({ amount, impact, full });
  // What the model's words add to the title, where they add anything at all.
  // Body text, because they are not a summable figure, and dropped entirely
  // where they only restate the title's own number.
  const subtitle = evidence ?? (full ? impactNote(title, impact) : null);
  const areaLabel = area?.label;

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
          <MaskedText text={title} />
        </h3>
        {/* The receipt sits between the heading and the figure, which is the
            order it is read in: what the claim is, what was counted, what it
            comes to. */}
        {subtitle && (
          <p className="mt-1 max-w-[70ch] break-words text-[12.5px] leading-[1.45] text-content-secondary">
            <MaskedText text={subtitle} />
          </p>
        )}
        {(areaLabel || figure || effort) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {areaLabel && (
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none"
                style={{ background: TONE_STYLE[area!.tone].soft, color: TONE_STYLE[area!.tone].ink }}
              >
                {areaLabel}
              </span>
            )}
            {figure && (
              // No `whitespace-nowrap`: the card clips its overflow, so a long
              // figure was guillotined mid-word on a phone rather than wrapping.
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none ui-tnum"
                style={
                  area
                    ? { background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }
                    : { background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }
                }
              >
                <MaskedText text={figure} />
              </span>
            )}
            {/* Quiet and neutral on purpose. It measures how much work the
                change is, not how much it is worth, so it must not compete with
                the figure beside it for the row's one colour. */}
            {effort && (
              <span className="inline-flex items-center rounded-ui-sm bg-canvas-sunken px-2 py-0.5 text-[12.5px] font-semibold leading-none text-content-secondary">
                {EFFORT_LABEL[effort]}
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
  const {
    title,
    description,
    impact,
    amount,
    chatPrompt,
    rowId,
    transactions,
    txnCount,
    txnScope,
    destination,
    onComplete,
    onSnooze,
    onDismiss,
    onContextClick,
    full,
  } = props;
  const txns = transactions ?? [];
  const total = txnCount ?? txns.length;
  const figure = rowFigure(props);
  const name = maskCurrencyInText(
    full
      ? [title, figure, props.effort && EFFORT_LABEL[props.effort]].filter(Boolean).join(', ')
      : title,
  );
  // A lone dismiss is a generic one. Beside "Mark complete" it is the other answer
  // to the same question, so it says which answer it is.
  const dismissLabel = onComplete || onSnooze ? 'Not for me' : 'Dismiss';

  return (
    <article
      data-action-id={rowId}
      className="relative overflow-hidden rounded-ui-md border border-line bg-panel shadow-ui-sm transition-[box-shadow,border-color] hover:border-line-strong hover:shadow-ui-md"
    >
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: edge }} aria-hidden />

      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        // Without this the name is the row's whole text content, so a screen
        // reader read "…back to normalSpending$14,047 spike" as one word. Masked
        // like the visible title: the raw one carries figures that privacy mode
        // exists to keep out of earshot as well as out of sight.
        //
        // The figure and the effort are in the name on the full surface, where
        // the title alone had a reader tab past seven actions and hear no money
        // and no idea which one was the quick win. The pages that embed a short
        // list of advice are unchanged by this work, so their name stays the
        // title.
        aria-label={name}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        // Inset ring, not `ui-focus`: that one paints an OUTWARD box-shadow and
        // the article above clips it (`overflow-hidden`), so the ring vanished
        // on a collapsed row and left a hairline across an expanded one.
        //
        // `active:` is the only feedback a tap gets: there is no hover on a
        // phone, so without it a press looks like nothing happened.
        className="cursor-pointer rounded-ui-md transition-colors focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)] active:bg-canvas-sunken"
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
                characters a line at 1280 with nothing to stop it.
                On the full rendering it drops to the card's own padding below
                `sm`, or the embedded transaction rows would lose 52px of a
                390px screen. Nowhere else, so the pages that embed a short list
                of advice keep the indent they already have. */}
            <div className={full ? 'pl-4 pr-4 pb-3 sm:pl-[52px]' : 'pl-[52px] pr-4 pb-3'}>
              <p className="max-w-[70ch] text-[13px] leading-[1.5] text-content-secondary">
                <MaskedText text={description} />
              </p>

              {txns.length > 0 && (
                <>
                  {/* Said once, here. A second "and 11 more" line under the
                      block would state the same count twice. */}
                  <p className="mt-2.5 text-[12px] font-medium text-content-muted">
                    {txnCountLine(txns.length, total, txnScope)}
                  </p>
                  {/* Presentational. No `onOpenDetail`: this page does not mount
                      the transaction drawer, and an overlay opening from inside
                      an accordion is a second layer over the one below it. */}
                  <div className="mt-1.5 overflow-hidden rounded-ui-md border border-line bg-canvas-sunken">
                    {txns.map((t) => (
                      <TxnRow
                        key={t.id}
                        merchant={t.merchant}
                        icon={t.isIncome ? <DollarSign size={15} /> : <Banknote size={15} />}
                        isIncome={t.isIncome}
                        categoryNode={null}
                        date={t.date}
                        amount={t.amount}
                      />
                    ))}
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                {/* Offered only where there is somewhere to go. The label is
                    composed with the href, so the two cannot disagree. */}
                {destination && (
                  // ONE element, not `<Link><Button>`: that emitted `<a><button>`,
                  // which is invalid HTML, two tab stops for one control, and an
                  // outer anchor painted in the UA's default blue.
                  //
                  // The Button's own `whitespace-nowrap` is dropped here. The card
                  // clips its overflow, so a real category name ("Rental Property
                  // Maintanance & Improvements") pushed this 157px past the card's
                  // edge on a 390px screen: the label cut mid-word and the arrow
                  // gone. It wraps instead, which is why the height is free.
                  <Link
                    href={destination.href}
                    className={cn(
                      button({ size: 'sm' }),
                      'min-w-0 max-w-full whitespace-normal h-auto min-h-9 py-2 text-left',
                    )}
                  >
                    {destination.label}
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                )}

                {/* Steps back where the row has somewhere to go: two brand-soft
                    pills side by side gave one row two primary controls and
                    neither read as the thing to press. */}
                <button
                  type="button"
                  onClick={() =>
                    openChat(
                      `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\nImpact: ${amount ? amountLabel(amount) : impact}\n\n${chatPrompt}`
                    )
                  }
                  // Same inset ring as the row header and the three verbs. Both
                  // shapes of this control carried no focus style at all, so a
                  // keyboard user got the UA's blue outline.
                  className={cn(
                    'focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]',
                    destination
                      ? 'touch-target inline-flex items-center gap-1.5 h-9 px-2.5 rounded-ui-md border border-line bg-canvas-sunken text-[12.5px] font-semibold text-content-secondary hover:border-line-strong hover:text-brand hover:shadow-ui-sm transition-[color,border-color,box-shadow] group'
                      : 'touch-target inline-flex items-center gap-1.5 h-9 px-3 rounded-ui-md text-[12.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow] group',
                  )}
                >
                  <Sparkles className="h-[14px] w-[14px]" />
                  Ask Lasagna about this
                  <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
                </button>

                {onContextClick && (
                  <button
                    type="button"
                    onClick={onContextClick}
                    className="touch-target h-9 px-2.5 rounded-ui-md border border-line bg-canvas-sunken text-[12.5px] font-semibold text-content-secondary hover:border-line-strong hover:text-content hover:shadow-ui-sm transition-[color,border-color,box-shadow]"
                  >
                    See in context →
                  </button>
                )}

                {/* A verb with no handler renders no button. */}
                {onComplete && <VerbButton label="Mark complete" onClick={onComplete} />}
                {onSnooze && <VerbButton label="Snooze a month" onClick={onSnooze} />}
                {onDismiss && <VerbButton label={dismissLabel} onClick={onDismiss} />}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}
