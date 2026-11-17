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

const SIDEBAR_TEST_IDS = [
  'tab-overview',
  'tab-alpha',
  'tab-max-alpha',
  'tab-watchlist',
  'tab-social',
  'tab-stake',
];

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

      if (width < 768) {
        await expect(page.getByTestId('mobile-nav-trigger')).toBeVisible();
      } else {
        for (const testId of SIDEBAR_TEST_IDS) {
          await expect(page.getByTestId(testId)).toBeVisible();
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

  test('dashboard sidebar navigation and membership restriction screens work interactively on mobile and desktop', async ({ page }) => {
    const kp = Keypair.generate();
    await injectPhantomWallet(page, kp);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'networkidle' });
    // Allow PhantomWalletAdapter's readyState interval to detect window.phantom
    await page.waitForTimeout(1200);

    // Disconnected state shows LockedTerminal
    await expect(page.locator('body')).toContainText(/WALLET AUTHENTICATION REQUIRED/i);

    // Connect Phantom wallet via UI
    await connectInjectedPhantom(page);

    // Open mobile drawer and switch to ALPHA -> restriction screen shown for FREE/unfunded wallet
    await page.getByTestId('mobile-nav-trigger').click();
    await expect(page.getByTestId('tab-alpha')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('tab-alpha').click();
    await expect(page).toHaveURL(/tab=ALPHA/i);
    await expect(page.locator('body')).toContainText(/GENESIS|MEMBER|UNLOCK|Access/i);

    // Switch to WATCHLIST -> restriction screen shown
    await page.getByTestId('mobile-nav-trigger').click();
    await page.getByTestId('tab-watchlist').click();
    await expect(page).toHaveURL(/tab=WATCHLIST/i);
    await expect(page.locator('body')).toContainText(/PRO|StakePoint|UNLOCK|Access/i);

    // Switch to STAKE -> Staking workspace shown (never silently bounced to Overview)
    await page.getByTestId('mobile-nav-trigger').click();
    await page.getByTestId('tab-stake').click();
    await expect(page).toHaveURL(/tab=STAKE/i);
    await expect(page.getByTestId('stake-workspace')).toBeVisible();

    // Switch to Overview -> Welcome & Account panel shown + browser back returns to Stake
    await page.getByTestId('mobile-nav-trigger').click();
    await page.getByTestId('tab-overview').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('body')).toContainText(/Welcome to the Lab/i);

    await page.goBack();
    await expect(page).toHaveURL(/tab=STAKE/i);

    // Desktop sidebar & collapse toggle
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByTestId('tab-social')).toBeVisible();
    await page.getByTestId('tab-social').click();
    await expect(page).toHaveURL(/tab=SOCIAL/i);
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect(page.getByTestId('sidebar-collapse-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('sidebar-collapse-toggle').click();
    await expect(page.getByTestId('sidebar-collapse-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('all 6 workspaces, overview sections, saved watchlist, and stake view render cleanly on desktop and tablet', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle' });

    // Connect via dev quick-connect Master Admin (Pro) preset if present, otherwise skip preset check
    await page.getByRole('button', { name: 'Connect Solana Wallet' }).click();
    const adminPresetBtn = page.getByRole('button', { name: /Master Admin/i });
    if (!(await adminPresetBtn.count())) {
      test.skip(true, 'Dev presets disabled in current environment');
      return;
    }
    await adminPresetBtn.click();

    // 1. Overview shows all key account sections & ledger embed
    await expect(page.locator('body')).toContainText(/Welcome to the Lab/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/VERIFIED BALANCE/i);
    await expect(page.locator('body')).toContainText(/RESEARCH ACCESS/i);
    await expect(page.locator('body')).toContainText(/PRO STAKING STATUS/i);
    await expect(page.getByTestId('pro-progress-bar')).toBeVisible();
    await expect(page.getByTestId('weekly-performance-digest')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Recent Call Performance Ledger/i);
    await expect(page.locator('body')).toContainText(/GET CALL NOTIFICATIONS/i);
    await expect(page.locator('body')).toContainText(/Staking — \$H42/i);

    // 2. Alpha Calls workspace
    await page.getByTestId('tab-alpha').click();
    await expect(page).toHaveURL(/tab=ALPHA/i);
    await expect(page.locator('body')).toContainText(/Curated Alpha Trade Calls/i);
    await expect(page.locator('body')).toContainText(/Top Performing Alpha Calls/i);

    // 3. Max Alpha workspace
    await page.getByTestId('tab-max-alpha').click();
    await expect(page).toHaveURL(/tab=MAX_ALPHA/i);
    await expect(page.locator('body')).toContainText(/Max Alpha Premium High-Conviction Calls/i);

    // 4. Watchlist workspace (both Saved & Lab Curated Research modes)
    await page.getByTestId('tab-watchlist').click();
    await expect(page).toHaveURL(/tab=WATCHLIST/i);
    await expect(page.getByTestId('watchlist-mode-saved')).toBeVisible();
    await expect(page.getByTestId('watchlist-mode-platform')).toBeVisible();
    await page.getByTestId('watchlist-mode-platform').click();
    await expect(page.locator('body')).toContainText(/Curated Watchlist & Research Projects/i);
    await page.getByTestId('watchlist-mode-saved').click();

    // 5. Raid workspace
    await page.getByTestId('tab-social').click();
    await expect(page).toHaveURL(/tab=SOCIAL/i);
    await expect(page.locator('body')).toContainText(/COMMUNITY REWARD RAIDS/i);

    // 6. Stake workspace
    await page.getByTestId('tab-stake').click();
    await expect(page).toHaveURL(/tab=STAKE/i);
    await expect(page.getByTestId('stake-workspace')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Staking — \$H42/i);

    // Tablet viewport check (768px) keeps sidebar accessible without overflow
    await page.setViewportSize({ width: 768, height: 900 });
    await page.waitForTimeout(300);
    const tabletDims = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(tabletDims.scroll).toBeLessThanOrEqual(tabletDims.client + 1);
  });
});
