/**
 * Builds the "Narrative" section of a Financial Plan document — a prose-led,
 * consulting-report analysis of the person's plan: an executive summary plus a
 * per-theme written interpretation of the REAL resolved figures. It's the report
 * SPINE; the deterministic charts/tables render beneath it as supporting exhibits.
 *
 * ONE bounded structured LLM call (generateObject + a zod schema) whose prompt
 * receives the SAME compact grounding the chat agent and suggestions section see,
 * so the prose references only the user's actual accounts / balances / rates and
 * never invents numbers.
 *
 * RESILIENCE: this must NEVER throw. Plan-create wraps deterministic sections
 * around it, and an LLM hiccup must not 500 the create. A failed/empty/invalid
 * model response returns null; the plan still creates with no narrative.
 */

import { z } from "zod";
import { llmGenerateObject } from "../lib/llm.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "../lib/activity.js";
import type { CompactPlanGrounding } from "./plan-grounding.js";

// Mid-tier model: same tier as suggestions — cheap enough for a create-time call,
// strong enough to write grounded, interpretive prose over the figures.
const NARRATIVE_LEVEL = "medium" as const;

// The FIXED theme keys the UI maps onto its existing sections. The model MUST
// use these exact keys; unknown keys are dropped in code so the UI mapping never
// breaks.
export const NARRATIVE_THEME_KEYS = [
  "situation",
  "retirement_readiness",
  "income_sources",
  "risks_opportunities",
  "recommendations",
  "whatifs",
] as const;

export type NarrativeThemeKey = (typeof NARRATIVE_THEME_KEYS)[number];

export interface NarrativeTheme {
  key: NarrativeThemeKey;
  heading: string;
  /** 1-3 paragraphs of prose interpreting the figures for this theme. */
  body: string;
}

export interface NarrativeSection {
  section: "narrative";
  executiveSummary: string;
  themes: NarrativeTheme[];
  generatedAt: string;
}

// Structured output contract. Lengths/counts are NOT encoded as zod min/max:
// those serialize to JSON-Schema maxItems/maxLength/minLength, which the
// OpenRouter -> Bedrock route for the medium model rejects ("property 'maxItems'
// is not supported"), throwing on every call. Bounds (fixed theme set, prose
// length) are steered in the prompt and post-processed in code below.
const themeSchema = z.object({
  key: z
    .string()
    .describe(
      "One of: situation, retirement_readiness, income_sources, risks_opportunities, recommendations, whatifs.",
    ),
  heading: z.string().describe("Short section heading for this theme."),
  body: z.string().describe("1-3 paragraphs of prose interpreting the figures."),
});

const narrativeSchema = z.object({
  executiveSummary: z
    .string()
    .describe("2-3 paragraph executive summary of the person's overall position."),
  themes: z.array(themeSchema),
});

const SYSTEM_PROMPT = `You are a senior financial planner writing the narrative of a client's financial plan in the voice of a consulting-firm report. You interpret the numbers; you do not merely restate them.

You are given the client's ACTUAL plan figures as JSON (net worth, accounts, allocation, retirement success rate and ages, drawdown order, Social Security estimate, real estate equity and rental income, guaranteed income, demographics, stated goals, top spending, tax summary). Write an executive summary and a per-theme analysis grounded ONLY in those figures.

Output an "executiveSummary" (2 to 3 paragraphs) and a "themes" array. Each theme has a "key", a short "heading", and a "body" of 1 to 3 prose paragraphs. Use EXACTLY these theme keys, once each, in this order:
- situation: the client's current financial position (net worth, assets vs debt, cash flow, savings capacity).
- retirement_readiness: what the success rate, retirement age, and projection mean for their odds of retiring on their terms.
- income_sources: the income that will fund retirement. You MUST discuss Social Security (the monthly benefit and the claim age), real-estate equity and any rental income, and explicitly note if there is no pension on file. Explain how these sources layer with portfolio withdrawals.
- risks_opportunities: the key risks (sequence risk, concentration, longevity, healthcare before Medicare) and opportunities the figures reveal.
- recommendations: the highest-leverage moves this client should consider, grounded in their figures.
- whatifs: how changing the retirement age, spending, or plan-end age would move the odds.

Rules:
- Reference ONLY figures, accounts, and rates present in the provided JSON. NEVER invent a number, balance, account, percentage, age, or benefit that is not in the data. If a figure is null or absent, say it is not on file rather than guessing.
- If assumptions have been applied (the "appliedAssumptions" object), state them as the READER'S CHOSEN SCENARIO, not as gaps in the data. When socialSecurityExcluded is true, say Social Security has been EXCLUDED at the reader's request for this scenario; do NOT say it is "not on file" and do NOT speculate about whether it will supplement the plan (that null Social Security figure is a deliberate exclusion, not missing data). Likewise frame expectedReturnOverride, retirementAgeOverride, and monthlySpendOverride as assumptions this reader chose for the scenario (e.g. "this scenario assumes a 6% return"), not as the only possible outcome. When soldProperties is present, each named property has been SOLD in this scenario: do NOT cite it, its equity, or its rent as a current holding (it has been removed from the real-estate figures on purpose). Instead say the property is sold and its net proceeds (reinvestedFromSales) are reinvested alongside the existing investments, in plain language for a non-expert.
- Use ONLY the exact dollar figures present in the data. Do NOT perform arithmetic to derive new dollar amounts (totals, nets, differences, annualizations) yourself. If a derived figure is not already in the data, describe it qualitatively instead of inventing a number. The real-estate figures already include the derived amounts you need: cite annualRent, annualCarryingCosts, and netAnnualRent (and their totals) directly rather than computing rent, insurance, maintenance, or net rental income on your own.
- Distinguish property VALUE, MORTGAGE balance, and EQUITY precisely. Real-estate "equity" means the equity figure provided (value minus mortgage), never the gross value. When you cite total real-estate equity, use totalEquity, not totalValue.
- Interpret, do not just restate: explain what each number means for this client and why it matters.
- Write in clear, professional prose. No bullet lists inside a body; use full sentences and paragraphs.
- Formatting: break the prose into short paragraphs, each of 2 to 4 sentences, separated by a blank line (\n\n between paragraphs). The executive summary must be 2 to 3 short paragraphs; each theme body must be 2 to 4 short paragraphs. Never return a single unbroken block.
- Do not use em dashes or en dashes anywhere in your output.`;

/**
 * Generate the narrative section from a plan's compact grounding via one bounded
 * structured model call. Returns null on any failure (model error, empty/invalid
 * output) so the caller can create the plan without it. Never throws.
 */
export async function buildNarrativeSection(
  tenantId: string,
  _userId: string,
  grounding: CompactPlanGrounding,
): Promise<NarrativeSection | null> {
  // Feed the model the SAME compact grounding the chat agent and suggestions use
  // — the real, reconciled numbers — serialized as JSON so the prose cannot drift
  // from the plan.
  const prompt = `Here is the client's plan data as JSON:\n\n${JSON.stringify(grounding)}`;

  // The claude-sonnet-4.5 OpenRouter route occasionally returns JSON that
  // generateObject can't parse for this larger prose payload ("Invalid JSON
  // response"). It's intermittent, so a single retry lands the narrative on the
  // vast majority of creates; on a second failure we still return null cleanly.
  let result: { object: z.infer<typeof narrativeSchema>; usage?: { inputTokens?: number; outputTokens?: number } } | null = null;
  for (let attempt = 0; attempt < 2 && result === null; attempt++) {
    try {
      result = await llmGenerateObject({ tenantId }, {
        model: getModel(NARRATIVE_LEVEL),
        schema: narrativeSchema,
        system: SYSTEM_PROMPT,
        prompt,
        temperature: 0.4,
        // Prose is longer than the suggestions list: an executive summary plus six
        // themes of 1-3 paragraphs. Kept bounded, but with enough headroom that the
        // structured JSON always closes — too low a ceiling truncates mid-object
        // and fails the parse ("No object generated"), losing the whole narrative.
        maxOutputTokens: 4000,
      });
    } catch (e) {
      console.error(
        `[narrative] model call failed for plan ${grounding.planId} (attempt ${attempt + 1}):`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (result === null) return null;

  logLlmUsage({
    tenantId,
    source: "narrative",
    model: getModelSlug(NARRATIVE_LEVEL),
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });

  const executiveSummary = (result.object.executiveSummary ?? "").trim();

  // Keep only themes with a known key + prose body, de-duped by key so a repeated
  // key can't render twice, in the fixed UI order.
  const allowed = new Set<string>(NARRATIVE_THEME_KEYS);
  const seen = new Set<string>();
  const themes: NarrativeTheme[] = (result.object.themes ?? [])
    .map((t) => ({ key: t.key.trim(), heading: (t.heading ?? "").trim(), body: (t.body ?? "").trim() }))
    .filter((t) => allowed.has(t.key) && t.heading && t.body && !seen.has(t.key) && seen.add(t.key))
    .map((t) => ({ key: t.key as NarrativeThemeKey, heading: t.heading, body: t.body }))
    .sort(
      (a, b) => NARRATIVE_THEME_KEYS.indexOf(a.key) - NARRATIVE_THEME_KEYS.indexOf(b.key),
    );

  // Nothing worth showing (no summary and no themes) -> treat as no narrative.
  if (!executiveSummary && themes.length === 0) return null;

  return {
    section: "narrative",
    executiveSummary,
    themes,
    generatedAt: new Date().toISOString(),
  };
}
