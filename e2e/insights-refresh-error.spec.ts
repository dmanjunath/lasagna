import { test, expect } from "@playwright/test";

test("clicking Refresh shows error banner when /insights/generate returns 502", async ({ page }) => {
  // Intercept the generate call and respond with 502 (matches the new server
  // contract — generic error, no leaked reason).
  await page.route("**/api/insights/generate", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "generation_failed" }),
    })
  );

  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();

  // Click whichever refresh entry point is on screen (toolbar or empty-state).
  const refreshBtn = page
    .getByRole("button", { name: /^(Refresh|Generate insights)$/i })
    .first();
  await refreshBtn.click();

  // Inline error banner appears
  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/couldn'?t refresh|try again/i);
  // We don't leak the underlying reason
  await expect(banner).not.toContainText(/openrouter|key limit|llm/i);

  await page.screenshot({ path: "e2e/screenshots/insights-refresh-error.png", fullPage: true });
});
