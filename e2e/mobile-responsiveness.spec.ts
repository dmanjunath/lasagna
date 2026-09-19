import { test, expect } from '@playwright/test';

test.describe('Mobile Responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    // Set viewport to mobile size first
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Go to login page
    await page.goto('http://localhost:5174');
    
    // Check if already logged in by checking URL
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Login with provided credentials
      await page.fill('input[type="email"]', 'test2@test.com');
      await page.fill('input[type="password"]', 'password123');
      await page.click('button[type="submit"]');
      
      // Wait for navigation to dashboard
      await page.waitForURL('**/', { timeout: 15000 });
    } else {
      // Already logged in, just make sure we're on dashboard
      await page.waitForLoadState('networkidle');
    }
  });

  test('dashboard mobile view', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of full dashboard
    await page.screenshot({ path: 'screenshots/mobile-dashboard.png', fullPage: true });

    // Verify mobile elements are present
    await expect(page.locator('.md:hidden')).toBeVisible();
    
    // Check for mobile tab bar
    await expect(page.locator('nav').filter({ hasText: 'Home' })).toBeVisible();
    
    // Check mobile menu button exists
    await expect(page.locator('button').filter({ hasText: '' }).first()).toBeVisible();
  });

  test('different mobile sizes', async ({ page }) => {
    const viewports = [
      { width: 375, height: 812, name: 'iPhone X' },
      { width: 414, height: 896, name: 'iPhone 11 Pro Max' },
      { width: 360, height: 640, name: 'Android Small' },
      { width: 390, height: 844, name: 'iPhone 12' },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('http://localhost:5174/');
      await page.waitForLoadState('networkidle');
      
      await page.screenshot({ 
        path: `screenshots/mobile-${viewport.width}x${viewport.height}.png`,
        fullPage: true 
      });
      
      // Check that content fits within viewport
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewport.width + 10); // Allow small margin
    }
  });

  test('key pages mobile view', async ({ page }) => {
    const pages = [
      { path: '/', name: 'dashboard' },
      { path: '/accounts', name: 'accounts' },
      { path: '/spending', name: 'spending' },
      { path: '/goals', name: 'goals' },
      { path: '/financial-level', name: 'financial-level' },
    ];

    for (const pageInfo of pages) {
      await page.goto(`http://localhost:5174${pageInfo.path}`);
      await page.waitForLoadState('networkidle');
      
      // Take screenshot
      await page.screenshot({ 
        path: `screenshots/mobile-${pageInfo.name}.png`,
        fullPage: true 
      });
      
      // Check horizontal scrolling issue
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 10);
    }
  });

  test('mobile navigation interactions', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Test mobile menu button
    const menuButton = page.locator('button').filter({ hasText: '' }).first();
    await menuButton.click();
    
    // Wait for mobile menu to open
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/mobile-menu-open.png' });
    
    // Test navigation to spending
    await page.click('text=Spending');
    await page.waitForURL('**/spending');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/mobile-spending.png' });
    
    // Test tab bar navigation
    await page.click('text=Home');
    await page.waitForURL('**/');
    await page.waitForLoadState('networkidle');
  });

  test('mobile chat functionality', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    
    // Open chat via tab bar
    await page.click('text=Chat');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/mobile-chat-open.png' });
    
    // Verify chat interface is mobile-friendly
    await expect(page.locator('text=Chat')).toBeVisible();
    
    // Close chat
    await page.click('button[aria-label="Close chat"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/mobile-chat-closed.png' });
  });
});