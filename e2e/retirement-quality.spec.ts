import { test, expect, Page } from "@playwright/test";

const RETIREMENT_PROMPT = "lets assume i work until 50 and i want to retire then. what do i need to do in order to be able to spend 100k of todays dollars when i retire?";

interface QualityScore {
  total: number;
  breakdown: {
    hasProseContent: boolean;
    hasStatBlocks: boolean;
    hasCharts: boolean;
    hasSectionCardsOrCallouts: boolean;
    noEmbeddedQuestions: boolean;
    hasActionBlock: boolean;
  };
  issues: string[];
}

async function scoreLayoutQuality(page: Page): Promise<QualityScore> {
  const issues: string[] = [];

  // Check for prose content (text blocks with markdown - research report style)
  // Look for rendered markdown: paragraphs, headers, lists
  const proseContent = page.locator('.prose');
  const proseCount = await proseContent.count();
  const hasProseContent = proseCount > 0;
  if (!hasProseContent) {
    issues.push("No prose content found - should include narrative text blocks");
  }

  // Check for stat blocks (glass-card with stat styling)
  const statBlocks = page.locator('[class*="stat-card"], [class*="glass-card"]').filter({
    has: page.locator('.text-3xl, .text-2xl') // Large values indicate stat blocks
  });
  const statCount = await statBlocks.count();
  const hasStatBlocks = statCount > 0;
  if (!hasStatBlocks) {
    issues.push("No stat blocks found - key metrics should use stat blocks");
  }

  // Check for charts (Recharts or Vega containers)
  const charts = page.locator('.recharts-wrapper, [class*="vega"], svg.recharts-surface');
  const chartCount = await charts.count();
  const hasCharts = chartCount > 0;
  if (!hasCharts) {
    issues.push("No charts found - visualizations should use dynamic_chart");
  }

  // Check for section cards or callouts (for emphasis, warnings, key insights)
  const sectionCardLabels = page.locator('.tracking-widest.uppercase, .tracking-wide.uppercase');
  const sectionCardCount = await sectionCardLabels.count();
  const hasSectionCardsOrCallouts = sectionCardCount > 0;
  if (!hasSectionCardsOrCallouts) {
    issues.push("No section cards found - use for key insights/warnings");
  }

  // Check for embedded questions in content (should be in chat instead)
  const contentArea = page.locator('.max-w-4xl');
  const contentText = await contentArea.textContent() || "";
  const questionPatterns = [
    /what is your.*\?/i,
    /tell me your.*\?/i,
    /how old are you/i,
    /what.*age.*\?/i,
    /please provide/i,
    /i need.*information/i,
  ];
  const hasEmbeddedQuestions = questionPatterns.some(pattern => pattern.test(contentText));
  const noEmbeddedQuestions = !hasEmbeddedQuestions;
  if (!noEmbeddedQuestions) {
    issues.push("Found embedded questions in content - follow-up questions should be in chat");
  }

  // Check for action blocks (next steps)
  const actionBlocks = page.locator('text=/Next Steps|Recommended Actions|Recommended Next/i');
  const hasActionBlock = await actionBlocks.count() > 0;
  if (!hasActionBlock) {
    issues.push("No action block found - should include Next Steps");
  }

  // Calculate total score (each criterion is worth ~16.6 points)
  const breakdown = {
    hasProseContent,
    hasStatBlocks,
    hasCharts,
    hasSectionCardsOrCallouts,
    noEmbeddedQuestions,
    hasActionBlock,
  };

  const total = Object.values(breakdown).filter(Boolean).length * 16.67;

  return { total: Math.round(total), breakdown, issues };
}

test.describe("Retirement Plan Quality", () => {
  test("creates retirement plan and scores layout quality", async ({ page }) => {
    // Increase timeout for LLM response
    test.setTimeout(180000); // 3 minutes

    // Step 1: Create a retirement plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();

    // Select Retirement plan type
    await page.getByRole("button", { name: /Retirement.*Plan your retirement/ }).click();

    // Fill in plan name
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Quality Test - Retire at 50");
    await page.getByRole("button", { name: "Create Plan" }).click();

    // Wait for redirect to plan detail
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 15000 });
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 15000 });

    // Step 2: Submit custom prompt
    const customInput = page.getByPlaceholder("Or type your own question...");
    await expect(customInput).toBeVisible({ timeout: 10000 });

    await customInput.fill(RETIREMENT_PROMPT);
    await page.getByRole("button", { name: /send/i }).or(page.locator('button[type="submit"]')).click();

    // Step 3: Wait for content generation
    // First, wait for loading state
    await expect(page.getByText("Generating your plan...")).toBeVisible({ timeout: 10000 });

    // Then wait for loading to finish (content appears)
    await expect(page.getByText("Generating your plan...")).not.toBeVisible({ timeout: 120000 });

    // Wait a bit more for content to render
    await page.waitForTimeout(2000);

    // Step 4: Score the quality
    const score = await scoreLayoutQuality(page);

    console.log("\n=== LAYOUT QUALITY SCORE ===");
    console.log(`Total Score: ${score.total}/100`);
    console.log("\nBreakdown:");
    console.log(`  Prose Content: ${score.breakdown.hasProseContent ? "✓" : "✗"}`);
    console.log(`  Stat Blocks: ${score.breakdown.hasStatBlocks ? "✓" : "✗"}`);
    console.log(`  Charts: ${score.breakdown.hasCharts ? "✓" : "✗"}`);
    console.log(`  Section Cards/Callouts: ${score.breakdown.hasSectionCardsOrCallouts ? "✓" : "✗"}`);
    console.log(`  No Embedded Questions: ${score.breakdown.noEmbeddedQuestions ? "✓" : "✗"}`);
    console.log(`  Action Block: ${score.breakdown.hasActionBlock ? "✓" : "✗"}`);

    if (score.issues.length > 0) {
      console.log("\nIssues:");
      score.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    console.log("============================\n");

    // Take a screenshot for review
    await page.screenshot({
      path: `e2e/screenshots/retirement-quality-${Date.now()}.png`,
      fullPage: true
    });

    // Assert minimum quality threshold (50% = 3 out of 6 criteria)
    expect(score.total).toBeGreaterThanOrEqual(50);
  });
});
