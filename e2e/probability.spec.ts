import { test, expect } from "@playwright/test";

test.describe("Probability of Success page", () => {
  // Simulations can take time to complete
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/probability");
  });

  /**
   * Wait for the page to finish initial data loading.
   * Returns "loaded" once stat cards appear, or "no-accounts" if empty state.
   */
  async function waitForPage(page: import("@playwright/test").Page) {
    const outcome = await Promise.race([
      page
        .getByText("Portfolio Value")
        .first()
        .waitFor({ timeout: 30000 })
        .then(() => "loaded" as const),
      page
        .getByText("No Accounts Linked")
        .waitFor({ timeout: 30000 })
        .then(() => "no-accounts" as const),
    ]).catch(() => "timeout" as const);

    expect(outcome).not.toBe("timeout");
    return outcome;
  }

  /** Wait for simulation results (success rate percentage) to appear. */
  async function waitForResults(page: import("@playwright/test").Page) {
    await expect(
      page.getByText("Probability of Success").first()
    ).toBeVisible({ timeout: 45000 });
  }

  test("page loads and shows results", async ({ page }) => {
    const outcome = await waitForPage(page);

    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    // Wait for simulation to produce success rate
    await waitForResults(page);
    await expect(page.locator("text=/\\d+(\\.\\d+)?%/").first()).toBeVisible();
  });

  test("strategy selector visible with 4 options", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    await expect(
      page.getByRole("button", { name: "Constant Dollar" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "% of Portfolio" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guardrails" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rules-Based" })
    ).toBeVisible();
  });

  test("can switch strategies", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    // Switch to % of Portfolio
    await page.getByRole("button", { name: "% of Portfolio" }).click();
    await expect(page.getByText("Withdrawal rate")).toBeVisible({
      timeout: 5000,
    });

    // Switch to Guardrails
    await page.getByRole("button", { name: "Guardrails" }).click();
    await expect(page.getByText("Initial withdrawal rate")).toBeVisible({
      timeout: 5000,
    });
  });

  test("portfolio allocation presets visible", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    await expect(
      page.getByRole("button", { name: "Conservative" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Balanced" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Growth" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Aggressive" })
    ).toBeVisible();
  });

  test("can run simulation", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    // Wait for initial simulation to finish
    await waitForResults(page);

    const runButton = page.getByRole("button", { name: /Run Simulation/i });
    await expect(runButton).toBeVisible();
    await runButton.click();

    // Wait for new results
    await waitForResults(page);
    await expect(page.locator("text=/\\d+(\\.\\d+)?%/").first()).toBeVisible();
  });

  test("backtest section shows filter cards", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    // Wait for simulation results to populate backtest section
    await waitForResults(page);

    // Use button role to target the filter card buttons specifically
    await expect(
      page.getByRole("button", { name: /Succeeded/ })
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: /Close Call/ })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Ran Out/ })
    ).toBeVisible();
  });

  test("dollar toggle works", async ({ page }) => {
    const outcome = await waitForPage(page);
    if (outcome === "no-accounts") {
      test.skip(true, "No accounts linked");
      return;
    }

    // Wait for simulation results so the toggle is rendered
    await waitForResults(page);

    const nominalButton = page.getByRole("button", { name: "Nominal $" });
    await expect(nominalButton).toBeVisible();
    await nominalButton.click();

    // Verify it's still visible after click (toggle worked without error)
    await expect(nominalButton).toBeVisible();
  });
});
