import test from 'node:test';
import assert from 'node:assert/strict';

// Helper for formatting token amount per §5.1:
// divide raw by 10**token_decimals, then format to 2 significant figures with M/K suffix
function formatTokenAmount(rawString, decimals = 9) {
  const tokens = Number(BigInt(rawString)) / Math.pow(10, decimals);
  if (tokens >= 1_000_000) {
    const val = tokens / 1_000_000;
    const formatted = val >= 10 ? val.toFixed(1) : val.toFixed(1);
    return `${Number(formatted)}M $H42`;
  }
  if (tokens >= 1_000) {
    const val = tokens / 1_000;
    return `${Number(val.toFixed(1))}K $H42`;
  }
  return `${Number(tokens.toFixed(1))} $H42`;
}

test('Token amount formatting math per §5.1', () => {
  // Member: 1,219,512 tokens -> 1.2M $H42
  const rawMember = '1219512195121951';
  assert.equal(formatTokenAmount(rawMember, 9), '1.2M $H42');

  // Pro: 15,243,902 tokens -> 15.2M $H42
  const rawPro = '15243902439024390';
  assert.equal(formatTokenAmount(rawPro, 9), '15.2M $H42');

  // Edge cases
  assert.equal(formatTokenAmount('500000000000', 9), '500 $H42');
  assert.equal(formatTokenAmount('25000000000000000', 9), '25M $H42');
});

test('Tier target validation logic per §4', () => {
  function validateTargetTier(userTier, targetTier) {
    if (targetTier !== 'member' && targetTier !== 'pro') {
      return { ok: false, status: 400, error: 'bad_request' };
    }
    if (targetTier === 'pro' && userTier !== 'pro') {
      return { ok: false, status: 403, error: 'not_eligible' };
    }
    if (targetTier === 'member' && userTier !== 'member' && userTier !== 'pro') {
      return { ok: false, status: 403, error: 'not_eligible' };
    }
    return { ok: true, status: 200 };
  }

  // Free user
  assert.equal(validateTargetTier('free', 'member').status, 403);
  assert.equal(validateTargetTier('free', 'pro').status, 403);

  // Member user
  assert.equal(validateTargetTier('member', 'member').status, 200);
  assert.equal(validateTargetTier('member', 'pro').status, 403);

  // Pro user
  assert.equal(validateTargetTier('pro', 'member').status, 200);
  assert.equal(validateTargetTier('pro', 'pro').status, 200);

  // Invalid tier
  assert.equal(validateTargetTier('pro', 'admin').status, 400);
});

test('Verification session reuse and 3/5min rate limiting', () => {
  const sessions = [];
  const now = 1730000000000;

  function createOrReuse(wallet, tier, currentMs) {
    const fiveMinAgo = currentMs - 5 * 60 * 1000;
    const recent = sessions.filter(
      (s) => s.wallet === wallet && s.createdAt > fiveMinAgo
    );
    if (recent.length >= 3) {
      return { error: 'rate_limited', status: 429 };
    }

    const existing = sessions.find(
      (s) =>
        s.wallet === wallet &&
        s.tier === tier &&
        s.usedAt === null &&
        s.expiresAt > currentMs
    );
    if (existing) {
      return { session: existing, reused: true, status: 200 };
    }

    const newSession = {
      sessionId: `vs_${Math.random().toString(36).slice(2, 14)}`,
      wallet,
      tier,
      createdAt: currentMs,
      expiresAt: currentMs + 10 * 60 * 1000,
      usedAt: null,
    };
    sessions.push(newSession);
    return { session: newSession, reused: false, status: 200 };
  }

  const wallet = 'WalletTest111111111111111111111111111111111';

  // 1. Initial creation
  const r1 = createOrReuse(wallet, 'member', now);
  assert.equal(r1.status, 200);
  assert.equal(r1.reused, false);
  const id1 = r1.session.sessionId;

  // 2. Reuse within 10 min
  const r2 = createOrReuse(wallet, 'member', now + 60_000);
  assert.equal(r2.status, 200);
  assert.equal(r2.reused, true);
  assert.equal(r2.session.sessionId, id1);

  // 3. Mark used -> cannot reuse
  r1.session.usedAt = now + 120_000;
  const r3 = createOrReuse(wallet, 'member', now + 130_000);
  assert.equal(r3.status, 200);
  assert.equal(r3.reused, false);
  assert.notEqual(r3.session.sessionId, id1);

  // 4. Third session created
  r3.session.usedAt = now + 140_000;
  const r4 = createOrReuse(wallet, 'member', now + 150_000);
  assert.equal(r4.status, 200);
  assert.equal(r4.reused, false);

  // 5. Fourth session attempt within 5 min -> Rate limit (429)
  const r5 = createOrReuse(wallet, 'member', now + 160_000);
  assert.equal(r5.status, 429);

  // 6. After 5 min window passes -> Allowed again
  const r6 = createOrReuse(wallet, 'member', now + 350_000);
  assert.equal(r6.status, 200);
});

test('Bot /start vs_<session_id> verification flow logic per §8', async () => {
  const sessions = new Map();
  const members = new Map();

  function createSession(sessionId, wallet, tier, expiresAt, usedAt = null) {
    sessions.set(sessionId, { sessionId, wallet, tier, expiresAt, usedAt });
  }

  async function simulateBotStart(sessionId, chatId, mockResolvedTier) {
    const session = sessions.get(sessionId);
    if (!session) {
      return { text: 'This link is invalid. Get a new one from your dashboard at trenchlabs.xyz/dashboard.', status: 'invalid' };
    }
    if (session.usedAt) {
      return { text: 'This link was already used. Get a new one from your dashboard if you still need access.', status: 'already_used' };
    }
    if (session.expiresAt < Date.now()) {
      return { text: 'This link expired. Get a new one from your dashboard.', status: 'expired' };
    }

    if (mockResolvedTier === 'free') {
      session.usedAt = Date.now();
      const short = `${session.wallet.slice(0, 6)}...${session.wallet.slice(-4)}`;
      return { text: `Your wallet ${short} doesn't currently qualify. You need $20 held for Member or $250 staked for Pro.`, status: 'not_qualified' };
    }

    if (session.tier === 'pro' && mockResolvedTier !== 'pro') {
      session.usedAt = Date.now();
      return { text: "You're not currently eligible for Pro (stake may have expired). Check your dashboard for a Member invite instead.", status: 'downgraded' };
    }

    const invite = `https://t.me/+trench_${session.tier}_mock123`;
    session.usedAt = Date.now();
    members.set(session.wallet, { tier: session.tier, inGroup: true, userId: chatId });

    const formatted = session.tier.charAt(0).toUpperCase() + session.tier.slice(1);
    return {
      text: `✅ Verified as ${formatted}.\n\nJoin your group: ${invite}\n\nSingle-use, expires in 60 minutes.`,
      status: 'success',
      invite,
    };
  }

  const now = Date.now();
  const wallet = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';

  // Test 1: Invalid link
  const res1 = await simulateBotStart('non_existent', 12345, 'member');
  assert.equal(res1.status, 'invalid');

  // Test 2: Expired link
  createSession('sess_exp', wallet, 'member', now - 1000);
  const res2 = await simulateBotStart('sess_exp', 12345, 'member');
  assert.equal(res2.status, 'expired');

  // Test 3: Unqualified wallet (free)
  createSession('sess_free', wallet, 'member', now + 600_000);
  const res3 = await simulateBotStart('sess_free', 12345, 'free');
  assert.equal(res3.status, 'not_qualified');
  assert.ok(sessions.get('sess_free').usedAt);

  // Test 4: Already used
  const res4 = await simulateBotStart('sess_free', 12345, 'member');
  assert.equal(res4.status, 'already_used');

  // Test 5: Successful verification
  createSession('sess_ok', wallet, 'pro', now + 600_000);
  const res5 = await simulateBotStart('sess_ok', 99999, 'pro');
  assert.equal(res5.status, 'success');
  assert.ok(res5.text.includes('✅ Verified as Pro'));
  assert.ok(sessions.get('sess_ok').usedAt);
  assert.equal(members.get(wallet).inGroup, true);
});

