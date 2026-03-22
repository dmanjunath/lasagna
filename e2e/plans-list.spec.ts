import { test, expect } from "@playwright/test";

test.describe("Plans List Page", () => {
  test("displays empty state when no plans exist", async ({ page }) => {
    // Navigate to plans page
    await page.goto("/plans");

    // Verify page header
    await expect(
      page.getByRole("heading", { name: "Financial Plans" })
    ).toBeVisible();
    await expect(
      page.getByText("AI-powered plans tailored to your goals")
    ).toBeVisible();

    // Verify empty state message
    await expect(page.getByText("No plans yet")).toBeVisible();
    await expect(
      page.getByText("Create your first financial plan to get started.")
    ).toBeVisible();

    // Verify "Create Plan" button in empty state
    await expect(page.getByRole("link", { name: "Create Plan" })).toBeVisible();
  });

  test("has New Plan button in header", async ({ page }) => {
    await page.goto("/plans");

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

    // Click "AI Plans" in sidebar navigation
    await page.getByRole("button", { name: "AI Plans" }).click();

    // Verify navigation
    await expect(page).toHaveURL("/plans");
    await expect(
      page.getByRole("heading", { name: "Financial Plans" })
    ).toBeVisible();
  });
});
