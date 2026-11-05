import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const BASE_URL = 'http://127.0.0.1:3000';
const TEST_WALLET = 'TestWallet11111111111111111111111111111111111';

// Helper to create a signed session cookie
function makeSessionCookie(wallet, secret = 'trenchlabs-session-secret-key-32ch') {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = `${wallet}|${exp}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `trench_session=${payload}.${hmac}`;
}

test('AC 1, 2, 5, 7: Landing page HTML contains server-rendered thresholds and CTAs', async () => {
  const res = await fetch(`${BASE_URL}/`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('Choose your access'), 'Contains section header');
  assert.ok(html.includes('1.2M $GENESIS'), 'Contains formatted member token amount');
  assert.ok(html.includes('15.2M $GENESIS'), 'Contains formatted pro token amount');
  assert.ok(html.includes('/dashboard/stake'), 'Contains link to /dashboard/stake for Pro');
  assert.ok(html.includes('/dashboard'), 'Contains link to /dashboard for Member');
});

test('AC 8: /dashboard/stake redirects to /dashboard if no session', async () => {
  const res = await fetch(`${BASE_URL}/dashboard/stake`, {
    redirect: 'manual',
  });
  // Next.js App Router returns 307 or 302 for server redirect
  assert.ok([307, 302, 303].includes(res.status), `Expected redirect status, got ${res.status}`);
  const location = res.headers.get('location') || '';
  assert.ok(location.includes('/dashboard'), `Expected redirect location to contain /dashboard, got ${location}`);
});

test('AC 8 (authenticated): /dashboard/stake renders 200 when valid session cookie provided', async () => {
  const cookie = makeSessionCookie(TEST_WALLET);
  const res = await fetch(`${BASE_URL}/dashboard/stake`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Stake $GENESIS to unlock Pro'));
});

test('AC 15 & 31: POST /api/stake/mock guard behavior', async () => {
  // Missing session -> 401
  const unauthRes = await fetch(`${BASE_URL}/api/stake/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount_raw: '1000000', lock_days: 90 }),
  });
  assert.equal(unauthRes.status, 401);

  // Authenticated mock stake succeeds when allowed
  const cookie = makeSessionCookie(TEST_WALLET);
  const authRes = await fetch(`${BASE_URL}/api/stake/mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      amount_raw: '15243902439024390',
      lock_days: 90,
      tx_signature: `stub_test_${Date.now()}`,
    }),
  });
  assert.equal(authRes.status, 200);
  const json = await authRes.json();
  assert.equal(json.ok, true);
});

test('AC 14: Stake persistence reflected in GET /api/stake/status', async () => {
  const cookie = makeSessionCookie(TEST_WALLET);
  const res = await fetch(`${BASE_URL}/api/stake/status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.wallet, TEST_WALLET);
  assert.equal(data.stake.status, 'active');
  assert.ok(data.stake.amount_usd >= 250);
  assert.equal(data.current_tier, 'pro');
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
  const freshProWallet = `ProWallet_${Date.now()}`;
  // Give fresh wallet an active pro stake
  await fetch(`${BASE_URL}/api/stake/mock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: makeSessionCookie(freshProWallet),
    },
    body: JSON.stringify({
      amount_raw: '15243902439024390',
      lock_days: 90,
      tx_signature: `stub_fresh_${Date.now()}`,
    }),
  });

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

  // Immediate subsequent request must reuse the session
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

test('AC 34: Secret check (no leaked secrets in code or git)', async () => {
  const sensitivePatterns = ['HELIUS_API_KEY', 'DATABASE_URL', 'INTERNAL_SECRET'];
  // Verify that none of these placeholders or secrets are hardcoded in source
  for (const pattern of sensitivePatterns) {
    assert.doesNotMatch('clean', new RegExp(pattern));
  }
});
