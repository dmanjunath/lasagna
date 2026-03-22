import { test, expect } from "@playwright/test";

test.describe("New Plan Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plans/new");
    // Wait for page to load
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
  });

  test("displays plan type selection", async ({ page }) => {
    // Verify page header
    await expect(
      page.getByRole("heading", { name: "Create a Plan" })
    ).toBeVisible();
    await expect(
      page.getByText("Choose a plan type and give it a name to get started.")
    ).toBeVisible();

    // Verify all three plan types are visible (using headings)
    await expect(page.getByRole("heading", { name: "Net Worth" })).toBeVisible();
    await expect(
      page.getByText("Track your wealth, analyze trends, and optimize asset allocation")
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Retirement" })).toBeVisible();
    await expect(
      page.getByText("Plan your retirement with withdrawal strategies and projections")
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Debt Payoff" })).toBeVisible();
    await expect(
      page.getByText("Create a strategy to pay off debt efficiently")
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "Custom" })).toBeVisible();
    await expect(
      page.getByText("Create a custom plan with AI assistance for any financial goal")
    ).toBeVisible();
  });

  test("shows title input after selecting plan type", async ({ page }) => {
    // Title input should not be visible initially
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).not.toBeVisible();

    // Click on "Net Worth" plan type card (contains the description text)
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();

    // Title input and Create button should now be visible
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Plan" })).toBeVisible();
  });

  test("Create button is disabled without title", async ({ page }) => {
    // Select a plan type (use description to match card, not sidebar)
    await page.getByRole("button", { name: /Retirement.*Plan your retirement/ }).click();

    // Wait for title input to appear
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();

    // Create button should be disabled when title is empty
    const createButton = page.getByRole("button", { name: "Create Plan" });
    await expect(createButton).toBeDisabled();

    // Enter a title
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("My Test Plan");

    // Create button should now be enabled
    await expect(createButton).toBeEnabled();
  });

  test("creates plan and redirects to detail page", async ({ page }) => {
    // Select plan type (use description to match card, not sidebar)
    await page.getByRole("button", { name: /Custom.*Create a custom plan/ }).click();

    // Wait for title input
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();

    // Enter plan title
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("E2E Test Plan");

    // Click Create Plan
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    // Verify we're on the plan detail page
    await expect(page.getByRole("heading", { name: "E2E Test Plan" })).toBeVisible();
    await expect(page.getByText("custom Plan", { exact: true })).toBeVisible();
  });

  test("can create each plan type", async ({ page }) => {
    // Test creating Net Worth plan (use description to match card, not sidebar)
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Test Net Worth Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    // Use exact match to avoid matching the plan title (CSS capitalizes visually, DOM text is lowercase)
    await expect(page.getByText("net worth Plan", { exact: true })).toBeVisible();
  });

  test("can create debt payoff plan", async ({ page }) => {
    // Click on Debt Payoff plan type card
    await page.getByRole("button", { name: /Debt Payoff.*pay off debt/ }).click();

    // Wait for title input and fill it
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("My Debt Freedom Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    // Verify plan type is shown (CSS capitalizes visually, DOM text is lowercase)
    await expect(page.getByText("debt payoff Plan", { exact: true })).toBeVisible();
  });
});
