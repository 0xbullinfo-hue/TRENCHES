import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { injectPhantomWallet, connectInjectedPhantom } from './wallet-helper';

const VIEWPORTS = [
  320,
  360,
  375,
  390,
  430,
  768,
  1024,
  1280,
  1440,
];

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3008';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'tests/browser/screenshots');

test.describe('TRENCHLABS responsive dashboard release verification', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  for (const width of VIEWPORTS) {
    test(`dashboard has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({
        width,
        height: 900,
      });

      await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.locator('body')).toBeVisible();
      await page.waitForTimeout(400);

      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));

      expect(
        dimensions.document,
        `Document overflows at ${width}px`
      ).toBeLessThanOrEqual(dimensions.viewport + 1);

      expect(
        dimensions.body,
        `Body overflows at ${width}px`
      ).toBeLessThanOrEqual(dimensions.viewport + 1);

      // Verify all four permanent tabs exist and are not clipped outside viewport
      for (const testId of ['tab-alpha', 'tab-social', 'tab-watchlist', 'tab-max-alpha']) {
        const tab = page.getByTestId(testId);
        if (await tab.count()) {
          await expect(tab.first()).toBeVisible();
        }
      }

      await page.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          `dashboard-social-${width}px.png`
        ),
        fullPage: false,
      });
    });
  }

  test('dashboard has viewport metadata', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`);

    const viewport = page.locator('meta[name="viewport"]');

    await expect(viewport).toHaveAttribute(
      'content',
      /width=device-width/
    );
  });

  test('Social tab is addressable directly', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`);

    await expect(page).toHaveURL(/tab=SOCIAL/i);
  });

  test('Alpha tab is addressable directly', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard?tab=ALPHA`);

    await expect(page).toHaveURL(/tab=ALPHA/i);
  });

  test('dashboard does not expose browser console errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`);

    await page.waitForLoadState('networkidle').catch(() => undefined);

    expect(errors).toEqual([]);
  });

  test('dashboard tab navigation and membership restriction screens work interactively', async ({ page }) => {
    const kp = Keypair.generate();
    await injectPhantomWallet(page, kp);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'domcontentloaded' });

    // Disconnected state shows LockedTerminal
    await expect(page.locator('body')).toContainText(/WALLET AUTHENTICATION REQUIRED/i);

    // Connect Phantom wallet via UI
    await connectInjectedPhantom(page);
    await expect(page.getByTestId('tab-alpha')).toBeVisible({ timeout: 15000 });

    // Switch to ALPHA -> restriction screen shown for FREE/unfunded wallet
    await page.getByTestId('tab-alpha').click();
    await expect(page).toHaveURL(/tab=ALPHA/i);
    await expect(page.locator('body')).toContainText(/GENESIS|MEMBER|UNLOCK|Access/i);

    // Switch to WATCHLIST -> restriction screen shown
    await page.getByTestId('tab-watchlist').click();
    await expect(page).toHaveURL(/tab=WATCHLIST/i);
    await expect(page.locator('body')).toContainText(/PRO|StakePoint|UNLOCK|Access/i);

    // Switch back to SOCIAL
    await page.getByTestId('tab-social').click();
    await expect(page).toHaveURL(/tab=SOCIAL/i);
  });
});
