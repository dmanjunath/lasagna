import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Navigate to the app (will show login page)
  await page.goto("/");

  // Wait for login page to load
  await expect(page.getByRole("heading", { name: "Lasagna" })).toBeVisible();

  // Click "Sign up" to create a new account
  await page.getByRole("button", { name: "Sign up" }).click();

  // Fill in signup form with test user
  const testEmail = `test-${Date.now()}@example.com`;
  await page.getByPlaceholder("Name (optional)").fill("Test User");
  await page.getByPlaceholder("Email").fill(testEmail);
  await page.getByPlaceholder("Password").fill("testpassword123");

  // Submit the form
  await page.getByRole("button", { name: "Create Account" }).click();

  // Wait for redirect to dashboard (authenticated)
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Overview")).toBeVisible();

  // Save storage state for reuse in tests
  await page.context().storageState({ path: authFile });
});
