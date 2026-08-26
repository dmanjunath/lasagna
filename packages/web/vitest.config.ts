import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors vite.config.ts: the tests read the shared calculator from
      // source, the same way the app does.
      "@lasagna/core/goal-target": fileURLToPath(
        new URL("../core/src/goal-target.ts", import.meta.url),
      ),
      "@lasagna/core/retirement-verdict": fileURLToPath(
        new URL("../core/src/retirement-verdict.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
