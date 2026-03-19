import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Exclude LLM benchmarks from normal test runs — they make real API calls and are slow
    exclude: ["src/**/benchmarks/**"],
  },
});
