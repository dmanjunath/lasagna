import { test, expect } from "playwright/test";
import path from "path";

const mockupUrl = `file://${path.resolve(__dirname, "lasagna-hifi-v6.html")}`;

test.describe("Lasagna Hi-Fi Mockup v6", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(mockupUrl);
    await page.waitForTimeout(1000);
  });

  test("renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload();
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test("shows persona toggles", async ({ page }) => {
    await expect(page.locator("#toggle-debt")).toBeVisible();
    await expect(page.locator("#toggle-invest")).toBeVisible();
  });

  test("has no onboarding selector", async ({ page }) => {
    await expect(page.locator("text=What's your main focus")).not.toBeVisible();
    // "Get started" text may appear in chat empty state, only check for onboarding button
    await expect(page.locator("button:has-text('Get started')")).not.toBeVisible();
  });

  // ─── Navigation ───

  test("bottom nav has all 5 tabs", async ({ page }) => {
    for (const label of ["Home", "Debt", "Invest", "Tax", "Profile"]) {
      await expect(page.locator(`nav button:has-text("${label}")`)).toBeVisible();
    }
  });

  test("Home tab active by default", async ({ page }) => {
    await expect(page.locator('button[data-tab="home"]')).toHaveClass(/active/);
    await expect(page.locator("#tab-home")).toHaveClass(/active/);
  });

  test("tab switching works", async ({ page }) => {
    for (const tab of ["debt", "invest", "tax", "profile"]) {
      await page.click(`button[data-tab="${tab}"]`);
      await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
    }
  });

  // ─── Persona Toggle ───

  test("default persona is debt + invest", async ({ page }) => {
    await expect(page.locator("#toggle-debt .persona-opt.active")).toHaveAttribute("data-val", "debt");
    await expect(page.locator("#toggle-invest .persona-opt.active")).toHaveAttribute("data-val", "invest");
    await expect(page.locator(".net-worth-amount")).toContainText("$23,800");
  });

  test("switching to no-debt changes content", async ({ page }) => {
    await page.click('#toggle-debt button[data-val="free"]');
    await expect(page.locator(".net-worth-amount")).toContainText("$47,230");
    await expect(page.locator("text=Debt-free ✓").first()).toBeVisible();
  });

  test("switching to no-invest changes content", async ({ page }) => {
    await page.click('#toggle-invest button[data-val="noinvest"]');
    await expect(page.locator(".net-worth-amount")).toContainText("$8,400");
    await expect(page.locator("text=Build a $1,000 starter emergency fund")).toBeVisible();
  });

  test("all 4 persona combos render without errors", async ({ page }) => {
    const combos = [
      ["debt", "invest"],
      ["debt", "noinvest"],
      ["free", "invest"],
      ["free", "noinvest"],
    ];
    for (const [d, i] of combos) {
      await page.click(`#toggle-debt button[data-val="${d}"]`);
      await page.click(`#toggle-invest button[data-val="${i}"]`);
      await page.waitForTimeout(300);
      // Every tab should have content
      for (const tab of ["home", "debt", "invest", "tax", "profile"]) {
        await page.click(`button[data-tab="${tab}"]`);
        await page.waitForTimeout(200);
        const text = await page.locator(`#tab-${tab}`).innerText();
        expect(text.trim().length).toBeGreaterThan(20);
      }
    }
  });

  // ─── Home Tab ───

  test("Home shows Do This Next card", async ({ page }) => {
    await expect(page.locator("text=Do This Next")).toBeVisible();
    await expect(page.locator("#next-action-title")).not.toBeEmpty();
  });

  test("Home shows Your Layers module cards", async ({ page }) => {
    await expect(page.locator("#home-debt-card")).toBeVisible();
    await expect(page.locator("#home-invest-card")).toBeVisible();
    await expect(page.locator("#home-tax-card")).toBeVisible();
  });

  test("Home layer cards navigate to tabs", async ({ page }) => {
    await page.click("[data-nav='invest']");
    await expect(page.locator("#tab-invest")).toHaveClass(/active/);
  });

  // ─── Debt Tab ───

  test("Debt tab shows debts in debt persona", async ({ page }) => {
    await page.click('button[data-tab="debt"]');
    await expect(page.locator("text=Chase Sapphire").first()).toBeVisible();
    await expect(page.locator("text=$14,200").first()).toBeVisible();
  });

  test("Debt tab shows celebration in debt-free persona", async ({ page }) => {
    await page.click('#toggle-debt button[data-val="free"]');
    await page.click('button[data-tab="debt"]');
    await expect(page.locator("text=Debt-free").first()).toBeVisible();
  });

  // ─── Invest Tab ───

  test("Invest tab shows content for each persona", async ({ page }) => {
    // Debt + invest
    await page.click('button[data-tab="invest"]');
    await expect(page.locator("text=Capture the match only")).toBeVisible();

    // No debt + invest
    await page.click('#toggle-debt button[data-val="free"]');
    await page.waitForTimeout(300);
    await expect(page.locator("text=Ready to invest")).toBeVisible();
  });

  // ─── Tax Tab ───

  test("Tax tab shows optimization actions, not tax owed", async ({ page }) => {
    await page.click('button[data-tab="tax"]');
    await expect(page.locator("#tab-tax .card-label:has-text('Tax Optimization Playbook')")).toBeVisible();
    await expect(page.locator("text=actions to reduce taxes")).toBeVisible();
    // Should NOT have tax owed estimate
    await expect(page.locator("text=~$8,420 owed")).not.toBeVisible();
  });

  test("Tax tab has actionable items", async ({ page }) => {
    await page.click('button[data-tab="tax"]');
    const actions = page.locator(".action-item");
    expect(await actions.count()).toBeGreaterThanOrEqual(3);
  });

  // ─── Action Items ───

  test("Debt tab has action items with checkboxes", async ({ page }) => {
    await page.click('button[data-tab="debt"]');
    const actions = page.locator("#tab-debt .action-item");
    expect(await actions.count()).toBeGreaterThanOrEqual(3);
  });

  test("Action checkboxes toggle on click", async ({ page }) => {
    await page.click('button[data-tab="debt"]');
    const check = page.locator("#tab-debt .action-check").first();
    await expect(check).not.toHaveClass(/done/);
    await check.click();
    await expect(check).toHaveClass(/done/);
    await check.click();
    await expect(check).not.toHaveClass(/done/);
  });

  // ─── Chat ───

  test("mobile: chat peek bar opens drawer", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(mockupUrl);
    await page.waitForTimeout(1000);

    await page.click("#chat-peek-bar");
    await expect(page.locator("#chat-drawer")).toHaveClass(/open/);
    await page.click("#chat-close");
    await expect(page.locator("#chat-drawer")).not.toHaveClass(/open/);
    await ctx.close();
  });

  test("chat shows empty thread list initially", async ({ page }) => {
    await expect(page.locator("text=Conversations").first()).toBeVisible();
    await expect(page.locator("text=No conversations yet")).toBeVisible();
  });

  test("chat creates new thread on send", async ({ page }) => {
    await page.fill("#chat-input", "hello");
    await page.click("#chat-send");
    // Should switch to thread view with user message
    await expect(page.locator(".chat-bubble.user").first()).toContainText("hello");
    // Bot responds
    await page.waitForTimeout(3000);
    expect(await page.locator(".chat-bubble.bot").count()).toBeGreaterThanOrEqual(1);
    // Back to list shows the thread
    await page.click("#chat-back");
    await expect(page.locator(".chat-thread-item")).toBeVisible();
  });

  test("prompt tiles create new chat thread", async ({ page }) => {
    const tile = page.locator("#tab-home .prompt-tile").first();
    await tile.click();
    await page.waitForTimeout(3000);
    await expect(page.locator(".chat-bubble.user").first()).toBeVisible();
  });

  // ─── Responsive ───

  test("mobile viewport works", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(mockupUrl);
    await page.waitForTimeout(1000);
    const nav = page.locator("nav.bottom-nav");
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(380);
    await ctx.close();
  });

  test("desktop shows full-width layout with sidebar nav and chat panel", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(mockupUrl);
    await page.waitForTimeout(1000);

    // Frame should be full width (not constrained to 430px)
    const box = await page.locator(".app-frame").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(1000);

    // Sidebar nav should be visible (vertical, not bottom)
    const nav = page.locator("nav.bottom-nav");
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.height).toBeGreaterThan(navBox!.width); // taller than wide = sidebar

    // Chat panel should be persistently visible (no drawer toggle needed)
    const chat = page.locator("#chat-drawer");
    await expect(chat).toBeVisible();
    await expect(page.locator("text=Conversations").first()).toBeVisible();

    // Peek bar should be hidden on desktop
    await expect(page.locator("#chat-peek-bar")).not.toBeVisible();

    await ctx.close();
  });

  // ─── Profile ───

  test("Profile tab shows user info", async ({ page }) => {
    await page.click('button[data-tab="profile"]');
    await expect(page.locator("#tab-profile .profile-name")).toContainText("Marcus Chen");
    await expect(page.locator("text=demo@example.com")).toBeVisible();
  });
});
