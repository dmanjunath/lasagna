/**
 * Records a demo video of the Lasagna app.
 * Usage: npx ts-node --esm e2e/record-demo.ts
 *   or:  npx playwright test --config=... (if adapted)
 *
 * Output: e2e/screenshots/demo-video.webm
 * Then convert to mp4: ffmpeg -i demo-video.webm demo-video.mp4
 */

import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

const EMAIL = "demo@lasagnafi.com";
const PASSWORD = "lasagna123";
const BASE = "http://localhost:5173";
const OUT_DIR = path.resolve("e2e/screenshots");

async function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function smoothScroll(page: any, px: number) {
  await page.evaluate((target: number) => {
    const el = Array.from(document.querySelectorAll("div")).find((d) => {
      const s = window.getComputedStyle(d);
      return (s.overflowY === "auto" || s.overflowY === "scroll") && d.scrollHeight > d.clientHeight;
    });
    if (el) el.scrollTop = target;
  }, px);
  await wait(600);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await ctx.newPage();

  // --- Login ---
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await wait(500);
  await page.fill('input[type="email"]', EMAIL);
  await wait(300);
  await page.fill('input[type="password"]', PASSWORD);
  await wait(300);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });
  await wait(2000);

  // --- Dashboard (home) ---
  await page.waitForLoadState("networkidle");
  await wait(2500);
  await smoothScroll(page, 300);
  await wait(1500);
  await smoothScroll(page, 0);
  await wait(1000);

  // --- Actions page ---
  await page.goto(`${BASE}/actions`);
  await page.waitForLoadState("networkidle");
  await wait(2500);

  // --- Accounts ---
  await page.goto(`${BASE}/accounts`);
  await page.waitForLoadState("networkidle");
  await wait(2000);

  // --- Retirement ---
  await page.goto(`${BASE}/retirement`);
  await page.waitForLoadState("networkidle");
  await wait(2500);
  await smoothScroll(page, 400);
  await wait(1500);

  // --- Spending ---
  await page.goto(`${BASE}/spending`);
  await page.waitForLoadState("networkidle");
  await wait(2000);

  // --- Tax strategy ---
  await page.goto(`${BASE}/tax`);
  await page.waitForLoadState("networkidle");
  await wait(2000);

  // --- Back to home ---
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  await wait(1500);

  await ctx.close();
  await browser.close();

  // Playwright saves video as a random uuid.webm in OUT_DIR
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".webm"));
  if (files.length > 0) {
    const latest = files
      .map((f) => ({ f, mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].f;
    const dest = path.join(OUT_DIR, "demo-video.webm");
    fs.renameSync(path.join(OUT_DIR, latest), dest);
    console.log(`\nVideo saved: ${dest}`);
    console.log("\nNext steps:");
    console.log("  1. Convert: ffmpeg -i e2e/screenshots/demo-video.webm -c:v libx264 -pix_fmt yuv420p e2e/screenshots/demo-video.mp4");
    console.log("  2. Upload demo-video.mp4 to YouTube (unlisted) or Vimeo");
    console.log("  3. Get the embed URL: https://www.youtube.com/embed/YOUR_VIDEO_ID");
    console.log("  4. Set PUBLIC_VIDEO_URL in packages/landing/.env");
    console.log("  5. Add VideoSection back to packages/landing/src/pages/index.astro");
  }
}

main().catch(console.error);
