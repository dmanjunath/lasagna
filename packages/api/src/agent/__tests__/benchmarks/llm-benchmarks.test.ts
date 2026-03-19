/**
 * LLM Benchmark Tests
 *
 * These tests make REAL API calls to OpenRouter and are excluded from the normal
 * `vitest run` suite. Run them with:
 *
 *   pnpm bench:llm               # run all benchmark cases
 *   pnpm bench:llm --reporter verbose   # with verbose output
 *
 * Each test:
 * - Sends a prompt to the actual model
 * - Measures latency
 * - Counts tool calls
 * - Asserts the response meets quality expectations
 * - Writes results to __tests__/benchmarks/results/ for regression tracking
 */

import { describe, it, expect } from 'vitest';
import {
  runBenchmark,
  runSuite,
  containsAll,
  doesNotContain,
  minResponseLength,
  usedTools,
  isMarkdown,
  noJsonPayload,
  underMs,
  type BenchmarkCase,
} from './runner.js';
import { pageContexts } from './fixtures/seed-data.js';

// ── Individual benchmark cases ────────────────────────────────────────────────

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: 'portfolio-concentration-risk',
    description: 'Asks about bond allocation from portfolio page with context',
    message: 'Should I increase my bond allocation given my age and risk tolerance?',
    context: pageContexts.portfolio,
    latencyWarnMs: 30000,
    maxToolRounds: 3,
    assertions: [
      isMarkdown(),
      noJsonPayload(),
      minResponseLength(200),
      containsAll('bond', 'allocation', '%'),
      doesNotContain('"layout"', '"blocks"', 'UIPayload'),
      usedTools(),
    ],
  },

  {
    id: 'retirement-simple-question',
    description: 'Simple retirement readiness question with page context',
    message: 'Am I on track to retire at 60?',
    context: pageContexts.retirement,
    latencyWarnMs: 30000,
    maxToolRounds: 3,
    assertions: [
      isMarkdown(),
      noJsonPayload(),
      minResponseLength(200),
      containsAll('retire'),
      doesNotContain('"layout"', '"blocks"'),
    ],
  },

  {
    id: 'debt-payoff-strategy',
    description: 'Asks about debt payoff strategy with context',
    message: 'What is the fastest way to pay off my high-interest debt?',
    context: pageContexts.debt,
    latencyWarnMs: 30000,
    maxToolRounds: 3,
    assertions: [
      isMarkdown(),
      noJsonPayload(),
      minResponseLength(200),
      containsAll('credit card', '%'),
      doesNotContain('"layout"', '"blocks"'),
      usedTools(),
    ],
  },

  {
    id: 'no-context-general-question',
    description: 'General question with no page context — tests tool usage',
    message: 'What is my current net worth?',
    context: undefined,
    latencyWarnMs: 40000,
    maxToolRounds: 5,
    assertions: [
      isMarkdown(),
      noJsonPayload(),
      minResponseLength(100),
      usedTools(), // must call a financial tool to get real data
      doesNotContain('"layout"', '"blocks"'),
    ],
  },

  {
    id: 'response-format-no-json-leak',
    description: 'Verifies model never leaks old UIPayload JSON format',
    message: 'Give me a summary of my financial situation.',
    context: pageContexts.portfolio,
    latencyWarnMs: 30000,
    assertions: [
      noJsonPayload(),
      doesNotContain('"type": "stat"', '"type": "chart"', '"type": "text"', 'rechartsConfig'),
      isMarkdown(),
      minResponseLength(150),
    ],
  },

  {
    id: 'next-steps-always-present',
    description: 'Response should always include actionable next steps',
    message: 'How should I rebalance my portfolio?',
    context: pageContexts.portfolio,
    latencyWarnMs: 30000,
    assertions: [
      isMarkdown(),
      noJsonPayload(),
      containsAll('next step', 'recommend', '%'),
      minResponseLength(300),
    ],
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LLM Benchmarks', () => {
  // Run all cases and write results to results/latest.json
  // Set BENCH_SCORE=true to also run LLM-as-judge scoring (slower, costs more tokens)
  it('full suite — writes results to disk', async () => {
    const score = process.env.BENCH_SCORE === 'true';
    const results = await runSuite(BENCHMARK_CASES, { verbose: true, score, writeResults: true });

    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      const summary = failed.map(r => {
        const failedAssertions = r.assertions.filter(a => !a.passed);
        return `[${r.caseId}] ${failedAssertions.map(a => a.error || a.name).join('; ')}`;
      }).join('\n');
      expect.fail(`${failed.length} benchmark(s) failed:\n${summary}`);
    }

    expect(results.every(r => r.passed)).toBe(true);
  }, 300_000); // 5 min timeout for all cases

  // Individual targeted tests — useful for iterating on a single prompt
  it('portfolio: no JSON payload leak', async () => {
    const result = await runBenchmark(
      BENCHMARK_CASES.find(c => c.id === 'response-format-no-json-leak')!,
      { verbose: true },
    );
    expect(result.passed, result.assertions.filter(a => !a.passed).map(a => a.error).join('; ')).toBe(true);
  }, 60_000);

  it('retirement: basic readiness check', async () => {
    const result = await runBenchmark(
      BENCHMARK_CASES.find(c => c.id === 'retirement-simple-question')!,
      { verbose: true },
    );
    expect(result.passed, result.assertions.filter(a => !a.passed).map(a => a.error).join('; ')).toBe(true);
  }, 60_000);
});

// ── Latency-only timing test ──────────────────────────────────────────────────

describe('LLM Latency', () => {
  it('records p50/p95 latency across repeated runs', async () => {
    const RUNS = 3;
    const latencies: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const result = await runBenchmark({
        id: `latency-run-${i}`,
        description: `Latency run ${i + 1}/${RUNS}`,
        message: 'Summarize my financial situation in 2 sentences.',
        context: pageContexts.portfolio,
        assertions: [minResponseLength(50), noJsonPayload()],
      });
      latencies.push(result.latencyMs);
      console.log(`  Run ${i + 1}: ${result.latencyMs}ms`);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1];
    const avg = Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length);

    console.log(`\n  Latency over ${RUNS} runs:`);
    console.log(`    avg: ${avg}ms  p50: ${p50}ms  p95: ${p95}ms`);

    // Soft threshold — logs a warning, doesn't fail CI
    if (avg > 45000) {
      console.warn(`⚠️  Average latency ${avg}ms is above 45s threshold`);
    }

    expect(latencies.length).toBe(RUNS);
  }, 600_000);
});
