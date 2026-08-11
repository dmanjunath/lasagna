import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { createFinancialTools } from "./tools/financial.js";
import { createPlanTools, createFinancialPlanTools } from "./tools/plans.js";
import { createSimulationTools } from "./tools/simulation.js";
import { createTaxTools } from "./tools/tax.js";
import { createSpendingTools } from "./tools/spending.js";
import { env } from "../lib/env.js";

// Lazy-load models to avoid startup failure when OPENROUTER_API_KEY is not set.
// Keyed by level plus whether OpenRouter's web-search plugin is enabled, so the
// plain and web-search variants of a level don't collide in the cache.
const _models = new Map<string, LanguageModel>();

export const MODEL_LEVELS = [
  "free",
  "fast",
  "fast-claude",
  "medium-google",
  "medium",
  "quality",
  "frontier",
] as const;
export type ModelLevel = (typeof MODEL_LEVELS)[number];

const modelMappings: Record<ModelLevel, string> = {
  "free": "google/gemini-3.5-flash",
  "fast": "google/gemini-3.1-flash-lite",
  "fast-claude": "anthropic/claude-haiku-4.5",
  "medium-google": "google/gemini-3.5-flash",
  "medium": "anthropic/claude-sonnet-4.5",
  "quality": "moonshotai/kimi-k2.6",
  "frontier": "anthropic/claude-opus-4.7",
};

// sailresearch.com model catalog is open-weights only, so there's no 1:1 match
// for the OpenRouter (Claude/Gemini) slugs above. Map each level to the closest
// sail model by tier. See https://docs.sailresearch.com/models
const sailModelMappings: Record<ModelLevel, string> = {
  "free": "google/gemma-4-31B-it",
  "fast": "google/gemma-4-31B-it",
  // Qwen3.6-35B-A3B is served only in sail's "flex" completion window, which is
  // best-effort/offline and can't serve an interactive chat turn (a synchronous
  // request is rejected). The mid tiers use gpt-oss-120b, a sync-capable model
  // of comparable tier that supports tool calls.
  "fast-claude": "openai/gpt-oss-120b",
  "medium-google": "openai/gpt-oss-120b",
  "medium": "openai/gpt-oss-120b",
  "quality": "moonshotai/Kimi-K2.6",
  "frontier": "zai-org/GLM-5.2-FP8",
};

export type Provider = "openrouter" | "sail";

// Curated, selectable chat models per provider — the admin model picker offers
// exactly these, and the chat route validates any override against this list.
// Seeded from the tier→slug maps above; `label` is what the picker shows.
export const CHAT_MODEL_CATALOG: Record<Provider, { id: string; label: string }[]> = {
  openrouter: [
    { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
    { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
    { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
    { id: "anthropic/claude-opus-4.7", label: "Claude Opus 4.7" },
  ],
  sail: [
    { id: "google/gemma-4-31B-it", label: "Gemma 4 31B" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "moonshotai/Kimi-K2.6", label: "Kimi K2.6" },
    { id: "zai-org/GLM-5.2-FP8", label: "GLM 5.2" },
  ],
};

/** True only for a (provider, model) pair present in the curated catalog. */
export function isAllowedModel(provider: string, model: string): boolean {
  const list = CHAT_MODEL_CATALOG[provider as Provider];
  return Boolean(list) && list.some((m) => m.id === model);
}

function useSail(): boolean {
  return env.INFERENCE_PROVIDER === "sail" && Boolean(env.SAIL_RESEARCH_API_KEY);
}

/** Provider slug for a given level — useful for telemetry / response metadata. */
export function getModelSlug(level: ModelLevel): string {
  return useSail() ? sailModelMappings[level] : modelMappings[level];
}

export function getModel(
  level: ModelLevel = "quality",
  options?: { webSearch?: boolean; override?: { provider: Provider; model: string } }
): LanguageModel {
  console.log("Requested model level:", level);
  // An admin override pins the exact provider + model, bypassing the env
  // provider and the tier→slug mapping; otherwise fall back to the configured
  // provider and the tier's default slug.
  const override = options?.override;
  const provider: Provider = override ? override.provider : useSail() ? "sail" : "openrouter";
  const slug = override
    ? override.model
    : provider === "sail"
      ? sailModelMappings[level]
      : modelMappings[level];
  // OpenRouter runs web search server-side via its "web" plugin. sail is a plain
  // OpenAI-compatible endpoint with no such plugin, so web search is only wired
  // when the caller asks for it, the deployment hasn't disabled it, AND we're on
  // OpenRouter — on sail it degrades to a normal (no web search) request.
  const webSearch =
    provider === "openrouter" && Boolean(options?.webSearch) && env.WEB_SEARCH_ENABLED;
  const label = override ? "override" : level;
  const cacheKey = `${provider}:${slug}${webSearch ? ":web" : ""}`;
  const cached = _models.get(cacheKey);
  if (cached) return cached;

  if (provider === "sail") {
    if (!env.SAIL_RESEARCH_API_KEY) {
      throw new Error("SAIL_RESEARCH_API_KEY is required to use the sail provider");
    }
    const sailProvider = createOpenAICompatible({
      name: "sailresearch",
      baseURL: "https://api.sailresearch.com/v1",
      apiKey: env.SAIL_RESEARCH_API_KEY,
    });
    const sailModel = sailProvider(slug);
    _models.set(cacheKey, sailModel);
    console.log(`Initialized sailresearch model: ${slug} (${label})`);
    return sailModel;
  }

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
  // OpenRouter runs web search server-side via the "web" plugin and injects the
  // results plus inline citation links into the response — no client-side tool.
  const model = webSearch
    ? openrouter(slug, {
        plugins: [{ id: "web", max_results: env.WEB_SEARCH_MAX_RESULTS }],
      })
    : openrouter(slug);
  _models.set(cacheKey, model);
  console.log(
    `Initialized OpenRouter model: ${slug} (${label})${webSearch ? " [web search]" : ""}`
  );
  return model;
}

export function createAgentTools(
  tenantId: string,
  userId: string,
  options?: { isDemo?: boolean; financialPlanId?: string }
) {
  const allTools = {
    ...createFinancialTools(tenantId, userId),
    ...createPlanTools(tenantId),
    // The financial-plan tool is bound to the thread's plan and only exists on a
    // plan-scoped thread — a non-plan thread has no get_financial_plan.
    ...(options?.financialPlanId
      ? createFinancialPlanTools(tenantId, userId, options.financialPlanId)
      : {}),
    ...createSimulationTools(tenantId, userId),
    ...createTaxTools(tenantId),
    ...createSpendingTools(tenantId),
  };

  if (!options?.isDemo) return allTools;

  // Exclude plan mutation tools for demo users so the AI can't modify plans.
  // update_financial_plan_goals / update_financial_plan_assumptions only exist
  // on a plan thread, so they may be absent here — the rest-spread simply drops
  // them when present.
  const {
    update_plan_content,
    create_plan,
    update_financial_plan_goals,
    update_financial_plan_assumptions,
    ...readOnlyTools
  } = allTools as typeof allTools & {
    update_financial_plan_goals?: unknown;
    update_financial_plan_assumptions?: unknown;
  };
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
- Never use em dashes, en dashes, middots, or semicolons. Write complete sentences, and write ranges as "X to Y"

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
- get_spending_summary: Monthly spending by category, top merchants, and income/savings rate DERIVED FROM TRANSACTIONS (may be 0 for manual-entry users with no income transactions)
- get_financial_profile: The user's stated annual income, filing status, age, target retirement age, employer 401(k) match %, risk tolerance, state, employment type, and dependents. For income, filing-status, and retirement-planning questions, get income and demographics from HERE — not from transactions.
- get_accounts / get_net_worth / get_holdings: accounts and balances, net worth, and investment holdings

**CRITICAL: You must call tools first before writing any analysis.** For income/filing-status/retirement questions, call get_financial_profile (the user may have no income transactions). For retirement/withdrawal questions, ALWAYS run simulations (monte carlo, backtest, scenarios) with the user's actual portfolio data — do not just cite general rules of thumb. Start by calling get_portfolio_summary, then use those numbers to run the relevant simulations. If a tool returns an error, report the specific error — never claim tools are "experiencing issues" or "unavailable."

## Gathering plan goals

On a plan conversation you have get_financial_plan (the plan's figures, including any goals already captured) and update_financial_plan_goals (save goals onto this plan). When the user asks to set up or complete their goals, hold a short, friendly intake: ask for their target retirement age, the age their money should last through (plan-end age), their desired annual retirement income, and any named goals (kids' college, travel, charity — with a target amount and year if they know). Ask for what's still missing, one or two questions at a time, and call update_financial_plan_goals as they answer (you may call it per answer). Do not re-ask for goals the plan already has. Confirm briefly once you've saved them.

## Requesting plan changes

On a plan conversation you also have update_financial_plan_assumptions, which adjusts an assumption AND regenerates the plan (the retirement success rate, the what-ifs, and the narrative all recompute). Call it whenever the user asks to change one of these:
- Exclude or restore Social Security. "Don't count Social Security" / "ignore SS" -> includeSocialSecurity: false. Reversals like "put Social Security back" / "count it again" -> includeSocialSecurity: true.
- Retire at a different age -> retirementAge (a whole number).
- Assume a different expected return -> expectedReturn as a DECIMAL (6% is 0.06, not 6).
- Spend a different amount in retirement -> monthlySpend in dollars per month (convert an annual figure by dividing by 12).
- Hypothetically SELL a property ("sell my house", "what if I sell the primary residence") -> sellPropertyAccountId. First call get_financial_plan and read realEstate.properties; pass THAT property's id. For "my house" or "primary residence", pick the residence (its name says so). If there are several properties and it is genuinely ambiguous which one they mean, ask which before selling; otherwise pick the obvious one. Reverse a sale ("don't sell the house after all", "put the house back") -> unsellPropertyAccountId with the same id.

Pass ONLY the fields the user asked to change; omitted fields keep their current value. After the tool returns, confirm in prose exactly what changed and how it moved the plan (e.g. the new success rate), reading the fresh figures from the tool result or a follow-up get_financial_plan.

When you sell a property, by default we assume the net proceeds are reinvested alongside their existing investments. State that assumption plainly in everyday language for a non-expert, e.g. "I've assumed you reinvest the roughly $X in proceeds with your other investments. If you'd rather hold it as cash or buy somewhere less expensive, tell me and we can look at that." Don't use jargon or quiz them.

For any change OUTSIDE that set, do NOT silently do nothing: explain what you can and cannot adjust. You can adjust Social Security inclusion, retirement age, expected return, monthly spend, and selling a property. You cannot yet act on things like changing the tax bracket or altering account balances directly; tell the user that plainly and offer the closest supported adjustment.

## Analysis Quality

Go beyond surface-level observations:
- Cite actual numbers from the user's data
- Compare against benchmarks where relevant (e.g., "your 2.8% SWR is well below the 4% historical threshold")
- Flag specific risks with concrete context
- Provide specific, actionable recommendations with dollar amounts or percentages where possible

Do NOT output any JSON, code blocks with structured data, or UIPayload objects.
`;
