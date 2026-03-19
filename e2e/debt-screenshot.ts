import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(ctx => ctx.newPage());
  await page.goto("http://localhost:5173");
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', "test2@test.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  await page.goto("http://localhost:5173/debt");
  await page.waitForTimeout(3500);
  // Extract text from page
  const text = await page.evaluate(() => document.body.innerText);
  console.log("PAGE TEXT:\n" + text);
  await browser.close();
}
main().catch(console.error);
