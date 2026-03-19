/**
 * Take full-length screenshots of the app.
 *
 * Usage:
 *   node take-screenshots.mjs           # desktop only (default)
 *   node take-screenshots.mjs --mobile  # desktop + mobile
 */

import { chromium } from "playwright";
import { readdirSync, unlinkSync } from "fs";
import { join } from "path";

const BASE_URL = "http://localhost:5173";
const EMAIL = "seed-1776398734647-1.8M@lasagna.local";
const PASSWORD = "password123";
const DIR = join(process.cwd(), "screenshots");
const MOBILE = process.argv.includes("--mobile");

// Delete existing screenshots
for (const file of readdirSync(DIR)) {
  if (file.endsWith(".png")) {
    const isMobile = file.startsWith("mobile-");
    if (!isMobile || MOBILE) {
      unlinkSync(join(DIR, file));
      console.log(`Deleted: ${file}`);
    }
  }
}

async function loginUser(p, label) {
  console.log(`Logging in (${label})...`);
  await p.goto(BASE_URL);
  await p.waitForSelector('input[type="email"]', { timeout: 10000 });
  await p.fill('input[type="email"]', EMAIL);
  await p.fill('input[type="password"]', PASSWORD);
  await p.click('button[type="submit"]');
  await p.waitForSelector('input[type="email"]', { state: "detached", timeout: 15000 });
  await p.waitForLoadState("networkidle");
  console.log(`Logged in (${label})`);
}

// Unlock the inner scroll container and expand the viewport to full content height
async function fullPageScreenshot(p, name) {
  const fullHeight = await p.evaluate(() => {
    const root = document.querySelector('[class*="h-dvh"]') || document.querySelector('[class*="h-screen"]');
    if (root) { root.style.height = "auto"; root.style.overflow = "visible"; }
    const main = document.querySelector("main");
    if (main) {
      let el = main;
      while (el && el !== document.body) {
        el.style.overflow = "visible";
        el.style.height = "auto";
        el.style.maxHeight = "none";
        el = el.parentElement;
      }
      main.style.overflow = "visible";
      main.style.height = "auto";
    }
    document.querySelectorAll("main *").forEach(el => {
      const s = window.getComputedStyle(el);
      if (s.overflowY === "auto" || s.overflowY === "scroll" || s.overflow === "hidden") {
        el.style.overflow = "visible";
        el.style.height = "auto";
        el.style.maxHeight = "none";
      }
    });
    return document.body.scrollHeight || document.documentElement.scrollHeight;
  });

  const vp = p.viewportSize();
  await p.setViewportSize({ width: vp.width, height: Math.max(fullHeight + 50, vp.height) });
  await p.waitForTimeout(400);
  await p.screenshot({ path: join(DIR, `${name}.png`) });
  await p.setViewportSize(vp);
  console.log(`Screenshot: ${name}.png (${fullHeight}px)`);
}

const browser = await chromium.launch({ headless: true });

// ── Desktop ──────────────────────────────────────────────────────────────────
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await loginUser(page, "desktop");

const desktopPages = [
  { name: "dashboard",          url: "/" },
  { name: "actions",            url: "/insights" },
  { name: "priorities",         url: "/priorities" },
  { name: "retirement",         url: "/retirement" },
  { name: "portfolio",          url: "/portfolio" },
  { name: "spending",           url: "/spending" },
  { name: "debt",               url: "/debt" },
  { name: "tax",                url: "/tax" },
];

for (const { name, url } of desktopPages) {
  await page.goto(`${BASE_URL}${url}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await fullPageScreenshot(page, name);
}

// Retirement simple / advanced
await page.goto(`${BASE_URL}/retirement`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);
await fullPageScreenshot(page, "retirement-simple");
await page.click('button:has-text("Advanced")');
await page.waitForTimeout(800);
await fullPageScreenshot(page, "retirement-advanced");

// ── Mobile (opt-in) ───────────────────────────────────────────────────────────
if (MOBILE) {
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const mobilePage = await mobileCtx.newPage();
  await loginUser(mobilePage, "mobile");

  const mobilePages = [
    { name: "mobile-dashboard",   url: "/" },
    { name: "mobile-spending",    url: "/spending" },
    { name: "mobile-priorities",  url: "/priorities" },
  ];

  for (const { name, url } of mobilePages) {
    await mobilePage.goto(`${BASE_URL}${url}`);
    await mobilePage.waitForLoadState("networkidle");
    await mobilePage.waitForTimeout(800);
    await fullPageScreenshot(mobilePage, name);
  }
}

await browser.close();
console.log("Done!");
