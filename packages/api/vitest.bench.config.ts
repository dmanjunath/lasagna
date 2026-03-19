import { defineConfig } from "vitest/config";

/**
 * Vitest config for LLM benchmarks.
 * Run with: pnpm bench:llm
 *
 * Requires OPENROUTER_API_KEY to be set. Either:
 *   - export OPENROUTER_API_KEY=... before running, or
 *   - run via: dotenv -e ../../.env pnpm bench:llm
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/benchmarks/**/*.test.ts"],
    // No parallelism — LLM calls are expensive and rate-limited
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
