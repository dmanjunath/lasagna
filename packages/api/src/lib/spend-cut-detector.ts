// Ways to spend less: deterministic detection, and nothing else. No database,
// no network, no model.
//
// Being pure is what makes this testable, and testable is the only real defence
// against a page of confidently wrong money advice. It is also the boundary a
// later slice depends on: a model may reorder these findings and rewrite their
// wording, but every figure and every size comes from here, so two households
// with the same overdraft fee get the same letter and the same subtotal.

export type SpendCutKind =
  | "fee"
  // A fee charged ONCE. Its own kind, not a flag on `fee`, because the figure
  // it carries is money back once and not money back every month, and the page
  // has to be able to keep it out of a total labelled "a month".
  | "one_time_fee"
  | "price_increase"
  | "duplicate_service"
  | "category_above_trend";
export type SpendCutSize = "s" | "m" | "l";

/** One expense transaction, as the generator reads it out of the database. */
export interface DetectorTxn {
  id: string;
  date: Date;
  name: string;
  merchantName: string | null;
  /** Positive = money out. The generator filters inflows out before this. */
  amount: number;
  categoryId: string | null;
  /** The household's own label for the category, e.g. "Dining Out". */
  categoryName: string | null;
  categorySystemKey: string | null;
  plaidCategoryDetailed: string | null;
}

export interface AnalysisWindow {
  start: Date;
  end: Date;
  /** Complete calendar months covered. Never 0 — the generator returns early. */
  months: number;
}

export interface SpendCutFinding {
  findingKey: string;
  kind: SpendCutKind;
  size: SpendCutSize;
  title: string;
  description: string;
  evidence: string;
  /**
   * The row's own figure. A saving per month on every kind but `one_time_fee`,
   * where it is the whole amount, recovered once. `kind` is what says which,
   * and the page prints the period beside the figure from it, so a one-off can
   * never be added into a total labelled "a month".
   */
  monthlySaving: number;
  annualSaving: number | null;
  claimKey: string | null;
  categoryId: string | null;
  /**
   * The household's own label for that category, carried alongside the id so a
   * reader can name it without a second lookup. Only a category finding has
   * one.
   */
  categoryName?: string | null;
  merchantName: string | null;
  txnIds: string[];
}

// The letter is a property of the KIND, not of the row, so it cannot be argued
// case by case and cannot drift between two households with the same finding.
// It reads the size of the change asked of the person, not the size of the
// saving: the dollar figure is already on every row.
const SIZE_BY_KIND: Record<SpendCutKind, SpendCutSize> = {
  // One call, and nothing to decide first.
  fee: "s",
  // The same one call.
  one_time_fee: "s",
  // One call, or one decision about one line item. Either way it is one thing.
  price_increase: "s",
  // A decision comes first: which of the two goes.
  duplicate_service: "m",
  // Nothing to cancel and nobody to call. A month of different choices.
  category_above_trend: "l",
};

// ── Small deterministic helpers ───────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "$1,234.50". Written by hand rather than via Intl so it cannot shift with a locale. */
function money(n: number): string {
  const [whole, cents] = Math.abs(round2(n)).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/**
 * "$1,234". The same whole dollars the page prints on a row, so a receipt that
 * restates a row's own figure spells it the way the row does.
 */
function wholeMoney(n: number): string {
  return `$${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** UTC throughout, so the month a figure is labelled with never depends on the server's zone. */
function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * "Apr 16, 2026" — the format every other date on screen uses.
 *
 * A receipt exists to be matched against the transactions it links to, and a
 * date spelled a way nothing else in the app spells it cannot be matched at a
 * glance.
 */
function dayLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The first instant of the calendar month `offset` months from `d`. UTC, like every date here. */
function monthStart(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Lowercase, drop punctuation, collapse runs of whitespace. Keeps word boundaries. */
function normalizeText(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The key a merchant is grouped under. Same as normalizeText, then truncated:
 * long descriptors ("SQ *THE COFFEE PLACE 0093 SAN FRA") carry a store number
 * and a city that differ charge to charge, and 40 characters is past the name.
 */
export function normalizeMerchant(raw: string): string {
  return normalizeText(raw).slice(0, 40).trim();
}

// ── Recurring merchants ───────────────────────────────────────────────────

export interface RecurringMerchant {
  norm: string;
  /** The label as the most recent charge shows it, for display. */
  merchantName: string;
  /** Chronological. */
  amounts: number[];
  dates: Date[];
  txnIds: string[];
  median: number;
  latest: number;
  categoryId: string | null;
}

const RECURRING_MIN_CHARGES = 3;
const RECURRING_MIN_GAP_DAYS = 25;
const RECURRING_MAX_GAP_DAYS = 35;
const RECURRING_AMOUNT_TOLERANCE = 0.25;

/**
 * Merchants charging a steady amount on a monthly cycle.
 *
 * Calendar-independent on purpose. A subscription that bills on the 2nd and
 * then the 1st is the same subscription, and keying off calendar months would
 * mean this found nothing until a household had a year of history — at signup
 * Plaid hands over roughly 90 days, which is exactly three charges. 25 to 35
 * days is a monthly cycle as a bank actually posts it.
 *
 * Every consecutive gap has to qualify, not most of them. A merchant the person
 * also shops at ad hoc breaks the run and is dropped, which is the right way to
 * be wrong: a missed suggestion costs nothing, a wrong one costs trust.
 */
export function recurringMerchants(txns: DetectorTxn[]): RecurringMerchant[] {
  const groups = new Map<string, DetectorTxn[]>();
  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    const norm = normalizeMerchant(t.merchantName ?? t.name);
    if (!norm) continue;
    const g = groups.get(norm);
    if (g) g.push(t);
    else groups.set(norm, [t]);
  }

  const out: RecurringMerchant[] = [];
  for (const [norm, rows] of groups) {
    if (rows.length < RECURRING_MIN_CHARGES) continue;
    const sorted = [...rows].sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id),
    );

    let cadenceHolds = true;
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].date, sorted[i].date);
      if (gap < RECURRING_MIN_GAP_DAYS || gap > RECURRING_MAX_GAP_DAYS) {
        cadenceHolds = false;
        break;
      }
    }
    if (!cadenceHolds) continue;

    const amounts = sorted.map((t) => t.amount);
    const med = median(amounts);
    if (med <= 0) continue;
    if (amounts.some((a) => Math.abs(a - med) > med * RECURRING_AMOUNT_TOLERANCE)) continue;

    const last = sorted[sorted.length - 1];
    out.push({
      norm,
      merchantName: last.merchantName ?? last.name,
      amounts,
      dates: sorted.map((t) => t.date),
      txnIds: sorted.map((t) => t.id),
      median: round2(med),
      latest: round2(last.amount),
      categoryId: last.categoryId,
    });
  }
  return out.sort((a, b) => a.norm.localeCompare(b.norm));
}

// ── Fees ──────────────────────────────────────────────────────────────────

interface FeeType {
  type: string;
  /** Singular. Every one of these pluralizes with a plain "s". */
  noun: string;
  /** Absent on the generic fallback, which is reached by category rather than by name. */
  match?: RegExp;
  /** `{fee}` is replaced with the correctly counted noun. */
  title: string;
  advice: string;
}

// Matched in order, first hit wins, against the transaction's name and merchant
// run through normalizeText.
const FEE_TYPES: FeeType[] = [
  {
    type: "overdraft",
    noun: "overdraft fee",
    match: /overdraft/,
    title: "Ask your bank to refund the {fee} and link a savings account as cover",
    advice:
      "Banks reverse these on request more often than people expect. The linked account covers a shortfall out of your own savings, so the next one does not have to become a fee.",
  },
  {
    type: "nsf",
    noun: "insufficient funds fee",
    match: /\bnsf\b|insufficient funds/,
    title: "Ask your bank to refund the {fee} and link a savings account as cover",
    advice:
      "A payment bounced. Ask for the charge back, then move that payment to just after payday so it clears.",
  },
  {
    type: "atm",
    noun: "ATM fee",
    match: /atm fee/,
    title: "Use an in network machine, or take cash back at a checkout",
    advice:
      "Neither normally charges you anything. Many banks also refund a couple of these a month if you ask, so the ones already paid are worth a call.",
  },
  {
    type: "foreign_transaction",
    noun: "foreign transaction fee",
    match: /foreign transaction/,
    title: "Use a card with no {fee}",
    advice:
      "Plenty of cards charge nothing for the same purchase abroad, so the whole fix is which card you reach for on the next trip.",
  },
  {
    type: "late",
    noun: "late fee",
    match: /late fee/,
    title: "Turn on autopay for at least the minimum",
    advice:
      "That is what stops the next one. Card issuers often drop a first late fee if you ask, so it is worth asking for this one back on the same call.",
  },
  {
    type: "maintenance",
    noun: "maintenance fee",
    match: /maintenance fee/,
    title: "Ask your bank to waive the {fee}",
    advice:
      "Most banks drop this for a direct deposit or a minimum balance, and accounts without one are easy to find.",
  },
  {
    type: "service_charge",
    noun: "service charge",
    match: /service charge/,
    title: "Ask your bank to waive the {fee}",
    advice:
      "Ask what the charge is for and what removes it. It is normally a condition on the account you can meet or switch away from.",
  },
  {
    type: "over_limit",
    noun: "over limit fee",
    match: /over limit/,
    title: "Ask your bank to refund the {fee}",
    advice:
      "Asking for a higher limit, or turning off over limit spending, stops this one repeating.",
  },
];

// A charge the taxonomy or Plaid calls a fee but no keyword names.
const GENERIC_FEE: FeeType = {
  type: "bank",
  noun: "bank fee",
  title: "Ask your bank to refund the {fee}",
  advice:
    "Ask what the charge was for and whether it can be reversed. Some of these are penalties a bank will drop on request, and others are account conditions you can change instead.",
};

const FEE_MIN_OCCURRENCES = 2;
const FEE_SINGLE_MIN_AMOUNT = 25;

function classifyFee(t: DetectorTxn): FeeType | null {
  const text = normalizeText(`${t.name} ${t.merchantName ?? ""}`);
  for (const f of FEE_TYPES) if (f.match!.test(text)) return f;
  if (t.categorySystemKey === "bank_fees") return GENERIC_FEE;
  if (t.plaidCategoryDetailed?.startsWith("BANK_FEES_")) return GENERIC_FEE;
  return null;
}

/**
 * Fees the household paid in the window, grouped by what kind of fee it is.
 *
 * The highest-value thing this feature does. "$35 overdraft, three times since
 * June" is money a person can usually get back by making one phone call.
 *
 * A fee seen ONCE comes back as `one_time_fee` and keeps its whole amount,
 * where a fee seen twice or more is a habit of the account and is stated per
 * month. This is the one place the distinction can be made, and it has to be
 * made: dividing a single $2,900 charge by an eight month window is true
 * arithmetic that produces "$363 a month", which is a refund the household gets
 * once described as one they get every month, and it lands in a headline that
 * says "a month". Getting the $2,900 back is worth more than everything else
 * this page finds put together, so the answer is to state it as what it is, not
 * to drop it.
 */
export function detectFees(txns: DetectorTxn[], window: AnalysisWindow): SpendCutFinding[] {
  const byType = new Map<string, { fee: FeeType; rows: DetectorTxn[] }>();
  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    const fee = classifyFee(t);
    if (!fee) continue;
    const bucket = byType.get(fee.type);
    if (bucket) bucket.rows.push(t);
    else byType.set(fee.type, { fee, rows: [t] });
  }

  const out: SpendCutFinding[] = [];
  for (const { fee, rows } of byType.values()) {
    const sorted = [...rows].sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id),
    );
    const amounts = sorted.map((t) => round2(t.amount));
    const total = round2(amounts.reduce((s, a) => s + a, 0));
    const oneTime = sorted.length < FEE_MIN_OCCURRENCES;
    // Twice is a pattern. Once is only worth saying if it was worth real money.
    if (oneTime && total < FEE_SINGLE_MIN_AMOUNT) continue;

    const n = sorted.length;
    const label = n === 1 ? fee.noun : `${fee.noun}s`;
    const first = sorted[0];
    const last = sorted[n - 1];
    const allSame = amounts.every((a) => a === amounts[0]);
    const saving = oneTime ? total : round2(total / window.months);
    // The division, written out. A monthly figure the reader cannot check is a
    // figure they have to take on trust, and the window length is stated
    // nowhere else on a page that has findings.
    const bridge =
      window.months > 1
        ? ` That is about ${wholeMoney(saving)} a month across ${window.months} months.`
        : "";
    const evidence = oneTime
      ? `One ${fee.noun} of ${money(amounts[0])} on ${dayLabel(first.date)}.`
      : allSame
        ? `${n} ${label} of ${money(amounts[0])} since ${monthLabel(first.date)}.${bridge}`
        : `${n} ${label} totalling ${money(total)} since ${monthLabel(first.date)}.${bridge}`;

    // One merchant behind every charge means we can name the bank. Several
    // means we cannot, and saying nothing beats naming the wrong one.
    const merchants = new Set(sorted.map((t) => normalizeMerchant(t.merchantName ?? t.name)));
    out.push({
      // A separate key, so a fee that starts happening twice replaces the
      // one-off row rather than upserting a new meaning into it.
      findingKey: oneTime ? `fee_once:${fee.type}` : `fee:${fee.type}`,
      kind: oneTime ? "one_time_fee" : "fee",
      size: SIZE_BY_KIND.fee,
      title: fee.title.replace("{fee}", label),
      description: fee.advice,
      evidence,
      monthlySaving: saving,
      annualSaving: null,
      claimKey: null,
      categoryId: last.categoryId,
      merchantName: merchants.size === 1 ? (last.merchantName ?? last.name) : null,
      txnIds: sorted.map((t) => t.id),
    });
  }
  return out;
}

// ── The remedy catalog ────────────────────────────────────────────────────
//
// What to DO, curated by hand, and it is the row's TITLE. A title that names
// the move is the difference between "Dining Out was above your usual", which
// is an observation, and something a reader can act on without opening
// anything.
//
// THE RULE THAT KEEPS THIS HONEST: a remedy may carry a figure only when that
// figure came out of the household's own transactions. "Bundle Disney Plus and
// Hulu on one plan" is sayable, because both names came from their statement.
// "Save 40% by bundling" is not, and the figure guard in spend-cuts.ts cannot
// catch it: an invented discount is not a number about the user at all, so
// there is nothing for it to disagree with. So where an option is known to
// exist but its price is not, the option is named WITHOUT a number. Still
// useful, and honest.
//
// Small and correct beats large and approximate. A wrong remedy is worse than
// none, so an offering only appears here when it is a standing part of how the
// service is sold rather than a promotion that could lapse, and anything short
// of that falls back to the generic wording.
//
// TWO CLASSES OF REMEDY, AND THE SECOND ONE NEEDS EVIDENCE. Every entry below
// is one or the other, and which one it is has to be decided before it is
// written, not argued about afterwards.
//
//   CLASS 1, a move the reader can simply make. Cancel, downgrade, switch to a
//   different card, use a different machine, take cash back, turn on autopay,
//   move onto a plan that is known to exist. Nobody has to agree to any of it,
//   so it is safe to state for any merchant.
//
//   CLASS 2, a move that only works if THE OTHER PARTY AGREES. Refund a fee,
//   waive a charge, restore an old rate, hand over a retention discount. This
//   may only be stated for a merchant, or a kind of business, where it is
//   verifiably common practice. It is never the default and it is never
//   inferred from a merchant we know nothing about.
//
// The trap this cost us is the fixed-price consumer subscription. Spotify has
// no retention desk and no rate to restore: you pay the new price, change plan,
// or leave. "Ask Spotify for the rate you were paying before" reads as
// confident advice and sends the reader to do something that cannot work, which
// costs more trust than saying nothing would have. So the class 2 wording sits
// behind an explicit list, and every merchant not on it gets a class 1 move.
//
// ADDING AN ENTRY: say which class it is. If it is class 2, the list it goes on
// is the evidence, so put it on one.

/** Pairs sold together as one named bundle. Normalized merchant fragments. */
const BUNDLED_PAIRS: Array<{ a: string; b: string; bundle: string }> = [
  { a: "disney plus", b: "hulu", bundle: "the Disney Bundle" },
  { a: "disneyplus", b: "hulu", bundle: "the Disney Bundle" },
  { a: "paramount plus", b: "showtime", bundle: "the Paramount Plus with Showtime plan" },
];

/**
 * Services that sell a family or duo plan covering several people. Keyed by
 * merchant rather than by family, because a family is only as true as its
 * weakest member: cloud storage holds Backblaze, which is priced per computer
 * and has no such plan, so a family-wide rule would produce a wrong remedy for
 * any pair it appeared in.
 */
const FAMILY_PLAN_SERVICES = [
  "spotify",
  "apple music",
  "youtube music",
  "amazon music",
  "tidal",
  "deezer",
  "pandora",
  "google one",
  "icloud",
  "dropbox",
  "onedrive",
];

/**
 * Merchants that bill yearly as a standing option. Named without a price: what
 * annual billing costs at any of them is their number, not the household's.
 */
const ANNUAL_BILLING_MERCHANTS = [
  "disney plus",
  "disneyplus",
  "dropbox",
  "google one",
  "new york times",
  "nytimes",
  "wall street journal",
  "the economist",
];

/**
 * CLASS 2. The only merchants a remedy may ask to move on price.
 *
 * Every entry is a business that runs a retention desk as a standing part of
 * how it sells: a named team, or a documented save offer, that a customer
 * threatening to leave is routed to. Nothing here is a guess about a category,
 * and a merchant we know nothing about never lands here by accident.
 *
 * DELIBERATELY ABSENT: the taxonomy's `insurance` category key, which looked
 * like the tidy way to cover insurers. It is not. Pet insurance is filed under
 * it and prices on the animal's age, so there is no old rate to restore and no
 * desk to ask, and one real household's statement already had exactly that on
 * it. Insurers are listed by name instead.
 */
const NEGOTIABLE_RATE_MERCHANTS = [
  // Mobile carriers. Postpaid only: a prepaid brand sells one published price
  // and has nobody to route a save offer through.
  "verizon", "^at t", "att", "t mobile", "tmobile", "us cellular",
  // Cable, satellite and broadband. The retention desk is close to an industry
  // norm here, and a promotional rate rolling off is the usual cause of the
  // rise in the first place.
  "comcast", "xfinity", "spectrum", "charter communications", "cox communications",
  "altice", "centurylink", "frontier communications", "windstream", "mediacom",
  "dish network", "directv", "direct tv",
  // Insurers, by name. Re-rating a policy and applying a discount that was
  // never added is ordinary work for an agent.
  "geico", "progressive", "state farm", "allstate", "usaa", "liberty mutual",
  "farmers insurance", "nationwide",
  // Gyms. The save offer at the cancellation counter is the business model.
  // Fitness APPS are not here: nobody at a workout app negotiates.
  "planet fitness", "la fitness", "24 hour fitness", "gold s gym", "equinox",
  "crunch fitness", "anytime fitness", "lifetime fitness", "life time fitness",
  "orangetheory",
  // Publishers that answer a cancellation with an offer rather than a form.
  "new york times", "nytimes", "wall street journal", "washington post",
  "the economist",
];

/**
 * Whether `norm` carries `fragment` as WHOLE WORDS. A leading `^` narrows that
 * to the START of the name.
 *
 * The lists above match with a plain `includes`, which is safe for a name as
 * distinctive as "planet fitness". It is not safe here. Punctuation is stripped
 * before matching, so "AT&T" normalizes to "at t", which is a substring of
 * "flat tire" and a whole-word run inside "payment at t j maxx". A remedy that
 * tells somebody to ring their tire shop for a better rate is precisely the
 * failure this list exists to prevent, so that one entry is anchored: every
 * real AT&T descriptor opens with it, and no sentence about a shop does.
 */
function mentions(norm: string, fragment: string): boolean {
  if (fragment.startsWith("^")) {
    const head = fragment.slice(1);
    return norm === head || norm.startsWith(`${head} `);
  }
  return (
    norm === fragment ||
    norm.startsWith(`${fragment} `) ||
    norm.endsWith(` ${fragment}`) ||
    norm.includes(` ${fragment} `)
  );
}

/** The one gate on class 2 wording in a price remedy. */
const negotiatesRate = (norm: string) =>
  NEGOTIABLE_RATE_MERCHANTS.some((m) => mentions(norm, m));

/** The wording each remedy is written in. `{a}`, `{b}` and the rest are filled in below. */
const REMEDY_COPY = {
  // CLASS 2. Reached only for a merchant on NEGOTIABLE_RATE_MERCHANTS.
  price_increase_negotiable: {
    title: "Ask {merchant} for the rate you were paying before",
    detail: "Ask to go back to {old} a month. If they will not move, ask what their cheapest plan is and price up leaving while you are on the call.",
  },
  // CLASS 2, for a merchant that both negotiates and sells a yearly plan.
  price_increase_negotiable_annual: {
    title: "Ask {merchant} for your old rate, or switch to annual billing",
    detail: "Ask to go back to {old} a month. {merchant} also bills yearly, so price that up on the same call.",
  },
  // CLASS 1 from here down. Every move below is one the reader makes on their
  // own, and none of them needs anybody at the merchant to say yes.
  price_increase_annual: {
    title: "Switch {merchant} to annual billing",
    detail: "{merchant} bills yearly as well as monthly, so price the annual plan up before you pay {new} again. If it comes out no cheaper, the question is whether it is still worth that.",
  },
  price_increase_family_plan: {
    title: "Move {merchant} onto a family plan",
    detail: "{merchant} sells a plan that covers several people on one bill. If anyone in the household would share it, that is a cheaper way to keep {merchant} than paying {new} alone. If nobody would, the question is whether it is still worth that.",
  },
  // The honest default, and the one most merchants get. It promises nothing
  // about the merchant at all. Both figures in it are the household's own, and
  // the decision it asks for is real: a fixed price you keep paying is a choice
  // whether or not anyone makes it deliberately.
  price_increase_decide: {
    title: "Decide whether {merchant} is still worth {new} a month",
    detail: "The charge stays at {new} until you change plan or cancel, and neither of those needs anyone's agreement. So the real question is whether it is worth that now, not whether it was worth {old}.",
  },
  duplicate_bundle: {
    title: "Move {a} and {b} onto {bundle}",
    detail: "{a} and {b} are sold together as {bundle}, so one plan can cover both. The figure here is what {b} costs on its own today.",
  },
  duplicate_family_plan: {
    title: "Move {a} and {b} onto a single family plan",
    detail: "{a} and {b} each sell a family plan that covers several people, so one of them can replace the pair. The figure here is what {b} costs on its own today.",
  },
  duplicate_generic: {
    title: "Cancel {a} and keep {b}",
    detail: "Two {label} subscriptions bill every month. {b} is the cheaper one and the figure here is its price, so dropping either saves at least this much.",
  },
  // No remedy. This kind is an awareness nudge and nothing else: see
  // detectCategoryAboveTrend for why nobody here gets to say what a household
  // ought to spend on groceries. The move it does offer is the only honest one,
  // which is to go and look.
  //
  // NOT "Keep an eye on {category}", which is how a reader would say it and was
  // the first wording here. /insights bands its rows under three headings and
  // the quietest of them is called "Keep an eye on", so four rows titled that
  // way landed under a DIFFERENT heading with the band's own words on them, and
  // the page said the same phrase twice meaning two things.
  category_above_trend: {
    title: "Check what drove {category} up",
    detail: "The figure beside this row is the gap between that month and your usual. Which of those charges you would make again is yours to decide.",
  },
} as const;

/** Fills `{name}` placeholders. Every value is either curated wording or a figure the detector computed. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

function bundleFor(a: string, b: string): string | null {
  for (const p of BUNDLED_PAIRS) {
    if ((a.includes(p.a) && b.includes(p.b)) || (a.includes(p.b) && b.includes(p.a))) return p.bundle;
  }
  return null;
}

const hasFamilyPlan = (norm: string) => FAMILY_PLAN_SERVICES.some((m) => norm.includes(m));
const billsAnnually = (norm: string) => ANNUAL_BILLING_MERCHANTS.some((m) => norm.includes(m));

/**
 * Which price-rise remedy a merchant gets, in order of how much it can promise.
 *
 * Class 2 first, and only for a merchant on the explicit list. Then the class 1
 * moves, cheapest structure first: annual billing needs nobody else, a family
 * plan needs somebody in the household to share. Falling off the end is not a
 * failure, it is the honest answer, and it is where most merchants belong.
 */
function priceRemedy(norm: string): { title: string; detail: string } {
  const annual = billsAnnually(norm);
  if (negotiatesRate(norm)) {
    return annual
      ? REMEDY_COPY.price_increase_negotiable_annual
      : REMEDY_COPY.price_increase_negotiable;
  }
  if (annual) return REMEDY_COPY.price_increase_annual;
  if (hasFamilyPlan(norm)) return REMEDY_COPY.price_increase_family_plan;
  return REMEDY_COPY.price_increase_decide;
}

/**
 * Every curated string in the catalog, so the claims in it can be checked as a
 * set. lib/__tests__/spend-cut-detector.test.ts asserts no entry states a
 * percentage and that no rendered remedy states a figure the finding does not
 * have.
 */
export const REMEDY_TEMPLATES: string[] = [
  ...FEE_TYPES.flatMap((f) => [f.title, f.advice]),
  GENERIC_FEE.title,
  GENERIC_FEE.advice,
  ...Object.values(REMEDY_COPY).flatMap((r) => Object.values(r) as string[]),
];

// ── Price increases ───────────────────────────────────────────────────────

const PRICE_MIN_ABSOLUTE = 2;
const PRICE_MIN_FRACTION = 0.08;

/**
 * A monthly charge whose latest amount sits above what it used to be. The floor
 * is whichever of $2 and 8% is larger, so neither a rounding wobble on a small
 * subscription nor a 1% drift on a big one is reported as a price rise.
 */
export function detectPriceIncreases(recurring: RecurringMerchant[]): SpendCutFinding[] {
  const out: SpendCutFinding[] = [];
  for (const r of recurring) {
    const prior = r.amounts.slice(0, -1);
    if (prior.length < 2) continue;
    const base = round2(median(prior));
    const delta = round2(r.latest - base);
    if (delta <= Math.max(PRICE_MIN_ABSOLUTE, base * PRICE_MIN_FRACTION)) continue;

    const lastDate = r.dates[r.dates.length - 1];
    const remedy = priceRemedy(r.norm);
    // Both figures are the household's own and both appear in the evidence
    // below, so a remedy that states either is still a remedy a reader can
    // check against their own statement.
    const words = { merchant: r.merchantName, old: money(base), new: money(r.latest) };
    out.push({
      findingKey: `price_increase:${r.norm}`,
      kind: "price_increase",
      size: SIZE_BY_KIND.price_increase,
      title: fill(remedy.title, words),
      description: fill(remedy.detail, words),
      evidence: `${r.merchantName} was ${money(base)} a month and the charge on ${dayLabel(lastDate)} was ${money(r.latest)}.`,
      monthlySaving: delta,
      annualSaving: null,
      claimKey: `merchant:${r.norm}`,
      categoryId: r.categoryId,
      merchantName: r.merchantName,
      txnIds: r.txnIds,
    });
  }
  return out;
}

// ── Duplicate services ────────────────────────────────────────────────────

interface ServiceFamily {
  key: string;
  label: string;
  /** Normalized fragments. A merchant matches if its normalized name contains one. */
  members: string[];
}

// Five families, kept deliberately short. A sloppy family map is the main way
// this feature produces confidently wrong output: every fragment here has to be
// a name that means one service and nothing else, which is why a bare "max" or
// "prime" is not on the list.
const SERVICE_FAMILIES: ServiceFamily[] = [
  {
    key: "streaming_video",
    label: "video streaming",
    members: ["netflix", "hulu", "disney plus", "disneyplus", "hbo max", "paramount plus", "peacock", "apple tv", "showtime", "starz"],
  },
  {
    key: "music",
    label: "music streaming",
    members: ["spotify", "apple music", "tidal", "pandora", "deezer", "youtube music", "amazon music"],
  },
  {
    key: "cloud_storage",
    label: "cloud storage",
    members: ["dropbox", "icloud", "google one", "onedrive", "backblaze"],
  },
  {
    key: "fitness",
    label: "gym or fitness",
    members: ["planet fitness", "equinox", "peloton", "classpass", "24 hour fitness", "la fitness", "orangetheory", "crunch fitness"],
  },
  {
    key: "news",
    label: "news subscription",
    members: ["new york times", "nytimes", "wall street journal", "washington post", "the athletic", "the economist"],
  },
];

function familyOf(norm: string): ServiceFamily | null {
  for (const f of SERVICE_FAMILIES) {
    if (f.members.some((m) => norm.includes(m))) return f;
  }
  return null;
}

/**
 * Two subscriptions doing the same job.
 *
 * The saving quoted is the CHEAPER of the two, deliberately: which one goes is
 * the person's call, so the only figure we can promise is the smaller one. When
 * a family holds three, the two dearest are named, and the claim is still the
 * cheaper of that pair.
 */
export function detectDuplicateServices(recurring: RecurringMerchant[]): SpendCutFinding[] {
  const families = new Map<string, { family: ServiceFamily; members: RecurringMerchant[] }>();
  for (const r of recurring) {
    const family = familyOf(r.norm);
    if (!family) continue;
    const bucket = families.get(family.key);
    if (bucket) bucket.members.push(r);
    else families.set(family.key, { family, members: [r] });
  }

  const out: SpendCutFinding[] = [];
  for (const { family, members } of families.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => b.median - a.median || a.norm.localeCompare(b.norm));
    const [bigger, smaller] = ranked;

    // Sorted, so the same pair produces the same key whichever order the two
    // merchants arrived in.
    const pair = [bigger.norm, smaller.norm].sort();
    // Both have been billing since the later of the two start dates.
    const since = new Date(
      Math.max(bigger.dates[0].getTime(), smaller.dates[0].getTime()),
    );

    // The remedy, in order of how specific it can be: a bundle the two are
    // genuinely sold in, then one family plan in place of two subscriptions,
    // then the generic move. Each names an option and never prices one.
    const bundle = bundleFor(bigger.norm, smaller.norm);
    const remedy = bundle
      ? REMEDY_COPY.duplicate_bundle
      : hasFamilyPlan(bigger.norm) && hasFamilyPlan(smaller.norm)
        ? REMEDY_COPY.duplicate_family_plan
        : REMEDY_COPY.duplicate_generic;
    const words = {
      a: bigger.merchantName,
      b: smaller.merchantName,
      bundle: bundle ?? "",
      label: family.label,
    };

    out.push({
      findingKey: `duplicate:${family.key}:${pair[0]}+${pair[1]}`,
      kind: "duplicate_service",
      size: SIZE_BY_KIND.duplicate_service,
      title: fill(remedy.title, words),
      description: fill(remedy.detail, words),
      evidence: `${bigger.merchantName} at ${money(bigger.median)} and ${smaller.merchantName} at ${money(smaller.median)} every month since ${monthLabel(since)}.`,
      monthlySaving: smaller.median,
      annualSaving: null,
      claimKey: `merchant:${smaller.norm}`,
      categoryId: smaller.categoryId,
      merchantName: smaller.merchantName,
      txnIds: [...bigger.txnIds, ...smaller.txnIds],
    });
  }
  return out;
}

// ── Categories above their own trend ──────────────────────────────────────

/**
 * Complete months a household needs before this kind says anything at all:
 * three of baseline, plus the month being read. With fewer, "your usual" is a
 * claim about one or two months, and one or two months is not a usual.
 */
const CATEGORY_MIN_MONTHS = 4;
/** How far back the household's own baseline is read. */
const CATEGORY_BASELINE_MONTHS = 3;
const CATEGORY_MIN_TXNS = 3;
const CATEGORY_MIN_EXCESS = 40;
/**
 * Half as much again as the household's usual, and that bar is the whole point
 * of the kind.
 *
 * It used to fire on whichever of $40 and a fifth of the median was larger,
 * which is a normal month with a dentist in it, so the page filled up with rows
 * a reader had no reason to look at twice and the whole set read as nagging. A
 * month worth a word is one that is obviously different, and half again is a
 * number a reader can be told and check for themselves.
 */
const CATEGORY_MIN_RATIO = 1.5;

const TIMES = [
  "", "", "double", "three times", "four times", "five times",
  "six times", "seven times", "eight times", "nine times", "ten times",
];

/**
 * How much bigger the month was, in the plainest form the two real figures
 * allow: a multiple once it reaches one, a percentage below that. Both dollar
 * figures are named either way, so the claim can be checked against the row's
 * own transactions.
 *
 * ON THE PERCENTAGE. Everything else here refuses one, and the refusal is about
 * PRESCRIPTION: "cut groceries by 20%" invents a goal out of nothing, which is
 * advice nobody asked for and nobody can check. A DESCRIPTIVE share of the
 * household's own change is the opposite. "up 86% on your usual $264.71" is
 * computed entirely from their transactions, says only what happened, and is
 * the clearest way to say it. Descriptive is allowed here. Prescriptive stays
 * banned everywhere, this kind included: nothing below states what a household
 * ought to spend.
 */
function magnitude(last: number, med: number): string {
  const ratio = last / med;
  if (ratio < 2) return `up ${Math.round((ratio - 1) * 100)}% on your usual ${money(med)}`;
  const n = Math.min(Math.floor(ratio), TIMES.length - 1);
  return `${ratio === n ? "" : "more than "}${TIMES[n]} your usual ${money(med)}`;
}

// Categories where "you spent more than usual" is a fact but not advice.
// Rent going up is not a habit, a tax bill is not a choice, and telling
// someone to spend less on healthcare or on paying down debt is worse than
// saying nothing. Matched on the taxonomy's system key, so a renamed category
// is still excluded.
//
// home_improvement is here for a different reason: this band claims a
// different HABIT, held for a month, and a renovation or a repair is a project
// that ends, not a habit. On real household data it fired at roughly $3,400 a
// month off one bathroom, which is true arithmetic, reads as bad advice, and
// was large enough to own the headline on its own.
const CATEGORY_NEVER: ReadonlySet<string> = new Set([
  "housing",
  "debt_payment",
  "taxes",
  "savings_investment",
  "insurance",
  "healthcare",
  "home_improvement",
]);

interface CategoryMonths {
  categoryId: string;
  name: string | null;
  systemKey: string | null;
  /** One entry per baseline month in the window, zero included. */
  baseline: Map<number, number>;
  analysisTotal: number;
  analysisTxnIds: string[];
}

/**
 * A category that cost this household half again what it usually costs them.
 *
 * The comparison is the last COMPLETE calendar month against the MEDIAN of that
 * category's own prior three complete months. Median rather than mean because
 * one holiday, one vet bill or one Christmas would otherwise become the
 * baseline and hide every month after it. The in-progress month is never read:
 * a figure that climbs from the 1st to the 28th is a figure nobody can check.
 *
 * A month with no spending in the category counts as a zero, which is what
 * makes the "median above zero" gate load-bearing: a category the household
 * only started using last month has no usual amount, and the median of two
 * zeros and one month is zero, so it never fires.
 *
 * THIS KIND NAMES NO TARGET, and that is deliberate. The other kinds have a
 * move: ask for the refund, cancel the second subscription, ask for the old
 * rate. Here there is none, because nothing in a bank feed says what a
 * household ought to spend on groceries, and a number invented for them to aim
 * at would be a guess wearing a dollar sign. So the row says what happened and
 * how big it was, names the month it happened in, and points at the
 * transactions behind it. What to do with that is the reader's to decide.
 */
export function detectCategoryAboveTrend(
  txns: DetectorTxn[],
  window: AnalysisWindow,
): SpendCutFinding[] {
  if (window.months < CATEGORY_MIN_MONTHS) return [];

  // window.end is the first of the month still running, so the month before it
  // is the last complete one: the same month /spending and the dashboard show.
  const analysisStart = monthStart(window.end, -1);
  // Up to three months before that, clipped at the window — which begins at the
  // household's first transaction when that is later than twelve months back.
  const baselineStarts: number[] = [];
  for (let i = 1; i <= CATEGORY_BASELINE_MONTHS; i++) {
    const m = monthStart(window.end, -1 - i);
    if (m.getTime() < window.start.getTime()) break;
    baselineStarts.push(m.getTime());
  }
  // The month count said three baseline months exist; this is where they are
  // actually found. Both have to agree, or the median of one month becomes
  // "your usual".
  if (baselineStarts.length < CATEGORY_BASELINE_MONTHS) return [];

  const byCategory = new Map<string, CategoryMonths>();
  for (const t of txns) {
    if (!(t.amount > 0)) continue;
    if (!t.categoryId) continue;
    const m = monthStart(t.date).getTime();
    const isAnalysis = m === analysisStart.getTime();
    if (!isAnalysis && !baselineStarts.includes(m)) continue;

    let c = byCategory.get(t.categoryId);
    if (!c) {
      c = {
        categoryId: t.categoryId,
        name: t.categoryName,
        systemKey: t.categorySystemKey,
        baseline: new Map(baselineStarts.map((k) => [k, 0])),
        analysisTotal: 0,
        analysisTxnIds: [],
      };
      byCategory.set(t.categoryId, c);
    }
    c.name = c.name ?? t.categoryName;
    c.systemKey = c.systemKey ?? t.categorySystemKey;

    if (isAnalysis) {
      c.analysisTotal += t.amount;
      c.analysisTxnIds.push(t.id);
    } else {
      c.baseline.set(m, (c.baseline.get(m) ?? 0) + t.amount);
    }
  }

  const out: SpendCutFinding[] = [];
  for (const c of byCategory.values()) {
    // Without a label there is no sentence to write, and "this category was
    // $420" is not one.
    if (!c.name) continue;
    if (c.systemKey && CATEGORY_NEVER.has(c.systemKey)) continue;
    // Three charges is a month of choices. One is a one-off, and a single large
    // purchase is not a habit anyone can hold differently.
    if (c.analysisTxnIds.length < CATEGORY_MIN_TXNS) continue;

    const med = round2(median([...c.baseline.values()]));
    if (med <= 0) continue;
    const last = round2(c.analysisTotal);
    // Half again on top of their usual, and no less.
    if (last < round2(med * CATEGORY_MIN_RATIO)) continue;
    const excess = round2(last - med);
    // An absolute floor under the ratio, so $10 becoming $16 stays quiet. It is
    // half again, and it is also six dollars.
    if (excess <= CATEGORY_MIN_EXCESS) continue;

    out.push({
      findingKey: `category:${c.categoryId}`,
      kind: "category_above_trend",
      size: SIZE_BY_KIND.category_above_trend,
      title: fill(REMEDY_COPY.category_above_trend.title, { category: c.name }),
      description: REMEDY_COPY.category_above_trend.detail,
      evidence: `${c.name} was ${money(last)} in ${monthLabel(analysisStart)}, ${magnitude(last, med)}.`,
      monthlySaving: excess,
      annualSaving: null,
      claimKey: `category:${c.categoryId}`,
      categoryId: c.categoryId,
      categoryName: c.name,
      merchantName: null,
      txnIds: c.analysisTxnIds,
    });
  }
  return out.sort((a, b) => a.findingKey.localeCompare(b.findingKey));
}

// ── Everything, once ──────────────────────────────────────────────────────

/**
 * Drops any finding that would spend a dollar a bigger finding already claims.
 * Netflix raising its price by $3 while also being the cheaper half of a
 * duplicate pair is one $22.99 saving, not a $22.99 and a $3 saving, and the
 * total has to be a number the person can actually reach.
 */
function dropDoubleClaims(findings: SpendCutFinding[]): SpendCutFinding[] {
  const best = new Map<string, SpendCutFinding>();
  for (const f of findings) {
    if (!f.claimKey) continue;
    const held = best.get(f.claimKey);
    if (
      !held ||
      f.monthlySaving > held.monthlySaving ||
      (f.monthlySaving === held.monthlySaving && f.findingKey < held.findingKey)
    ) {
      best.set(f.claimKey, f);
    }
  }
  return findings.filter((f) => !f.claimKey || best.get(f.claimKey) === f);
}

/**
 * Leaves a category finding claiming only the dollars nothing else claims.
 *
 * A $15 duplicate music subscription sits inside entertainment, and so does
 * entertainment's above-trend excess, so adding both up promises the same $15
 * twice and the headline becomes a number nobody can reach.
 *
 * The merchant-level finding wins, every time. It names a merchant, a charge
 * and one thing to do, where a category finding only says the month ran high,
 * so the specific one is the one worth keeping whole. What is left of the
 * category is its excess less every merchant-level claim inside it, and a
 * remainder under the same $40 floor the kind fires at is dropped rather than
 * shown: "cut $12 out of dining" is not a suggestion.
 *
 * Runs AFTER dropDoubleClaims, so a merchant finding that was itself dropped
 * cannot take dollars off a category nothing is claiming any more. The netted
 * figure is what gets stored, so the row's own amount, the band subtotal and
 * the headline are the same arithmetic, and dismissing a merchant row later
 * cannot make the category row grow back.
 */
function netCategoryClaims(findings: SpendCutFinding[]): SpendCutFinding[] {
  const claimed = new Map<string, number>();
  for (const f of findings) {
    // The finding's own category is where its claimed dollars sit: the merchant
    // named in a price rise, and the cheaper half of a duplicate pair, which is
    // the half whose money the row promises.
    //
    // A one-off fee claims nothing here. Its figure is money back once, so
    // netting it against a category's monthly excess would take $2,900 off a
    // $360 gap and delete a row on the strength of a subtraction between two
    // different units.
    if (f.kind === "category_above_trend" || f.kind === "one_time_fee" || !f.categoryId) continue;
    claimed.set(f.categoryId, (claimed.get(f.categoryId) ?? 0) + f.monthlySaving);
  }

  const out: SpendCutFinding[] = [];
  for (const f of findings) {
    if (f.kind !== "category_above_trend" || !f.categoryId) {
      out.push(f);
      continue;
    }
    const taken = round2(Math.min(f.monthlySaving, claimed.get(f.categoryId) ?? 0));
    const left = round2(Math.max(0, f.monthlySaving - taken));
    if (left < CATEGORY_MIN_EXCESS) continue;
    out.push(
      taken === 0
        ? f
        : {
            ...f,
            monthlySaving: left,
            // Said on the row, or the receipt above it would no longer add up to
            // the figure beside it.
            evidence: `${f.evidence} ${money(taken)} of that gap is claimed by another suggestion here, so this row counts the remaining ${money(left)}.`,
          },
    );
  }
  return out;
}

/**
 * Drops a finding whose figure would PRINT as nothing.
 *
 * The page rounds every amount to whole dollars, so a true $0.25 saving renders
 * as "$0 a month" over a receipt about two $1.50 fees. Nothing about that row is
 * wrong and nobody should ever see it. Applied last, because netCategoryClaims
 * is what makes a figure smaller than the kind that produced it.
 */
function printsAsZero(f: SpendCutFinding): boolean {
  return Math.round(f.monthlySaving) < 1;
}

export function detectSpendCuts(
  txns: DetectorTxn[],
  window: AnalysisWindow,
): SpendCutFinding[] {
  const recurring = recurringMerchants(txns);
  return netCategoryClaims(
    dropDoubleClaims([
      ...detectFees(txns, window),
      ...detectPriceIncreases(recurring),
      ...detectDuplicateServices(recurring),
      ...detectCategoryAboveTrend(txns, window),
    ]),
  ).filter((f) => !printsAsZero(f));
}
