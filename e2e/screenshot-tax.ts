import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto("http://localhost:5173");
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', "seed-1775948687122-750k@lasagna.local");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  await page.goto("http://localhost:5173/tax");
  await page.waitForTimeout(3000);

  // Get the Tax Documents section bounding box
  const section = await page.locator("text=Tax Documents").first();
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  
  // Screenshot just the panel area
  const panelEl = await page.locator(".glass-card").filter({ hasText: "Add tax information" }).first();
  if (await panelEl.isVisible().catch(() => false)) {
    const box = await panelEl.boundingBox();
    console.log("panel box:", JSON.stringify(box));
    await page.screenshot({ 
      path: "e2e/screenshots/tax-panel-zoom.png",
      clip: box ? { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 40), width: box.width + 40, height: box.height + 80 } : undefined
    });
  }

  // Also mobile view
  await context.newPage(); // just for reference
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto("http://localhost:5173/tax");
  await mobilePage.waitForTimeout(3000);
  const mobilePanel = await mobilePage.locator(".glass-card").filter({ hasText: "Add tax information" }).first();
  if (await mobilePanel.isVisible().catch(() => false)) {
    await mobilePanel.scrollIntoViewIfNeeded();
    await mobilePage.waitForTimeout(400);
    const mbox = await mobilePanel.boundingBox();
    await mobilePage.screenshot({ 
      path: "e2e/screenshots/tax-panel-mobile.png",
      clip: mbox ? { x: Math.max(0, mbox.x - 10), y: Math.max(0, mbox.y - 20), width: mbox.width + 20, height: mbox.height + 60 } : undefined
    });
  }

  await browser.close();
  console.log("done");
}
main().catch(console.error);
