import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { injectPhantomWallet, connectInjectedPhantom } from './wallet-helper';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3008';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function signEd25519Hex(kp: Keypair, message: string): string {
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(null, Buffer.from(message, 'utf-8'), privKey).toString('hex');
}

function signEd25519Base64(kp: Keypair, message: string): string {
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(null, Buffer.from(message, 'utf-8'), privKey).toString('base64');
}

test.describe('TRENCHLABS Social Posts Authenticated Browser E2E', () => {
  test('complete Social Posts UI-driven session auth, form submission, reload persistence, and replay rejection', async ({
    page,
  }) => {
    const walletA = Keypair.generate();
    const walletB = Keypair.generate();
    const walletAddrA = walletA.publicKey.toBase58();
    const walletAddrB = walletB.publicKey.toBase58();

    await injectPhantomWallet(page, walletA);

    // 1. Open Social Posts feed in real Chrome and connect Wallet A via UI
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/tab=SOCIAL/i);
    await connectInjectedPhantom(page);
    await expect(page.getByTestId('tab-social')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('tab-social').click();

    // 2. Fetch active campaigns from live server
    const campaignsRes = await page.request.get(`${BASE_URL}/api/campaigns`);
    expect(campaignsRes.status()).toBe(200);
    const campaignsData = await campaignsRes.json();
    expect(campaignsData.ok).toBe(true);
    expect(Array.isArray(campaignsData.campaigns)).toBe(true);

    const activeCamp = campaignsData.campaigns.find((c: { status: string }) => c.status === 'ACTIVE');
    if (!activeCamp) {
      test.skip(true, 'No active campaign available on local server for submission test');
      return;
    }

    // Verify campaign card renders in browser UI
    await expect(page.locator('body')).toContainText(activeCamp.title, { timeout: 15000 });

    const ts = Date.now();

    // ---- §3.3 EXACT CODE — UI-driven submission ----

    // Authenticate through the actual CampaignCard UI.
    // The injected wallet is a test double, not a real Phantom extension.

    const authenticateButton = page.getByRole('button', {
      name: 'Authenticate',
      exact: true,
    });

    await expect(authenticateButton).toBeVisible();
    await authenticateButton.click();

    await expect(page.locator('body')).toContainText(
      'Wallet Authenticated & Ready',
      { timeout: 15000 }
    );

    // Fill the actual campaign submission form.
    await page.locator(`#wallet-${activeCamp.id}`).fill(walletAddrA);

    await page.locator(`#xhandle-${activeCamp.id}`).fill(
      `@e2e_${ts}`
    );

    const uniqueTweet =
      `https://x.com/e2e_${ts}/status/${ts}01`;

    await page.locator(`#retweet-${activeCamp.id}`).fill(
      uniqueTweet
    );

    // Capture the real UI-generated submission request.
    // Do not replace the UI click with page.request.post().
    let uiSubmissionBody: Record<string, unknown> | null = null;
    let uiSubmissionStatus: number | null = null;

    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes(
          `/api/campaigns/${activeCamp.id}/submit`
        )
      ) {
        try {
          uiSubmissionBody = request.postDataJSON();
        } catch {
          uiSubmissionBody = null;
        }
      }
    });

    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.url().includes(
          `/api/campaigns/${activeCamp.id}/submit`
        )
      ) {
        uiSubmissionStatus = response.status();
      }
    });

    const submitButton = page.getByRole('button', {
      name: 'Claim Raid Airdrop',
      exact: true,
    });

    await expect(submitButton).toBeEnabled();

    await submitButton.click();

    await expect(page.locator('body')).toContainText(
      'Raid proof submitted! Awaiting admin airdrop verification.',
      { timeout: 30000 }
    );

    expect(uiSubmissionStatus).toBe(201);
    expect(uiSubmissionBody).toBeTruthy();

    expect(uiSubmissionBody).toMatchObject({
      walletAddress: walletAddrA,
      xHandle: `@e2e_${ts}`,
      xRetweetLink: uniqueTweet,
    });

    expect(typeof (uiSubmissionBody as unknown as Record<string, unknown>)?.challengeId).toBe('string');
    expect(typeof (uiSubmissionBody as unknown as Record<string, unknown>)?.signature).toBe('string');

    // Verify the successful submission survives a page reload.
    await page.reload({
      waitUntil: 'domcontentloaded',
    });

    await expect(page.locator('body')).toContainText(
      'Raid Proof Submitted',
      { timeout: 15000 }
    );

    // Replay the exact request generated by the real UI.
    // This API request is intentionally used only for the replay test.
    const replayRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: uiSubmissionBody,
      }
    );

    expect([400, 409]).toContain(replayRes.status());

    // ---- End §3.3 EXACT CODE ----

    // Additional API-driven security tests

    // Expired / unknown challengeId must be rejected
    const expiredRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@e2e_${ts}`,
          xRetweetLink: `https://x.com/e2e_${ts}/status/${ts}03`,
          challengeId: 'rc_nonexistent_expired_123',
          signature: signEd25519Base64(walletA, 'fake-challenge'),
        },
      }
    );
    expect([400, 404, 410]).toContain(expiredRes.status());

    // Wallet-switch isolation: Wallet A session cannot request challenge for Wallet B
    const mismatchRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/challenge`,
      {
        data: { walletAddress: walletAddrB },
      }
    );
    expect(mismatchRes.status()).toBe(403);
  });

  // §3.5 Negative UI tests

  test('missing X handle prevents submission', async ({ page }) => {
    const walletA = Keypair.generate();
    const walletAddrA = walletA.publicKey.toBase58();
    await injectPhantomWallet(page, walletA);
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'domcontentloaded' });
    await connectInjectedPhantom(page);

    const campaignsRes = await page.request.get(`${BASE_URL}/api/campaigns`);
    const campaignsData = await campaignsRes.json();
    const activeCamp = campaignsData.campaigns?.find((c: { status: string }) => c.status === 'ACTIVE');
    if (!activeCamp) {
      test.skip(true, 'No active campaign');
      return;
    }

    await expect(page.locator('body')).toContainText(activeCamp.title, { timeout: 15000 });

    // Authenticate first
    const authBtn = page.getByRole('button', { name: 'Authenticate', exact: true });
    if (await authBtn.isVisible().catch(() => false)) {
      await authBtn.click();
      await expect(page.locator('body')).toContainText('Wallet Authenticated & Ready', { timeout: 15000 });
    }

    // Fill wallet and retweet but leave X handle empty
    const ts = Date.now();
    await page.locator(`#wallet-${activeCamp.id}`).fill(walletAddrA);
    await page.locator(`#retweet-${activeCamp.id}`).fill(`https://x.com/e2e/status/${ts}`);
    // Do NOT fill xhandle

    const submitBtn = page.getByRole('button', { name: 'Claim Raid Airdrop', exact: true });
    // Submit button should be disabled or clicking it should show an error
    const isDisabled = await submitBtn.isDisabled().catch(() => true);
    if (!isDisabled) {
      await submitBtn.click();
      // Should show validation error, not success
      await page.waitForTimeout(3000);
      const hasSuccess = await page.locator('body').textContent();
      expect(hasSuccess).not.toContain('Raid proof submitted! Awaiting admin airdrop verification.');
    }
  });

  test('missing retweet URL prevents submission', async ({ page }) => {
    const walletA = Keypair.generate();
    const walletAddrA = walletA.publicKey.toBase58();
    await injectPhantomWallet(page, walletA);
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'domcontentloaded' });
    await connectInjectedPhantom(page);

    const campaignsRes = await page.request.get(`${BASE_URL}/api/campaigns`);
    const campaignsData = await campaignsRes.json();
    const activeCamp = campaignsData.campaigns?.find((c: { status: string }) => c.status === 'ACTIVE');
    if (!activeCamp) {
      test.skip(true, 'No active campaign');
      return;
    }

    await expect(page.locator('body')).toContainText(activeCamp.title, { timeout: 15000 });

    const authBtn = page.getByRole('button', { name: 'Authenticate', exact: true });
    if (await authBtn.isVisible().catch(() => false)) {
      await authBtn.click();
      await expect(page.locator('body')).toContainText('Wallet Authenticated & Ready', { timeout: 15000 });
    }

    const ts = Date.now();
    await page.locator(`#wallet-${activeCamp.id}`).fill(walletAddrA);
    await page.locator(`#xhandle-${activeCamp.id}`).fill(`@e2e_${ts}`);
    // Do NOT fill retweet URL

    const submitBtn = page.getByRole('button', { name: 'Claim Raid Airdrop', exact: true });
    const isDisabled = await submitBtn.isDisabled().catch(() => true);
    if (!isDisabled) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
      const hasSuccess = await page.locator('body').textContent();
      expect(hasSuccess).not.toContain('Raid proof submitted! Awaiting admin airdrop verification.');
    }
  });

  test('invalid X retweet URL is rejected', async ({ page }) => {
    const walletA = Keypair.generate();
    const walletAddrA = walletA.publicKey.toBase58();
    await injectPhantomWallet(page, walletA);
    await page.goto(`${BASE_URL}/dashboard?tab=SOCIAL`, { waitUntil: 'domcontentloaded' });
    await connectInjectedPhantom(page);

    const campaignsRes = await page.request.get(`${BASE_URL}/api/campaigns`);
    const campaignsData = await campaignsRes.json();
    const activeCamp = campaignsData.campaigns?.find((c: { status: string }) => c.status === 'ACTIVE');
    if (!activeCamp) {
      test.skip(true, 'No active campaign');
      return;
    }

    await expect(page.locator('body')).toContainText(activeCamp.title, { timeout: 15000 });

    const authBtn = page.getByRole('button', { name: 'Authenticate', exact: true });
    if (await authBtn.isVisible().catch(() => false)) {
      await authBtn.click();
      await expect(page.locator('body')).toContainText('Wallet Authenticated & Ready', { timeout: 15000 });
    }

    const ts = Date.now();
    await page.locator(`#wallet-${activeCamp.id}`).fill(walletAddrA);
    await page.locator(`#xhandle-${activeCamp.id}`).fill(`@e2e_${ts}`);
    await page.locator(`#retweet-${activeCamp.id}`).fill('not-a-valid-url');

    const submitBtn = page.getByRole('button', { name: 'Claim Raid Airdrop', exact: true });
    const isDisabled = await submitBtn.isDisabled().catch(() => true);
    if (!isDisabled) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
      const bodyText = await page.locator('body').textContent();
      expect(bodyText).not.toContain('Raid proof submitted! Awaiting admin airdrop verification.');
    }
  });

  test('duplicate/replayed challenge submission is rejected via API', async ({ page }) => {
    const walletA = Keypair.generate();
    const walletAddrA = walletA.publicKey.toBase58();

    // Authenticate via API to get a valid session
    const ts = Date.now();
    const authMsg = `TrenchLabs Access|POST|/api/auth/session|${ts}`;
    const authSig = signEd25519Hex(walletA, authMsg);
    const sessionRes = await page.request.post(`${BASE_URL}/api/auth/session`, {
      data: { wallet: walletAddrA, signature: authSig, timestamp: ts },
    });
    expect(sessionRes.status()).toBe(200);

    // Get a challenge
    const campaignsRes = await page.request.get(`${BASE_URL}/api/campaigns`);
    const campaignsData = await campaignsRes.json();
    const activeCamp = campaignsData.campaigns?.find((c: { status: string }) => c.status === 'ACTIVE');
    if (!activeCamp) {
      test.skip(true, 'No active campaign');
      return;
    }

    const challengeRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/challenge`,
      { data: { walletAddress: walletAddrA } }
    );
    expect(challengeRes.status()).toBe(201);
    const challengeData = await challengeRes.json();

    // Sign and submit
    const challengeSig = signEd25519Base64(walletA, challengeData.message);
    const submitRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@replay_${ts}`,
          xRetweetLink: `https://x.com/replay_${ts}/status/${ts}01`,
          challengeId: challengeData.challengeId,
          signature: challengeSig,
        },
      }
    );
    // First submission should succeed (201) or be a duplicate (400/409)
    expect([201, 400, 409]).toContain(submitRes.status());

    // Replay exact same request — must be rejected
    const replayRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@replay_${ts}`,
          xRetweetLink: `https://x.com/replay_${ts}/status/${ts}01`,
          challengeId: challengeData.challengeId,
          signature: challengeSig,
        },
      }
    );
    expect([400, 409]).toContain(replayRes.status());
  });
});
