/**
 * LLM Benchmark Runner
 *
 * Runs a prompt through the actual AI model (via generateText) and records:
 * - latency (ms)
 * - tool calls made + their names
 * - response length
 * - pass/fail for each assertion
 *
 * Results are written to results/latest.json and appended to results/history.jsonl
 * so you can track regressions over time.
 */

import { generateText } from 'ai';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getModel, createAgentTools, systemPrompt } from '../../agent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

export interface BenchmarkAssertion {
  name: string;
  /** Return true if assertion passes, or a string error message if it fails */
  check: (result: BenchmarkResult) => true | string;
}

export interface BenchmarkCase {
  id: string;
  description: string;
  /** The user message (without context) */
  message: string;
  /** Optional page context string prepended for the AI */
  context?: string;
  /** Tenant ID to use — defaults to demo/seed tenant */
  tenantId?: string;
  assertions: BenchmarkAssertion[];
  /** Max acceptable latency in ms. Warns (doesn't fail) if exceeded. */
  latencyWarnMs?: number;
  /** Max tool call rounds expected */
  maxToolRounds?: number;
}

export interface AssertionResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface BenchmarkResult {
  caseId: string;
  description: string;
  latencyMs: number;
  toolCallCount: number;
  toolNames: string[];
  responseLength: number;
  response: string;
  assertions: AssertionResult[];
  passed: boolean;
  latencyWarning?: string;
  error?: string;
  timestamp: string;
  model: string;
}

export async function runBenchmark(
  benchCase: BenchmarkCase,
  opts: { verbose?: boolean } = {},
): Promise<BenchmarkResult> {
  const { verbose = false } = opts;
  const startMs = Date.now();
  const tenantId = benchCase.tenantId ?? 'benchmark-seed';

  let response = '';
  let toolCallCount = 0;
  const toolNames: string[] = [];
  let errorMsg: string | undefined;

  try {
    const tools = createAgentTools(tenantId, { isDemo: true });
    const MAX_TOOL_ROUNDS = benchCase.maxToolRounds ?? 5;

    const userContent = benchCase.context
      ? benchCase.context + benchCase.message
      : benchCase.message;

    let conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: userContent },
    ];

    let finalText = '';

    for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
      const stepResult = await generateText({
        model: getModel(),
        system: systemPrompt,
        messages: conversationMessages,
        tools,
      });

      finalText = stepResult.text;

      if (!stepResult.toolCalls?.length || stepResult.finishReason !== 'tool-calls') break;

      const toolResults: Array<{ toolCallId: string; toolName: string; result: string }> = [];

      for (const toolCall of stepResult.toolCalls) {
        toolCallCount++;
        toolNames.push(toolCall.toolName);

        const tool = tools[toolCall.toolName as keyof typeof tools];
        if (tool && 'execute' in tool) {
          try {
            const result = await (tool as any).execute((toolCall as any).args ?? {});
            toolResults.push({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: JSON.stringify(result),
            });
          } catch (e) {
            toolResults.push({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            });
          }
        }
      }

      const toolSummary = toolResults.map(tr => `[Tool: ${tr.toolName}]\n${tr.result}`).join('\n\n');
      conversationMessages.push({ role: 'assistant', content: stepResult.text });
      conversationMessages.push({ role: 'user', content: `[Tool results]\n\n${toolSummary}\n\nContinue your analysis.` });
    }

    response = finalText;
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  const latencyMs = Date.now() - startMs;

  const partialResult: BenchmarkResult = {
    caseId: benchCase.id,
    description: benchCase.description,
    latencyMs,
    toolCallCount,
    toolNames,
    responseLength: response.length,
    response,
    assertions: [],
    passed: !errorMsg,
    error: errorMsg,
    timestamp: new Date().toISOString(),
    model: 'claude-sonnet-4',
  };

  // Run assertions
  const assertionResults: AssertionResult[] = benchCase.assertions.map(assertion => {
    try {
      const result = assertion.check(partialResult);
      if (result === true) {
        return { name: assertion.name, passed: true };
      }
      return { name: assertion.name, passed: false, error: result };
    } catch (e) {
      return { name: assertion.name, passed: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const allAssertionsPassed = assertionResults.every(a => a.passed);
  const latencyWarning = benchCase.latencyWarnMs && latencyMs > benchCase.latencyWarnMs
    ? `Latency ${latencyMs}ms exceeded warning threshold ${benchCase.latencyWarnMs}ms`
    : undefined;

  const finalResult: BenchmarkResult = {
    ...partialResult,
    assertions: assertionResults,
    passed: !errorMsg && allAssertionsPassed,
    latencyWarning,
  };

  if (verbose) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${benchCase.id}] ${benchCase.description}`);
    console.log(`  Latency: ${latencyMs}ms${latencyWarning ? ' ⚠️' : ''}`);
    console.log(`  Tools called (${toolCallCount}): ${toolNames.join(', ') || 'none'}`);
    console.log(`  Response length: ${response.length} chars`);
    if (errorMsg) console.log(`  Error: ${errorMsg}`);
    for (const a of assertionResults) {
      console.log(`  ${a.passed ? '✓' : '✗'} ${a.name}${a.error ? ': ' + a.error : ''}`);
    }
    if (latencyWarning) console.log(`  ⚠️  ${latencyWarning}`);
  }

  return finalResult;
}

export async function runSuite(
  cases: BenchmarkCase[],
  opts: { verbose?: boolean; writeResults?: boolean } = {},
): Promise<BenchmarkResult[]> {
  const { verbose = true, writeResults = true } = opts;
  const results: BenchmarkResult[] = [];

  console.log(`\nRunning ${cases.length} benchmark case(s)...\n`);

  for (const benchCase of cases) {
    const result = await runBenchmark(benchCase, { verbose });
    results.push(result);
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed | avg latency: ${avgLatency}ms`);
  console.log('═'.repeat(60));

  if (writeResults) {
    const latestPath = join(RESULTS_DIR, 'latest.json');
    writeFileSync(latestPath, JSON.stringify(results, null, 2));

    const historyPath = join(RESULTS_DIR, 'history.jsonl');
    appendFileSync(historyPath, JSON.stringify({ runAt: new Date().toISOString(), results }) + '\n');

    console.log(`\nResults written to ${latestPath}`);
  }

  return results;
}

// ── Common assertion helpers ──────────────────────────────────────────────────

/** Response must contain all of these substrings (case-insensitive) */
export function containsAll(...terms: string[]): BenchmarkAssertion {
  return {
    name: `response contains: ${terms.join(', ')}`,
    check: (r) => {
      const lower = r.response.toLowerCase();
      const missing = terms.filter(t => !lower.includes(t.toLowerCase()));
      return missing.length === 0 ? true : `Missing: ${missing.join(', ')}`;
    },
  };
}

/** Response must NOT contain these strings (catches hallucinations / format leakage) */
export function doesNotContain(...terms: string[]): BenchmarkAssertion {
  return {
    name: `response does not contain: ${terms.join(', ')}`,
    check: (r) => {
      const lower = r.response.toLowerCase();
      const found = terms.filter(t => lower.includes(t.toLowerCase()));
      return found.length === 0 ? true : `Found forbidden: ${found.join(', ')}`;
    },
  };
}

/** Response must be at least minChars long */
export function minResponseLength(minChars: number): BenchmarkAssertion {
  return {
    name: `response length >= ${minChars} chars`,
    check: (r) => r.responseLength >= minChars ? true : `Got ${r.responseLength} chars`,
  };
}

/** At least one tool call must have been made */
export function usedTools(...expectedToolNames: string[]): BenchmarkAssertion {
  if (expectedToolNames.length === 0) {
    return {
      name: 'used at least one tool',
      check: (r) => r.toolCallCount > 0 ? true : 'No tools were called',
    };
  }
  return {
    name: `used tools: ${expectedToolNames.join(', ')}`,
    check: (r) => {
      const missing = expectedToolNames.filter(t => !r.toolNames.includes(t));
      return missing.length === 0 ? true : `Missing tool calls: ${missing.join(', ')}`;
    },
  };
}

/** Response must be valid markdown (has at least one heading or bullet) */
export function isMarkdown(): BenchmarkAssertion {
  return {
    name: 'response is markdown (has headings or bullets)',
    check: (r) => /^#{1,3} |^\*\*|^- |\*\*[^*]+\*\*/m.test(r.response) ? true : 'No markdown formatting found',
  };
}

/** Response must NOT contain raw JSON blocks (no leftover UIPayload) */
export function noJsonPayload(): BenchmarkAssertion {
  return {
    name: 'response has no JSON payload blocks',
    check: (r) => {
      if (r.response.includes('"layout"') && r.response.includes('"blocks"')) {
        return 'Response contains UIPayload JSON — blocks not fully removed';
      }
      return true;
    },
  };
}

/** Latency must be under maxMs */
export function underMs(maxMs: number): BenchmarkAssertion {
  return {
    name: `latency < ${maxMs}ms`,
    check: (r) => r.latencyMs < maxMs ? true : `Took ${r.latencyMs}ms`,
  };
}
