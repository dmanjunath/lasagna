/**
 * One model for an action, whichever workflow wrote it.
 *
 * Two producers write to the same table and `GET /api/insights` serves both in
 * one array: the insights engine, whose rows carry advice in words, and the
 * spend-cuts detector, whose rows carry a deterministic figure, a receipt and
 * the transactions behind it. They are completed, snoozed and dismissed the
 * same way and render as the same row, so they are normalised to one shape here
 * rather than forked per page.
 */
import {
  displayedTotal,
  isOneTime,
  monthlyCuts,
  oneTimeCuts,
  wholeMoney,
  type ActionAmount,
} from './spend-cuts';

/** The workflow behind the rows that carry figures, receipts and transactions. */
export const SPEND_CUTS_PRODUCER = 'spend-cuts';

/** How much work the action asks of the person, NOT how big its figure is. */
export type Effort = 'quick' | 'moderate' | 'involved';

/** One transaction behind a figure, as the server hydrates it. */
export interface ActionTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  /** The server derives this as `amount < 0`, which is what TxnRow expects. */
  isIncome: boolean;
}

/**
 * A row exactly as the wire serves it.
 *
 * The spend-cut fields are optional because they are null or empty on every
 * insights-engine row, so a consumer that renders only model-authored advice
 * (home, the path step panel) never names them.
 */
export interface ApiActionRow {
  id: string;
  category: string;
  urgency: string;
  effort: Effort | null;
  type: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string | null;
  generatedBy: string;
  createdAt: string;
  /** The step of the path this action serves. Null when it serves none. */
  pathStepKey: string | null;
  /** Which workflow wrote the row. Absent on a fixture that models only one. */
  producer?: string;
  monthlyValue?: number | null;
  oneTimeValue?: number | null;
  evidence?: string | null;
  transactions?: ActionTransaction[];
  txnCount?: number;
  /** What those transactions are, as a noun phrase the count line can name. */
  txnScope?: string | null;
  drill?: { label: string; href: string } | null;
}

export interface ActionRow {
  id: string;
  type: string | null;
  category: string | null;
  urgency: string;
  createdAt: string;
  title: string;
  description: string;
  chatPrompt: string;
  /** The receipt sentence. Shown at rest, and never repeated in the body. */
  evidence: string | null;
  /** The summable figure, or null on a row that has none. */
  amount: ActionAmount | null;
  /** The figure in words, for a row that has no numeric one. */
  impact: string | null;
  impactColor: 'green' | 'amber' | 'red';
  effort: Effort | null;
  transactions: ActionTransaction[];
  /** The full count behind the figure, which can exceed the rows served. */
  txnCount: number;
  /** What those transactions are, named by the server. Null on a row with none. */
  txnScope: string | null;
  drill: { label: string; href: string } | null;
}

function shared(r: ApiActionRow) {
  return {
    id: r.id,
    type: r.type,
    category: r.category,
    urgency: r.urgency,
    createdAt: r.createdAt,
    title: r.title,
    description: r.description,
    chatPrompt: r.chatPrompt ?? r.title,
    effort: r.effort,
    impactColor: (r.impactColor as 'green' | 'amber' | 'red' | null) ?? 'amber',
  };
}

/**
 * A model-authored action. It has no numeric figure, so its `impact` words are
 * what the row prints, and it has no receipt and nothing to drill into.
 */
export function fromInsight(r: ApiActionRow): ActionRow {
  return {
    ...shared(r),
    evidence: null,
    amount: null,
    impact: r.impact,
    transactions: [],
    txnCount: 0,
    txnScope: null,
    drill: null,
  };
}

/** One whole currency run, as either a title or an impact line writes it. */
const FIGURE = /\$\d[\d,]*(?:\.\d+)?[KMB]?/gi;

/**
 * What a model row's `impact` words add to its title, or null when they add
 * nothing.
 *
 * On the full surface the money pill is reserved for a summable figure, so
 * these words render as body text instead. Most of them only restate the
 * title's own figure ("$14,047 spike" under "Review the $14,047 rental property
 * maintenance spike in August"), and a line that says what the line above it
 * already said is worth nothing to read.
 *
 * The test is the figure, not the whole phrase: the words around it are a label
 * for the number, so once the title carries the number the label is a repeat.
 *
 * Whole figures are compared, never substrings: `$14,047` reads as a substring
 * of `$14,047.12`, so a title stating the cent-exact figure would swallow an
 * impact stating a different, rounded one and the row would lose it.
 */
export function impactNote(title: string, impact: string | null | undefined): string | null {
  const words = impact?.trim();
  if (!words) return null;
  const figure = words.match(FIGURE)?.[0];
  if (!figure) return words;
  const inTitle = title.match(FIGURE) ?? [];
  return inTitle.some((f) => f.toLowerCase() === figure.toLowerCase()) ? null : words;
}

/**
 * A detected saving. Its figure is a number in one period, which is what makes
 * it summable, so the `impact` words are dropped: the pill prints the figure and
 * printing both would say the same thing twice.
 */
export function fromSpendCut(r: ApiActionRow): ActionRow {
  const amount: ActionAmount | null =
    r.monthlyValue != null
      ? { value: r.monthlyValue, period: 'monthly' }
      : r.oneTimeValue != null
        ? { value: r.oneTimeValue, period: 'once' }
        : null;
  return {
    ...shared(r),
    evidence: r.evidence ?? null,
    amount,
    impact: null,
    transactions: r.transactions ?? [],
    txnCount: r.txnCount ?? 0,
    txnScope: r.txnScope ?? null,
    // Taken as given. The server already spells the scope in the names
    // /transactions reads, so there is one spelling for this destination and
    // nothing here to translate.
    drill: r.drill ?? null,
  };
}

/** One wire row, read by whichever workflow wrote it. */
export function toActionRow(r: ApiActionRow): ActionRow {
  return r.producer === SPEND_CUTS_PRODUCER ? fromSpendCut(r) : fromInsight(r);
}

const EFFORT_ORDER: Effort[] = ['quick', 'moderate', 'involved'];
const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** An unrated row sorts after every rated one rather than pretending to be quick. */
function effortRank(row: ActionRow): number {
  const i = row.effort ? EFFORT_ORDER.indexOf(row.effort) : -1;
  return i === -1 ? EFFORT_ORDER.length : i;
}

/**
 * The order the list is worked in: least work first, and inside one effort the
 * biggest figure first.
 *
 * Ranked rather than grouped. Home's actions section already set that precedent
 * for an actions list embedded on a page, and grouping a short list into bands
 * turned it into several shorter ones with a subtotal each, which is a second
 * level of arithmetic to keep adding up.
 *
 * A one-off figure is never sorted in among monthly ones by raw size: $2,900
 * back once is not a bigger monthly saving than $367 a month, and sorting them
 * together would put it above rows that measure something else.
 */
export function rankActions(rows: ActionRow[]): ActionRow[] {
  return [...rows].sort((a, b) => {
    const effort = effortRank(a) - effortRank(b);
    if (effort !== 0) return effort;

    // A row with a figure leads a row without one, inside the same effort.
    const hasFigure = Number(b.amount != null) - Number(a.amount != null);
    if (hasFigure !== 0) return hasFigure;

    if (a.amount && b.amount) {
      const period = Number(isOneTime(a)) - Number(isOneTime(b));
      if (period !== 0) return period;
      return b.amount.value - a.amount.value;
    }

    const urgency = (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0);
    if (urgency !== 0) return urgency;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * What the rows on screen come to, in one sentence, split by period.
 *
 * Every figure in it is the sum of the row pills beneath it, as those pills
 * print them, so a reader adding the list up lands on this line. The two
 * periods are stated apart and NEVER added together.
 *
 * Null for fewer than two rows with a figure: a summary of one thing is that
 * thing printed twice. The count is every row shown, so it always matches the
 * screen, and a row with no figure contributes nothing to the money.
 */
export function savingsSentence(shown: ActionRow[]): string | null {
  if (shown.filter((r) => r.amount != null).length < 2) return null;

  const monthly = displayedTotal(monthlyCuts(shown));
  const once = displayedTotal(oneTimeCuts(shown));
  const figures: string[] = [];
  if (monthly > 0) figures.push(`about ${wholeMoney(monthly)} a month`);
  if (once > 0) figures.push(`about ${wholeMoney(once)} once`);
  if (figures.length === 0) return null;

  const lead = shown.length === 2 ? 'Do both of these' : `Do all ${shown.length} of these`;
  return `${lead} and you save ${figures.join(', plus ')}.`;
}
