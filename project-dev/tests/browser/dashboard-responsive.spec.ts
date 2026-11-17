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

    // Watchlist workspace removed; Admin item hidden for non-admin; Max Alpha shows restriction
    await page.getByTestId('mobile-nav-trigger').click();
    await expect(page.getByTestId('tab-watchlist')).toHaveCount(0);
    await expect(page.getByTestId('tab-admin')).toHaveCount(0);
    await page.getByTestId('tab-max-alpha').click();
    await expect(page).toHaveURL(/tab=MAX_ALPHA/i);
    await expect(page.locator('body')).toContainText(/PRO|StakePoint|UNLOCK|Access/i);

    // Direct navigation to ?tab=ADMIN fails closed both before and after non-admin wallet connect
    await page.goto(`${BASE_URL}/dashboard?tab=ADMIN`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await connectInjectedPhantom(page);
    await expect(page.getByTestId('admin-unauthorized-panel')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('mobile-nav-trigger').click();
    await page.getByTestId('tab-overview').click();
    await expect(page).toHaveURL(/\/dashboard$/);

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

  test('all 6 workspaces, admin isolation, independent filters, unified My Pinned Posts, and stake view work cleanly on desktop and tablet', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'trenchlabs_social_initiation_v1',
        JSON.stringify({ completed: true, sharedAt: new Date().toISOString() })
      );
    });
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

    // 1. Overview shows compact account summary, My Pinned Posts, User Call History & collapsed Secondary Tools — NO Ledger embed or Admin Desk
    await expect(page.locator('body')).toContainText(/Welcome to the Lab/i, { timeout: 15000 });
    await expect(page.locator('body')).toContainText(/Verified Holdings/i);
    await expect(page.locator('body')).toContainText(/Research Access/i);
    await expect(page.locator('body')).toContainText(/Pro Staking/i);
    await expect(page.getByTestId('my-pinned-posts')).toBeVisible();
    await expect(page.getByTestId('user-call-history')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Recent Call Performance Ledger/i);
    await expect(page.locator('body')).not.toContainText(/View full ledger/i);
    await expect(page.locator('body')).not.toContainText(/MASTER ADMIN DESK/i);
    await expect(page.locator('body')).not.toContainText(/Staking — \$H42/i);

    // Secondary tools collapsed by default and expand cleanly
    await expect(page.getByTestId('overview-secondary-content')).toHaveCount(0);
    await page.getByTestId('toggle-secondary-tools').click();
    await expect(page.getByTestId('overview-secondary-content')).toBeVisible();
    await expect(page.getByTestId('pro-progress-bar')).toBeVisible();
    await expect(page.getByTestId('weekly-performance-digest')).toBeVisible();
    await expect(page.locator('body')).toContainText(/GET CALL NOTIFICATIONS/i);
    await page.getByTestId('toggle-secondary-tools').click();

    // 2. Alpha Calls workspace + apply workspace-local filters (chain=SOL, search=NONEXISTENT, view=TABLE)
    await page.getByTestId('tab-alpha').click();
    await expect(page).toHaveURL(/tab=ALPHA/i);
    await expect(page.getByTestId('filter-bar-alpha')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Alpha Calls/i);
    await expect(page.locator('body')).not.toContainText(/MASTER ADMIN DESK/i);

    await page.getByTestId('chain-alpha-sol').click();
    await page.getByTestId('view-table-alpha').click();
    await page.getByTestId('search-input-alpha').fill('ALPHA_ONLY_QUERY');

    // 3. Max Alpha workspace maintains completely independent filter state
    await page.getByTestId('tab-max-alpha').click();
    await expect(page).toHaveURL(/tab=MAX_ALPHA/i);
    await expect(page.getByTestId('filter-bar-max_alpha')).toBeVisible();
    await expect(page.getByTestId('search-input-max_alpha')).toHaveValue('');
    await expect(page.getByTestId('view-grid-max_alpha')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body')).not.toContainText(/MASTER ADMIN DESK/i);

    // Return to Alpha -> verify Alpha's own filter state was preserved without interference
    await page.getByTestId('tab-alpha').click();
    await expect(page.getByTestId('search-input-alpha')).toHaveValue('ALPHA_ONLY_QUERY');
    await expect(page.getByTestId('view-table-alpha')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('reset-filters-alpha').click();

    // 4. Legacy ?tab=WATCHLIST resolves gracefully to Overview & My Pinned Posts
    await page.goto(`${BASE_URL}/dashboard?tab=WATCHLIST`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('my-pinned-posts')).toBeVisible();

    // 5. Raid workspace + pinning a Raid card into unified My Pinned Posts
    await page.getByTestId('tab-social').click();
    await expect(page).toHaveURL(/tab=SOCIAL/i);
    await expect(page.locator('body')).toContainText(/COMMUNITY REWARD RAIDS/i);
    await expect(page.locator('body')).not.toContainText(/MASTER ADMIN DESK/i);

    const favRaidBtn = page.locator('[data-testid^="favorite-raid-"]').first();
    if ((await favRaidBtn.count()) > 0 && (await favRaidBtn.isVisible())) {
      const cardLocked = await page.getByTestId('locked-social-card-gate').count();
      if (cardLocked === 0) {
        await favRaidBtn.click();
        await page.getByTestId('tab-overview').click();
        await expect(page.getByTestId('my-pinned-posts')).toContainText(/RAID/i);
      }
    }

    // 6. Stake workspace (exclusive home for DashboardStakingCard + StakeClientView)
    await page.getByTestId('tab-stake').click();
    await expect(page).toHaveURL(/tab=STAKE/i);
    await expect(page.getByTestId('stake-workspace')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Staking — \$H42/i);

    // 7. Dedicated Admin workspace
    await page.getByTestId('tab-admin').click();
    await expect(page).toHaveURL(/tab=ADMIN/i);
    await expect(page.getByTestId('admin-workspace')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Publishing Overview/i);
    await page.getByTestId('admin-create-call-btn').click();
    await expect(page.getByTestId('dest-select-alpha')).toBeVisible();
    await expect(page.getByTestId('dest-select-max-alpha')).toBeVisible();
    await expect(page.locator('body')).toContainText(/Live Card Preview/i);
    await page.getByTestId('admin-subtab-campaigns').click();
    await expect(page.locator('body')).toContainText(/X RAID CAMPAIGNS & AIRDROP REWARD DESK/i);
    await expect(page.locator('body')).toContainText(/\+ Post New Raid Campaign/i);

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
