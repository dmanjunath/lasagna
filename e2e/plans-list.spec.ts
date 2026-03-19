import { test, expect } from "@playwright/test";

test.describe("Plans List Page", () => {
  test("displays plans page with header and content", async ({ page }) => {
    // Navigate to plans page
    await page.goto("/plans");

    // Verify page header
    await expect(
      page.getByRole("heading", { name: "Financial Plans" })
    ).toBeVisible();
    await expect(
      page.getByText("AI-powered plans tailored to your goals")
    ).toBeVisible();

    // Wait for loading to finish
    await expect(page.getByText("Loading...")).not.toBeVisible({ timeout: 10000 });

    // Page should show either empty state or existing plans
    // The "New Plan" button in header is always visible
    await expect(page.getByRole("link", { name: "New Plan" })).toBeVisible();
  });

  test("has New Plan button in header", async ({ page }) => {
    await page.goto("/plans");

    // Wait for page to load
    await expect(page.getByRole("heading", { name: "Financial Plans" })).toBeVisible();

    // Verify "New Plan" button exists in header
    const newPlanButton = page.getByRole("link", { name: "New Plan" });
    await expect(newPlanButton).toBeVisible();

    // Click and verify navigation
    await newPlanButton.click();
    await expect(page).toHaveURL("/plans/new");
  });

  test("can navigate to plans via sidebar", async ({ page }) => {
    // Start at dashboard
    await page.goto("/");

    // Click "AI Plans" in sidebar navigation (button contains icon + text)
    await page.getByRole("button", { name: /AI Plans/ }).click();

    // Verify navigation
    await expect(page).toHaveURL("/plans");
    await expect(
      page.getByRole("heading", { name: "Financial Plans" })
    ).toBeVisible();
  });
});
