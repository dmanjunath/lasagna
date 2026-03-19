import { test, expect } from "@playwright/test";

test.describe("Starter Prompts", () => {
  test("shows starter prompts for new retirement plan", async ({ page }) => {
    // Create a new retirement plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Retirement.*Plan your retirement/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Starter Prompt Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    // Wait for page to load
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Verify starter prompts are visible
    await expect(page.getByText("Get started with a question")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze my retirement readiness" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retire early at 35/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Minimize my lifetime taxes/ })).toBeVisible();
  });

  test("shows starter prompts for net worth plan", async ({ page }) => {
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Net Worth Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Verify net worth specific prompts
    await expect(page.getByRole("button", { name: "Show my net worth breakdown" })).toBeVisible();
    await expect(page.getByRole("button", { name: /How has my wealth changed/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Review my asset allocation/ })).toBeVisible();
  });

  test("shows starter prompts for debt payoff plan", async ({ page }) => {
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Debt Payoff.*pay off debt/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Debt Payoff Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Verify debt payoff specific prompts
    await expect(page.getByRole("button", { name: "Create a debt payoff strategy" })).toBeVisible();
    await expect(page.getByRole("button", { name: /most efficient way to pay off/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /become debt-free/ })).toBeVisible();
  });

  test("shows custom input field", async ({ page }) => {
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Custom.*Create a custom plan/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Custom Input Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Verify custom input is visible
    await expect(page.getByPlaceholder("Or type your own question...")).toBeVisible();
  });
});
