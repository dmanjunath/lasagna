// Reads a household's spending, runs the deterministic detector over it, and
// stores what it found as ACTIONS, in the same table the insights engine writes
// to. Every figure, every size and every counted fact comes out of
// spend-cut-detector.ts, and nothing here can change one.
//
// Two producers share that table and are told apart by `producer`. This one is
// monthly, free and deterministic; the insights engine is daily and model
// authored. Every producer-wide delete on either side is scoped by that column,
// or one workflow erases the other's set on its next run.
//
// One model call may rewrite the BODY, and only the body. It is handed findings
// that are already complete and already correct, it returns a description per
// finding, and a rewrite that states a dollar figure the finding was never
// given is thrown away in favour of the template wording it was meant to
// replace. The TITLE is out of reach entirely: it is the remedy, it is curated
// in spend-cut-detector.ts, and a remedy that named a price no bank feed
// contains would be caught by nothing, because an invented discount is not a
// figure about the household at all. Which layer wrote a given line is recorded
// per row in generated_by, so the question is always answerable.

import {
  activityEvents,
  and,
  asc,
  categories,
  categoryGroups,
  eq,
  financialProfiles,
  insights,
  notInArray,
  accounts,
  sql,
  transactions,
} from "@lasagna/core";
import { z } from "zod";
import { db } from "./db.js";
import { isTenantDisabled } from "./billing.js";
import { excludedTxnAccountIds } from "./account-balances.js";
import {
  detectSpendCuts,
  type AnalysisWindow,
  type DetectorTxn,
  type SpendCutFinding,
  type SpendCutKind,
  type SpendCutSize,
} from "./spend-cut-detector.js";
import { llmGenerateObject } from "./llm.js";
import { buildAliasMap, descrub, type AliasMap } from "./pii-scrubber.js";
import { normalizePunctuation } from "./insights-engine.js";
import { getModel } from "../agent/index.js";

const WINDOW_MONTHS = 12;

/**
 * The window the figures are computed over: the last 12 COMPLETE calendar
 * months, or from the household's first transaction if there are fewer.
 *
 * The current month is deliberately left out. Including it would make every
 * monthly figure read low on the 2nd and high on the 28th, and a number that
 * moves on its own is a number nobody can check.
 *
 * UTC month boundaries throughout, so the window does not shift with the
 * server's timezone.
 */
export async function spendCutsWindow(
  tenantId: string,
  now: Date = new Date(),
): Promise<AnalysisWindow> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const twelveBack = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - WINDOW_MONTHS, 1));

  const [row] = await db
    .select({ earliest: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.tenantId, tenantId));

  const first = row?.earliest ? new Date(row.earliest) : null;
  const start =
    first && first.getTime() > twelveBack.getTime()
      ? new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1))
      : twelveBack;

  const months = Math.max(
    0,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()),
  );
  return { start, end, months };
}

/**
 * Only a household with accounts can produce suggestions. Used to skip the read
 * backstop for an empty pre-connection tenant, and to let the client tell
 * "connect an account" apart from "nothing found". Mirrors the early return in
 * generateSpendCuts.
 */
export async function tenantHasAccounts(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId))
    .limit(1);
  return rows.length > 0;
}

/**
 * When this household last triggered the paid rewrite, or null if it never has.
 * The refresh throttle reads THIS, and it is the only thing it reads.
 *
 * Two questions had been sharing last_spend_cuts_generated_at, and the free
 * path kept answering the paid one. That marker means "when were these figures
 * worked out", so the free read backstop writes it, and the throttle read it
 * too: a household whose set had merely gone stale had it redone for free on
 * arrival and then found Refresh dimmed with "Next in 6h", having pressed
 * nothing.
 *
 * Read off the model-call ledger rather than a marker of its own, because an
 * activity_events row for source "spend-cuts" IS the event the throttle asks
 * about, and it has two properties a marker would have to be kept honest by
 * hand. A path that makes no model call writes nothing here, so it cannot close
 * the throttle, whoever adds it later. And lib/llm.ts writes the row from a
 * `finally`, so a rewrite that FAILED counts exactly like one that worked:
 * whatever breaks downstream of the model, the attempt is on the record and the
 * household cannot pay for a second one inside the window.
 *
 * Indexed: activity_events_tenant_created_idx is (tenant_id, created_at), which
 * is the scan this walks backwards.
 */
export async function lastSpendCutsPolishAt(tenantId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<string | Date | null>`max(${activityEvents.createdAt})` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.tenantId, tenantId),
        eq(activityEvents.kind, "llm"),
        eq(activityEvents.source, "spend-cuts"),
      ),
    );
  return row?.at ? new Date(row.at) : null;
}

/**
 * The household's spending in the window, under the exact filter every other
 * spending reader applies: nothing the person excluded, nothing from an account
 * they hid from spending views, and no income or transfer rows. Drifting from
 * this makes the same month read differently on two screens, which is a bug
 * users notice and nobody can explain.
 */
async function readSpending(tenantId: string, window: AnalysisWindow): Promise<DetectorTxn[]> {
  const excludedAccounts = await excludedTxnAccountIds(tenantId);
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categorySystemKey: categories.systemKey,
      plaidCategoryDetailed: transactions.plaidCategoryDetailed,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        sql`${transactions.excludedAt} IS NULL`,
        // Money out only. A refund is not a charge, and feeding one to the
        // recurring detector would read as a subscription billing a negative.
        sql`${transactions.amount} > 0`,
        sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
        sql`${transactions.date} >= ${window.start.toISOString()}`,
        sql`${transactions.date} < ${window.end.toISOString()}`,
        ...(excludedAccounts.length > 0
          ? [notInArray(transactions.accountId, excludedAccounts)]
          : []),
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.id));

  return rows.map((r) => ({
    id: r.id,
    date: new Date(r.date),
    name: r.name,
    merchantName: r.merchantName,
    // numeric(19,2) arrives as a string from the driver.
    amount: parseFloat(r.amount),
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    categorySystemKey: r.categorySystemKey,
    plaidCategoryDetailed: r.plaidCategoryDetailed,
  }));
}

// ── The figure rule ───────────────────────────────────────────────────────
//
// The detector owns every number. The model owns the words. This is the part
// that holds those two apart when the model writes a figure anyway.

/** Every "$1,234.50"-shaped run in a piece of copy. */
const CURRENCY_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g;

/**
 * "$1,234.50", "$1234.5" and the stored "1234.50" all land on the same string,
 * so a figure restated in a different spelling still counts as the same figure.
 */
function canonicalAmount(raw: string | number): string | null {
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function amountsIn(text: string): string[] {
  const out: string[] = [];
  for (const run of text.match(CURRENCY_RE) ?? []) {
    const c = canonicalAmount(run);
    if (c) out.push(c);
  }
  return out;
}

/**
 * The same shape the detector writes its figures in, so a figure the model
 * restates is spelled exactly like the one in the receipt under it. By hand
 * rather than via Intl for the same reason the detector does it by hand: a
 * formatter that follows the server's locale is a figure that changes hosts.
 */
function money(n: number): string {
  const [whole, cents] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

/**
 * Enough of a row, stored or about to be, to check its copy against its own
 * figures. The description is the only field the model may write, and the other
 * three are the only place a figure may come from, which is what makes the
 * check identical on the write path and on the read path.
 *
 * The title is deliberately absent. It is deterministic now, so its figures are
 * the detector's own by construction, and checking it here would suppress a
 * perfectly good row the moment a curated remedy named one.
 */
export interface SpendCutRowCopy {
  description: string;
  evidence: string | null;
  /** numeric(19,2) arrives as a string from the driver, as a number from the detector. */
  monthlySaving: number | string;
  annualSaving: number | string | null;
}

/**
 * True when this row's copy states a dollar figure the finding was never given,
 * so the wording may not be stored and may not be shown.
 *
 * PURE, and applied on BOTH paths: as a rewrite is stored, and again in
 * routes/insights.ts as a row is served. Applying it only on the way in
 * leaves a row written by an earlier build saying the invented number until
 * that household next regenerates, which is a month away. Applying it on the
 * way out too costs one regex per row and makes the rule true on deploy. Same
 * call, and the same reasoning, as pricesTaxSaving in insights-engine.ts.
 *
 * Deliberately currency-only. The detector writes money and counts, and a count
 * ("3 fees since June") is already in the facts under every row, so a stray
 * digit there is not a number anyone can be misled by. A dollar figure is.
 */
export function statesUnknownFigure(row: SpendCutRowCopy): boolean {
  const allowed = new Set(amountsIn(row.evidence ?? ""));
  for (const v of [row.monthlySaving, row.annualSaving]) {
    if (v == null) continue;
    const c = canonicalAmount(v);
    if (c) allowed.add(c);
  }
  return amountsIn(row.description).some((a) => !allowed.has(a));
}

/** Every way English says "and again next month". */
const RECURRENCE_RE =
  /\b(a|each|per|every)\s+(month|year)\b|\bmonthly\b|\byearly\b|\bannually\b|\ba\s+week\b|\bweekly\b/i;

/**
 * True when a one-off row's copy calls its figure a recurring one.
 *
 * The figure rule cannot catch this. $2,900 IS the row's own figure, so
 * "$2,900 a month" states nothing the finding does not have and passes every
 * check above. What it changes is the period, and the period is the whole
 * difference between a refund the household gets once and one it gets forever.
 *
 * Only asked of `one_time_fee`, because every other kind IS monthly and saying
 * so is correct. Asked of the description alone, for the same reason the figure
 * rule is: the title is the detector's own words.
 */
export function claimsRecurrence(kind: string, description: string): boolean {
  return kind === "one_time_fee" && RECURRENCE_RE.test(description);
}

// ── The rewrite ───────────────────────────────────────────────────────────

/** Strong enough to phrase advice, cheap enough to run for every household. */
const POLISH_LEVEL = "medium" as const;

const POLISH_SYSTEM = `You rewrite the body of ready-made money-saving suggestions so they read like advice a person wrote, not a filled-in template.

Every suggestion you are given is already correct and already complete. Its title, its size, its dollar figures and the facts behind it were computed before you were asked, and none of them are yours to change. THE TITLE IS FIXED. It names the move the reader should make, it was chosen from a curated list, and you cannot write one: a title is not a field you are given to return. For each suggestion you get an id, a kind, a size, the facts it rests on, the exact figures it is allowed to state, the title it keeps, and the body it has now. Rewrite the description of every id you are given and return it under that same id.

Rules:
- The description is 2 to 3 sentences. The title already says what to do, so do not say it again. Say why the move is worth making and what changes when the reader makes it. Address the reader as "you".
- NEVER write a dollar figure that is not in that suggestion's "figures" list, and write it exactly as it appears there. Do not round one, do not add two together, do not turn a monthly figure into a yearly one, and do not introduce a new one. A suggestion whose copy states a figure it was not given is thrown away, and the template wording is kept instead.
- The wording you were given is already right about WHAT the saving is, and that meaning is not yours to change either. If it says the figure is the gap between one month and a typical month, do not turn it into a total. If it says the figure is the difference a price rise made, do not tell the reader to cancel the thing outright, because cancelling saves a different amount.
- A figure stated once is money back once, not money back every month, and the wording you were given says which it is. Do not turn "once" into "a month" or "a month" into a year.
- The facts are shown to the reader directly under your description, so do not repeat them line by line. Say what they mean.
- NEVER state a figure, a rate or a discount for anything the reader is not already paying for. A bundle, a family plan, another card or another provider may be NAMED, because the title names one, but what any of them costs is that company's number and not one you have, so a price or a saving attached to one is invented.
- On a suggestion whose size is "l", never set a target and never say what the reader ought to spend. That suggestion exists so they know a month ran high, and nothing in their data says what the right amount would have been.
- Do not promise an outcome the facts do not support, and do not guess at a reason the facts do not give.
- No em dashes, no en dashes, no middots, no semicolons. Write ordinary sentences with commas and periods.`;

// Lengths and counts are NOT expressed as zod min/max: they serialize to
// JSON-Schema maxItems/maxLength, which the OpenRouter route for this tier
// rejects outright, so a bound written here would fail every call rather than
// shorten anything. The prompt bounds the prose and the code below bounds the
// rest.
// Exported so the model's ENTIRE write surface can be asserted as a unit: the
// row object has exactly id and description, and a test fails the build if a
// third key is ever added. Narrowing it from two written fields to one is what
// puts the remedy out of reach by construction rather than by instruction. See
// lib/__tests__/spend-cuts-lifecycle.test.ts.
export const polishSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string().describe("The id of the suggestion this rewrite is for, copied exactly."),
      description: z.string().describe("2 to 3 sentences of reasoning addressed to the reader."),
    }),
  ),
});

/** The rewritten body of one row. No title, no figures, no size, no ordering. */
export interface PolishedCopy {
  description: string;
}

/**
 * Punctuation first, real names second.
 *
 * normalizePunctuation is the deterministic half of the punctuation rule the
 * prompt states, and a semicolon is banned by the same rule, so it is turned
 * into the comma the sentence wanted rather than regenerated over. Both run
 * BEFORE descrub, because a restored account name is the user's own text and
 * nothing here should be rewriting that.
 */
function polishField(raw: string, aliasMap: AliasMap): string {
  const clean = normalizePunctuation(raw.trim()).replace(/\s*;\s*/g, ", ");
  return descrub(clean, aliasMap).trim();
}

/**
 * Whether the model may rewrite this row's wording at all.
 *
 * Every kind but one states a figure whose meaning is fixed by the figure
 * itself: a fee is money back, a price rise is the difference, a category is the
 * gap. `duplicate_service` is the exception. Its figure is the CHEAPER of two
 * subscriptions and it is only true of an action the reader has not chosen yet
 * ("drop either one and you save at least this"), so the copy carries half the
 * claim and the number carries the other half.
 *
 * A rewrite came back reading "cutting the pricier option and keeping the
 * cheaper one" over $17.99, which is the price of the one it just told the
 * reader to keep, and it dropped both merchant names on the way. The existing
 * guard cannot catch that: every figure in it was real. Nothing deterministic
 * can, either — "cancel Netflix, you already have Hulu" names both services,
 * invents no figure, and is still the wrong direction beside that number.
 *
 * So the one kind whose meaning a rewrite can invert keeps its own words. The
 * prompt already carries a rule about this and the rule is what failed, which
 * is the argument for not relying on a second one.
 */
function isRewritable(f: SpendCutFinding): boolean {
  return f.kind !== "duplicate_service";
}

/** The figures a finding is allowed to state, in the order a reader meets them. */
function allowedFigures(f: SpendCutFinding): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (display: string) => {
    const c = canonicalAmount(display);
    if (!c || seen.has(c)) return;
    seen.add(c);
    out.push(display);
  };
  for (const run of f.evidence.match(CURRENCY_RE) ?? []) add(run);
  add(money(f.monthlySaving));
  if (f.annualSaving != null) add(money(f.annualSaving));
  return out;
}

/**
 * One model call for the whole set, returning the rewritten wording by finding
 * key. Best effort, and it NEVER throws: generation already produced a complete
 * and correct set of suggestions before the model was consulted, so a call that
 * fails, a response that will not parse and a rewrite that breaks the figure
 * rule all degrade to the same place, which is the template wording.
 *
 * Ids are ordinals rather than finding keys. A finding key carries a category
 * uuid, and there is nothing for the model to do with one.
 */
export async function polishSpendCutCopy(
  tenantId: string,
  findings: SpendCutFinding[],
): Promise<Map<string, PolishedCopy>> {
  const out = new Map<string, PolishedCopy>();
  const rewritable = findings.filter(isRewritable);
  if (rewritable.length === 0) return out;

  const byId = new Map(rewritable.map((f, i) => [`f${i + 1}`, f]));
  const payload = [...byId].map(([id, f]) => ({
    id,
    size: f.size,
    kind: f.kind,
    figures: allowedFigures(f),
    facts: f.evidence,
    // Given so the body does not repeat it, never to be rewritten.
    fixedTitle: f.title,
    currentDescription: f.description,
  }));

  try {
    // descrubOutput: false, and the one written field is descrubbed by hand
    // below, so the punctuation rule runs on the model's own words and not on a
    // restored account name.
    const aliasMap = await buildAliasMap(tenantId);
    const result = await llmGenerateObject(
      { tenantId, source: "spend-cuts", aliasMap, descrubOutput: false },
      {
        model: getModel(POLISH_LEVEL),
        schema: polishSchema,
        system: POLISH_SYSTEM,
        prompt: `Suggestions to rewrite:\n\n${JSON.stringify(payload)}`,
        temperature: 0.3,
        maxOutputTokens: 2000,
        // Tool mode, for the reason strategy-section.ts documents at length:
        // generateObject asks for a JSON response format, OpenRouter turns
        // that into a field the Anthropic routes serving this account reject,
        // and what comes back is prose that fails the schema. Asked for the
        // same rewrite as one forced tool call, which is how these models do
        // structured output natively, it parses first time. Observed here as
        // "No object generated: response did not match schema" on the very
        // first live call, so this is not a precaution.
        viaToolCall: true,
      },
    );

    for (const row of result.object.rows ?? []) {
      const f = byId.get(String(row.id).trim());
      if (!f) continue;
      const description = polishField(row.description ?? "", aliasMap);
      if (!description) continue;
      if (
        statesUnknownFigure({
          description,
          evidence: f.evidence,
          monthlySaving: f.monthlySaving,
          annualSaving: f.annualSaving,
        })
      ) {
        console.warn(
          `[SpendCuts] Rewrite of ${f.findingKey} states a figure the finding does not have — keeping the template wording`,
        );
        continue;
      }
      if (claimsRecurrence(f.kind, description)) {
        console.warn(
          `[SpendCuts] Rewrite of ${f.findingKey} calls a one-off amount a recurring one — keeping the template wording`,
        );
        continue;
      }
      out.set(f.findingKey, { description });
    }
  } catch (e) {
    console.error(
      `[SpendCuts] Copy rewrite failed, keeping template wording: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
  return out;
}

/**
 * The wording one row is stored with, and the record of who wrote it. The only
 * place the ai/rules decision is made, so a row can never claim one and carry
 * the other.
 */
export function copyForRow(
  f: SpendCutFinding,
  rewrite: PolishedCopy | undefined,
): { title: string; description: string; generatedBy: "ai" | "system" } {
  // "system" rather than a word of its own: generated_by is already documented
  // as system | ai | manual, and the template wording IS the system's own.
  // The title is the finding's own either way. Only the body has two authors.
  return rewrite
    ? { title: f.title, description: rewrite.description, generatedBy: "ai" }
    : { title: f.title, description: f.description, generatedBy: "system" };
}

// ── The row ───────────────────────────────────────────────────────────────

/** The workflow that owns these rows. The other producer is the insights engine. */
export const SPEND_CUTS_PRODUCER = "spend-cuts";

/**
 * How pressing the action is, read off the KIND and nothing else. A fee is
 * money the household can usually get back by making one phone call this week,
 * so it leads. Never read off the figure, and never off a model.
 *
 * A category above its own trend is a habit rather than a one-off, and that is
 * already said by `effort: "involved"` on the same row. Urgency must not
 * double-count it: rating it low banded the largest recurring savings on the
 * page under "keep an eye on", below rows worth nothing a month.
 */
const URGENCY_BY_KIND: Record<SpendCutKind, "low" | "medium" | "high"> = {
  fee: "high",
  one_time_fee: "high",
  price_increase: "medium",
  duplicate_service: "medium",
  category_above_trend: "medium",
};

/** The detector's letter, in the words the actions table uses for the same idea. */
const EFFORT_BY_SIZE: Record<SpendCutSize, "quick" | "moderate" | "involved"> = {
  s: "quick",
  m: "moderate",
  l: "involved",
};

/** "$1,234". Whole dollars, the way an action's impact line prints a figure. */
function wholeMoney(n: number): string {
  return `$${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * How much work the row asks of the person.
 *
 * The size letter answers this for every kind that carries a remedy, because the
 * letter measures the change that remedy asks for. The awareness kind carries no
 * remedy at all, so there is no change to measure and the letter cannot answer
 * it: the only move the row offers is to open that month and look, which is one
 * sitting whatever figure sits beside it. Rendered from the letter alone, a row
 * titled "Check what drove Groceries up" wore an "Involved" pill, which
 * described months of work nobody was being asked to do.
 *
 * The letter itself is left as it is, and deliberately: POLISH_SYSTEM reads
 * `size === "l"` to forbid the rewrite setting a target or saying what the
 * household ought to spend, and that rule protects exactly this kind. Moving the
 * letter would switch it off silently.
 *
 * Exported and read on the SERVE path as well as here, the way routes/insights.ts
 * already re-applies the two copy guards. These rows are recomputed once a month,
 * so a row written before this changed would otherwise keep its "Involved" pill
 * for up to a month after the fix deployed.
 */
export function effortForSpendCut(
  kind: SpendCutKind,
  size: SpendCutSize,
): "quick" | "moderate" | "involved" {
  return kind === "category_above_trend" ? "quick" : EFFORT_BY_SIZE[size];
}

/**
 * Whether this kind's figure is money the household gets back.
 *
 * THE answer to that question, so the label, the colour and every total read it
 * rather than each deciding again. Four kinds hand money back. The awareness
 * kind's figure is the size of a gap to go and look at, so it is money back in
 * no period at all and belongs in no savings total.
 */
export function handsMoneyBack(kind: SpendCutKind): boolean {
  return kind !== "category_above_trend";
}

/**
 * The words in a spend-cut row's `impact` label, from its kind and its figure.
 *
 * `impact` is a LABEL and not a datum: monthly_value (or one_time_value) is the
 * column to read for a number, and this is the sentence printed beside it. Four
 * of the five kinds hand money back, so they say so. The awareness kind hands
 * nothing back, so it states the magnitude of the gap and promises nothing.
 *
 * Read on the serve path as well as here, for the same reason as the effort
 * above: a stored "Saves $367/mo" on a row whose whole offer is to go and look is
 * not something to leave readable until the next monthly recompute.
 */
export function impactLabelForSpendCut(kind: SpendCutKind, figure: number): string {
  if (kind === "category_above_trend") return `${wholeMoney(figure)} above usual`;
  if (kind === "one_time_fee") return `${wholeMoney(figure)} back once`;
  return `Saves ${wholeMoney(figure)}/mo`;
}

/**
 * The chat this action opens with. A deterministic template that names the
 * merchant or the category and carries NO figure: the numbers are on the row
 * already, and a prompt that restates one is a second place for them to drift.
 */
function chatPromptForFinding(f: SpendCutFinding): string {
  switch (f.kind) {
    case "fee":
    case "one_time_fee":
      return f.merchantName
        ? `Help me get the fees from ${f.merchantName} refunded and stop them repeating.`
        : "Help me get these bank fees refunded and stop them repeating.";
    case "price_increase":
      return f.merchantName
        ? `Help me handle the price rise at ${f.merchantName}.`
        : "Help me handle this price rise.";
    case "duplicate_service":
      return f.merchantName
        ? `Help me decide whether to keep ${f.merchantName} or the service that overlaps it.`
        : "Help me decide which of these two overlapping subscriptions to keep.";
    case "category_above_trend":
      return f.categoryName
        ? `Help me understand what drove my ${f.categoryName} spending up that month.`
        : "Help me understand what drove this spending up that month.";
  }
}

/** Everything a reader needs about a spend-cut row that is not a column of its own. */
export interface SpendCutMetadata {
  kind: SpendCutKind;
  size: SpendCutSize;
  claimKey: string | null;
  categoryId: string | null;
  /** The household's own label for that category. Only a category finding has one. */
  categoryName: string | null;
  merchantName: string | null;
  txnIds: string[];
  annualSaving: number | null;
  window: { start: string; end: string; months: number };
}

/** One action row, exactly as this producer writes it. */
export interface SpendCutInsightRow {
  tenantId: string;
  producer: typeof SPEND_CUTS_PRODUCER;
  dedupeKey: string;
  category: "general";
  insightType: "spending";
  urgency: "low" | "medium" | "high";
  effort: "quick" | "moderate" | "involved";
  title: string;
  description: string;
  impact: string;
  impactColor: "green" | "amber";
  chatPrompt: string;
  monthlyValue: string | null;
  oneTimeValue: string | null;
  evidence: string;
  metadata: SpendCutMetadata;
  generatedBy: "ai" | "system";
  pathStepKey: null;
  sourceData: null;
  expiresAt: null;
}

/**
 * The stored row for one finding. PURE, and the only place a spend-cut action
 * is assembled.
 *
 * The invariant it exists to make provable: the model's ENTIRE write surface is
 * the description of a row, and even that it only gets if the rewrite passes
 * both figure guards. Every other field here, the title included, is derived
 * from the finding, so a rewrite reading "Save $99,999 every month" changes the
 * wording of nothing and the figures of nothing. Asserted kind by kind in
 * lib/__tests__/spend-cuts-lifecycle.test.ts against a hostile rewrite.
 *
 * `window` is a parameter rather than a field of the finding because the
 * detector computes findings against a window it is handed and does not carry
 * it on each one. Passing it keeps this function pure.
 */
export function insightRowForFinding(
  tenantId: string,
  f: SpendCutFinding,
  window: AnalysisWindow,
  rewrite?: PolishedCopy,
): SpendCutInsightRow {
  // The same two guards the write path applies as a rewrite comes back, applied
  // again HERE, where the row is actually built. A rewrite that reaches this
  // function by any other route still cannot land.
  const vetted =
    rewrite &&
    !statesUnknownFigure({
      description: rewrite.description,
      evidence: f.evidence,
      monthlySaving: f.monthlySaving,
      annualSaving: f.annualSaving,
    }) &&
    !claimsRecurrence(f.kind, rewrite.description)
      ? rewrite
      : undefined;
  const copy = copyForRow(f, vetted);
  const oneOff = f.kind === "one_time_fee";

  return {
    tenantId,
    producer: SPEND_CUTS_PRODUCER,
    dedupeKey: `spend-cut:${f.findingKey}`,
    // A constant. The enum needs no new value: the web resolves which area an
    // action belongs to from `type` first, and `type` says spending.
    category: "general",
    insightType: "spending",
    urgency: URGENCY_BY_KIND[f.kind],
    effort: effortForSpendCut(f.kind, f.size),
    title: copy.title,
    description: copy.description,
    // Rendered from the numeric column beside it, never written by a model.
    impact: impactLabelForSpendCut(f.kind, f.monthlySaving),
    // Green is the colour of money gained. The awareness kind gains none, so it
    // is stored in the caution tone instead. The label beside it already says
    // "above usual", and a column that still said green is exactly how the same
    // claim reached a pill once: a reader of the raw row would paint a gap in
    // the colour of a saving.
    impactColor: handsMoneyBack(f.kind) ? "green" : "amber",
    chatPrompt: chatPromptForFinding(f),
    // The split is the safety property. A one-off leaves monthly_value NULL, so
    // no sum over that column can quietly fold money back once into a total
    // labelled "a month".
    monthlyValue: oneOff ? null : f.monthlySaving.toFixed(2),
    oneTimeValue: oneOff ? f.monthlySaving.toFixed(2) : null,
    evidence: f.evidence,
    metadata: {
      kind: f.kind,
      size: f.size,
      claimKey: f.claimKey,
      categoryId: f.categoryId,
      categoryName: f.categoryName ?? null,
      merchantName: f.merchantName,
      txnIds: f.txnIds,
      annualSaving: f.annualSaving,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        months: window.months,
      },
    },
    generatedBy: copy.generatedBy,
    pathStepKey: null,
    sourceData: null,
    // Deliberately null. These rows are recomputed monthly against real
    // transactions, and a finding that no longer holds is DELETED, which is the
    // truthful version of expiry. A clock-based one would hide a saving the
    // household still has.
    expiresAt: null,
  };
}

/**
 * What the spend-cut rows HAND BACK, over exactly the rows handed in.
 *
 * Pure, and deliberately not a SQL aggregate: the read path suppresses rows
 * after they are selected, so a total computed in the database would count
 * money the reader cannot see and the headline would not add up to the list
 * beneath it.
 *
 * An awareness row is skipped, by `handsMoneyBack` and not by a second rule of
 * its own. Its figure is how far a category ran over its usual month, which is
 * money already spent: summed in here it turned four rows that ask you to go
 * and look into "$1,146 a month" of savings nobody was being offered.
 */
export function spendCutTotals(
  rows: Array<{
    monthlyValue: string | number | null;
    oneTimeValue: string | number | null;
    /** The stored metadata. Its `kind` is what says whether the figure is a saving. */
    metadata?: unknown;
  }>,
): { monthly: number; oneTime: number } {
  let monthly = 0;
  let oneTime = 0;
  for (const r of rows) {
    const kind = (r.metadata as Partial<SpendCutMetadata> | null | undefined)?.kind;
    if (kind && !handsMoneyBack(kind)) continue;
    if (r.monthlyValue != null) monthly += Number(r.monthlyValue);
    if (r.oneTimeValue != null) oneTime += Number(r.oneTimeValue);
  }
  return {
    monthly: Math.round(monthly * 100) / 100,
    oneTime: Math.round(oneTime * 100) / 100,
  };
}

export interface GenerateSpendCutsOptions {
  /**
   * Rewrite the template wording with one model call.
   *
   * OFF by default, and the default is the load-bearing part. The stale-set
   * backstop in routes/insights.ts calls this on a page load, and a page load
   * that bills a model call is how this codebase has run up large costs nobody
   * asked for before now. The read path stays deterministic, fast and free, so
   * only the scheduled monthly run and an explicit refresh press pay for a
   * rewrite. The flag is a parameter rather than a global so the decision is
   * visible at the call site that pays for it.
   */
  polish?: boolean;
}

/** Rewrites a household's spend cuts. Returns how many findings it stored. */
export async function generateSpendCuts(
  tenantId: string,
  options: GenerateSpendCutsOptions = {},
): Promise<number> {
  // Admin pause: a disabled tenant gets nothing generated.
  if (await isTenantDisabled(tenantId)) {
    console.log(`[SpendCuts] Tenant ${tenantId} is disabled — skipping`);
    return 0;
  }
  if (!(await tenantHasAccounts(tenantId))) return 0;

  const window = await spendCutsWindow(tenantId);
  // No complete month yet: everything this household has spent is in the month
  // still running, and a monthly figure divided by zero months is not a figure.
  if (window.months < 1) return 0;

  const txns = await readSpending(tenantId, window);
  const findings = detectSpendCuts(txns, window);
  const rewritten = options.polish
    ? await polishSpendCutCopy(tenantId, findings)
    : new Map<string, PolishedCopy>();
  const now = new Date();

  if (findings.length > 0) {
    await db
      .insert(insights)
      .values(findings.map((f) => insightRowForFinding(tenantId, f, window, rewritten.get(f.findingKey))))
      // An upsert, not an insert, and that is the whole point of the partial
      // unique index on (tenant_id, dedupe_key).
      //
      // I1 — generation writes CONTENT, never STATE. Every field in this set is
      // something the detector or the rewrite just worked out. Not one of
      // dismissed, actedOn, snoozedUntil, expiresAt, createdAt, tenantId,
      // dedupeKey or producer appears, and none of them may: a regeneration
      // that touched any of them would un-dismiss a finding the person called
      // deliberate, or cancel a snooze they set this morning. The rendered SET
      // list is pinned in lib/__tests__/spend-cuts-lifecycle.test.ts.
      .onConflictDoUpdate({
        target: [insights.tenantId, insights.dedupeKey],
        // Matches the index predicate, so Postgres can infer the partial index.
        targetWhere: sql`${insights.dedupeKey} IS NOT NULL`,
        set: {
          category: sql`excluded.category`,
          urgency: sql`excluded.urgency`,
          effort: sql`excluded.effort`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          impact: sql`excluded.impact`,
          impactColor: sql`excluded.impact_color`,
          chatPrompt: sql`excluded.chat_prompt`,
          monthlyValue: sql`excluded.monthly_value`,
          oneTimeValue: sql`excluded.one_time_value`,
          evidence: sql`excluded.evidence`,
          metadata: sql`excluded.metadata`,
          generatedBy: sql`excluded.generated_by`,
          updatedAt: now,
        },
      });
  }

  // I3 — the condition being gone is a deletion, the person having finished
  // with it is a tombstone.
  //
  // A finding that no longer holds is cleared, so it stops being shown. A row
  // the person has dismissed, acted on OR snoozed is kept forever and never
  // re-shown, because deleting it means the next monthly run inserts it again:
  // a snooze would silently become a dismissal followed by a resurrection, and
  // "that duplicate is deliberate" would have to be said again every month.
  //
  // Scoped to this producer. Without that clause this deletes the insights
  // engine's entire non-dismissed set on every monthly run.
  const keys = findings.map((f) => `spend-cut:${f.findingKey}`);
  await db.delete(insights).where(
    and(
      eq(insights.tenantId, tenantId),
      eq(insights.producer, SPEND_CUTS_PRODUCER),
      sql`${insights.dismissed} IS NULL`,
      sql`${insights.actedOn} IS NULL`,
      sql`${insights.snoozedUntil} IS NULL`,
      ...(keys.length > 0 ? [notInArray(insights.dedupeKey, keys)] : []),
    ),
  );

  // When these figures were worked out, whichever path worked them out. This is
  // a FRESHNESS marker and nothing else: it is what the monthly staleness rule
  // in routes/insights.ts reads, and what the page's "Updated …" line prints,
  // so the free backstop has to write it. The paid refresh throttles on
  // lastSpendCutsPolishAt instead, which is why a free run here no longer takes
  // the Refresh button away from anybody.
  await db
    .insert(financialProfiles)
    .values({ tenantId, lastSpendCutsGeneratedAt: now })
    .onConflictDoUpdate({
      target: financialProfiles.tenantId,
      set: { lastSpendCutsGeneratedAt: now },
    });

  return findings.length;
}
