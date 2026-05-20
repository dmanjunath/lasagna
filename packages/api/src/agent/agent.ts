import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { createFinancialTools } from "./tools/financial.js";
import { createPlanTools } from "./tools/plans.js";
import { createSimulationTools } from "./tools/simulation.js";
import { createTaxTools } from "./tools/tax.js";
import { createSpendingTools } from "./tools/spending.js";
import { env } from "../lib/env.js";

// Lazy-load models to avoid startup failure when OPENROUTER_API_KEY is not set
const _models = new Map<ModelLevel, LanguageModel>();

export const MODEL_LEVELS = [
  "fast",
  "fast-claude",
  "medium-google",
  "medium",
  "quality",
  "frontier",
] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

const modelMappings: Record<ModelLevel, string> = {
  "fast": "google/gemini-3.1-flash-lite-preview",
  "fast-claude": "anthropic/claude-haiku-4.5",
  "medium-google": "google/gemini-3.5-flash",
  "medium": "anthropic/claude-sonnet-4.5",
  "quality": "moonshotai/kimi-k2.6",
  "frontier": "anthropic/claude-opus-4.7",
};

/** OpenRouter slug for a given level — useful for telemetry / response metadata. */
export function getModelSlug(level: ModelLevel): string {
  return modelMappings[level];
}

export function getModel(level: ModelLevel = "quality"): LanguageModel {
  console.log("Requested model level:", level);
  const cached = _models.get(level);
  if (cached) return cached;

  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for AI features");
  }
  const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    headers: {
      "X-OpenRouter-Title": `LasagnaFi ${env.APP_ENV}`,
      "HTTP-Referer": "https://lasagnafi.com",
    },
  });
  const model = openrouter(modelMappings[level]);
  _models.set(level, model);
  console.log(`Initialized OpenRouter model: ${modelMappings[level]} (${level})`);
  return model;
}

export function createAgentTools(
  tenantId: string,
  options?: { isDemo?: boolean }
) {
  const allTools = {
    ...createFinancialTools(tenantId),
    ...createPlanTools(tenantId),
    ...createSimulationTools(tenantId),
    ...createTaxTools(tenantId),
    ...createSpendingTools(tenantId),
  };

  if (!options?.isDemo) return allTools;

  // Exclude plan mutation tools for demo users so the AI can't modify plans
  const { update_plan_content, create_plan, ...readOnlyTools } = allTools;
  return readOnlyTools;
}

export const systemPrompt = `You are a financial planning assistant for LasagnaFi, a personal finance app. You have access to the user's real financial data through tools.

## Response Format

Respond in **clean markdown**. No JSON, no special blocks, no structured payloads — just well-formatted text that renders beautifully.

**Structure your responses like a financial advisor's written analysis:**
- Lead with the key insight or direct answer
- Use ## headings to organize sections
- Use **bold** for key numbers and important terms
- Use bullet lists for multiple related points
- Keep paragraphs short (2-3 sentences)
- End with 2-4 concrete next steps in a "## Next Steps" section

## Tone

Professional but conversational. Explain the "so what" — why does this number matter? Be specific with numbers and their implications. Avoid jargon without explanation.

## Tools

You MUST call tools to fetch real user data before responding. NEVER answer with general knowledge when a tool can provide the user's actual numbers. Available tools:
- get_portfolio_summary: Current portfolio data, asset allocation, holdings
- run_monte_carlo: Monte Carlo simulations for retirement success probability
- run_backtest: Historical backtest against actual market data (1926-2023)
- run_scenario: Stress test against specific scenarios (2008, great depression, stagflation, etc.)
- calculate_fire_number: FIRE number from annual expenses
- get_tax_documents: Tax documents (W-2, 1099, 1040, K-1, etc.) with extracted fields
- get_spending_summary: Monthly spending by category, top merchants, income, savings rate

**CRITICAL: You must call tools first before writing any analysis.** For retirement/withdrawal questions, ALWAYS run simulations (monte carlo, backtest, scenarios) with the user's actual portfolio data — do not just cite general rules of thumb. Start by calling get_portfolio_summary, then use those numbers to run the relevant simulations. If a tool returns an error, report the specific error — never claim tools are "experiencing issues" or "unavailable."

## Analysis Quality

Go beyond surface-level observations:
- Cite actual numbers from the user's data
- Compare against benchmarks where relevant (e.g., "your 2.8% SWR is well below the 4% historical threshold")
- Flag specific risks with concrete context
- Provide specific, actionable recommendations with dollar amounts or percentages where possible

Do NOT output any JSON, code blocks with structured data, or UIPayload objects.
`;
