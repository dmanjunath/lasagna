import { chromium } from "@playwright/test";

async function scroll(page: any, px: number) {
  await page.evaluate((n: number) => {
    const el = Array.from(document.querySelectorAll('div')).find(e => {
      const s = window.getComputedStyle(e);
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight;
    });
    if (el) el.scrollTop = n; else window.scrollTo(0, n);
  }, px);
  await page.waitForTimeout(400);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Login
  await page.goto("http://localhost:5173");
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', "seed-1776398734647-1.8M@lasagna.local");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  const pages = [
    { path: '/', name: 'dashboard' },
    { path: '/spending', name: 'spending' },
    { path: '/debt', name: 'debt' },
    { path: '/priorities', name: 'priorities' },
    { path: '/actions', name: 'actions' },
    { path: '/accounts', name: 'accounts' },
    { path: '/invest', name: 'invest' },
    { path: '/retirement', name: 'retirement' },
    { path: '/tax', name: 'tax' },
    { path: '/profile', name: 'profile' },
  ];

  for (const p of pages) {
    await page.goto(`http://localhost:5173${p.path}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `e2e/screenshots/audit-${p.name}-top.png` });
    await scroll(page, 700);
    await page.screenshot({ path: `e2e/screenshots/audit-${p.name}-mid.png` });
  }

  // Mobile
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  await mPage.goto("http://localhost:5173");
  await mPage.waitForSelector('input[type="email"]', { timeout: 5000 });
  await mPage.fill('input[type="email"]', "seed-1776398734647-1.8M@lasagna.local");
  await mPage.fill('input[type="password"]', "password123");
  await mPage.click('button[type="submit"]');
  await mPage.waitForTimeout(2000);

  const mobilePages = ['/', '/spending', '/debt', '/priorities'];
  for (const p of mobilePages) {
    const name = p === '/' ? 'dashboard' : p.slice(1);
    await mPage.goto(`http://localhost:5173${p}`);
    await mPage.waitForTimeout(2500);
    await mPage.screenshot({ path: `e2e/screenshots/audit-mobile-${name}.png` });
  }

  await browser.close();
  console.log("done");
}
main().catch(console.error);
