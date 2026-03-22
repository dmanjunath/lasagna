import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  // Global setup runs once before all tests
  // Seeds the database with test data (creates unique user per run)
  globalSetup: require.resolve("./e2e/global-setup.ts"),

  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Auth setup project - runs first to authenticate
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    // Main test project - depends on auth setup
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  // Start both API and frontend servers before tests
  // NOTE: Database must be running (docker compose up db)
  webServer: [
    {
      command: "pnpm --filter @lasagna/api dev",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
    {
      command: "pnpm dev:web",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
