import { test, expect } from "@playwright/test";

test.describe("New Plan Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/plans/new");
  });

  test("displays plan type selection", async ({ page }) => {
    // Verify page header
    await expect(
      page.getByRole("heading", { name: "Create a Plan" })
    ).toBeVisible();
    await expect(
      page.getByText("Choose a plan type and give it a name to get started.")
    ).toBeVisible();

    // Verify all three plan types are visible
    await expect(page.getByText("Net Worth")).toBeVisible();
    await expect(
      page.getByText("Track your wealth, analyze trends, and optimize asset allocation")
    ).toBeVisible();

    await expect(page.getByText("Retirement")).toBeVisible();
    await expect(
      page.getByText("Plan your retirement with withdrawal strategies and projections")
    ).toBeVisible();

    await expect(page.getByText("Custom")).toBeVisible();
    await expect(
      page.getByText("Create a custom plan with AI assistance for any financial goal")
    ).toBeVisible();
  });

  test("shows title input after selecting plan type", async ({ page }) => {
    // Title input should not be visible initially
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).not.toBeVisible();

    // Click on "Net Worth" plan type
    await page.getByText("Net Worth").click();

    // Title input and Create button should now be visible
    await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Plan" })).toBeVisible();
  });

  test("Create button is disabled without title", async ({ page }) => {
    // Select a plan type
    await page.getByText("Retirement").click();

    // Create button should be disabled when title is empty
    const createButton = page.getByRole("button", { name: "Create Plan" });
    await expect(createButton).toBeDisabled();

    // Enter a title
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("My Test Plan");

    // Create button should now be enabled
    await expect(createButton).toBeEnabled();
  });

  test("creates plan and redirects to detail page", async ({ page }) => {
    // Select plan type
    await page.getByText("Custom").click();

    // Enter plan title
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("E2E Test Plan");

    // Click Create Plan
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail page
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);

    // Verify we're on the plan detail page
    await expect(page.getByRole("heading", { name: "E2E Test Plan" })).toBeVisible();
    await expect(page.getByText("custom Plan")).toBeVisible();
  });

  test("can create each plan type", async ({ page }) => {
    // Test creating Net Worth plan
    await page.getByText("Net Worth").click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Test Net Worth Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();

    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);
    await expect(page.getByText("net worth Plan")).toBeVisible();
  });
});
