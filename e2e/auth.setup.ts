import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

const authFile = "e2e/.auth/user.json";

// Read test user credentials created by global-setup.ts
// The global setup runs db:seed:e2e which creates a unique user per test run
function getTestUser() {
  const testUserPath = path.resolve(__dirname, ".test-user.json");
  const content = readFileSync(testUserPath, "utf-8");
  return JSON.parse(content) as {
    email: string;
    password: string;
    userId: string;
    tenantId: string;
    timestamp: number;
  };
}

setup("authenticate with seeded test user", async ({ page }) => {
  const testUser = getTestUser();

  console.log(`[Auth Setup] Logging in as: ${testUser.email}`);

  // Navigate to the app (will show login page)
  await page.goto("/");

  // Wait for login page to load
  await expect(page.getByRole("heading", { name: "Lasagna" })).toBeVisible();

  // Fill in login form with test user credentials
  await page.getByPlaceholder("Email").fill(testUser.email);
  await page.getByPlaceholder("Password").fill(testUser.password);

  // Submit the form
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for redirect to dashboard (authenticated)
  await expect(page).toHaveURL("/", { timeout: 10000 });
  await expect(page.getByText("Overview")).toBeVisible();

  console.log("[Auth Setup] Successfully authenticated");

  // Save storage state for reuse in tests
  await page.context().storageState({ path: authFile });
});
