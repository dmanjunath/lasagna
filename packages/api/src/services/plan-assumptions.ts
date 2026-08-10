/**
 * Plan CHANGES — scalar assumption overrides + the regeneration harness.
 *
 * A plan's chat can request changes that adjust a small set of scalar
 * assumptions and regenerate the plan document off them. This module owns the
 * `PlanAssumptions` shape (persisted as a JSON string in `financial_plans.
 * assumptions`), the derivation of those assumptions into engine overrides, and
 * `regeneratePlan`, which rebuilds `document.sections` by re-running the SAME
 * builders the create path uses, THREADING the overrides through so the whole
 * document (retirement verdict, what-ifs, schedule, strategy) reconciles with
 * the change.
 *
 * Slice (a) supports: exclude Social Security, retirement-age override,
 * expected-return override, monthly-spend override. Room is left for later
 * slices (e.g. sold-property account ids) without a schema change.
 *
 * NON-CORRUPTING: regeneration builds a NEW document in memory and returns it;
 * the caller swaps the stored `document` on success only. A failure here leaves
 * the stored plan untouched.
 */

import { buildRetirementReadiness } from "./retirement-readiness.js";
import { buildWhatIfSection } from "./what-if-section.js";
import { buildNarrativeSection, type NarrativeSection } from "./narrative-section.js";
import { buildFinancialSnapshot } from "./financial-snapshot.js";
import { buildRetirementSchedule } from "./retirement-schedule.js";
import { buildStrategySection } from "./strategy-section.js";
import { toCompactGrounding, resolvePersonContext } from "./plan-grounding.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import {
  deriveSimOverrides,
  computePropertySaleAdjustment,
  type PlanAssumptions,
} from "./plan-assumptions-overrides.js";
import type { StoredSections } from "./plan-grounding.js";
import type { WhatIfSection } from "./what-if-section.js";
import type { SuggestionsSection } from "./suggestions-section.js";
import type { ScheduleSection } from "./retirement-schedule.js";
import type { StrategySection } from "./strategy-section.js";

// Re-export the pure assumptions half so existing importers keep a single entry
// point (the leaf module exists only to break a module-load cycle).
export {
  deriveSimOverrides,
  type PlanAssumptions,
  type SimOverrideSet,
} from "./plan-assumptions-overrides.js";

/**
 * The full stored `document.sections` set. `StoredSections` (from plan-grounding)
 * only carries the four the grounding compaction reads; the persisted document
 * also holds whatIfs / suggestions / narrative, which regeneration must preserve
 * or replace. This is that complete shape.
 */
export type DocumentSections = StoredSections & {
  whatIfs?: WhatIfSection;
  suggestions?: SuggestionsSection;
  narrative?: NarrativeSection;
  schedule?: ScheduleSection;
  strategy?: StrategySection;
};

/**
 * Rebuild a plan's `document.sections` off `assumptions`, re-running the SAME
 * builders plan-create uses with the assumptions-derived overrides threaded
 * through. Snapshot + portfolio are unaffected by these scalar overrides, so the
 * caller's already-stored sections for them are reused verbatim (passed in as
 * `existingSections`) rather than recomputed.
 *
 * Only the retirement verdict, what-ifs, schedule, and strategy depend on the
 * assumptions, so only those are rebuilt. LEGACY plans (stored narrative +
 * suggestions, no strategy) instead regenerate their narrative and get no
 * schedule/strategy injected (no legacy page renders them).
 *
 * Returns the NEW document object; the caller persists it on success only.
 */
export async function regeneratePlan(
  tenantId: string,
  userId: string,
  plan: { title: string; sections: DocumentSections },
  assumptions: PlanAssumptions | null,
): Promise<{ sections: DocumentSections }> {
  const { overrides, flatReturn } = deriveSimOverrides(assumptions);

  // ── Property-sale reclassification — computed ONCE, threaded everywhere ──────
  // Net equity from any hypothetically sold property (value − its linked
  // mortgage) is added to investable; the sold property + mortgage drop from the
  // asset/debt sums. Compute it here from the accounts snapshot and feed the SAME
  // numbers to the snapshot, the sim (extraInvestable), and the grounding, so the
  // three surfaces can't drift: net worth stays unchanged, only reclassified.
  const soldIds = assumptions?.soldPropertyAccountIds;
  const hasSale = !!soldIds && soldIds.length > 0;
  const saleAdjustment = hasSale
    ? computePropertySaleAdjustment(await fetchAccountsWithBalances(tenantId), soldIds)
    : null;
  const extraInvestable = saleAdjustment?.netEquity;

  // ── Retirement readiness — the analytical heart, re-run with the overrides ──
  const retirement = await buildRetirementReadiness(
    tenantId,
    userId,
    overrides,
    flatReturn,
    extraInvestable,
  );

  // ── What-ifs — the same engine, same overrides as the base projection ───────
  // Only worth running when the base projection was computable, exactly like the
  // create path. Wrapped so a scenario (or the whole build) can't fail regen.
  let whatIfs = null;
  if (retirement.computed) {
    try {
      whatIfs = await buildWhatIfSection(
        tenantId,
        userId,
        retirement.successRate,
        overrides,
        flatReturn,
        extraInvestable,
      );
    } catch (e) {
      console.error("[plan-assumptions] what-if regeneration failed:", e);
    }
  }

  // ── Snapshot — rebuilt when a sale reclassifies balances (or is REVERSED) ────
  // Scalar assumptions (SS / age / return / spend) don't touch the snapshot, so
  // the stored one carries through untouched. But a sale moves value between
  // buckets, and REVERSING one (soldProperties present on the stored snapshot but
  // no sale now) must restore it — so rebuild whenever either is true. Passing a
  // null adjustment rebuilds the plain, un-reclassified snapshot.
  const storedSnapshot = plan.sections.snapshot ?? null;
  let snapshot = storedSnapshot;
  const needsSnapshotRebuild = !!saleAdjustment || !!storedSnapshot?.soldProperties?.length;
  if (needsSnapshotRebuild) {
    try {
      snapshot = await buildFinancialSnapshot(tenantId, userId, saleAdjustment ?? undefined);
    } catch (e) {
      console.error("[plan-assumptions] snapshot regeneration failed:", e);
    }
  }

  const person = await resolvePersonContext(tenantId, userId, assumptions);

  // ── Legacy plans (stored narrative + suggestions, no strategy) ──────────────
  // Keep the OLD regen behavior: rebuild the narrative so its prose reconciles
  // with the fresh verdict, and do NOT inject schedule/strategy sections no
  // legacy document was designed to carry. Wrapped so an LLM hiccup keeps the
  // previous narrative rather than dropping it.
  const isLegacy = !plan.sections.strategy && !!plan.sections.narrative;
  if (isLegacy) {
    let narrative = plan.sections.narrative ?? null;
    try {
      const grounding = toCompactGrounding(
        "pending",
        plan.title,
        { ...plan.sections, ...(snapshot ? { snapshot } : {}), retirement },
        person,
        assumptions,
      );
      const regenerated = await buildNarrativeSection(tenantId, userId, grounding);
      if (regenerated) narrative = regenerated;
    } catch (e) {
      console.error("[plan-assumptions] narrative regeneration failed:", e);
    }
    return {
      sections: {
        ...plan.sections,
        ...(snapshot ? { snapshot } : {}),
        retirement,
        ...(whatIfs ? { whatIfs } : {}),
        ...(narrative ? { narrative } : {}),
      },
    };
  }

  // ── Schedule — the deterministic drawdown table, re-run with the SAME overrides
  // so the scenario change flows through it (SS excluded, age/return/spend, and a
  // sale's reinvested net equity). Wrapped so a failure keeps the stored schedule.
  let schedule = plan.sections.schedule ?? null;
  let scheduleFresh = false;
  try {
    schedule = await buildRetirementSchedule(tenantId, userId, {
      overrides,
      flatReturn,
      extraInvestable,
      person,
    });
    scheduleFresh = true;
  } catch (e) {
    console.error("[plan-assumptions] schedule regeneration failed:", e);
  }

  // ── Strategy — one bounded LLM regen so it reflects the change, grounded on the
  // SAME compact figures WITH the freshly-regenerated schedule attached and the
  // assumptions threaded in. Wrapped so an LLM hiccup keeps the previous strategy.
  // Only when the schedule ACTUALLY rebuilt: regenerating strategy against the
  // stale stored schedule would ground fresh prose on old-assumption figures.
  let strategy = plan.sections.strategy ?? null;
  if (scheduleFresh) {
    try {
      const grounding = toCompactGrounding(
        "pending",
        plan.title,
        { ...plan.sections, ...(snapshot ? { snapshot } : {}), retirement },
        person,
        assumptions,
        schedule,
      );
      const regenerated = await buildStrategySection(tenantId, userId, grounding);
      if (regenerated) strategy = regenerated;
    } catch (e) {
      console.error("[plan-assumptions] strategy regeneration failed:", e);
    }
  } else {
    console.warn(
      "[plan-assumptions] schedule regen failed — keeping the stored strategy (skipping strategy regen)",
    );
  }

  // Reuse portfolio / goals / suggestions / narrative verbatim — the last two are
  // legacy sections untouched by the new wiring. Swap in the freshly-built
  // retirement, what-ifs, schedule, strategy, and (on a sale) the reclassified
  // snapshot.
  const sections: DocumentSections = {
    ...plan.sections,
    ...(snapshot ? { snapshot } : {}),
    retirement,
    ...(whatIfs ? { whatIfs } : {}),
    ...(schedule && schedule.computed ? { schedule } : {}),
    ...(strategy ? { strategy } : {}),
  };

  return { sections };
}
