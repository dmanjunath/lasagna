import { test, expect } from "@playwright/test";

test.describe("Plan Detail Page", () => {
  let planId: string;

  test.beforeEach(async ({ page }) => {
    // Create a plan first
    await page.goto("/plans/new");
    await page.getByText("Net Worth").click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Detail Test Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect and extract plan ID from URL
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);
    const url = page.url();
    planId = url.split("/plans/")[1];
  });

  test("displays plan header with title and type", async ({ page }) => {
    // Verify plan header
    await expect(
      page.getByRole("heading", { name: "Detail Test Plan" })
    ).toBeVisible();
    await expect(page.getByText("net worth Plan")).toBeVisible();
  });

  test("shows empty state when plan has no content", async ({ page }) => {
    // New plan should show empty state
    await expect(
      page.getByText("This plan is empty. Start a conversation to generate content.")
    ).toBeVisible();
  });

  test("has toolbar buttons for chat, history, and more", async ({ page }) => {
    // Verify toolbar buttons exist
    // These are icon buttons, so we check by their accessible names or parent structure
    const chatButton = page.locator("button").filter({ has: page.locator(".lucide-message-square") }).first();
    const historyButton = page.locator("button").filter({ has: page.locator(".lucide-history") });
    const moreButton = page.locator("button").filter({ has: page.locator(".lucide-more-vertical") });

    await expect(chatButton).toBeVisible();
    await expect(historyButton).toBeVisible();
    await expect(moreButton).toBeVisible();
  });

  test("chat panel is visible by default", async ({ page }) => {
    // Chat panel should be visible when plan loads with a thread
    // The chat input should be present
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).toBeVisible({ timeout: 5000 });
  });

  test("can toggle chat panel visibility", async ({ page }) => {
    // Wait for chat panel to load
    await expect(
      page.getByPlaceholder("Ask about your finances...")
    ).toBeVisible({ timeout: 5000 });

    // Click chat toggle button to hide
    const chatToggle = page.locator("button").filter({ has: page.locator(".lucide-message-square") }).first();
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
    ).toBeVisible({ timeout: 5000 });
  });

  test("can send a chat message", async ({ page }) => {
    // Wait for chat panel to load
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type a message
    await chatInput.fill("What is my net worth?");

    // Click send button
    await page.getByRole("button", { name: "Send" }).click();

    // Message should appear in the chat
    await expect(page.getByText("What is my net worth?")).toBeVisible();

    // Input should be cleared after sending
    await expect(chatInput).toHaveValue("");
  });

  test("chat input is disabled while loading", async ({ page }) => {
    // Wait for chat panel to load
    const chatInput = page.getByPlaceholder("Ask about your finances...");
    await expect(chatInput).toBeVisible({ timeout: 5000 });

    // Type and send a message
    await chatInput.fill("Test message");
    await page.getByRole("button", { name: "Send" }).click();

    // During loading, the input and button should be disabled
    // This is a brief state, so we check immediately after clicking
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("navigating from plans list to plan detail works", async ({ page }) => {
    // Go back to plans list
    await page.goto("/plans");

    // Find and click the plan we created
    await page.getByText("Detail Test Plan").click();

    // Verify we're on the detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);
    await expect(
      page.getByRole("heading", { name: "Detail Test Plan" })
    ).toBeVisible();
  });
});
