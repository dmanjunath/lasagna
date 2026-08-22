/**
 * Builds the "Suggestions" section of a Financial Plan document — an
 * agent-generated list of concrete next steps (portfolio rebalancing, Roth
 * conversion, Rule 72(t), NUA, early-retirement healthcare gotchas, etc.)
 * grounded in the plan's REAL resolved figures.
 *
 * ONE bounded structured LLM call (generateObject + a zod schema) whose prompt
 * receives the SAME compact grounding the chat agent sees — so every suggestion
 * references only the user's actual accounts / balances / rates and never
 * invents numbers.
 *
 * RESILIENCE: this must NEVER throw. Plan-create wraps deterministic sections
 * around it, and an LLM hiccup must not 500 the create. A failed/empty/invalid
 * model response returns null; the plan still creates with no suggestions.
 */

import { z } from "zod";
import { llmGenerateObject } from "../lib/llm.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "../lib/activity.js";
import type { CompactPlanGrounding } from "./plan-grounding.js";

// Mid-tier model: cheap enough for a create-time call, strong enough to reason
// over the grounding and phrase concrete, non-generic advice.
const SUGGESTIONS_LEVEL = "medium" as const;

export interface Suggestion {
  /** Short imperative title, e.g. "Rebalance toward bonds". */
  title: string;
  /** 1-2 sentence rationale citing the user's real figures. */
  rationale: string;
  /** Optional expected impact, e.g. "Raises success rate by ~4pts". */
  impact?: string;
  /** Optional grouping label, e.g. "Portfolio", "Tax", "Healthcare". */
  category?: string;
}

export interface SuggestionsSection {
  section: "suggestions";
  items: Suggestion[];
  generatedAt: string;
}

// Structured output contract. Lengths/count are NOT encoded as zod
// min/max here: those serialize to JSON-Schema maxItems/maxLength/minLength,
// which the OpenRouter -> Bedrock route for the medium model rejects
// ("property 'maxItems' is not supported"), throwing on every call. The 3-6
// item bound and terse copy are enforced in the prompt and post-processed in
// code below (slice to 6; empty -> no suggestions).
const suggestionSchema = z.object({
  title: z.string().describe("Short imperative title for the next step."),
  rationale: z
    .string()
    .describe("1-2 sentences citing the user's real figures from the plan."),
  impact: z
    .string()
    .optional()
    .describe("Optional expected impact of taking this step."),
  category: z
    .string()
    .optional()
    .describe("Optional grouping label, e.g. 'Portfolio', 'Tax', 'Healthcare'."),
});

const suggestionsSchema = z.object({
  items: z.array(suggestionSchema),
});

const SYSTEM_PROMPT = `You are a financial planner writing concrete next steps for one person's plan.

You are given that person's ACTUAL plan figures as JSON (net worth, accounts, allocation, retirement success rate, drawdown order, stated goals). Recommend 3-6 specific next steps grounded ONLY in those figures.

Rules:
- Reference ONLY figures, accounts, and rates present in the provided JSON. NEVER invent a number, balance, account, or percentage that is not in the data.
- Each suggestion: a short imperative "title", a 1-2 sentence "rationale" that cites the user's real figures, and an optional short "impact".
- Prefer concrete, well-known planning moves when the data supports them: portfolio rebalancing toward a target allocation, Roth conversions in low-income years, Rule 72(t) / SEPP for penalty-free early withdrawals, NUA on employer stock, and early-retirement healthcare (ACA subsidies / MAGI) gotchas.
- If a move does not apply to this person's data, do not suggest it. Do not pad to hit a count.
- Do not restate the plan back to the user; give ACTIONS. Keep it specific and free of jargon the rationale does not explain.
- Do not use em dashes, en dashes, middots, or semicolons. Write complete sentences and write ranges as "X to Y".`;

/**
 * Generate the suggestions section from a plan's compact grounding via one
 * bounded structured model call. Returns null on any failure (model error,
 * empty/invalid output) so the caller can create the plan without it. Never
 * throws.
 */
export async function buildSuggestionsSection(
  tenantId: string,
  _userId: string,
  grounding: CompactPlanGrounding,
): Promise<SuggestionsSection | null> {
  // Feed the model the SAME compact grounding the chat agent uses — the real,
  // reconciled numbers — serialized as JSON so it cannot drift from the plan.
  const prompt = `Here is the person's plan data as JSON:\n\n${JSON.stringify(grounding)}`;

  let result;
  try {
    result = await llmGenerateObject({ tenantId }, {
      model: getModel(SUGGESTIONS_LEVEL),
      schema: suggestionsSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      maxOutputTokens: 900,
    });
  } catch (e) {
    console.error(
      `[suggestions] model call failed for plan ${grounding.planId}:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  logLlmUsage({
    tenantId,
    source: "suggestions",
    model: getModelSlug(SUGGESTIONS_LEVEL),
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    costUsd: result.costUsd,
  });

  // Trim and drop any item the model left without the two required fields; if
  // nothing survives, treat it as no suggestions rather than an empty card.
  const items: Suggestion[] = (result.object.items ?? [])
    .map((it) => ({
      title: it.title.trim(),
      rationale: it.rationale.trim(),
      impact: it.impact?.trim() || undefined,
      category: it.category?.trim() || undefined,
    }))
    .filter((it) => it.title && it.rationale)
    .slice(0, 6);

  if (items.length === 0) return null;

  return { section: "suggestions", items, generatedAt: new Date().toISOString() };
}
