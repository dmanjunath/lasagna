/**
 * Builds the "Strategy" section of a Financial Plan document — a situation-aware,
 * quantified retirement strategy grounded in the deterministic schedule + flags.
 *
 * ONE bounded structured LLM call (generateObject + a zod schema) whose prompt
 * receives the compact grounding AND the curated schedule rows + flags, so every
 * dollar figure cited by the model can be traced to real computed data.
 *
 * RESILIENCE: this must NEVER throw. Plan-create wraps deterministic sections
 * around it, and an LLM hiccup must not 500 the create. A failed/empty/invalid
 * model response returns null; the plan still creates with no strategy section.
 */

import { z } from "zod";
import { llmGenerateObject, type LlmAnonContext } from "../lib/llm.js";
import { buildAliasMap } from "../lib/pii-scrubber.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "../lib/activity.js";
import { DEFERRED_401K_LIMIT, standardDeduction } from "./tax-model.js";
import type { CompactPlanGrounding } from "./plan-grounding.js";

const STRATEGY_LEVEL = "medium" as const;
// Verification is judge-capability-bound: the frontier tier catches semantic
// errors (inverted tax logic, claims contradicted by the rows) the medium tier
// demonstrably missed. One call per create; worth it for a trust-critical report.
const VERIFY_LEVEL = "frontier" as const;

export interface StrategySection {
  section: "strategy";
  situationHeadline: string;
  watchouts: { title: string; detail: string }[];
  strategies: { title: string; detail: string; quantifiedImpact?: string }[];
  explore: { title: string; detail: string }[];
  generatedAt: string;
}

// Structured output contract. Lengths/counts are NOT encoded as zod min/max:
// those serialize to JSON-Schema maxItems/maxLength/minLength, which the
// OpenRouter -> Bedrock route for the medium model rejects ("property 'maxItems'
// is not supported"), throwing on every call. Bounds are steered in the prompt
// and post-processed in code below.
const item = z.object({ title: z.string(), detail: z.string() });
const stratItem = z.object({
  title: z.string(),
  detail: z.string(),
  quantifiedImpact: z.string().optional(),
});
const strategySchema = z.object({
  situationHeadline: z.string(),
  watchouts: z.array(item),
  strategies: z.array(stratItem),
  explore: z.array(item),
});

const SYSTEM_PROMPT = `You are a sharp fee-only financial planner writing the strategy section of ONE person's retirement plan. You are given a DETERMINISTIC year-by-year schedule (curated rows) and computed FLAGS for this specific person: the bridge to penalty-free age 59.5 and whether their taxable savings cover it, first-shortfall age, CoastFI value (what their untouched tax-deferred plus Roth grows to), the annual tax-free withdrawal capacity, real-estate equity, RMD onset and size, and whether the plan depletes. You also get their real accounts, allocation, Social Security estimate, and demographics.

Your job is to tell them the specific, non-obvious things a great advisor would -- NOT to restate the charts. Produce:
1. situationHeadline: ONE or two sentences naming this person's binding constraint in plain language (e.g. an early-retirement cashflow bridge that the 4% rule does not address, or a tax-deferred-heavy portfolio facing an RMD tax wall). Make it specific to THEIR numbers.
2. watchouts: the specific risks their figures reveal, each with a concrete number: the bridge gap and whether it is covered, sequence-of-returns risk in the first retirement years, the RMD tax wall at 73, ACA premium subsidy (MAGI) cliffs before Medicare, and concentration. Only include ones that apply.
3. strategies: concrete, QUANTIFIED moves grounded in the schedule and flags. Prefer, when the data supports them: the specific drawdown sequence across their accounts; living on portfolio dividends plus taxable-lot liquidation up to the 0% long-term-cap-gains ceiling (cite the tax-free capacity figure); a Roth-conversion ladder in low-income early-retirement years; a 72(t)/SEPP if the bridge is short; a CoastFI hold (cite what the deferred plus Roth grows to); and selling real estate to fund the bridge (cite the equity). Each strategy cites a figure from the data; add a quantifiedImpact when you can.
4. explore: 2 to 4 creative or less-conventional ideas tailored to their situation (e.g. geographic arbitrage to a no-income-tax state, a bond/TIPS ladder to cover the first years of sequence risk, a mega-backdoor Roth while still working, borrowing against assets instead of selling). These are directional: describe them QUALITATIVELY with NO dollar figures at all (sizing them precisely requires modeling the report does not do).

RULES:
- Every dollar figure you cite MUST appear in the provided data (schedule rows, flags, tax capacities, accounts). Do NOT invent or compute new dollar totals. In explore items you may describe effects qualitatively without new numbers.
- The schedule rows include the person's ACTUAL named accounts with per-account withdrawals and balances. When prescribing draws, name the specific account and the dollar amount from the data, not just the tax bucket. Use each account's name EXACTLY as it appears in the data. NEVER invent, embellish, or guess an institution or account name that is not in the data.
- Ground everything in THIS person's data. If a strategy does not apply to their figures, omit it. Do not pad.
- flags.coastFi.deferredPlusRothAt59 includes BOTH tax-deferred AND Roth. Roth accounts have NO RMDs. Any RMD statement must use flags.rmd (first age and amount) and the tax-deferred balance only, never the combined figure.
- The bridge to penalty-free access ends at age 59 and a half; write it as 'age 59½' consistently. Its length is (59.5 minus the retirement age) years; state that duration correctly (retiring at 36 means a roughly 23 year bridge).
- Accounts marked earmarked (529, custodial, UTMA) belong to someone else: never propose spending them and never count them as retirement funding.
- Sanity-check your arithmetic: any timeline or dollar range you state must be consistent with the balances and flows in the data (e.g. do not claim a decades-long conversion ladder for a balance the data shows converting in a couple of years).
- Cite figures exactly as they appear in the schedule rows and flags; round only to obvious $K/$M forms; never produce a figure that appears nowhere in the data.
- All schedule balances are END-of-year values, exactly as the report table displays them.
- TIMEPOINT DISCIPLINE: every figure must be labeled with WHEN it applies. Snapshot, portfolio, and account balances are TODAY's values; write "today". Schedule-row figures are values AT that row's age; cite them with that age. NEVER attach today's balance to "at retirement" or a future age; if you need the value at an age, use that age's row. Social Security estimates outside the rows are today's dollars; the rows' guaranteed-income figures are the nominal amounts at each age; cite future SS from the rows.
- The tax-free withdrawal figure is the portion of that year's withdrawal incurring no federal tax (cash basis plus Roth plus deduction-sheltered income plus 0% band gains). It routinely EXCEEDS the 0% capital-gains ceiling; never compare it to that ceiling.
- Never write internal field identifiers (camelCase like taxFreeWithdrawal) in prose; use plain words.
- A derived figure is allowed ONLY as a single stated rate times a figure in the data, computed correctly (e.g. 15% of the tax-free capacity). Anything else: describe it qualitatively, without a number.
- When you compare two figures qualitatively (half, a third, a quarter), the fraction must match the actual numbers.
- The schedule does not force RMD withdrawals; flags.rmd is an estimate of the first required amount at 73, not a modeled cashflow.
- Real estate: name properties freely, but NEVER attach a dollar value, mortgage, or equity figure to an individual property (per-property figures are unreliable when mortgages are unlinked). The ONLY citable equity figures are the single netted total today and the schedule rows'/flags' equity at an age.
- The taxable side is many accounts; write "taxable accounts" or "taxable balance", not "account".
- If you write "the first N years", the endpoint age must be retirement age plus N minus 1.
- Avoid absolute claims (eliminates, guarantees, ensures); write reduces/improves/increases the odds.
- When describing which accounts fund a year, match that row's per-account withdrawals (cash accounts first, then brokerage); never say a year is funded "entirely" from one account unless the row shows exactly that.
- Dividend or yield estimates apply the yield to the TAXABLE balance today (see the TIMEPOINT REFERENCE), never the whole portfolio (retirement and earmarked accounts are not spendable income), and name the base.
- Never present growth as "compounding at N% for Y years"; the schedule grows at its volatility-adjusted rate. Cite starting and ending values without a rate-times-years mechanism.
- SUSTAINABILITY claims come ONLY from the schedule rows: never claim a balance "will fund spending through age X" or "onward" unless the rows show the money lasting that long.
- EXTERNAL thresholds (federal poverty levels, ACA cliff dollars, state tax exemptions and rates): describe them QUALITATIVELY ("the ACA subsidy cliff", "state tax treatment") — never cite a specific dollar threshold or state-tax fact that is not in the data.
- Relocation ideas: rental income remains taxed by the PROPERTY's state regardless of where the owner lives; never claim moving eliminates state tax on rent. Limit relocation benefits to income sourced to the person (gains, conversions, distributions).
- Vocabulary: the flags' tax-free capacity figure is the "standard tax-free capacity"; a row's tax-free figure is "the tax-free portion of that year's withdrawal" — never call the row figure a capacity. Say "cost basis" (return of principal), never "cash basis".
- If gain harvesting, Roth conversions, and an ACA/MAGI target all appear, include ONE sentence ordering them (which fills the room first and what yields).
- Any borrow-against-portfolio idea must name margin-call/maintenance risk and advise a low loan-to-value.
- Every risk named in watchouts must have at least one strategy or idea addressing it (concentration named means a diversification action exists).
- FACTS the draft keeps getting wrong; state them correctly or not at all: (1) sequence-of-returns risk GROWS with the withdrawal rate — a low withdrawal rate softens it; (2) Virginia fully exempts Social Security from state income tax; (3) ordinary income (wages, conversions) stacks UNDER long-term gains — adding conversions pushes harvested gains out of the 0% band, so set the conversion amount first and harvest only the remaining 0% room; the 12% bracket top and the 0% gains ceiling are nearly the same dollar level, not two separate pools; (4) the standard tax-free capacity = standard deduction + 0% gains band only — cost basis is untaxed return of principal on top of it, not part of it.
- Dividends are part of the portfolio's total return in this model, NOT extra income on top of the schedule's withdrawals. Describe living on dividends as a way to STRUCTURE the withdrawal, never as additional income, and never assert a dividend dollar amount alongside MAGI or bracket arithmetic that omits it.
- Treat every income source consistently across items: if two strategies compete for the same bracket or 0% band room (e.g. Roth conversions and gain harvesting), say so and set a priority.
- Rebalancing guidance must respect tax location: selling inside IRA/Roth/HSA triggers NO tax; selling in a taxable account REALIZES gains. Prefer rebalancing inside tax-advantaged accounts and say what a taxable rebalance would cost in realized gains.
- NEVER use the words "entirely", "solely", or "exclusively" about funding sources; describe the actual mix from the rows.
- NEVER write calendar years (2027, 2030, ...); cite ages only.
- NEVER attach a dollar amount to dividends; describe dividend income qualitatively as part of structuring the withdrawal.
- Any figure you describe as "today" must be a today value (snapshot, portfolio, accounts, drawdown order, the timepoint reference) — never a schedule-row value, which is at a future age.
- Any spending or withdrawal figure must come from the schedule rows' withdrawal or spend figures for the ages you mention; a range must bracket the actual values across those ages.
- The growth rate is a volatility-adjusted NOMINAL return; never call it a "real" return.
- Allocation percentages are of the PORTFOLIO; write "of your portfolio", never "of your assets".
- When citing calendar years, derive them from the retirement calendar year given in the TIMEPOINT REFERENCE; the first N retirement years begin in that year.
- A TIMEPOINT REFERENCE with exact today vs at-retirement values is appended to the data; whenever you cite a balance or equity figure "today" or "at retirement/at age N", use the value from that reference or the row for that age.
- Never write "as the schedule shows" about a figure the report does not display.
- Be specific and free of jargon you do not explain. Short paragraphs, full sentences, no bullet lists inside a field.
- Do not use em dashes or en dashes.`;

// ---------------------------------------------------------------------------
// Grounded-figure validation — the RECONCILIATION gate for prose.
// Prompt discipline alone has proven insufficient: the model computes its own
// dollar totals or mis-cites rows. So we enforce it in code: every dollar
// figure in the output must match a number present in the grounding (within a
// rounding tolerance), or a stated-rate product we explicitly allow. One
// corrective retry with the violations listed; items still violating are
// dropped rather than shipped.
// ---------------------------------------------------------------------------

/** Recursively collect every dollar-scale number in the grounding JSON. */
function collectGroundedNumbers(value: unknown, out: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    const v = Math.abs(Math.round(value));
    if (v >= 1000) out.add(v);
  } else if (Array.isArray(value)) {
    for (const v of value) collectGroundedNumbers(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectGroundedNumbers(v, out);
  }
}

const DOLLAR_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|[mMkK])?\b/g;

/** Parse "$1.2M" / "$126,700" / "$48.9k" style figures out of prose (>= $1,000). */
export function extractDollarFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DOLLAR_RE)) {
    let v = parseFloat(m[1].replace(/,/g, ""));
    const suffix = (m[2] ?? "").toLowerCase();
    if (suffix === "million" || suffix === "m") v *= 1_000_000;
    else if (suffix === "k") v *= 1_000;
    if (v >= 1000) out.push(Math.round(v));
  }
  return out;
}

// Well-known 2025 planning constants an advisor legitimately cites without them
// being anywhere in the user's data (IRS contribution limits, gift/529 amounts,
// standard deductions, the SS wage cap). The 401(k) limit and the standard
// deductions come from tax-model.ts so this gate can't go stale independently.
const EXTERNAL_CONSTANTS_2025 = [
  7_000, 8_000, DEFERRED_401K_LIMIT, 31_000, 4_300, 8_550, 19_000, 38_000, 95_000, 190_000,
  standardDeduction("single"), standardDeduction("married_joint"), 176_100, 126_700,
];

/**
 * True when a cited figure is legitimate:
 *  - matches a grounded number within a 2.5% rounding tolerance (a citation),
 *  - is a sum of two grounded numbers (e.g. tax-deferred + Roth combined),
 *  - is a clean multiple of $5,000 (a round PRESCRIPTIVE amount the advisor
 *    chooses, e.g. "convert $30,000 a year" — precision implies citation and is
 *    checked; roundness implies prescription and is allowed), or
 *  - is a known external constant (IRS limits etc.).
 */
function figureAllowed(fig: number, allowed: Set<number>): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.025 * b, 1);
  for (const a of allowed) if (near(fig, a)) return true;
  if (fig >= 5_000 && fig % 5_000 === 0) return true;
  for (const c of EXTERNAL_CONSTANTS_2025) if (near(fig, c)) return true;
  // Pairwise sums of grounded numbers (bounded: |allowed| is a few hundred).
  const arr = [...allowed].filter((a) => a < fig * 1.03);
  for (let i = 0; i < arr.length; i++) {
    for (let j = i; j < arr.length; j++) {
      if (Math.abs(arr[i] + arr[j] - fig) <= Math.max(0.025 * fig, 1)) return true;
    }
  }
  return false;
}

// Internal field names that must never appear in customer prose.
const INTERNAL_ID_RE =
  /\b(taxFreeWithdrawal|portfolioWithdrawal|spendTarget|guaranteedIncome|totalPortfolio|netWorth|coastFi|deferredPlusRothAt59|deferredPlusRothAtEnd|ltcgRealized|ordinaryIncome|estimatedTax|firstShortfallAge|endingPortfolio|taxFreeCapacityAtRetirement)\b/;

/** All ungrounded dollar figures + internal identifiers in one text blob. */
export function textViolations(text: string, allowed: Set<number>): string[] {
  const out: string[] = [];
  for (const fig of extractDollarFigures(text)) {
    if (!figureAllowed(fig, allowed)) out.push(`$${fig.toLocaleString()}`);
  }
  const id = text.match(INTERNAL_ID_RE);
  if (id) out.push(`internal identifier "${id[0]}"`);
  return out;
}

type StrategyObject = z.infer<typeof strategySchema>;

// ---------------------------------------------------------------------------
// Adversarial verification — a second bounded model call that fact-checks each
// draft item against the SAME grounding. The numeric gate catches ungrounded
// figures; this catches what regex cannot: ranges inconsistent with the rows
// for the ages cited, internal arithmetic, cross-item contradictions, summed
// per-property equity, and wrong legal/tax claims. FAIL-OPEN: if the verify
// call errors, the (numerically-gated) draft ships rather than losing the
// section.
// ---------------------------------------------------------------------------

// A rejection must name its error class; a verdict whose reason talks itself
// back into "actually fine" or cites tolerated rounding gets ignored in code.
const ERROR_CLASSES = [
  "wrong_figure",
  "wrong_timepoint",
  "wrong_base",
  "duration_mismatch",
  "cross_item_contradiction",
  "per_property_figures",
  "external_threshold",
  "unsupported_sustainability",
  "wrong_legal_claim",
  "schedule_shows_false",
  "inconsistent_income",
  "rate_mechanism",
] as const;

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      key: z.string().describe("The item key exactly as given, e.g. headline, w0, s2, e1."),
      ok: z.boolean(),
      errorClass: z
        .string()
        .optional()
        .describe(
          "REQUIRED when ok=false: exactly one of wrong_figure, wrong_timepoint, wrong_base, duration_mismatch, cross_item_contradiction, per_property_figures, external_threshold, unsupported_sustainability, wrong_legal_claim, schedule_shows_false, inconsistent_income, rate_mechanism.",
        ),
      reason: z.string().describe("One short sentence when not ok; empty when ok."),
    }),
  ),
});

const VERIFIER_PROMPT = `You are a fact-checker for the strategy section of ONE person's financial plan. You get the plan DATA (JSON) and DRAFT items, each with a key. For each item return ok=true or ok=false. Your job is to catch MATERIAL errors a reader would call wrong, not to punish normal rounding.

TOLERANCE (never reject for these):
- A figure within 3% of the data value, or rounded to two significant figures, is CORRECT ($1,766,124 cited as "$1.8M" is fine).
- Arithmetic correct within 1% is fine.
- Items keyed e0, e1, ... are DIRECTIONAL ideas that are intentionally qualitative; NEVER reject one for lacking figures or precision. Reject an idea only for a claim you are confident is factually wrong.

Mark an item ok=false ONLY when one of these MATERIAL errors holds:
- A dollar figure or range is off by more than ~10% from the DATA for the ages it mentions, or a sizing/budget claim falls materially short of the actual withdrawal figures in the rows for those ages.
- Its arithmetic is materially wrong (a stated rate times a stated base missing the stated result by more than a few percent; parts that do not sum to the stated total; a duration off by 2x from balance divided by annual amount).
- It materially contradicts another item (e.g. one item's conversion plan would destroy another item's 0% gains band or subsidy claim).
- It sums per-property real-estate values into a new total.
- It makes a legal or tax claim you are CONFIDENT is wrong (not merely one you cannot verify).
- It claims "the schedule shows" a figure the data does not contain.
- It attaches a figure to the WRONG TIMEPOINT: a today's-dollar balance (snapshot/portfolio/accounts) described as "at retirement" or at a future age when the row for that age shows a materially different value.
- A stated DURATION contradicts the ages it spans (e.g. calling the span from age 36 to age 59½ a "two-year bridge" when it is roughly 23 years).
- A percentage attributed to the wrong base (a portfolio-allocation percentage described as a share of total assets, or a yield applied to the whole portfolio instead of the taxable balance).
- A claimed rate-times-years mechanism that does not reproduce the cited endpoint values within a few percent.
- A sustainability claim ("funds spending through X / onward") the schedule rows do not support.
- A specific dollar threshold for an external program (poverty level, subsidy cliff, state exemption) that is not present in the data, or a state-tax assertion (e.g. which income a state taxes) — these must be qualitative.
- Income treated inconsistently across items (e.g. dividend income asserted in one item but omitted from another item's MAGI or bracket arithmetic).
- Calendar years inconsistent with the ages cited (the retirement start year is in the TIMEPOINT REFERENCE).
- Use the TIMEPOINT REFERENCE in the DATA for today-vs-at-retirement checks; a "today" claim must match the today value and an "at retirement/at age N" claim must match that timepoint's value.

When ok=false you MUST set errorClass to the single class that applies; if no class fits, the item is ok=true. If your own reasoning concludes the item is acceptable or within tolerance, you MUST return ok=true — rounding within the stated tolerance is NEVER grounds for rejection.

Judge against the DATA and the other items. Return one verdict per key, every key exactly once.`;

// The broad verifier sweep produces occasional FALSE rejections (reasons that
// argue themselves back to "correct", or contradict the stated rules). Before a
// rejection costs content it must be UPHELD by a focused adjudication call that
// sees only the item, the claim, and the data — a narrow question a model
// answers far more reliably than a 12-rule sweep.
const adjudicationSchema = z.object({
  upheld: z.array(
    z.object({
      key: z.string(),
      uphold: z.boolean().describe("true only if the rejection is clearly valid against the data"),
    }),
  ),
});

const ADJUDICATOR_PROMPT = `You are adjudicating rejections raised against items in a financial plan's strategy section. For each rejection you get the item's text and the reviewer's claimed error. Uphold a rejection ONLY when the claimed error is clearly real when checked against the DATA: the figure or claim in the item genuinely contradicts the data or the stated tolerance (rounding within ~3% or to two significant figures is always acceptable). If the reviewer's claim is itself mistaken, contradicts the data, or the item is fine, do NOT uphold. Return a verdict for every key.`;

/**
 * generateObject with a model-tier fallback: the frontier route (Bedrock Opus)
 * rejects structured-output config ("output_config.format: Extra inputs are not
 * permitted"), so fall back to the medium tier rather than silently skipping
 * verification via fail-open.
 */
async function generateObjectWithFallback<T extends z.ZodTypeAny>(anon: LlmAnonContext, opts: {
  schema: T;
  system: string;
  prompt: string;
  maxOutputTokens: number;
}): Promise<{ object: z.infer<T> }> {
  try {
    return (await llmGenerateObject(anon, { model: getModel(VERIFY_LEVEL), temperature: 0, ...opts })) as { object: z.infer<T> };
  } catch (e) {
    console.warn(
      `[strategy] ${VERIFY_LEVEL} verification route failed, falling back to ${STRATEGY_LEVEL}:`,
      e instanceof Error ? e.message : e,
    );
    return (await llmGenerateObject(anon, { model: getModel(STRATEGY_LEVEL), temperature: 0, ...opts })) as { object: z.infer<T> };
  }
}

/** Returns the set of item keys that FAILED verification (empty on fail-open). */
async function verifyItems(
  anon: LlmAnonContext,
  grounding: CompactPlanGrounding,
  object: StrategyObject,
  timepointRef: unknown,
): Promise<Map<string, string>> {
  const items: Record<string, string> = { headline: object.situationHeadline ?? "" };
  (object.watchouts ?? []).forEach((w, i) => (items[`w${i}`] = `${w.title}: ${w.detail}`));
  (object.strategies ?? []).forEach(
    (s, i) => (items[`s${i}`] = `${s.title}: ${s.detail} ${s.quantifiedImpact ?? ""}`),
  );
  (object.explore ?? []).forEach((e, i) => (items[`e${i}`] = `${e.title}: ${e.detail}`));

  const failed = new Map<string, string>();
  try {
    const res = await generateObjectWithFallback(anon, {
      schema: verdictSchema,
      system: VERIFIER_PROMPT,
      prompt: `DATA:\n${JSON.stringify(grounding)}\n\nTIMEPOINT REFERENCE:\n${JSON.stringify(timepointRef)}\n\nDRAFT ITEMS:\n${JSON.stringify(items)}`,
      maxOutputTokens: 1500,
    });
    const validClasses = new Set<string>(ERROR_CLASSES);
    const candidates: { key: string; reason: string }[] = [];
    for (const v of res.object.verdicts ?? []) {
      if (!v || v.ok !== false || !(v.key in items)) continue;
      // Class guard: a rejection must name a real error class.
      if (!v.errorClass || !validClasses.has(v.errorClass)) continue;
      candidates.push({ key: v.key, reason: `${v.errorClass}: ${v.reason ?? ""}` });
    }
    if (candidates.length === 0) return failed;

    // Adjudicate: each surviving rejection must be upheld before it drops content.
    // Fail-open on adjudication error = keep the content (discard rejections).
    try {
      const adj = await generateObjectWithFallback(anon, {
        schema: adjudicationSchema,
        system: ADJUDICATOR_PROMPT,
        prompt: `DATA:\n${JSON.stringify(grounding)}\n\nTIMEPOINT REFERENCE:\n${JSON.stringify(timepointRef)}\n\nREJECTIONS:\n${JSON.stringify(
          candidates.map((c) => ({ key: c.key, itemText: items[c.key], claimedError: c.reason })),
        )}`,
        maxOutputTokens: 800,
      });
      const upheld = new Set(
        (adj.object.upheld ?? []).filter((u) => u.uphold === true).map((u) => u.key),
      );
      for (const c of candidates) {
        if (upheld.has(c.key)) failed.set(c.key, c.reason);
        else console.warn(`[strategy] adjudicator overturned rejection of ${c.key}: ${c.reason}`);
      }
    } catch (e) {
      console.warn(
        `[strategy] adjudication failed (fail-open, rejections discarded):`,
        e instanceof Error ? e.message : e,
      );
    }
  } catch (e) {
    console.warn(
      `[strategy] verifier call failed (fail-open):`,
      e instanceof Error ? e.message : e,
    );
  }
  return failed;
}

/** Violations per output field; empty map = fully grounded. */
function sectionViolations(
  obj: StrategyObject,
  allowed: Set<number>,
  // Today's values only (snapshot/portfolio/person/drawdown — NOT schedule rows):
  // a figure cited "today" must come from here, or it's a mislabeled row value.
  allowedToday: Set<number>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.025 * b, 1);
  const check = (key: string, text: string | undefined) => {
    if (!text) return;
    const v = textViolations(text, allowed);
    // Absolute funding claims are a repeat offender the rows keep contradicting.
    if (/\b(entirely|solely|exclusively)\b/i.test(text)) {
      v.push('absolute funding claim ("entirely/solely/exclusively") — describe the actual mix');
    }
    // Calendar years drift off-by-one against ages every round; ages are the
    // verifiable currency of this report.
    if (/\b20[2-9]\d\b/.test(text)) {
      v.push("calendar year in prose — cite ages instead");
    }
    // Dividend dollar amounts invite double-counting income the model then
    // omits from MAGI/bracket math; dividends stay qualitative.
    if (/dividend[^.!?]{0,80}\$\s?\d|\$\s?\d[\d,.]*[KkMm]?[^.!?]{0,80}dividend/i.test(text)) {
      v.push("dollar amount attached to dividends — frame dividends qualitatively");
    }
    // TODAY-context figures must match today's value set, not schedule rows.
    for (const m of text.matchAll(DOLLAR_RE)) {
      const idx = m.index ?? 0;
      const ctx = text.slice(Math.max(0, idx - 60), idx + (m[0]?.length ?? 0) + 60);
      if (!/\btoday\b/i.test(ctx)) continue;
      let fig = parseFloat(m[1].replace(/,/g, ""));
      const suffix = (m[2] ?? "").toLowerCase();
      if (suffix === "million" || suffix === "m") fig *= 1_000_000;
      else if (suffix === "k") fig *= 1_000;
      fig = Math.round(fig);
      if (fig < 1000) continue;
      let ok = false;
      for (const a of allowedToday) if (near(fig, a)) { ok = true; break; }
      if (!ok) {
        // sums of two today-values (e.g. deferred + roth today)
        const arr = [...allowedToday].filter((a) => a < fig * 1.03);
        outer: for (let i = 0; i < arr.length; i++) {
          for (let j = i; j < arr.length; j++) {
            if (Math.abs(arr[i] + arr[j] - fig) <= Math.max(0.025 * fig, 1)) { ok = true; break outer; }
          }
        }
      }
      if (!ok) v.push(`$${fig.toLocaleString()} cited as "today" but matches no today value`);
    }
    if (v.length > 0) map.set(key, v);
  };
  check("situationHeadline", obj.situationHeadline);
  (obj.watchouts ?? []).forEach((w, i) => check(`watchouts[${i}]`, `${w.title} ${w.detail}`));
  (obj.strategies ?? []).forEach((s, i) =>
    check(`strategies[${i}]`, `${s.title} ${s.detail} ${s.quantifiedImpact ?? ""}`),
  );
  (obj.explore ?? []).forEach((e, i) => {
    // Directional ideas carry NO dollar figures at all (prompt rule, enforced):
    // precise-sounding sizing in an unmodeled idea is how trust dies.
    const text = `${e.title} ${e.detail}`;
    const v = textViolations(text, allowed);
    if (extractDollarFigures(text).length > 0) v.push("dollar figure in a directional idea");
    if (v.length > 0) map.set(`explore[${i}]`, v);
  });
  return map;
}

/**
 * Generate the strategy section from a plan's compact grounding (which must
 * include schedule grounding) via one bounded structured model call. Returns
 * null on any failure (model error, empty/invalid output) so the caller can
 * create the plan without it. Never throws.
 */
export async function buildStrategySection(
  tenantId: string,
  _userId: string,
  grounding: CompactPlanGrounding,
): Promise<StrategySection | null> {
  // Build the tenant alias map ONCE and reuse it for every model call in this
  // section (draft, corrective retry, verifier, adjudicator) so the boundary
  // never re-reads the DB per call. Guarded: this function must never throw.
  let anon: LlmAnonContext;
  try {
    anon = { tenantId, aliasMap: await buildAliasMap(tenantId) };
  } catch (e) {
    console.error(
      `[strategy] alias map build failed for plan ${grounding.planId}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  // Per-property dollar figures are REDACTED from the strategist's grounding:
  // when a mortgage is unlinked, a property's standalone "equity" is really its
  // gross value (a 2x+ overstatement observed in review), and listing
  // per-property figures next to the netted total never reconciles. Names and
  // rents stay; the netted total and the schedule's equity figures are the only
  // citable equity numbers — the numeric gate then blocks per-property dollars
  // mechanically.
  const redactedGrounding: CompactPlanGrounding = grounding.person?.realEstate
    ? {
        ...grounding,
        person: {
          ...grounding.person,
          realEstate: {
            ...grounding.person.realEstate,
            properties: grounding.person.realEstate.properties.map((pr) => ({
              ...pr,
              value: 0,
              mortgage: 0,
              equity: 0,
            })),
          },
        },
      }
    : grounding;

  // Precomputed today-vs-at-retirement reference for the entities the model
  // most often mislabels (balances, real-estate equity, the retirement year).
  // Verification becomes a lookup instead of arithmetic, which is the
  // difference between the verifier catching this class and missing it.
  const retirementAge = grounding.retirement?.retirementAge ?? null;
  const retireRow = grounding.schedule?.rows.find((r) => r.age === retirementAge) ?? null;
  const currentAge = grounding.snapshot?.age ?? null;
  const timepointReference = {
    today: {
      byTaxBucket: Object.fromEntries(
        (grounding.retirement?.drawdownOrder ?? []).map((d) => [d.bucket, d.balance]),
      ),
      portfolioTotal: grounding.portfolio?.totalValue ?? null,
      totalAssetsIncludingRealEstate: grounding.snapshot?.totalAssets ?? null,
      realEstateEquity: grounding.person?.realEstate?.totalEquity ?? null,
    },
    atRetirement: retireRow
      ? {
          age: retireRow.age,
          calendarYear:
            currentAge != null && retirementAge != null && grounding.schedule
              ? grounding.schedule.assumptions.taxYear + (retirementAge - currentAge)
              : null,
          byTaxBucket: Object.fromEntries(
            Object.entries(retireRow.buckets).map(([b, f]) => [b, f.end]),
          ),
          totalPortfolio: retireRow.totalPortfolio,
          realEstateEquity: retireRow.realEstate?.equity ?? null,
        }
      : null,
  };

  const basePrompt = `Here is the person's plan data as JSON:\n\n${JSON.stringify(redactedGrounding)}\n\nTIMEPOINT REFERENCE (exact values for "today" vs "at retirement"):\n${JSON.stringify(timepointReference)}`;

  // The set of citable numbers: everything in the grounding, plus the explicitly
  // allowed derived products (15%/20% of the tax-free capacity — the common
  // "tax saved at the LTCG rate" statement).
  const allowed = new Set<number>();
  collectGroundedNumbers(redactedGrounding, allowed);
  const cap = grounding.schedule?.flags?.taxFreeCapacityAtRetirement;
  if (typeof cap === "number" && cap > 0) {
    allowed.add(Math.round(cap * 0.15));
    allowed.add(Math.round(cap * 0.2));
  }

  // Today's value set for the today-context gate: everything EXCEPT the
  // schedule rows/flags (whose values are at future ages).
  const allowedToday = new Set<number>();
  collectGroundedNumbers(
    {
      snapshot: redactedGrounding.snapshot,
      portfolio: redactedGrounding.portfolio,
      person: redactedGrounding.person,
      drawdownOrder: redactedGrounding.retirement?.drawdownOrder ?? [],
      today: timepointReference.today,
    },
    allowedToday,
  );

  // One bounded call, retried on parse failure (the OpenRouter -> Bedrock route
  // occasionally returns unparseable JSON for larger payloads).
  const attempt = async (prompt: string) => {
    let result: {
      object: StrategyObject;
      usage?: { inputTokens?: number; outputTokens?: number };
    } | null = null;
    for (let i = 0; i < 2 && result === null; i++) {
      try {
        result = await llmGenerateObject(anon, {
          model: getModel(STRATEGY_LEVEL),
          schema: strategySchema,
          system: SYSTEM_PROMPT,
          prompt,
          temperature: 0.25,
          maxOutputTokens: 4000,
        });
      } catch (e) {
        console.error(
          `[strategy] model call failed for plan ${grounding.planId} (attempt ${i + 1}):`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    if (result) {
      logLlmUsage({
        tenantId,
        source: "strategy",
        model: getModelSlug(STRATEGY_LEVEL),
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });
    }
    return result?.object ?? null;
  };

  let object = await attempt(basePrompt);
  if (object === null) return null;

  // Grounded-figure gate: if the draft cites figures that exist nowhere in the
  // data (or internal identifiers), give the model ONE corrective pass with the
  // violations named, then drop anything still violating.
  let violations = sectionViolations(object, allowed, allowedToday);
  if (violations.size > 0) {
    const detail = [...violations.entries()]
      .map(([k, v]) => `${k}: ${v.join(", ")}`)
      .join("; ");
    console.warn(`[strategy] ungrounded figures for plan ${grounding.planId}: ${detail}`);
    const corrected = await attempt(
      `${basePrompt}\n\nIMPORTANT: your previous draft cited figures that appear NOWHERE in the data: ${detail}. Every dollar figure must be a figure from the data (or a single stated rate times one, computed correctly), and prose must never contain internal field identifiers. Rewrite the section fully grounded.`,
    );
    if (corrected) {
      object = corrected;
      violations = sectionViolations(object, allowed, allowedToday);
    }
  }

  const dropped = (key: string) => {
    if (!violations.has(key)) return false;
    console.warn(
      `[strategy] dropping still-ungrounded ${key} for plan ${grounding.planId}: ${violations.get(key)!.join(", ")}`,
    );
    return true;
  };

  // Adversarial fact-check on what survives the numeric gate: semantic errors
  // (mis-sized ranges, bad arithmetic, cross-item contradictions, wrong legal
  // claims) that regex cannot see. Fail-open on verifier error.
  const failedVerify = await verifyItems(anon, redactedGrounding, object, timepointReference);
  const rejected = (key: string) => {
    if (!failedVerify.has(key)) return false;
    console.warn(
      `[strategy] verifier rejected ${key} for plan ${grounding.planId}: ${failedVerify.get(key)}`,
    );
    return true;
  };

  const situationHeadline =
    dropped("situationHeadline") || rejected("headline")
      ? ""
      : (object.situationHeadline ?? "").trim();

  const watchouts = (object.watchouts ?? [])
    .filter((_, i) => !dropped(`watchouts[${i}]`) && !rejected(`w${i}`))
    .map((w) => ({ title: (w.title ?? "").trim(), detail: (w.detail ?? "").trim() }))
    .filter((w) => w.title && w.detail);

  const strategies = (object.strategies ?? [])
    .filter((_, i) => !dropped(`strategies[${i}]`) && !rejected(`s${i}`))
    .map((s) => ({
      title: (s.title ?? "").trim(),
      detail: (s.detail ?? "").trim(),
      quantifiedImpact: s.quantifiedImpact ? s.quantifiedImpact.trim() : undefined,
    }))
    .filter((s) => s.title && s.detail)
    .map((s) => (s.quantifiedImpact ? s : { title: s.title, detail: s.detail }));

  const explore = (object.explore ?? [])
    .filter((_, i) => !dropped(`explore[${i}]`) && !rejected(`e${i}`))
    .map((e) => ({ title: (e.title ?? "").trim(), detail: (e.detail ?? "").trim() }))
    .filter((e) => e.title && e.detail);

  // Nothing worth showing -> treat as no strategy section.
  if (!situationHeadline && watchouts.length === 0 && strategies.length === 0 && explore.length === 0) {
    return null;
  }

  return {
    section: "strategy",
    situationHeadline,
    watchouts,
    strategies,
    explore,
    generatedAt: new Date().toISOString(),
  };
}
