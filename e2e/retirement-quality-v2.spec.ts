import { test, expect } from '@playwright/test';

test.describe('Retirement Plan V2', () => {
  test('creates plan with v2 response format', async ({ page }) => {
    test.setTimeout(180000);

    await page.goto('/plans/new');
    await page.getByRole('button', { name: /Retirement/ }).click();
    await page.getByPlaceholder(/e.g.,/).fill('V2 Test Plan');
    await page.getByRole('button', { name: 'Create Plan' }).click();

    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);

    // Submit prompt
    const input = page.getByPlaceholder(/type your own/);
    await input.fill('I want to retire at 55 with $80k annual spending');
    await page.locator('button[type="submit"]').click();

    // Wait for response
    await expect(page.getByText('Generating')).not.toBeVisible({ timeout: 120000 });

    // Check for v2 elements - prose content should be visible
    await expect(page.locator('.prose')).toBeVisible();

    // Check for markdown rendering (headings, paragraphs)
    await expect(page.locator('.prose h2, .prose h3')).toBeVisible();

    // Check for metrics bar if present (not required, but good to verify rendering)
    const metricsBar = page.locator('[data-testid="metrics-bar"]');
    const hasMetrics = await metricsBar.count() > 0;
    if (hasMetrics) {
      await expect(metricsBar).toBeVisible();
    }

    // Check for actions footer if present
    const actionsFooter = page.locator('[data-testid="actions-footer"]');
    const hasActions = await actionsFooter.count() > 0;
    if (hasActions) {
      await expect(actionsFooter).toBeVisible();
      await expect(actionsFooter.locator('li')).toHaveCount({ minimum: 1 });
    }

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/v2-test.png', fullPage: true });
  });
});
