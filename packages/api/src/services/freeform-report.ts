/**
 * EXPERIMENT: a fully model-authored advisor report.
 *
 * Unlike the structured plan (deterministic engine + gated prose), this hands
 * the whole report to the model: it calls the SAME data tools the chat agent
 * uses (accounts, portfolio, retirement sims, spending, taxes), then writes a
 * complete self-contained HTML document — layout, narrative, and charts (inline
 * SVG it draws itself) — with no imposed structure beyond "a financial advisor
 * report". The web app renders the HTML verbatim in a sandboxed iframe (no
 * scripts), and the plan's input box sends FEEDBACK that revises the report.
 *
 * Model: pinned to anthropic/claude-sonnet-5 via the getModel override.
 */

import type { ModelMessage } from "ai";
import { llmGenerateText } from "../lib/llm.js";
import { getModel, createAgentTools } from "../agent/index.js";
import { logLlmUsage } from "../lib/activity.js";
import { buildAliasMap, scrub, descrub } from "../lib/pii-scrubber.js";

export interface FreeformReport {
  /** Lifecycle: generation and revision run in the background.
   *  "generating" → no html yet; "revising" → html is the PREVIOUS report;
   *  "ready" → html is current; "failed" → creation failed (retryable).
   *  Absent on documents stored before async generation → treat as "ready". */
  status?: "generating" | "revising" | "ready" | "failed";
  /** When the in-flight generation/revision started (staleness timeout). */
  startedAt?: string;
  /** Last failure message (creation failure, or a revision that didn't apply). */
  error?: string;
  html: string;
  generatedAt: string;
  model: string;
  /** Feedback notes applied so far, oldest first. */
  history: { feedback: string; at: string }[];
}

const FREEFORM_MODEL = "anthropic/claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are the senior analyst behind LasagnaFi Financial Insights: a complete, expert written analysis of ONE person's finances, generated from their live data. Your report should read like the output of many hours of expert work: comprehensive, specific, and opinionated about what this person should DO. The BRAND and VOCABULARY rules below constrain naming only, never depth or candor.

BRAND (identical for every user):
- The product and report name is exactly "LasagnaFi Financial Insights". Use it as the report title and wherever the report refers to itself.
- Begin the <body> with this header, verbatim except the date:
  <header style="border-bottom:3px solid #05B279;padding-bottom:24px;margin-bottom:32px">
    <div style="letter-spacing:.16em;text-transform:uppercase;font-size:12px;color:#047A54;font-weight:700">LasagnaFi</div>
    <h1 style="font-size:34px;margin:8px 0 4px;font-weight:600;color:#1c2230">Financial Insights</h1>
    <div style="font-size:14px;color:#6b7280">Generated DATE from your live accounts</div>
  </header>
- Palette (use ONLY these): brand green #05B279, dark green ink #047A54, text ink #1c2230, muted #6b7280, paper #F7F9FC, hairlines #E2E6EC. Charts use the brand green plus neutral grays; one accent only.
- Font: system UI stack (-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif). Serif is not used.

VOCABULARY (compliance, non-negotiable):
- NEVER use these words or phrases anywhere: "wealth management", "wealth advisory", "wealth advisor", "private wealth", "financial planning", "financial planner", "financial advisor", "advisory report", "advisory firm". LasagnaFi is a software product, not an advisory service.
- The closing disclaimer must say projections are estimates, this is not tax or investment advice, and to consult a licensed professional. Do not name a profession beyond "licensed professional".

PROCESS:
1. First call the tools to gather the person's REAL data: accounts and balances, portfolio composition, retirement simulation, spending, taxes, goals. Call as many tools as you need. Never invent a number; every figure in the report must come from tool results.
2. Then output the finished report as ONE complete, self-contained HTML document.

REQUIRED CONTENT (the core pillars; every one present, every one a FULL analysis — several paragraphs plus a figure or table where it helps, never a summary stub):
1. Executive summary: their position and your headline conclusions.
2. Net worth and balance sheet, at the account level.
3. Portfolio: real composition, concentration, and holdings-derived growth modeling.
4. Cash flow and spending: their actual patterns, from the spending tools.
5. Taxes, BOTH horizons: their current-year tax position AND the future tax trajectory (how tax-free withdrawal room, bracket exposure, and required distributions evolve over time).
6. Retirement: a comprehensive analysis against their ACTUAL average spending and REAL portfolio — simulation results with success odds and percentile outcomes, how long the money lasts, and a comparison of withdrawal approaches. Goals may be listed in a goals section, but a goal is NEVER the basis of the readiness verdict.
7. Risks and stress tests: what breaks the plan and how likely.
8. RECOMMENDATIONS: numbered, specific action items — each with the concrete dollar figures behind it, why it matters for THIS person, and what it changes. A report without actionable recommendations is a failed report.
9. A short methodology and data-sources appendix.

ANALYSIS RULES:
- All projections model the real portfolio: its actual asset composition and its holdings-derived expected growth. Never substitute generic mixes or rule-of-thumb return rates for their portfolio.
- Beyond the core pillars, add deep-dive sections THOUGHTFULLY, by what this person's situation actually calls for — not from a template. Examples of the judgment expected: someone retiring well before age 59 and a half likely warrants a bridge-years analysis (which specific accounts fund spending before penalty-free access, and roughly how much can be withdrawn each year with no federal tax); someone approaching required-distribution age warrants a tax-wall analysis; a heavily concentrated portfolio warrants a concentration analysis; a large real-estate position warrants a liquidity analysis. Include what is genuinely useful for THIS person and omit what is not.

HTML RULES:
- Return ONLY the HTML document: start with <!DOCTYPE html>, end with </html>. No markdown, no commentary outside the HTML.
- Entirely self-contained: inline CSS in a <style> block, no external fonts/images/scripts, NO JavaScript.
- Charts and figures: draw them yourself as inline SVG from the real numbers. Compute every SVG coordinate carefully: widths, heights, and radii must be non-negative and within the viewBox. Label axes and values so each chart stands alone.
- Every dollar figure, percentage, and age must trace to tool data. Label estimates as estimates. In prose text, do not use em dashes, en dashes, middots, or semicolons (CSS may use semicolons). Write complete sentences and write ranges as "X to Y".`;

// Deterministic brand backstop: banned positioning vocabulary is replaced even
// if the model slips (a 10-minute regeneration is too expensive to retry for a
// phrase). Longest phrases first. Persona nouns map to the disclaimer-safe
// "licensed professional" so "consult a financial advisor" stays coherent.
const BRAND_REPLACEMENTS: Array<[RegExp, string]> = [
  [/comprehensive financial advisory report/gi, "LasagnaFi Financial Insights"],
  [/financial advisory report|financial planning report|advisory report/gi, "LasagnaFi Financial Insights"],
  [/private wealth advisory|private wealth management|wealth management|wealth advisory|private wealth/gi, "LasagnaFi Financial Insights"],
  [/wealth advisor|financial advisor|financial planner/gi, "licensed professional"],
  [/financial planning/gi, "financial insights"],
  [/advisory firm/gi, "LasagnaFi"],
];

/** Enforce the LasagnaFi Financial Insights vocabulary on generated HTML. */
export function sanitizeBrand(html: string): string {
  let out = html;
  for (const [re, replacement] of BRAND_REPLACEMENTS) out = out.replace(re, replacement);
  return out;
}

/** Pull the HTML document out of the model's final text (tolerates fences/preamble).
 *  Returns null unless the document is COMPLETE (has a closing </html>) — a
 *  truncated report must be regenerated, never shipped. */
export function extractHtml(text: string): string | null {
  const start = text.search(/<!DOCTYPE\s+html|<html[\s>]/i);
  if (start === -1) return null;
  const endMatch = text.match(/<\/html>/i);
  if (!endMatch) return null; // truncated (finish=length) — not shippable
  const end = (endMatch.index ?? text.length) + endMatch[0].length;
  return text.slice(start, end).trim();
}

/**
 * Generate (or, with feedback + previousHtml, revise) the freeform report.
 * Throws on failure — the caller decides what an empty report means for it.
 */
export async function generateFreeformReport(
  tenantId: string,
  userId: string,
  opts?: { feedback?: string; previousHtml?: string },
): Promise<FreeformReport["html"]> {
  const tools = createAgentTools(tenantId, userId);
  const model = getModel("medium", {
    override: { provider: "openrouter", model: FREEFORM_MODEL },
  });
  // PII anonymization, same engine as chat: tool results are scrubbed (real
  // names → aliases) before the model sees them, and the finished HTML is
  // descubbed on the way out. The previous report + the client's feedback are
  // scrubbed too — both carry real names back toward the model otherwise.
  const aliasMap = await buildAliasMap(tenantId);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const messages: ModelMessage[] = [];
  if (opts?.previousHtml && opts?.feedback) {
    const prevScrubbed = scrub(opts.previousHtml, aliasMap, "freeform") as string;
    const feedbackScrubbed = scrub(opts.feedback, aliasMap, "freeform") as string;
    messages.push({
      role: "user",
      content: `Here is the current report you previously produced:\n\n${prevScrubbed}\n\nThe client left this feedback:\n\n"${feedbackScrubbed}"\n\nRevise the report accordingly. Today's date is ${today}; use it in the header. Re-query tools if the revision needs data you don't have. Return the COMPLETE revised HTML document (not a diff).`,
    });
  } else {
    messages.push({
      role: "user",
      content:
        `Produce my full LasagnaFi Financial Insights report. Today's date is ${today}; use it in the header. Gather whatever data you need first, then write the complete HTML document.`,
    });
  }

  let finalText = "";
  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    // descrubOutput: false — keep the model's text in alias form so
    // sanitizeBrand at the end sees pure model output (aliases carry no banned
    // vocabulary) before real names are restored once, at the very end.
    const stepResult = await llmGenerateText({ tenantId, aliasMap, descrubOutput: false }, {
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      // The final turn emits a full HTML document with inline SVG — needs far
      // more headroom than a chat turn.
      maxOutputTokens: 60000,
      toolChoice: step === 0 && !opts?.previousHtml ? "required" : "auto",
    });
    logLlmUsage({
      tenantId,
      source: "freeform",
      model: FREEFORM_MODEL,
      inputTokens: stepResult.usage?.inputTokens,
      outputTokens: stepResult.usage?.outputTokens,
      costUsd: stepResult.costUsd,
    });
    finalText = stepResult.text;
    console.log(
      `[freeform] step ${step + 1}: text=${finalText.length} toolCalls=${stepResult.toolCalls?.length ?? 0} finish=${stepResult.finishReason}`,
    );

    const calls = stepResult.toolCalls ?? [];
    if (calls.length === 0 || stepResult.finishReason !== "tool-calls") break;

    // Execute tools and thread results back, mirroring the chat route's loop.
    const toolResultParts: unknown[] = [];
    for (const toolCall of calls) {
      if (!toolCall) continue;
      const t = tools[toolCall.toolName as keyof typeof tools];
      let value: string;
      if (t && "execute" in t) {
        try {
          const input = (toolCall as { input?: unknown; args?: unknown }).input ?? (toolCall as { args?: unknown }).args ?? {};
          value = JSON.stringify(scrub(await (t as unknown as { execute: (i: unknown) => Promise<unknown> }).execute(input), aliasMap, "freeform"));
        } catch (e) {
          value = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        value = JSON.stringify({ error: `unknown tool ${toolCall.toolName}` });
      }
      toolResultParts.push({
        type: "tool-result" as const,
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: { type: "text" as const, value },
      });
    }
    const assistantContent: unknown[] = [];
    if (stepResult.text) assistantContent.push({ type: "text" as const, text: stepResult.text });
    for (const tc of calls) {
      if (!tc) continue;
      assistantContent.push({
        type: "tool-call" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        input: (tc as { input?: unknown; args?: unknown }).input ?? (tc as { args?: unknown }).args,
      });
    }
    messages.push({ role: "assistant", content: assistantContent as never });
    messages.push({ role: "tool", content: toolResultParts as never });
  }

  // Tool rounds exhausted mid-gathering: force one tool-free synthesis turn.
  if (!extractHtml(finalText)) {
    const synth = await llmGenerateText({ tenantId, aliasMap, descrubOutput: false }, {
      model,
      system: SYSTEM_PROMPT,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Write the complete HTML report now from the data you have gathered. Return ONLY the HTML document.",
        },
      ],
      maxOutputTokens: 60000,
    });
    logLlmUsage({
      tenantId,
      source: "freeform",
      model: FREEFORM_MODEL,
      inputTokens: synth.usage?.inputTokens,
      outputTokens: synth.usage?.outputTokens,
      costUsd: synth.costUsd,
    });
    finalText = synth.text;
  }

  const html = extractHtml(finalText);
  if (!html) throw new Error("model returned no HTML document");
  // Enforce the brand vocabulary on the model's output FIRST (aliases contain
  // no banned vocabulary), THEN restore real names — so a real account or
  // institution name that happens to contain e.g. "Wealth Management" is
  // restored untouched.
  return descrub(sanitizeBrand(html), aliasMap, "freeform");
}
