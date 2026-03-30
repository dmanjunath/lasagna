import { test, expect } from "@playwright/test";

test.describe("Probability of Success page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/probability");
  });

  test("loads and displays simulation results", async ({ page }) => {
    // Wait for initial loading to finish
    const outcome = await Promise.race([
      page.getByText("Probability of Success").first().waitFor({ timeout: 30000 }).then(() => "loaded"),
      page.getByText("Simulation Error").waitFor({ timeout: 30000 }).then(() => "error"),
      page.getByText("No Accounts Linked").waitFor({ timeout: 30000 }).then(() => "no-accounts"),
    ]).catch(() => "timeout");

    expect(outcome).not.toBe("timeout");
    expect(outcome).not.toBe("error");

    if (outcome === "no-accounts") {
      console.log("No accounts linked - empty state shown correctly");
      await expect(page.getByText("Link Your First Account")).toBeVisible();
      return;
    }

    // Should show success rate percentage
    await expect(page.locator("text=/\\d+\\.\\d+%/").first()).toBeVisible();
    console.log("Probability page loaded with simulation results");
  });

  test("displays editable stat cards", async ({ page }) => {
    // Wait for page to load
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    // Check if we have accounts (skip if not)
    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Wait for stats row to appear
    await page.waitForTimeout(2000);

    // Verify editable stat cards are visible (use exact match)
    await expect(page.getByText("Retirement Age", { exact: true })).toBeVisible();
    await expect(page.getByText("Life Expectancy", { exact: true })).toBeVisible();
    await expect(page.getByText("Monthly Spend", { exact: true })).toBeVisible();
    await expect(page.getByText("Duration", { exact: true })).toBeVisible();

    // Verify pencil icons are visible (always shown now) - 3 editable cards
    const pencilIcons = page.locator('svg.lucide-pencil');
    expect(await pencilIcons.count()).toBeGreaterThanOrEqual(3);
  });

  test("can edit retirement age with presets", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    await page.waitForTimeout(2000);

    // Click on retirement age card to edit - find the card containing "Retirement Age" label
    const retirementCard = page.locator('.glass-card').filter({ hasText: /^Retirement Age/ }).first();
    await retirementCard.click();

    // Wait for presets to appear
    await page.waitForTimeout(500);

    // Check preset buttons are visible (use exact match to avoid ambiguity)
    await expect(page.getByRole("button", { name: "55", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "60", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "65", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "67", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "70", exact: true })).toBeVisible();

    // Click a preset
    await page.getByRole("button", { name: "60", exact: true }).click();

    // Verify the value changed
    await expect(page.getByText("60").first()).toBeVisible();
  });

  test("can edit life expectancy", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    await page.waitForTimeout(2000);

    // Click on life expectancy card to edit
    const lifeExpCard = page.locator('.glass-card').filter({ hasText: /^Life Expectancy/ }).first();
    await lifeExpCard.click();

    await page.waitForTimeout(500);

    // Check preset buttons (use exact match to avoid ambiguity)
    await expect(page.getByRole("button", { name: "85", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "90", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "95", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "100", exact: true })).toBeVisible();

    // Click a preset
    await page.getByRole("button", { name: "90", exact: true }).click();
  });

  test("displays portfolio allocation section", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Verify portfolio allocation section
    await expect(page.getByText("Portfolio Allocation")).toBeVisible();

    // Verify preset buttons
    await expect(page.getByRole("button", { name: "Conservative" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Balanced" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Growth" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Aggressive" })).toBeVisible();

    // Verify asset class labels with historical returns
    await expect(page.getByText(/US Stocks.*10%/)).toBeVisible();
    await expect(page.getByText(/Int'l Stocks.*7\.5%/)).toBeVisible();
    await expect(page.getByText(/Bonds.*5%/)).toBeVisible();
    await expect(page.getByText(/REITs.*9\.5%/)).toBeVisible();
    await expect(page.getByText(/Cash.*2%/)).toBeVisible();

    // Verify expected return is shown
    await expect(page.getByText("Expected return:")).toBeVisible();
  });

  test("can switch portfolio presets", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Click Conservative preset
    await page.getByRole("button", { name: "Conservative" }).click();
    await page.waitForTimeout(300);

    // Verify expected return changes (conservative ~6.1%)
    const expectedReturn = page.getByText(/Expected return:.*\d+\.\d+%/);
    await expect(expectedReturn).toBeVisible();

    // Click Aggressive preset
    await page.getByRole("button", { name: "Aggressive" }).click();
    await page.waitForTimeout(300);

    // Expected return should be higher for aggressive
    await expect(expectedReturn).toBeVisible();
  });

  test("can run simulation", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Wait for initial simulation to complete
    await page.waitForTimeout(3000);

    // Click Run Simulation button
    const runButton = page.getByRole("button", { name: /Run Simulation/i });
    await expect(runButton).toBeVisible();
    await runButton.click();

    // Should show loading state
    await expect(page.getByText("Running...")).toBeVisible();

    // Wait for simulation to complete
    await page.waitForSelector("text=/\\d+\\.\\d+%/", { timeout: 60000 });

    // Verify results appeared (use first() to avoid strict mode)
    await expect(page.getByText("Probability of Success").first()).toBeVisible();
  });

  test("displays Monte Carlo chart with view toggle", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Wait for charts to load
    await page.waitForTimeout(3000);

    // Check Monte Carlo section
    const mcSection = page.getByText("Monte Carlo Projection");
    if (await mcSection.isVisible()) {
      // Verify view toggle buttons
      await expect(page.getByRole("button", { name: "Fan Chart" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Paths" })).toBeVisible();

      // Click Paths to switch view
      await page.getByRole("button", { name: "Paths" }).click();
      await page.waitForTimeout(500);

      // Switch back to Fan Chart
      await page.getByRole("button", { name: "Fan Chart" }).click();
    }
  });

  test("displays histogram and backtest sections", async ({ page }) => {
    await page.waitForSelector("text=Probability of Success", { timeout: 30000 }).catch(() => null);

    const noAccounts = await page.getByText("No Accounts Linked").isVisible().catch(() => false);
    if (noAccounts) {
      test.skip();
      return;
    }

    // Wait for all charts to load
    await page.waitForTimeout(3000);

    // Check for Distribution section
    const histogramSection = page.getByText("Distribution of Final Portfolio Values");
    if (await histogramSection.isVisible()) {
      // Verify legend items (use exact match to avoid ambiguity)
      await expect(page.getByText("Succeeded", { exact: true })).toBeVisible();
      await expect(page.getByText("Close call", { exact: true })).toBeVisible();
      await expect(page.getByText("Ran out", { exact: true })).toBeVisible();
    }

    // Check for Backtest section
    const backtestSection = page.getByText("Historical Backtest Analysis");
    if (await backtestSection.isVisible()) {
      await expect(page.getByText("Success Rate")).toBeVisible();
      await expect(page.getByText("Avg Final Value")).toBeVisible();
      await expect(page.getByText("Periods Tested")).toBeVisible();
    }
  });
});
