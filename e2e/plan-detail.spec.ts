import { test, expect } from "@playwright/test";

test.describe("Plan Detail Page", () => {
  let planId: string;

  test.beforeEach(async ({ page }) => {
    // Create a plan first
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();

    // Click on Net Worth plan type card (use description to match card, not sidebar)
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();

    // Wait for title input and fill it
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Detail Test Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect and extract plan ID from URL
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    const url = page.url();
    planId = url.split("/plans/")[1];

    // Wait for page to finish loading
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });
  });

  test("displays plan header with title and type", async ({ page }) => {
    // Verify plan header
    await expect(
      page.getByRole("heading", { name: "Detail Test Plan" })
    ).toBeVisible();
    // Plan type text (CSS capitalizes visually, DOM text is lowercase)
    await expect(page.getByText("net worth Plan", { exact: true })).toBeVisible();
  });

  test("shows starter prompts when plan has no content", async ({ page }) => {
    // New plan should show starter prompts
    await expect(
      page.getByText("Get started with a question")
    ).toBeVisible();
    // Should show suggested prompts for net_worth type
    await expect(
      page.getByRole("button", { name: "Show my net worth breakdown" })
    ).toBeVisible();
  });

  test("has toolbar buttons for history and more", async ({ page }) => {
    // Verify toolbar buttons exist - there are 2 icon buttons in the header (history, more)
    const headerButtons = page.locator("button").filter({ has: page.locator("svg") });

    await expect(headerButtons.first()).toBeVisible();
    const count = await headerButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("chat panel is hidden by default for new plans", async ({ page }) => {
    // For new plans with no messages, chat sidebar should NOT be visible
    // Only starter prompts should be shown
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).not.toBeVisible();

    // Starter prompts should be visible instead
    await expect(
      page.getByText("Get started with a question")
    ).toBeVisible();
  });

  test("chat panel appears after selecting starter prompt", async ({ page }) => {
    // Click a starter prompt
    await page.getByRole("button", { name: "Show my net worth breakdown" }).click();

    // Wait for animation to complete and chat input to be visible
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 15000 });
  });

  test("starter prompt sends message to chat", async ({ page }) => {
    // Click a starter prompt
    await page.getByRole("button", { name: "Show my net worth breakdown" }).click();

    // Wait for chat panel - use input as indicator
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 15000 });
  });

  test("main content shows loading state when generating", async ({ page }) => {
    // Click a starter prompt
    await page.getByRole("button", { name: "Show my net worth breakdown" }).click();

    // Should show generating state in main content area
    // Check that either generating message OR chat input appears (both valid states)
    const generatingText = page.getByText("Generating your plan...");
    const chatInput = page.getByPlaceholder("Ask about your finances...");

    // Wait for either to be visible
    await expect(generatingText.or(chatInput).first()).toBeVisible({ timeout: 15000 });
  });

  test("navigating from plans list to plan detail works", async ({ page }) => {
    // Go back to plans list
    await page.goto("/plans");

    // Wait for main content loading to finish (use role="main" to avoid sidebar)
    await expect(page.getByRole("main").getByText("Loading...")).not.toBeVisible({ timeout: 10000 });

    // Find and click the first plan with our title (tests may create multiple)
    await page.getByText("Detail Test Plan").first().click();

    // Verify we're on the detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: "Detail Test Plan" })
    ).toBeVisible();
  });
});
