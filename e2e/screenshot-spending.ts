import { chromium } from "@playwright/test";

async function scroll(page: any, px: number) {
  await page.evaluate((scrollPx: number) => {
    // The spending page root div has flex-1 overflow-y-auto
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

  // Desktop
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:5173");
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', "test2@test.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.goto("http://localhost:5173/spending");
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "e2e/screenshots/spending-d1.png" });
  await scroll(page, 600);
  await page.screenshot({ path: "e2e/screenshots/spending-d2.png" });
  await scroll(page, 1400);
  await page.screenshot({ path: "e2e/screenshots/spending-d3.png" });

  // Mobile
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  await mPage.goto("http://localhost:5173");
  await mPage.waitForSelector('input[type="email"]', { timeout: 5000 });
  await mPage.fill('input[type="email"]', "test2@test.com");
  await mPage.fill('input[type="password"]', "password123");
  await mPage.click('button[type="submit"]');
  await mPage.waitForTimeout(2000);
  await mPage.goto("http://localhost:5173/spending");
  await mPage.waitForTimeout(3500);
  await mPage.screenshot({ path: "e2e/screenshots/spending-m1.png" });
  await scroll(mPage, 600);
  await mPage.screenshot({ path: "e2e/screenshots/spending-m2.png" });
  await scroll(mPage, 1400);
  await mPage.screenshot({ path: "e2e/screenshots/spending-m3.png" });

  await browser.close();
  console.log("done");
}
main().catch(console.error);
