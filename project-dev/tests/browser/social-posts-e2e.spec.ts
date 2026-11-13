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
  test('complete Social Posts feed, session auth, challenge issuance, exact signing, submission, reload, and replay/security rejections', async ({
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
    expect(activeCamp).toBeTruthy();

    // Verify campaign card renders in browser UI
    await expect(page.locator('body')).toContainText(activeCamp.title, { timeout: 15000 });

    // 3. Authenticate Wallet A via /api/auth/session with real Ed25519 signature
    const ts = Date.now();
    const authMsg = `TrenchLabs Access|POST|/api/auth/session|${ts}`;
    const authSig = signEd25519Hex(walletA, authMsg);
    const sessionRes = await page.request.post(`${BASE_URL}/api/auth/session`, {
      data: {
        wallet: walletAddrA,
        signature: authSig,
        timestamp: ts,
      },
    });
    expect(sessionRes.status()).toBe(200);
    const sessionData = await sessionRes.json();
    expect(sessionData.ok).toBe(true);

    const checkSessionRes = await page.request.get(`${BASE_URL}/api/auth/session`);
    expect(checkSessionRes.status()).toBe(200);
    const checkSessionData = await checkSessionRes.json();
    expect(checkSessionData.authenticated).toBe(true);
    expect(checkSessionData.wallet).toBe(walletAddrA);

    // 4. Request server-issued challenge for Wallet A
    const challengeRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/challenge`,
      {
        data: { walletAddress: walletAddrA },
      }
    );
    expect(challengeRes.status()).toBe(201);
    const challengeData = await challengeRes.json();
    expect(challengeData.ok).toBe(true);
    expect(typeof challengeData.challengeId).toBe('string');
    expect(typeof challengeData.message).toBe('string');
    expect(challengeData.campaignId).toBe(activeCamp.id);
    expect(challengeData.walletAddress).toBe(walletAddrA);

    // 5. Invalid signature must be rejected before valid submission consumes challenge
    const badSubmitRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@e2e_${ts}`,
          xRetweetLink: `https://x.com/e2e_${ts}/status/${ts}01`,
          challengeId: challengeData.challengeId,
          signature: Buffer.from(new Uint8Array(64).fill(9)).toString('base64'),
        },
      }
    );
    expect([401, 403]).toContain(badSubmitRes.status());

    // 6. Sign exact server-issued challenge message & submit
    const challengeSig = signEd25519Base64(walletA, challengeData.message);
    const uniqueTweet = `https://x.com/e2e_${ts}/status/${ts}02`;
    const submitRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@e2e_${ts}`,
          xRetweetLink: uniqueTweet,
          challengeId: challengeData.challengeId,
          signature: challengeSig,
        },
      }
    );
    expect(submitRes.status()).toBe(201);
    const submitData = await submitRes.json();
    expect(submitData.ok).toBe(true);
    expect(submitData.submission?.walletAddress).toBe(walletAddrA);
    expect(submitData.submission?.campaignId).toBe(activeCamp.id);

    // 7. Reload page and verify session persists in browser context
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReloadSession = await page.request.get(`${BASE_URL}/api/auth/session`);
    expect(afterReloadSession.status()).toBe(200);
    const afterReloadData = await afterReloadSession.json();
    expect(afterReloadData.wallet).toBe(walletAddrA);

    // 8. Duplicate / replay submission with consumed challengeId must be rejected
    const replayRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@e2e_${ts}`,
          xRetweetLink: uniqueTweet,
          challengeId: challengeData.challengeId,
          signature: challengeSig,
        },
      }
    );
    expect([400, 409]).toContain(replayRes.status());

    // 9. Expired / unknown challengeId must be rejected
    const expiredRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/submit`,
      {
        data: {
          walletAddress: walletAddrA,
          xHandle: `@e2e_${ts}`,
          xRetweetLink: `https://x.com/e2e_${ts}/status/${ts}03`,
          challengeId: 'rc_nonexistent_expired_123',
          signature: challengeSig,
        },
      }
    );
    expect([400, 404, 410]).toContain(expiredRes.status());

    // 10. Wallet-switch isolation: Wallet A session cannot request challenge for Wallet B
    const mismatchRes = await page.request.post(
      `${BASE_URL}/api/campaigns/${activeCamp.id}/challenge`,
      {
        data: { walletAddress: walletAddrB },
      }
    );
    expect(mismatchRes.status()).toBe(403);
  });
});
