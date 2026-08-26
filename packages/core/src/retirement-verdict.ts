/**
 * One definition of "on track", read by every surface that states one.
 *
 * The verdict used to be written three times: the readiness service had this
 * threshold, the retirement page had its own copy of the constant plus a
 * separate "2 of 3 methods each clear 90%" composite, and the per-method badges
 * judged the same percentage again on an 80/60 scale. Same household, same
 * session, one nav click apart, they contradicted each other: an 80% chance of
 * lasting read "Needs attention" on the path, "On track" in the retirement
 * headline, and "Good" on the badge directly under that headline.
 *
 * So the rule lives here, in the one package both the API and the web app can
 * import, and nothing states a verdict without going through it.
 *
 * The input is always the Monte Carlo chance the money lasts, as an integer
 * percentage, because that is the figure the whole app measures readiness on.
 * Other projections (a historical backtest, a single deterministic path) can be
 * shown alongside it, but they do not get a vote.
 */

/** At or above this chance of the money lasting, a household is on track. */
export const TARGET_SUCCESS = 85;

/** Below this, the gap is too wide to call it a matter of attention. */
const AT_RISK_BELOW = 70;

export type ReadinessVerdict = "on_track" | "needs_attention" | "at_risk";

/** The verdict for a Monte Carlo success rate, given as 0..100. */
export function verdictFor(successPct: number): ReadinessVerdict {
  if (successPct >= TARGET_SUCCESS) return "on_track";
  if (successPct >= AT_RISK_BELOW) return "needs_attention";
  return "at_risk";
}

/** The words a verdict is printed as. Every surface prints these same words. */
export function verdictLabel(verdict: ReadinessVerdict): string {
  if (verdict === "on_track") return "On track";
  if (verdict === "needs_attention") return "Needs attention";
  return "At risk";
}

/** The design-system tone a verdict is coloured with. */
export function verdictTone(verdict: ReadinessVerdict): "positive" | "caution" | "negative" {
  if (verdict === "on_track") return "positive";
  if (verdict === "needs_attention") return "caution";
  return "negative";
}
