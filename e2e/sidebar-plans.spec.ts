import { test, expect } from "@playwright/test";

test.describe("Sidebar Plans", () => {
  test("shows Your Plans section with expand/collapse", async ({ page }) => {
    await page.goto("/");

    // Verify the "Your Plans" section header is visible
    await expect(page.getByText("Your Plans")).toBeVisible();

    // The section should show either plans or "No plans yet" or "Loading..."
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    // Click to collapse the plans section
    await page.getByText("Your Plans").click();

    // The "New Plan" button should be hidden when collapsed
    await expect(page.locator("aside").getByRole("button", { name: "New Plan" })).not.toBeVisible();

    // Click to expand again
    await page.getByText("Your Plans").click();

    // "New Plan" button should be visible again
    await expect(page.locator("aside").getByRole("button", { name: "New Plan" })).toBeVisible();
  });

  test("New Plan button navigates to create plan page", async ({ page }) => {
    await page.goto("/");

    // Wait for sidebar to load
    await expect(page.getByText("Your Plans")).toBeVisible();

    // Click New Plan button in sidebar
    await page.locator("aside").getByRole("button", { name: "New Plan" }).click();

    // Should navigate to new plan page
    await expect(page).toHaveURL("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
  });

  test("created plan appears in sidebar", async ({ page }) => {
    // First create a plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();

    // Select Net Worth plan type
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();

    // Fill in title
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Sidebar Test Plan");

    // Create the plan
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    // Now the sidebar should show this plan
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("Sidebar Test Plan")).toBeVisible();
  });

  test("clicking plan in sidebar navigates to plan detail", async ({ page }) => {
    // First create a plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();

    await page.getByRole("button", { name: /Retirement.*Plan your retirement/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Navigate Test Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    const planUrl = page.url();

    // Navigate away to dashboard
    await page.goto("/");
    await expect(page.getByText("Overview")).toBeVisible();

    // Click on the plan in sidebar
    const sidebar = page.locator("aside");
    await sidebar.getByText("Navigate Test Plan").click();

    // Should navigate back to the plan detail page
    await expect(page).toHaveURL(planUrl);
    await expect(page.getByRole("heading", { name: "Navigate Test Plan" })).toBeVisible();
  });
});
