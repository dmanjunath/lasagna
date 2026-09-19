import { Hono } from "hono";
import { eq, and, desc, inArray, insights, accounts, transactions, sql } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import {
  generateInsights,
  heldSecurityNames,
  observesRatherThanActs,
  personalizesPortfolio,
  pricesTaxSaving,
  statesAGuessedSpan,
  taxSafeImpactColor,
  NO_HELD_SECURITIES,
  type HeldSecurities,
} from "../lib/insights-engine.js";
import {
  claimsRecurrence,
  effortForSpendCut,
  generateSpendCuts,
  impactLabelForSpendCut,
  lastSpendCutsPolishAt,
  spendCutTotals,
  spendCutsWindow,
  statesUnknownFigure,
  SPEND_CUTS_PRODUCER,
  type SpendCutMetadata,
} from "../lib/spend-cuts.js";
import { readPathSteps } from "../lib/path-generator.js";
import { readHouseholdProfile } from "../lib/profile-resolver.js";
import { UUID_RE } from "../lib/taxonomy.js";
import { env } from "../lib/env.js";

export const insightsRoutes = new Hono<AuthEnv>();

// Cloud Scheduler is the happy path for daily regeneration. If it stalls, the
// next read older than this window regenerates synchronously as a backstop.
//
// This doubles as the COOLDOWN between two generation attempts for the same
// household, because generateInsights records the attempt whether it succeeded
// or not. That is the brake on this path: the marker used to be written only on
// success, ~140 lines past the parse that could throw, so a household whose
// generation kept failing was stale on every single read and every single read
// paid for a fresh model call. useInsights is mounted on the home screen as
// well as /insights, so nearly every navigation re-entered it. One household
// ran 303 calls for $23.78 in 15 hours that way.
const REGEN_STALE_MS = 48 * 60 * 60 * 1000;

function loadActiveInsights(tenantId: string) {
  return db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, tenantId),
        sql`${insights.dismissed} IS NULL`,
        sql`${insights.actedOn} IS NULL`,
        sql`(${insights.snoozedUntil} IS NULL OR ${insights.snoozedUntil} < NOW())`,
        sql`(${insights.expiresAt} IS NULL OR ${insights.expiresAt} > NOW())`
      )
    )
    .orderBy(
      // Critical first, then high, medium, low
      sql`CASE ${insights.urgency}
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END`,
      // Biggest saving first inside one urgency band. Spend-cut rows take their
      // urgency from the KIND of finding, so without this the largest saving
      // can sit under the smallest one in the same band. NULLS LAST leaves
      // every model-authored row (which carries no figure) exactly where it was,
      // ordered by createdAt below.
      sql`${insights.monthlyValue} DESC NULLS LAST`,
      desc(insights.createdAt)
    );
}

/**
 * The actions, read in the order of the plan they serve.
 *
 * Urgency alone is what this list used to be sorted by, and it is what made the
 * page a feed: a card at step six sat above the step the person is standing on
 * because it happened to be marked critical. So the step comes first, and
 * urgency decides the order WITHIN a step, which is what the SQL above already
 * gives us. The sort is stable, so nothing else has to be re-stated here.
 *
 * An action with no step is shown, after every action that has one. Dropping it
 * would silently lose real advice the path has no rung for, like a fraud alert
 * or a document to file.
 */
function inPathOrder<T extends { pathStepKey: string | null }>(
  rows: T[],
  steps: Awaited<ReturnType<typeof readPathSteps>>,
): T[] {
  if (steps.length === 0) return rows;
  const position = new Map(steps.map((s) => [s.key, s.step]));
  // A key that no longer names a step on the active path is treated exactly as
  // no key at all, which is what keeps a regenerated path from hiding anything.
  const at = (row: T) => position.get(row.pathStepKey ?? "") ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => at(a) - at(b));
}

/**
 * Every rule that decides whether a STORED row may still be shown, in one place
 * so the two routes below cannot disagree about what is servable.
 *
 * Applying these on the way out as well as on the way in is what makes a rule
 * take effect the moment it deploys. A row written before the rule existed sits
 * in the table saying the banned thing until that household next regenerates,
 * which is a daily cron away at best and 48 hours at worst. Suppressed rather
 * than deleted: the row is the model's output, not the user's data, but it
 * still carries a dismissed/snoozed state a purge would throw away, and the
 * next generation replaces every non-dismissed row anyway.
 */
function servable(
  r: {
    title: string;
    description: string | null;
    impact: string | null;
    category: string | null;
    insightType: string | null;
    producer?: string | null;
    generatedBy?: string | null;
    evidence?: string | null;
    monthlyValue?: string | null;
    oneTimeValue?: string | null;
    metadata?: unknown;
  },
  held: HeldSecurities,
): boolean {
  // The spend-cuts producer writes deterministic figures with its own two copy
  // rules, and none of the model-copy rules below apply to it. Both predicates
  // are imported from lib/spend-cuts.ts so each still has exactly one
  // definition, on the write path and here.
  if (r.producer === SPEND_CUTS_PRODUCER) {
    const meta = (r.metadata ?? {}) as Partial<SpendCutMetadata>;
    const monthly = r.monthlyValue == null ? null : Number(r.monthlyValue);
    const oneTime = r.oneTimeValue == null ? null : Number(r.oneTimeValue);
    if (r.generatedBy === "ai") {
      if (
        statesUnknownFigure({
          description: r.description ?? "",
          evidence: r.evidence ?? null,
          monthlySaving: monthly ?? oneTime ?? 0,
          annualSaving: meta.annualSaving ?? null,
        })
      ) {
        console.warn(`[SpendCuts] Suppressed a row that states a figure the finding does not have`);
        return false;
      }
      if (claimsRecurrence(meta.kind ?? "", r.description ?? "")) {
        console.warn(`[SpendCuts] Suppressed a row that calls a one-off amount a recurring one`);
        return false;
      }
    }
    // A row the page would print as "$0". One-off rows carry a null monthly
    // value and are not asked the question, which is the point of the split.
    if (monthly != null && Math.round(monthly) < 1) return false;
    return true;
  }

  const copy = { title: r.title, description: r.description, impact: r.impact };
  if (pricesTaxSaving(copy)) return false;
  // Rules 3 and 14. Suppressed rather than trimmed to the offending sentence: a
  // row whose title only asks you to look has no move left once the observation
  // is taken out, and a body that priced somebody else's card cannot be repaired
  // into one that does not. Silence is the honest failure here.
  if (observesRatherThanActs(copy)) return false;
  if (statesAGuessedSpan(copy)) return false;
  // The family is carried through because it decides whether a security NAME is
  // looked for at all: outside the holdings families the same words are shops
  // and cards, so a debt or spending action keeps its "Visa" and its "Target".
  const withFamily = { ...copy, category: r.category, type: r.insightType };
  if (env.HOSTED_MODE && personalizesPortfolio(withFamily, held)) return false;
  return true;
}

// The securities this household holds, read once per request and only where the
// rule that needs them applies. A self-hosted deployment never pays the query.
function heldForRequest(tenantId: string): Promise<HeldSecurities> {
  return env.HOSTED_MODE ? heldSecurityNames(tenantId) : Promise.resolve(NO_HELD_SECURITIES);
}

// Only a tenant with accounts can produce actions. Used to skip the backstop
// lock/regen path for empty (pre-connection) tenants, whose lastActionsGeneratedAt
// is null and would otherwise re-enter generateInsights on every read only for it
// to no-op. Mirrors generateInsights' own 0-account early return.
async function tenantHasAccounts(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether the stored spend cuts are old enough to redo.
 *
 * The monthly scheduled run is the happy path. If it is missed, the read is
 * what keeps it correct: anything worked out before this month is redone on the
 * next look. Monthly rather than daily because these findings barely move — a
 * duplicate subscription is the same duplicate tomorrow.
 *
 * A SECOND marker, never the one the actions backstop reads. That one gates a
 * paid model call at 48 hours; this one gates a free deterministic recompute at
 * a calendar month. Sharing one marker is what made a free regeneration close
 * the paid refresh throttle, and the same reasoning forbids sharing here.
 */
function spendCutsStale(last: Date | string | null | undefined, now: Date): boolean {
  if (!last) return true;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(last).getTime() < monthStart.getTime();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07-01". UTC, so the link never lands on a different day by timezone. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The calendar month a finding measured, or null.
 *
 * window.end is the first of the month still running, so the month before it is
 * the last complete one.
 */
function analysisMonth(w: { end: string } | undefined): Date | null {
  if (!w) return null;
  const end = new Date(w.end);
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
}

/**
 * What the transactions behind a finding ARE, as a noun phrase.
 *
 * The count line prints it, so the two figures a row shows stop reading as a
 * contradiction: the pill is the excess over this household's own typical
 * month, while the rows beneath it are the whole month's spend. "The 3
 * transactions behind this" under a $367 pill, over rows summing to $780.34,
 * made both numbers look wrong when both were right.
 */
function txnScopeFor(meta: Partial<SpendCutMetadata>): string | null {
  const month = analysisMonth(meta.window);
  if (meta.kind === "category_above_trend" && meta.categoryName && month) {
    return `${meta.categoryName} transactions in ${MONTH_NAMES[month.getUTCMonth()]} ${month.getUTCFullYear()}`;
  }
  if (meta.merchantName) return `${meta.merchantName} transactions`;
  return null;
}

type DayRange = { start: string; end: string };

/**
 * The first and last day the finding's own transactions fall on, as YYYY-MM-DD,
 * or null when none of its ids resolved to a row.
 *
 * This is what holds a merchant drill to what the row counted. It is a text
 * search, so the span it carries is the only other thing narrowing it: over the
 * whole analysis window, a row whose evidence read "one bank fee of $2,900.00 on
 * Apr 16" landed on three rows totalling $11,800, two of them unrelated
 * transfers that merely matched the name.
 */
function txnDayRange(
  meta: Partial<SpendCutMetadata>,
  hydrated: Map<string, { date: string }>,
): DayRange | null {
  const days = (meta.txnIds ?? [])
    .map((id) => hydrated.get(id)?.date.slice(0, 10))
    .filter((d): d is string => d != null)
    .sort();
  if (days.length === 0) return null;
  return { start: days[0]!, end: days[days.length - 1]! };
}

/**
 * Where a spend-cut row drills to, built here rather than in the client so the
 * label and the URL cannot disagree.
 *
 * A category finding's figure describes ONE month, so its link is scoped to that
 * month. Everything else is a merchant, scoped to the days its own transactions
 * fall on. That is still a text search, so a same-day match on an unrelated
 * transaction remains possible — which is why no count appears in a label: it
 * would be a promise the destination cannot keep.
 *
 * The scope is spelled `search`, `categories`, `startDate` and `endDate`,
 * which are the names /transactions reads and the names it writes back to the
 * address bar (see filtersFromQuery/filtersToSearchParams in
 * TransactionFilters). Emitting them here rather than renaming in the client
 * keeps ONE spelling for this destination: a second set of names is how
 * "See August's transactions" once landed on nine months of rows.
 */
function drillFor(
  meta: Partial<SpendCutMetadata>,
  txnDays: DayRange | null,
): { label: string; href: string } | null {
  if (!meta.txnIds || meta.txnIds.length === 0) return null;
  const w = meta.window;
  if (!w) return { label: "See these in Transactions", href: "/transactions" };

  // The month the detector measured, and its last day.
  const end = new Date(w.end);
  const analysisStart = analysisMonth(w)!;
  const analysisEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
  const monthName = MONTH_NAMES[analysisStart.getUTCMonth()];

  if (meta.kind === "category_above_trend" && meta.categoryId && meta.categoryName) {
    const q = new URLSearchParams({
      categories: meta.categoryId,
      startDate: ymd(analysisStart),
      endDate: ymd(analysisEnd),
    });
    return {
      label: `See ${monthName}'s ${meta.categoryName} transactions`,
      href: `/transactions?${q}`,
    };
  }
  if (meta.merchantName) {
    // The finding's own days, so the destination reflects what the row counted.
    // The window is the fallback for a finding whose transactions have since
    // been deleted, where there is no narrower span left to use.
    const q = new URLSearchParams({
      search: meta.merchantName,
      startDate: txnDays?.start ?? ymd(new Date(w.start)),
      endDate: txnDays?.end ?? ymd(analysisEnd),
    });
    return { label: `See your ${meta.merchantName} transactions`, href: `/transactions?${q}` };
  }
  return { label: "See these in Transactions", href: "/transactions" };
}

/**
 * The transactions behind the spend-cut rows about to be served, in one query.
 *
 * Hydrated here because the receipt is what makes a figure believable, and the
 * client has no way to turn a list of ids into rows without a second round trip
 * per action.
 */
async function txnsBehindFindings(
  tenantId: string,
  ids: string[],
): Promise<Map<string, { id: string; date: string; merchant: string; amount: number; isIncome: boolean }>> {
  const out = new Map<string, { id: string; date: string; merchant: string; amount: number; isIncome: boolean }>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(and(eq(transactions.tenantId, tenantId), inArray(transactions.id, ids)));
  for (const r of rows) {
    const amount = Number(r.amount);
    out.set(r.id, {
      id: r.id,
      date: new Date(r.date).toISOString(),
      merchant: r.merchantName ?? r.name,
      amount,
      isIncome: amount < 0,
    });
  }
  return out;
}

/**
 * The top three transactions behind one finding: LARGEST first, not most
 * recent, because the large rows are what make the figure believable. Date
 * descending breaks a tie.
 */
function topTxnsFor(
  meta: Partial<SpendCutMetadata>,
  hydrated: Awaited<ReturnType<typeof txnsBehindFindings>>,
) {
  return (meta.txnIds ?? [])
    .map((id) => hydrated.get(id))
    .filter((t): t is NonNullable<typeof t> => t != null)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.date.localeCompare(a.date))
    .slice(0, 3);
}

// List active insights (not dismissed, not snoozed, not expired)
insightsRoutes.get("/", async (c) => {
  const session = c.get("session");

  let rows = await loadActiveInsights(session.tenantId);
  // lastActionsGeneratedAt is household bookkeeping on the tenant profile row.
  let profile = await readHouseholdProfile(session.tenantId);
  // Read once: both backstops gate on it, and the payload reports it so a
  // pre-connection household can tell "connect an account" from "nothing found".
  const hasAccounts = await tenantHasAccounts(session.tenantId);

  const last = profile?.lastActionsGeneratedAt;
  const stale = !last || Date.now() - new Date(last).getTime() > REGEN_STALE_MS;
  if (stale && hasAccounts) {
    // Advisory xact-lock keyed off the tenant id keeps concurrent stale reads
    // from double-generating. It lives on the transaction's connection and
    // auto-releases on commit/rollback, so it can't leak. If another request
    // holds it we skip and return the (possibly stale) rows we already have.
    let regenerated = false;
    try {
      regenerated = await db.transaction(async (tx) => {
        const locked = await tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtext(${session.tenantId})) as locked`
        );
        if (!(locked as unknown as Array<{ locked: boolean }>)[0]?.locked) return false;
        await generateInsights(session.tenantId);
        return true;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Insights] Backstop regeneration failed: ${msg.slice(0, 300)}`);
    }
    if (regenerated) {
      rows = await loadActiveInsights(session.tenantId);
      profile = await readHouseholdProfile(session.tenantId);
    }
  }

  // The second producer's backstop. A SEPARATE transaction from the one above,
  // not a second statement inside it: both take the same tenant-keyed advisory
  // lock, so sharing a transaction would mean a held insights lock silently
  // skipped the spend-cut regeneration for a whole month.
  //
  // Deterministic on purpose: generateSpendCuts is called WITHOUT `polish`, so
  // looking at the page can never bill a model call. The rewritten wording
  // arrives on the monthly cron or on an explicit refresh press.
  if (spendCutsStale(profile?.lastSpendCutsGeneratedAt, new Date()) && hasAccounts) {
    let regenerated = false;
    try {
      regenerated = await db.transaction(async (tx) => {
        const locked = await tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtext(${session.tenantId})) as locked`
        );
        if (!(locked as unknown as Array<{ locked: boolean }>)[0]?.locked) return false;
        await generateSpendCuts(session.tenantId);
        return true;
      });
    } catch (e) {
      // A failed regeneration must not fail the read. Stale suggestions are
      // worth more than an error page.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[SpendCuts] Backstop regeneration failed: ${msg.slice(0, 300)}`);
    }
    if (regenerated) {
      rows = await loadActiveInsights(session.tenantId);
      profile = await readHouseholdProfile(session.tenantId);
    }
  }

  const pathSteps = await readPathSteps(session.tenantId);
  // A key that names no step on the path AS IT STANDS is not an answer, it is a
  // leftover: the path was reordered, or the step was taken off it, or nothing
  // has attached this action yet. Resolving here rather than in each reader is
  // what makes the payload mean what it says — a consumer that trusted the raw
  // column would file an orphan under a step that is not on the plan.
  const onPath = new Set(pathSteps.map((s) => s.key));

  // The same rules the insert loop applies, applied again on the way out.
  const held = await heldForRequest(session.tenantId);
  const shown = inPathOrder(rows, pathSteps).filter((r) => servable(r, held));

  // The spend-cut subset, AFTER servable() has had its say. The totals are
  // computed over exactly this array and never as a SQL aggregate: servable()
  // suppresses rows, so a database total would count money the reader cannot
  // see and the headline would not add up to the list beneath it.
  const spendCutRows = shown.filter((r) => r.producer === SPEND_CUTS_PRODUCER);
  const metaOf = (r: (typeof shown)[number]) => (r.metadata ?? {}) as Partial<SpendCutMetadata>;
  const hydrated = await txnsBehindFindings(
    session.tenantId,
    [...new Set(spendCutRows.flatMap((r) => metaOf(r).txnIds ?? []))],
  );

  const window = await spendCutsWindow(session.tenantId);
  const lastPolish = await lastSpendCutsPolishAt(session.tenantId);

  return c.json({
    insights: shown.map((r) => {
      const meta = metaOf(r);
      const isSpendCut = r.producer === SPEND_CUTS_PRODUCER;
      return {
        id: r.id,
        // Which workflow wrote this row. `generatedBy` still answers the other
        // question, which is who wrote its words.
        producer: r.producer,
        category: r.category,
        urgency: r.urgency,
        // Null on every action written before effort existed, and on one the
        // model declined to rate. The reader decides what an absent answer means.
        //
        // A detected row's effort and label are DERIVED here rather than read off
        // the columns, from the one definition in lib/spend-cuts.ts, exactly as
        // the two copy guards above are re-applied on the way out. These rows are
        // recomputed once a month, so a row stored before either rule changed
        // would otherwise keep its old wording for up to a month: "Involved" on a
        // row titled "Check what drove Groceries up", and "Saves $367/mo" on a row
        // that hands nothing back.
        effort: isSpendCut && meta.kind && meta.size
          ? effortForSpendCut(meta.kind, meta.size)
          : r.effort,
        type: r.insightType,
        title: r.title,
        description: r.description,
        impact: isSpendCut && meta.kind
          ? impactLabelForSpendCut(meta.kind, Number(r.monthlyValue ?? r.oneTimeValue ?? 0))
          : r.impact,
        impactColor: taxSafeImpactColor({
          category: r.category,
          type: r.insightType,
          impactColor: r.impactColor,
        }),
        chatPrompt: r.chatPrompt,
        generatedBy: r.generatedBy,
        createdAt: r.createdAt,
        // The step of the path this action serves. Null when it serves none, and
        // null when the key names no step on the path as it stands.
        pathStepKey: r.pathStepKey && onPath.has(r.pathStepKey) ? r.pathStepKey : null,
        // The figure, as a number rather than as the words in `impact`. Null on
        // every model-authored row, and monthlyValue null on a one-off.
        monthlyValue: r.monthlyValue == null ? null : Number(r.monthlyValue),
        oneTimeValue: r.oneTimeValue == null ? null : Number(r.oneTimeValue),
        evidence: r.evidence,
        kind: meta.kind ?? null,
        merchantName: meta.merchantName ?? null,
        categoryId: meta.categoryId ?? null,
        txnIds: meta.txnIds ?? [],
        // The receipt: the three largest transactions behind the figure, plus
        // how many there are in total, so the list can say what it is showing
        // three of.
        transactions: isSpendCut ? topTxnsFor(meta, hydrated) : [],
        txnCount: meta.txnIds?.length ?? 0,
        // What those transactions are, so the count line can name the scope the
        // rows cover rather than let it read as the pill's own scope.
        txnScope: isSpendCut ? txnScopeFor(meta) : null,
        drill: isSpendCut ? drillFor(meta, txnDayRange(meta, hydrated)) : null,
      };
    }),
    lastActionsGeneratedAt: profile?.lastActionsGeneratedAt ?? null,
    // The second producer's freshness marker. Two timestamps, because they
    // answer two questions, and neither may be read for the other's.
    lastSpendCutsGeneratedAt: profile?.lastSpendCutsGeneratedAt ?? null,
    // When this household last asked to PAY for the rewrite, which is the only
    // thing the refresh throttle may go on.
    lastPolishAttemptAt: lastPolish?.toISOString() ?? null,
    spendCuts: spendCutTotals(spendCutRows),
    analysisWindow: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      months: window.months,
    },
    hasAccounts,
  });
});

/**
 * Regenerate the spend-cut findings on request, paying for the rewrite.
 *
 * Throttled off this household's last PAID attempt, so holding the button down
 * cannot bill a model call per press. Six hours rather than the monthly
 * staleness rule: a person who has just cancelled a duplicate subscription
 * should see it go today, but nothing here moves fast enough to be worth asking
 * twice in an afternoon.
 *
 * Deliberately NOT the freshness marker, which the free read backstop also
 * writes. Sharing one marker meant a household that had simply not been looked
 * at this month arrived to a dimmed Refresh and a six hour wait.
 *
 * One path segment, so it cannot collide with /:id/*.
 */
const SPEND_CUTS_REFRESH_THROTTLE_MS = 6 * 60 * 60 * 1000;

insightsRoutes.post("/refresh-spend-cuts", async (c) => {
  const session = c.get("session");

  const lastPolish = await lastSpendCutsPolishAt(session.tenantId);
  if (lastPolish && Date.now() - lastPolish.getTime() < SPEND_CUTS_REFRESH_THROTTLE_MS) {
    return c.json({ error: "throttled" }, 429);
  }

  try {
    // The press pays for the rewrite. It is one of the two paths that do.
    const generated = await generateSpendCuts(session.tenantId, { polish: true });
    return c.json({ ok: true, generated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[SpendCuts] Generation failed: ${msg.slice(0, 300)}`);
    return c.json({ error: "generation_failed" }, 502);
  }
});

// Dismiss an insight
insightsRoutes.post("/:id/dismiss", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();
  // Postgres raises on a malformed uuid, which would otherwise surface as a 500
  // on what is really a bad request.
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  await db
    .update(insights)
    .set({ dismissed: new Date() })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true });
});

// Mark an insight as acted on
insightsRoutes.post("/:id/acted", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);

  await db
    .update(insights)
    .set({ actedOn: new Date() })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true });
});

// Snooze an insight for N hours (default 24h)
insightsRoutes.post("/:id/snooze", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();
  if (!UUID_RE.test(id)) return c.json({ error: "Invalid id" }, 400);
  const { hours = 24 } = (await c.req.json().catch(() => ({}))) as { hours?: number };

  const until = new Date(Date.now() + hours * 60 * 60 * 1000);

  await db
    .update(insights)
    .set({ snoozedUntil: until })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true, snoozedUntil: until.toISOString() });
});

// Get dismissed/historical insights
insightsRoutes.get("/history", async (c) => {
  const session = c.get("session");

  const rows = await db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, session.tenantId),
        sql`${insights.dismissed} IS NOT NULL`
      )
    )
    .orderBy(desc(insights.createdAt))
    .limit(50);

  // Dismissed rows were served unfiltered, which left the banned copy readable
  // in the one place a person goes to look back at it.
  const held = await heldForRequest(session.tenantId);

  return c.json({
    insights: rows.filter((r) => servable(r, held)).map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      description: r.description,
      impact: r.impact,
      dismissedAt: r.dismissed,
      actedOnAt: r.actedOn,
      createdAt: r.createdAt,
    })),
  });
});

// Generate new insights (triggers AI analysis)
insightsRoutes.post("/generate", async (c) => {
  const session = c.get("session");

  try {
    const count = await generateInsights(session.tenantId);
    return c.json({ ok: true, generated: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Insights] Generation failed: ${msg.slice(0, 300)}`);
    return c.json({ error: "generation_failed" }, 502);
  }
});
