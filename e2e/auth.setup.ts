import { test as setup, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";

const authFile = "e2e/.auth/user.json";

// Read test user credentials created by global-setup.ts
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

setup("authenticate with seeded test user", async ({ page, request }) => {
  const testUser = getTestUser();

  console.log(`[Auth Setup] Test user: ${testUser.email}`);

  // First, verify the API is reachable
  console.log("[Auth Setup] Checking API health...");
  try {
    const healthCheck = await request.get("http://localhost:3000/api/health");
    if (healthCheck.ok()) {
      console.log("[Auth Setup] API is healthy");
    } else {
      console.error(`[Auth Setup] API health check failed: ${healthCheck.status()}`);
    }
  } catch (error) {
    console.error("[Auth Setup] Cannot reach API server:", error);
    console.error("[Auth Setup] Make sure 'docker compose up' is running");
    throw error;
  }

  // Navigate to the app (will show login page)
  await page.goto("/");

  // Wait for login page to load
  await expect(page.getByRole("heading", { name: "Lasagna" })).toBeVisible();

  // Fill in login form with test user credentials
  await page.getByPlaceholder("Email").fill(testUser.email);
  await page.getByPlaceholder("Password").fill(testUser.password);

  // Submit the form
  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait for either success (redirect to dashboard) or error message
  const result = await Promise.race([
    page.waitForURL("/", { timeout: 10000 }).then(() => "success"),
    page.getByText(/invalid|error|failed/i).waitFor({ timeout: 10000 }).then(() => "error"),
  ]).catch(() => "timeout");

  if (result === "error") {
    // Capture the error message
    const errorText = await page.locator(".text-danger, [class*='error']").textContent();
    console.error(`[Auth Setup] Login failed with error: ${errorText}`);
    throw new Error(`Login failed: ${errorText}`);
  }

  if (result === "timeout") {
    // Take screenshot to debug
    await page.screenshot({ path: "e2e/auth-debug.png" });
    console.error("[Auth Setup] Login timed out - screenshot saved to e2e/auth-debug.png");
    throw new Error("Login timed out");
  }

  // Verify we're on the dashboard
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible({ timeout: 5000 });
  console.log("[Auth Setup] Successfully authenticated");

  // Save storage state for reuse in tests
  await page.context().storageState({ path: authFile });
});
