import type { ColorRoles } from "@lasagna/design";

/**
 * The meaningful color map (owner, 2026-11-23): one fixed meaning per color.
 * Good (on track, under, money back) is basil, attention (slipping, needs a
 * look) is yellow, bad (behind, over, owed) is sauce. Only real verdicts take
 * these, never decoration: a component with no verdict keeps its own color.
 */
export type Verdict = "good" | "attention" | "bad";

/** A verdict's color for text and small marks (contrast-safe ink). */
export function verdictInk(c: ColorRoles, v: Verdict): string {
  return v === "good" ? c.positive : v === "attention" ? c.caution : c.negative;
}

/** A verdict's color for a filled shape: a progress bar, a jar's fill, a dot. */
export function verdictFill(c: ColorRoles, v: Verdict): string {
  return v === "good" ? c.brand : v === "attention" ? c.celebration : c.negative;
}
