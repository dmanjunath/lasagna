import { test, expect, Page } from "@playwright/test";

const RETIREMENT_PROMPT = "lets assume i work until 50 and i want to retire then. what do i need to do in order to be able to spend 100k of todays dollars when i retire?";

interface QualityScore {
  total: number;
  breakdown: {
    hasSectionCards: boolean;
    hasStatBlocks: boolean;
    hasCharts: boolean;
    noTextBlocks: boolean;
    noEmbeddedQuestions: boolean;
    hasActionBlock: boolean;
  };
  issues: string[];
}

async function scoreLayoutQuality(page: Page): Promise<QualityScore> {
  const issues: string[] = [];

  // Check for section cards (labeled cards with headers)
  const sectionCardLabels = page.locator('.text-xs.font-medium.uppercase.tracking-wide');
  const sectionCardCount = await sectionCardLabels.count();
  const hasSectionCards = sectionCardCount > 0;
  if (!hasSectionCards) {
    issues.push("No section_card blocks found - text should use section_card with labels");
  }

  // Check for stat blocks (glass-card with stat styling)
  // Stat cards have a label and value in a specific format
  const statBlocks = page.locator('[class*="glass-card"]').filter({
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
    issues.push("No dynamic charts found - visualizations should use dynamic_chart");
  }

  // Check for deprecated text blocks (prose without section card wrapper)
  // Text blocks would be direct prose content without the label header
  const pageContent = await page.content();
  const hasDeprecatedTextBlock = pageContent.includes('"type":"text"') ||
    pageContent.includes("type: 'text'");
  const noTextBlocks = !hasDeprecatedTextBlock;
  if (!noTextBlocks) {
    issues.push("Found deprecated 'text' blocks - should use section_card instead");
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
  const actionBlocks = page.locator('text=/Next Steps|Recommended Actions/i');
  const hasActionBlock = await actionBlocks.count() > 0;
  if (!hasActionBlock) {
    issues.push("No action block found - should include Next Steps");
  }

  // Calculate total score (each criterion is worth ~16.6 points)
  const breakdown = {
    hasSectionCards,
    hasStatBlocks,
    hasCharts,
    noTextBlocks,
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
    console.log(`  Section Cards: ${score.breakdown.hasSectionCards ? "✓" : "✗"}`);
    console.log(`  Stat Blocks: ${score.breakdown.hasStatBlocks ? "✓" : "✗"}`);
    console.log(`  Dynamic Charts: ${score.breakdown.hasCharts ? "✓" : "✗"}`);
    console.log(`  No Text Blocks: ${score.breakdown.noTextBlocks ? "✓" : "✗"}`);
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
