/**
 * Plan CHANGES — scalar assumption overrides + the regeneration harness.
 *
 * A plan's chat can request changes that adjust a small set of scalar
 * assumptions and regenerate the plan document off them. This module owns the
 * `PlanAssumptions` shape (persisted as a JSON string in `financial_plans.
 * assumptions`), the derivation of those assumptions into engine overrides, and
 * `regeneratePlan`, which rebuilds `document.sections` by re-running the SAME
 * builders the create path uses, THREADING the overrides through so the whole
 * document (retirement verdict, what-ifs, narrative) reconciles with the change.
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
import { toCompactGrounding, resolvePersonContext } from "./plan-grounding.js";
import { deriveSimOverrides, type PlanAssumptions } from "./plan-assumptions-overrides.js";
import type { StoredSections } from "./plan-grounding.js";
import type { WhatIfSection } from "./what-if-section.js";
import type { SuggestionsSection } from "./suggestions-section.js";

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
};

/**
 * Rebuild a plan's `document.sections` off `assumptions`, re-running the SAME
 * builders plan-create uses with the assumptions-derived overrides threaded
 * through. Snapshot + portfolio are unaffected by these scalar overrides, so the
 * caller's already-stored sections for them are reused verbatim (passed in as
 * `existingSections`) rather than recomputed.
 *
 * Only the retirement verdict, what-ifs, and narrative depend on the assumptions,
 * so only those are rebuilt. Suggestions are intentionally NOT regenerated on the
 * change path (halves the LLM cost of a change; the create-time suggestions
 * stand) — the caller's existing suggestions carry through untouched.
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

  // ── Retirement readiness — the analytical heart, re-run with the overrides ──
  const retirement = await buildRetirementReadiness(tenantId, userId, overrides, flatReturn);

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
      );
    } catch (e) {
      console.error("[plan-assumptions] what-if regeneration failed:", e);
    }
  }

  // ── Narrative — one bounded LLM regen so income_sources etc. reflect the
  // change (e.g. Social Security excluded rather than paying $X). Grounded on the
  // SAME compact figures, with the assumptions threaded into the person context.
  // Wrapped so an LLM hiccup keeps the previous narrative rather than dropping it.
  const person = await resolvePersonContext(tenantId, userId, assumptions);
  let narrative = plan.sections.narrative ?? null;
  try {
    const grounding = toCompactGrounding(
      "pending",
      plan.title,
      { ...plan.sections, retirement },
      person,
      assumptions,
    );
    const regenerated = await buildNarrativeSection(tenantId, userId, grounding);
    if (regenerated) narrative = regenerated;
  } catch (e) {
    console.error("[plan-assumptions] narrative regeneration failed:", e);
  }

  // Reuse snapshot / portfolio / goals / suggestions verbatim — unaffected by the
  // scalar overrides. Swap in the freshly-built retirement, what-ifs, narrative.
  const sections: DocumentSections = {
    ...plan.sections,
    retirement,
    ...(whatIfs ? { whatIfs } : {}),
    ...(narrative ? { narrative } : {}),
  };

  return { sections };
}
