// Oracle-outage behaviour. Runs in its own process (node --test isolates files), so price.ts module
// state starts empty and every network call fails: this exercises the REAL fail-closed paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const realFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('simulated network outage');
};

const { getGenesisPrice } = await import('../../src/server/price.ts');
const { resolveWalletEntitlement } = await import('../../src/server/entitlements.ts');
const { GET: tiersGet } = await import('../../src/app/api/tiers/current/route.ts');
const { GET: dispatchGet, POST: dispatchPost } = await import('../../src/app/api/telegram/dispatch-delayed/route.ts');

test('Oracle outage: getGenesisPrice reports null/unavailable instead of a hardcoded price', async () => {
  const first = await getGenesisPrice();
  assert.equal(first.priceUsd, null);
  assert.equal(first.source, 'unavailable');
  assert.equal(first.isFresh, false);
  // cooldown path must be equally honest
  const second = await getGenesisPrice();
  assert.equal(second.priceUsd, null);
  assert.equal(second.source, 'unavailable');
});

test('Oracle outage: non-admin wallet resolves to unknown (no wrong demotion, no wrong promotion)', async () => {
  const wallet = 'MemberWallet11111111111111111111111111111111';
  const ent = await resolveWalletEntitlement(wallet, { mockHoldingTokens: 99_000_000, mockStakedTokens: 99_000_000 });
  assert.equal(ent.tier, 'unknown');
  assert.equal(ent.price.usd, null);
  assert.equal(ent.permissions.canAccessTerminal, false);
  assert.equal(ent.permissions.canAccessProSignals, false);
});

test('Oracle outage: admin keeps Pro access', async () => {
  const { ADMIN_WALLET } = await import('../../src/lib/config.ts');
  const ent = await resolveWalletEntitlement(ADMIN_WALLET, { mockHoldingTokens: 0, mockStakedTokens: 0 });
  assert.equal(ent.tier, 'pro');
});

test('Oracle outage: /api/tiers/current returns 503 price_unavailable with no price or thresholds', async () => {
  const res = await tiersGet();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'price_unavailable');
  assert.equal(body.price_source, 'unavailable');
  assert.equal(body.member, undefined);
  assert.equal(body.pro, undefined);
  assert.ok(!JSON.stringify(body).includes('0.0000164'));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('dispatch-delayed requires CRON_SECRET Bearer auth on GET and POST', async () => {
  const prev = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const noCfg = await dispatchGet(new NextRequest('http://localhost:3000/api/telegram/dispatch-delayed'));
    assert.equal(noCfg.status, 500);

    process.env.CRON_SECRET = 'test-dispatch-secret';
    for (const handler of [dispatchGet, dispatchPost]) {
      const anon = await handler(new NextRequest('http://localhost:3000/api/telegram/dispatch-delayed', { method: handler === dispatchPost ? 'POST' : 'GET' }));
      assert.equal(anon.status, 401);
      const bad = await handler(
        new NextRequest('http://localhost:3000/api/telegram/dispatch-delayed', {
          method: handler === dispatchPost ? 'POST' : 'GET',
          headers: { authorization: 'Bearer wrong' },
        })
      );
      assert.equal(bad.status, 401);
      const bare = await handler(
        new NextRequest('http://localhost:3000/api/telegram/dispatch-delayed', {
          method: handler === dispatchPost ? 'POST' : 'GET',
          headers: { authorization: 'test-dispatch-secret' },
        })
      );
      assert.equal(bare.status, 401, 'secret without Bearer prefix must be rejected');
    }

    // Authorised: Telegram unconfigured in tests -> dispatcher returns zero work, HTTP 200.
    const ok = await dispatchGet(
      new NextRequest('http://localhost:3000/api/telegram/dispatch-delayed', {
        headers: { authorization: 'Bearer test-dispatch-secret' },
      })
    );
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
    globalThis.fetch = realFetch;
  }
});
