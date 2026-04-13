import { test, expect } from "@playwright/test";

test.describe("Mobile Chat", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("shows floating chat pill on mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("chat-pill")).toBeVisible();
  });

  test("opens chat panel when pill is clicked", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-pill").click();
    // Panel should be visible (pushed into view)
    await expect(page.getByTestId("chat-panel")).toBeInViewport();
    await expect(page.getByTestId("chat-tabs")).toBeVisible();
  });

  test("chat panel has Chat and History tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();
    const chatTab = page.getByTestId("chat-tabs").getByRole("button", { name: "Chat" });
    const historyTab = page.getByTestId("history-tab-button");
    await expect(chatTab).toBeVisible();
    await expect(historyTab).toBeVisible();
  });

  test("closes chat panel when back arrow is clicked", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();
    await page.getByLabel("Close chat").click();
    // Panel should slide offscreen
    await expect(page.getByTestId("chat-panel")).not.toBeInViewport();
  });

  test("chat pill is hidden when panel is open", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();
    await expect(page.getByTestId("chat-pill")).not.toBeVisible();
  });

  test("History tab shows search and category filters", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("chat-pill").click();
    await page.getByTestId("history-tab-button").click();
    await expect(page.getByPlaceholder("Search threads...")).toBeVisible();
    await expect(page.getByTestId("chat-tabs").getByRole("button", { name: "All" })).toBeVisible();
  });

  test("chat persists across navigation", async ({ page }) => {
    await page.goto("/");

    // Open chat
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();

    // Close chat
    await page.getByLabel("Close chat").click();
    await expect(page.getByTestId("chat-panel")).not.toBeInViewport();

    // Navigate to accounts via tab bar
    await page.getByRole("button", { name: "Accounts" }).click();
    await page.waitForURL("/accounts");

    // Open chat again — panel should work
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();
    await expect(page.getByTestId("chat-tabs")).toBeVisible();
  });

  test("push transition moves main content left", async ({ page }) => {
    await page.goto("/");

    // Get the main content's initial position
    const mainContent = page.locator("main");
    const initialBox = await mainContent.boundingBox();
    expect(initialBox).toBeTruthy();

    // Open chat
    await page.getByTestId("chat-pill").click();
    await expect(page.getByTestId("chat-panel")).toBeInViewport();

    // Wait for animation
    await page.waitForTimeout(500);

    // Main content should have moved left
    const afterBox = await mainContent.boundingBox();
    expect(afterBox).toBeTruthy();
    expect(afterBox!.x).toBeLessThan(initialBox!.x);
  });
});

test.describe("Desktop Chat", () => {
  test("chat sidebar toggle is available without admin restriction", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTitle("Open chat")).toBeVisible();
  });
});
