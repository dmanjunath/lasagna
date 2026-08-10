import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const testUserPath = path.resolve(__dirname, ".test-user.json");
const testUser = JSON.parse(readFileSync(testUserPath, "utf-8")) as {
  email: string;
  tenantId: string;
};

const repoRoot = path.resolve(__dirname, "..");

function setLastGeneratedAt(tenantId: string, sqlInterval: string | null) {
  const value = sqlInterval === null ? "NULL" : `NOW() - INTERVAL '${sqlInterval}'`;
  const sql = `UPDATE financial_profiles SET last_actions_generated_at = ${value} WHERE tenant_id = '${tenantId}';`;
  execSync(
    `docker compose exec -T db psql -U lasagna -d lasagna -c "${sql}"`,
    { cwd: repoRoot, encoding: "utf-8" }
  );
}

// All tests mutate the same tenant's last_actions_generated_at, so they must run
// sequentially.
test.describe.configure({ mode: "serial" });

test.describe("Insights lastActionsGeneratedAt display", () => {
  test("NULL value → timestamp is hidden on /insights", async ({ page }) => {
    setLastGeneratedAt(testUser.tenantId, null);

    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();

    // No "Updated" badge should be present
    await expect(page.getByText(/^Updated /)).toHaveCount(0);

    // Refresh button shows plain "Refresh" (no prior gen → no cooldown)
    await expect(page.getByRole("button", { name: /^Refresh$/i })).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/insights-null.png", fullPage: true });
  });

  test("Populated value → '/insights shows 'Updated Xm/h ago' and Refresh shows cooldown", async ({ page }) => {
    setLastGeneratedAt(testUser.tenantId, "30 minutes");

    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();

    // Toolbar timestamp visible
    await expect(page.getByText(/^Updated \d+m ago$/)).toBeVisible();

    // Within 3h → button shows "Refresh in Xh Ym" and is disabled
    const cooldownBtn = page.getByRole("button", { name: /^Refresh in \d+h \d+m$/ });
    await expect(cooldownBtn).toBeVisible();
    await expect(cooldownBtn).toBeDisabled();

    await page.screenshot({ path: "e2e/screenshots/insights-recent.png", fullPage: true });
  });

  test("Populated value → Dashboard shows 'Last updated …'", async ({ page }) => {
    setLastGeneratedAt(testUser.tenantId, "2 hours");

    await page.goto("/");
    // Wait for the dashboard hero
    await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();

    // The hero "Insights & Actions" panel timestamp
    const stamp = page.getByText(/^Last updated \d+h ago$/).first();
    await expect(stamp).toBeVisible();

    await page.screenshot({ path: "e2e/screenshots/dashboard-recent.png", fullPage: true });
  });

  test(">3h old → Refresh button is enabled with 'Refresh' label", async ({ page }) => {
    setLastGeneratedAt(testUser.tenantId, "4 hours");

    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();

    await expect(page.getByText(/^Updated \d+h ago$/)).toBeVisible();
    const btn = page.getByRole("button", { name: /^Refresh$/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });
});
