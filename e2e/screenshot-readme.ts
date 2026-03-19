import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

const EMAIL = "seed-1776374400905-1.8M@lasagna.local";
const PASSWORD = "password123";
const BASE = "http://localhost:5173";
const OUT = path.resolve("screenshots");

async function scroll(page: any, px: number) {
  await page.evaluate((scrollPx: number) => {
    const candidates = Array.from(document.querySelectorAll("div"));
    const scrollable = candidates.find((el) => {
      const style = window.getComputedStyle(el);
      return style.overflowY === "auto" || style.overflowY === "scroll";
    });
    if (scrollable) scrollable.scrollTop = scrollPx;
  }, px);
  await page.waitForTimeout(400);
}

async function login(page: any) {
  await page.goto(BASE);
  await page.waitForSelector('input[type="email"]', { timeout: 8000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
}

async function shot(page: any, name: string) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  captured ${name}.png`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  // ── Desktop (1440×900) ──────────────────────────────────────────────────
  console.log("\nDesktop screenshots...");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);

  // Dashboard
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(3500);
  await shot(page, "dashboard");

  // Actions
  await page.goto(`${BASE}/insights`);
  await page.waitForTimeout(3500);
  await shot(page, "actions");

  // Spending
  await page.goto(`${BASE}/spending`);
  await page.waitForTimeout(3500);
  await shot(page, "spending");

  // Portfolio
  await page.goto(`${BASE}/portfolio`);
  await page.waitForTimeout(6000);
  await shot(page, "portfolio");

  // Retirement
  await page.goto(`${BASE}/retirement`);
  await page.waitForTimeout(3500);
  await shot(page, "retirement");

  // Probability (Monte Carlo)
  await page.goto(`${BASE}/probability`);
  await page.waitForTimeout(5000);
  await shot(page, "probability");

  // Debt
  await page.goto(`${BASE}/debt`);
  await page.waitForTimeout(3000);
  await shot(page, "debt");

  // Priorities
  await page.goto(`${BASE}/priorities`);
  await page.waitForTimeout(3000);
  await shot(page, "priorities");

  // Tax
  await page.goto(`${BASE}/tax`);
  await page.waitForTimeout(3000);
  await shot(page, "tax");

  // Goals
  await page.goto(`${BASE}/goals`);
  await page.waitForTimeout(3000);
  await shot(page, "goals");

  // Plans
  await page.goto(`${BASE}/plans`);
  await page.waitForTimeout(3000);
  await shot(page, "plans");

  await ctx.close();

  // ── Mobile (390×844) ────────────────────────────────────────────────────
  console.log("\nMobile screenshots...");
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mPage = await mCtx.newPage();
  await login(mPage);

  // Dashboard mobile
  await mPage.goto(`${BASE}/`);
  await mPage.waitForTimeout(3500);
  await shot(mPage, "mobile-dashboard");

  // Spending mobile
  await mPage.goto(`${BASE}/spending`);
  await mPage.waitForTimeout(3500);
  await shot(mPage, "mobile-spending");

  // Priorities mobile
  await mPage.goto(`${BASE}/priorities`);
  await mPage.waitForTimeout(3000);
  await shot(mPage, "mobile-priorities");

  await mCtx.close();

  await browser.close();
  console.log(`\nDone. Screenshots saved to ${OUT}`);
}

main().catch(console.error);
