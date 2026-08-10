import { chromium } from "@playwright/test";

async function scroll(page: any, px: number) {
  await page.evaluate((scrollPx: number) => {
    const candidates = Array.from(document.querySelectorAll('div'));
    const scrollable = candidates.find(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    });
    if (scrollable) scrollable.scrollTop = scrollPx;
  }, px);
  await page.waitForTimeout(400);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto("http://localhost:5173");
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', "test2@test.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  // Focus page
  await page.goto("http://localhost:5173/priorities");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e/screenshots/focus-top.png" });
  await scroll(page, 600);
  await page.screenshot({ path: "e2e/screenshots/focus-mid.png" });
  await scroll(page, 1400);
  await page.screenshot({ path: "e2e/screenshots/focus-bottom.png" });

  // Reference: spending page for width comparison
  await page.goto("http://localhost:5173/spending");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e/screenshots/ref-spending.png" });

  // Reference: debt page
  await page.goto("http://localhost:5173/debt");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "e2e/screenshots/ref-debt.png" });

  await browser.close();
  console.log("done");
}
main().catch(console.error);
