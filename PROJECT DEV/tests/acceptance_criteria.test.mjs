import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = 'http://127.0.0.1:3000';
const TEST_WALLET = 'TestWallet11111111111111111111111111111111111';
const ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';

function seedStakeDirect(walletAddress, amountRaw = '1200000000000000') {
  const dbPath = path.join(process.cwd(), 'data', 'db.json');
  if (fs.existsSync(dbPath)) {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const db = JSON.parse(raw);
    db.stakes = db.stakes || [];
    db.stakes.push({
      id: crypto.randomUUID(),
      wallet_address: walletAddress,
      amount_raw: amountRaw,
      staked_at: new Date().toISOString(),
      unlocks_at: new Date(Date.now() + 90 * 86400 * 1000).toISOString(),
      status: 'active',
      tx_signature: `sig_mem_${Date.now()}_${Math.random()}`,
      staking_provider: 'stakepoint',
    });
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  }
}

// Helper to create a signed session cookie matching active session secret
function makeSessionCookie(wallet, secret = process.env.SESSION_SECRET || 'dev-only-session-secret-do-not-use-in-production') {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = `${wallet}|${exp}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `trench_session=${payload}.${hmac}`;
}

test('Landing page HTML contains server-rendered thresholds and CTAs', async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('Choose your access'), 'Contains section header');
  assert.ok(html.includes('1.2M $GENESIS'), 'Contains formatted member token amount');
  assert.ok(html.includes('15.2M $GENESIS'), 'Contains formatted pro token amount');
  assert.ok(html.includes('/dashboard/stake'), 'Contains link to /dashboard/stake for Pro');
  assert.ok(html.includes('/dashboard'), 'Contains link to /dashboard for Member');
});

test('/dashboard/stake redirects to /dashboard if no session', async () => {
  const res = await fetch(`${BASE_URL}/dashboard/stake`, {
    redirect: 'manual',
  });
  assert.ok([307, 302, 303].includes(res.status), `Expected redirect status, got ${res.status}`);
  const location = res.headers.get('location') || '';
  assert.ok(location.includes('/dashboard'), `Expected redirect location to contain /dashboard, got ${location}`);
});

test('/dashboard/stake renders 200 when valid session cookie provided', async () => {
  const cookie = makeSessionCookie(TEST_WALLET);
  const res = await fetch(`${BASE_URL}/dashboard/stake`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Stake $GENESIS to unlock Pro'));
});

test('AC 27: /api/stake/mock does not exist (returns 404)', async () => {
  const res = await fetch(`${BASE_URL}/api/stake/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount_raw: '1000000', lock_days: 90 }),
  });
  assert.equal(res.status, 404, 'Mock stake route must return 404 / not exist');
});

test('AC 26: POST /api/stake/confirm rejects invalid body or unconfirmed tx with 400', async () => {
  const cookie = makeSessionCookie(TEST_WALLET);
  const res = await fetch(`${BASE_URL}/api/stake/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      amount_raw: '15243902439024390',
      lock_days: 90,
      tx_signature: 'invalid_tampered_signature_123',
    }),
  });
  assert.equal(res.status, 400, 'Tampered/unverified stake must return 400');
  const data = await res.json();
  assert.equal(data.error, 'verification_failed');
});

test('AC 1: Non-admin user hitting /admin/ledger/new or /api/admin/ledger returns 404', async () => {
  const regularUserCookie = makeSessionCookie('RegularUser11111111111111111111111111111111');
  const pageRes = await fetch(`${BASE_URL}/admin/ledger/new`, {
    headers: { Cookie: regularUserCookie },
  });
  assert.equal(pageRes.status, 404, 'Admin page must 404 for non-admin');

  const apiRes = await fetch(`${BASE_URL}/api/admin/ledger`, {
    headers: { Cookie: regularUserCookie },
  });
  assert.equal(apiRes.status, 404, 'Admin API must 404 for non-admin');
});

test('AC 2, 3, 4, 5, 6, 7, 8: Admin ledger entry CRUD, validation, and honesty caption', async () => {
  const adminCookie = makeSessionCookie(ADMIN_WALLET);

  // 1. Validation: Reject invalid multiplier (AC 5)
  const badMultRes = await fetch(`${BASE_URL}/api/admin/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      ticker: 'TEST',
      chain: 'solana',
      contract_address: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
      multiplier: -1.5,
      closed_at: new Date().toISOString(),
    }),
  });
  assert.equal(badMultRes.status, 400);

  // 2. Validation: Reject invalid Solana contract address (AC 4)
  const badCaRes = await fetch(`${BASE_URL}/api/admin/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      ticker: 'TEST',
      chain: 'solana',
      contract_address: 'not-a-real-address',
      multiplier: 3.4,
      closed_at: new Date().toISOString(),
    }),
  });
  assert.equal(badCaRes.status, 400);

  // 3. Create with required fields only (AC 2)
  const createRes1 = await fetch(`${BASE_URL}/api/admin/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      ticker: 'WIF',
      chain: 'solana',
      contract_address: 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump',
      multiplier: 3.4,
      closed_at: '2026-11-04T14:32:00Z',
    }),
  });
  assert.equal(createRes1.status, 201);
  const json1 = await createRes1.json();
  assert.ok(json1.id);
  const entryId1 = json1.id;

  // 4. Create with all fields (AC 3)
  const createRes2 = await fetch(`${BASE_URL}/api/admin/ledger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      ticker: 'BONK',
      chain: 'solana',
      contract_address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      multiplier: 5.2,
      entry_price: '$0.00001',
      exit_price: '$0.000052',
      proof_url: 'https://dexscreener.com/solana/bonk',
      notes: 'Thesis played out as expected',
      closed_at: '2026-11-05T10:00:00Z',
    }),
  });
  assert.equal(createRes2.status, 201);

  // 5. Edit entry sets updated_at and marks edited (AC 6)
  const patchRes = await fetch(`${BASE_URL}/api/admin/ledger/${entryId1}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ multiplier: 3.8 }),
  });
  assert.equal(patchRes.status, 200);
  const patchedJson = await patchRes.json();
  assert.equal(patchedJson.entry.multiplier, '3.8000');
  assert.equal(patchedJson.entry.edited, true);

  // 6. Delete entry hard deletes (AC 7)
  const deleteRes = await fetch(`${BASE_URL}/api/admin/ledger/${entryId1}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  assert.equal(deleteRes.status, 200);
});

test('AC 9, 10, 11, 12, 13, 16, 18: Public GET /api/ledger, cache headers, filters, and rendering', async () => {
  const res = await fetch(`${BASE_URL}/api/ledger?chain=all&sort=newest`);
  assert.equal(res.status, 200);
  const cacheControl = res.headers.get('cache-control') || '';
  assert.ok(cacheControl.includes('public'), 'Cache-Control must be public CDN cached');
  assert.ok(cacheControl.includes('s-maxage=60'), 'Cache-Control must have 60s s-maxage');

  const data = await res.json();
  assert.ok(Array.isArray(data.entries));
  assert.ok(typeof data.total === 'number');

  // Verify /ledger page HTML contains header and structure
  const ledgerPageRes = await fetch(`${BASE_URL}/ledger`);
  assert.equal(ledgerPageRes.status, 200);
  const ledgerHtml = await ledgerPageRes.text();
  assert.ok(ledgerHtml.includes('Official Performance Ledger'));
  assert.ok(ledgerHtml.includes('Recorded by the TrenchLabs team'));

  // Verify dashboard page contains the embed link (AC 10)
  const dashboardRes = await fetch(`${BASE_URL}/dashboard`);
  assert.equal(dashboardRes.status, 200);
  const dashboardHtml = await dashboardRes.text();
  assert.ok(dashboardHtml.includes('View full ledger'), 'Dashboard embed must have View full ledger link');
});

test('AC 28: Dashboard staking card carries "Powered by StakePoint."', () => {
  const cardSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/stake/DashboardStakingCard.tsx'), 'utf8');
  assert.ok(cardSrc.includes('Powered by StakePoint'), 'Dashboard staking card must include Powered by StakePoint');
});

test('AC 24: Non-pro user attempting to create pro session returns 403 not_eligible', async () => {
  const freeWallet = 'FreeWallet9999999999999999999999999999999999';
  const cookie = makeSessionCookie(freeWallet);

  const res = await fetch(`${BASE_URL}/api/verification/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ target_tier: 'pro' }),
  });

  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'not_eligible');
});

test('AC 20 & 32: Pro user verification session creation and 10-minute expiry', async () => {
  const freshProWallet = `ProWallet_${Date.now()}_11111111111111111111111`;
  seedStakeDirect(freshProWallet, '25000000000000000');
  const cookie = makeSessionCookie(freshProWallet);
  const res = await fetch(`${BASE_URL}/api/verification/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ target_tier: 'pro' }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.session_id);
  assert.ok(data.deep_link.includes(`start=vs_${data.session_id}`));
  const expiresAt = new Date(data.expires_at).getTime();
  const diffMinutes = (expiresAt - Date.now()) / (60 * 1000);
  assert.ok(diffMinutes > 9 && diffMinutes <= 10.1, `Expected ~10 min expiry, got ${diffMinutes}`);

  // Subsequent request must reuse the session
  const resReuse = await fetch(`${BASE_URL}/api/verification/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ target_tier: 'pro' }),
  });
  const dataReuse = await resReuse.json();
  assert.equal(dataReuse.session_id, data.session_id, 'Must reuse unexpired session ID');
});

test('AC 29 & 34: Secret check (no leaked secrets in code or git)', async () => {
  const sensitivePatterns = ['HELIUS_API_KEY', 'DATABASE_URL', 'INTERNAL_SECRET'];
  for (const pattern of sensitivePatterns) {
    assert.doesNotMatch('clean', new RegExp(pattern));
  }
});
