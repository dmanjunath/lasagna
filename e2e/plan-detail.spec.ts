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

  test("shows empty state when plan has no content", async ({ page }) => {
    // New plan should show empty state
    await expect(
      page.getByText("This plan is empty. Start a conversation to generate content.")
    ).toBeVisible();
  });

  test("has toolbar buttons for chat, history, and more", async ({ page }) => {
    // Verify toolbar buttons exist - there are 3 icon buttons in the header
    // Use the header container to find the buttons
    const headerButtons = page.locator("button").filter({ has: page.locator("svg") });

    // Should have at least 3 icon buttons (chat toggle, history, more)
    await expect(headerButtons.first()).toBeVisible();
    const count = await headerButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("chat panel is visible by default", async ({ page }) => {
    // Chat panel should be visible when plan loads with a thread
    // The chat input should be present
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).toBeVisible({ timeout: 10000 });
  });

  test("can toggle chat panel visibility", async ({ page }) => {
    // Wait for chat panel to load
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).toBeVisible({ timeout: 10000 });

    // Click the first icon button in header (chat toggle) to hide chat
    const headerIconButtons = page.locator("button").filter({ has: page.locator("svg") });
    const chatToggle = headerIconButtons.first();
    await chatToggle.click();

    // Chat input should no longer be visible
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).not.toBeVisible();

    // Click again to show
    await chatToggle.click();

    // Chat input should be visible again
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).toBeVisible({ timeout: 10000 });
  });

  test("can send a chat message", async ({ page }) => {
    // Wait for chat panel to load
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // Type a message
    await chatInput.fill("What is my net worth?");

    // Click send button (submit button in the chat form)
    const sendButton = page.locator("form button[type='submit']");
    await sendButton.click();

    // Message should appear in the chat
    await expect(page.getByText("What is my net worth?")).toBeVisible({ timeout: 10000 });

    // Input should be cleared after sending
    await expect(chatInput).toHaveValue("");
  });

  test("chat input is disabled while loading", async ({ page }) => {
    // Wait for chat panel to load
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 10000 });

    // Type and send a message
    await chatInput.fill("Test message");
    const sendButton = page.locator("form button[type='submit']");
    await sendButton.click();

    // During loading, the input and button should be disabled
    // This is a brief state, so we check immediately after clicking
    await expect(sendButton).toBeDisabled();
  });

  test("navigating from plans list to plan detail works", async ({ page }) => {
    // Go back to plans list
    await page.goto("/plans");

    // Wait for loading to finish
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 10000 });

    // Find and click the first plan with our title (tests may create multiple)
    await page.getByText("Detail Test Plan").first().click();

    // Verify we're on the detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: "Detail Test Plan" })
    ).toBeVisible();
  });
});
