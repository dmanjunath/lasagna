import { test, expect } from "@playwright/test";

// Pre-auth structural coverage for the two-step (email-first) login. The emailed-code
// *success* path needs a real WorkOS code (real inbox) and is a manual/staging check;
// these tests cover the flow structure, which is what regresses on refactors.

test.describe("Passwordless two-step login", () => {
  test("email step: password hidden, Google button branded", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
    // Password is hidden by default.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    // Brand-compliant Google button with the official 4-color "G".
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
    await expect(page.locator('svg path[fill="#4285F4"]')).toHaveCount(1);
  });

  test("password path: a password account reveals the password field", async ({ page }) => {
    await page.goto("/");
    // The demo account has a local password and no WorkOS link → Step-1 returns "password".
    await page.getByPlaceholder("you@example.com").fill("demo@lasagnafi.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /Email a code instead/i })).toBeVisible();
    await expect(page.getByText("Use a different email")).toBeVisible();
  });

  test("code path: unknown/passwordless email → code screen with NO consent gate", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("you@example.com").fill("nobody-unknown-99@example.com");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/verify-email/);
    await expect(page.getByPlaceholder("123456")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend/i })).toBeVisible();
    // Login-purpose code entry must NOT force consent (regression guard).
    await expect(page.getByText(/I agree to the/i)).toHaveCount(0);
  });

  test("signup: password is optional (behind a toggle)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByRole("button", { name: /Set a password \(optional\)/i })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    // Revealing it shows the field.
    await page.getByRole("button", { name: /Set a password \(optional\)/i }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
});
