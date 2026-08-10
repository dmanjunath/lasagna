/**
 * Benchmark comparison tool.
 *
 * Compares two result files (baseline vs latest) and shows what improved,
 * regressed, or stayed the same — both for scores and pass/fail assertions.
 *
 * Usage:
 *   # Pin the current results as your baseline
 *   pnpm bench:baseline
 *
 *   # Edit agent.ts, then run benchmarks again
 *   pnpm bench:llm:score
 *
 *   # See what changed
 *   pnpm bench:compare
 */

import { readFileSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkResult } from './runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const BASELINE_PATH = join(RESULTS_DIR, 'baseline.json');
const LATEST_PATH = join(RESULTS_DIR, 'latest.json');

// ── CLI entry points ──────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'baseline') {
  // Copy latest.json → baseline.json
  if (!existsSync(LATEST_PATH)) {
    console.error('No results/latest.json found. Run pnpm bench:llm first.');
    process.exit(1);
  }
  copyFileSync(LATEST_PATH, BASELINE_PATH);
  const results: BenchmarkResult[] = JSON.parse(readFileSync(LATEST_PATH, 'utf-8'));
  const scored = results.filter(r => r.scoring);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((s, r) => s + (r.scoring?.total ?? 0), 0) / scored.length)
    : null;
  console.log(`Baseline saved (${results.length} cases${avgScore !== null ? `, avg score ${avgScore}/100` : ''}).`);
  console.log(`Edit your prompt, run pnpm bench:llm:score, then pnpm bench:compare.`);

} else {
  // Default: compare baseline vs latest
  compare();
}

function compare() {
  if (!existsSync(BASELINE_PATH)) {
    console.error('No baseline found. Run: pnpm bench:baseline');
    process.exit(1);
  }
  if (!existsSync(LATEST_PATH)) {
    console.error('No latest results. Run: pnpm bench:llm:score');
    process.exit(1);
  }

  const baseline: BenchmarkResult[] = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
  const latest: BenchmarkResult[] = JSON.parse(readFileSync(LATEST_PATH, 'utf-8'));

  const baselineMap = new Map(baseline.map(r => [r.caseId, r]));

  let totalScoreDelta = 0;
  let totalLatencyDelta = 0;
  let scoredCases = 0;
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;

  console.log(`\n${'═'.repeat(70)}`);
  console.log('BENCHMARK COMPARISON: baseline → latest');
  console.log('═'.repeat(70));

  for (const curr of latest) {
    const prev = baselineMap.get(curr.caseId);
    if (!prev) {
      console.log(`\n[${curr.caseId}] NEW CASE (no baseline)`);
      continue;
    }

    const latencyDelta = curr.latencyMs - prev.latencyMs;
    const passedBefore = prev.passed;
    const passedNow = curr.passed;

    // Score comparison
    const prevScore = prev.scoring?.total;
    const currScore = curr.scoring?.total;
    const scoreDelta = (prevScore != null && currScore != null) ? currScore - prevScore : null;

    if (scoreDelta !== null) {
      totalScoreDelta += scoreDelta;
      scoredCases++;
      if (scoreDelta > 2) improved++;
      else if (scoreDelta < -2) regressed++;
      else unchanged++;
    }
    totalLatencyDelta += latencyDelta;

    // Status line
    const statusIcon = !passedBefore && passedNow ? '↑ FIXED  '
      : passedBefore && !passedNow ? '↓ BROKE  '
      : passedNow ? '  PASS   '
      : '  FAIL   ';

    const scoreStr = scoreDelta !== null
      ? `${currScore}/100 (${scoreDelta >= 0 ? '+' : ''}${scoreDelta})`
      : prevScore != null ? `${prevScore}/100 (no new score)`
      : '(not scored)';

    const latStr = `${latencyDelta >= 0 ? '+' : ''}${latencyDelta}ms`;
    const latColor = latencyDelta > 5000 ? ' SLOWER' : latencyDelta < -5000 ? ' FASTER' : '';

    console.log(`\n${statusIcon} [${curr.caseId}]`);
    console.log(`  Score:   ${scoreStr}`);
    console.log(`  Latency: ${curr.latencyMs}ms (${latStr}${latColor})`);

    // Show assertion changes
    const prevAssertMap = new Map(prev.assertions.map(a => [a.name, a.passed]));
    for (const a of curr.assertions) {
      const wasPassing = prevAssertMap.get(a.name);
      if (wasPassing === undefined) {
        console.log(`  + NEW assertion: ${a.passed ? '✓' : '✗'} ${a.name}`);
      } else if (wasPassing && !a.passed) {
        console.log(`  ✗ REGRESSED: ${a.name}${a.error ? ' — ' + a.error : ''}`);
      } else if (!wasPassing && a.passed) {
        console.log(`  ✓ FIXED: ${a.name}`);
      }
    }

    // Show score dimension breakdown if both have scores
    if (prev.scoring && curr.scoring) {
      const dims = ['relevance', 'actionability', 'use_of_data', 'clarity', 'completeness', 'overall'] as const;
      const changes = dims
        .map(d => {
          const delta = curr.scoring!.scores[d] - prev.scoring!.scores[d];
          return delta !== 0 ? `${d}:${delta >= 0 ? '+' : ''}${delta}` : null;
        })
        .filter(Boolean);
      if (changes.length > 0) {
        console.log(`  Dimensions changed: ${changes.join('  ')}`);
      }
      if (curr.scoring.scores.reasoning !== prev.scoring.scores.reasoning) {
        console.log(`  Judge now says: "${curr.scoring.scores.reasoning}"`);
      }
    }
  }

  // Summary
  const avgScoreDelta = scoredCases > 0 ? (totalScoreDelta / scoredCases).toFixed(1) : 'n/a';
  const avgLatDelta = Math.round(totalLatencyDelta / latest.length);

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`SUMMARY`);
  if (scoredCases > 0) {
    const arrow = totalScoreDelta > 0 ? '↑' : totalScoreDelta < 0 ? '↓' : '→';
    console.log(`  Score:   ${arrow} avg delta ${avgScoreDelta > '0' ? '+' : ''}${avgScoreDelta}/100  (${improved} improved, ${regressed} regressed, ${unchanged} unchanged)`);
  }
  const latArrow = avgLatDelta > 0 ? '↑ SLOWER' : avgLatDelta < 0 ? '↓ FASTER' : '→ same';
  console.log(`  Latency: ${latArrow} (avg ${avgLatDelta >= 0 ? '+' : ''}${avgLatDelta}ms)`);

  if (regressed > 0 || latest.filter(r => !r.passed && baselineMap.get(r.caseId)?.passed).length > 0) {
    console.log(`\n  WARNING: regressions detected. Review before merging.`);
    process.exit(1);
  } else {
    console.log(`\n  No regressions detected.`);
  }
}
