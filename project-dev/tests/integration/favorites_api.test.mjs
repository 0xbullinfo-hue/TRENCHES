import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';

process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis-favorites.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-redis-favorites-token';

import { GENESIS_MINT, ADMIN_WALLET, TOKEN_DECIMALS } from '../../src/lib/config.ts';

const mockRedisStore = new Map();
const walletBalancesRaw = new Map(); // wallet -> BigInt token raw amount string

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  // Solana JSON-RPC mock for balance lookup
  if (options?.body && String(options.body).includes('getTokenAccountsByOwner')) {
    const rpcBody = JSON.parse(String(options.body));
    const owner = rpcBody?.params?.[0] || '';
    const rawAmount = walletBalancesRaw.get(owner);
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          value: rawAmount
            ? [
                {
                  account: {
                    data: {
                      parsed: {
                        info: {
                          tokenAmount: {
                            amount: rawAmount,
                            decimals: TOKEN_DECIMALS,
                            uiAmount: Number(BigInt(rawAmount) / BigInt(10 ** TOKEN_DECIMALS)),
                          },
                        },
                      },
                    },
                  },
                },
              ]
            : [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Jupiter / DexScreener price oracle mock ($0.00002 -> 2M tokens = $40 = MEMBER)
  if (urlStr.includes('api.jup.ag/price') || urlStr.includes('dexscreener.com')) {
    return new Response(
      JSON.stringify({
        data: { [GENESIS_MINT]: { price: '0.00002' } },
        pairs: [{ baseToken: { address: GENESIS_MINT }, priceUsd: '0.00002', liquidity: { usd: 50000 } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Mock Upstash Redis REST
  if (urlStr.includes('mock-redis-favorites.io')) {
    const args = JSON.parse(String(options?.body || '[]'));
    const cmd = String(args[0] || '').toUpperCase();

    if (cmd === 'GET') {
      return new Response(JSON.stringify({ result: mockRedisStore.get(String(args[1])) ?? null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (cmd === 'SET' || cmd === 'SETEX') {
      const key = String(args[1]);
      const val = String(cmd === 'SETEX' ? args[3] : args[2]);
      const hasNx = args.includes('NX');
      if (hasNx && mockRedisStore.has(key)) {
        return new Response(JSON.stringify({ result: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      mockRedisStore.set(key, val);
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (cmd === 'INCR') {
      const key = String(args[1]);
      const next = (Number(mockRedisStore.get(key) || '0') || 0) + 1;
      mockRedisStore.set(key, String(next));
      return new Response(JSON.stringify({ result: next }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (cmd === 'EXPIRE' || cmd === 'DEL') {
      if (cmd === 'DEL') mockRedisStore.delete(String(args[1]));
      return new Response(JSON.stringify({ result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (cmd === 'EVAL') {
      const script = String(args[1]);
      if (script.includes('LOCK_LOST')) {
        const lockKey = String(args[3]);
        const targetKey = String(args[4]);
        const token = String(args[5]);
        const payload = String(args[6]);
        if (mockRedisStore.get(lockKey) !== token) {
          return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'LOCK_LOST' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        mockRedisStore.set(targetKey, payload);
        return new Response(JSON.stringify({ result: JSON.stringify({ success: true }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (script.includes("redis.call('del',KEYS[1])")) {
        const k = String(args[3]);
        if (mockRedisStore.get(k) === String(args[4])) {
          mockRedisStore.delete(k);
          return new Response(JSON.stringify({ result: 1 }), { status: 200 });
        }
        return new Response(JSON.stringify({ result: 0 }), { status: 200 });
      }
      if (script.includes("redis.call('set',KEYS[2],ARGV[2])")) {
        mockRedisStore.set(String(args[4]), String(args[6]));
        return new Response(JSON.stringify({ result: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: 1 }), { status: 200 });
    }
  }

  return originalFetch(url, options);
};

const { signSession, SESSION_COOKIE_NAME } = await import('../../src/server/auth.ts');
const { GET, POST, DELETE } = await import('../../src/app/api/favorites/route.ts');

function authedReq(url, method, wallet, body) {
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSession(wallet))}`;
  return new NextRequest(url, {
    method,
    headers: {
      cookie,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test('GET/POST /api/favorites fail closed without session authentication (401)', async () => {
  const unauthGet = await GET(new NextRequest('http://localhost/api/favorites'));
  assert.equal(unauthGet.status, 401);

  const unauthPost = await POST(
    new NextRequest('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'raid-1', kind: 'RAID', active: true }),
    })
  );
  assert.equal(unauthPost.status, 401);
});

test('POST/GET/DELETE /api/favorites enforce membership gates, wallet isolation, and migration dedupe', async () => {
  const freeWallet = Keypair.generate().publicKey.toBase58();
  const memberWallet = Keypair.generate().publicKey.toBase58();
  // Member holds 5,000,000 tokens ($100 at $0.00002 -> member tier)
  walletBalancesRaw.set(memberWallet, String(BigInt(5_000_000) * BigInt(10 ** TOKEN_DECIMALS)));

  // 1. FREE wallet can favorite RAID, rejected from ALPHA (403) & MAX_ALPHA (403)
  const freeRaid = await POST(
    authedReq('http://localhost/api/favorites', 'POST', freeWallet, {
      id: 'raid-open-1',
      kind: 'RAID',
      active: true,
    })
  );
  assert.equal(freeRaid.status, 200);
  const freeRaidJson = await freeRaid.json();
  assert.equal(freeRaidJson.favorites.length, 1);
  assert.equal(freeRaidJson.favorites[0].kind, 'RAID');

  const freeAlpha = await POST(
    authedReq('http://localhost/api/favorites', 'POST', freeWallet, {
      id: 'alpha-1',
      kind: 'ALPHA',
      active: true,
    })
  );
  assert.equal(freeAlpha.status, 403);

  // 2. MEMBER wallet can favorite ALPHA & RAID, rejected from MAX_ALPHA (403)
  const memberAlpha = await POST(
    authedReq('http://localhost/api/favorites', 'POST', memberWallet, {
      id: 'alpha-100',
      kind: 'ALPHA',
      active: true,
    })
  );
  assert.equal(memberAlpha.status, 200);

  const memberMax = await POST(
    authedReq('http://localhost/api/favorites', 'POST', memberWallet, {
      id: 'max-100',
      kind: 'MAX_ALPHA',
      active: true,
    })
  );
  assert.equal(memberMax.status, 403);

  // 3. Wallet isolation: MEMBER wallet only sees its own favorites, never freeWallet's items
  const memberGet = await GET(authedReq('http://localhost/api/favorites', 'GET', memberWallet));
  assert.equal(memberGet.status, 200);
  const memberGetJson = await memberGet.json();
  assert.deepEqual(
    memberGetJson.favorites.map((f) => f.id),
    ['alpha-100']
  );

  // 4. Migration deduplicates overlapping IDs and drops unauthorized MAX_ALPHA items for Member
  const migrateRes = await POST(
    authedReq('http://localhost/api/favorites', 'POST', memberWallet, {
      migrate: [
        { id: 'alpha-100', kind: 'ALPHA' },
        { id: 'alpha-100', kind: 'ALPHA' },
        { id: 'max-100', kind: 'MAX_ALPHA' },
        { id: 'raid-open-1', kind: 'RAID' },
      ],
    })
  );
  assert.equal(migrateRes.status, 200);
  const migrateJson = await migrateRes.json();
  assert.deepEqual(
    migrateJson.favorites.map((f) => f.id).sort(),
    ['alpha-100', 'raid-open-1']
  );

  // 5. ADMIN/PRO wallet can favorite MAX_ALPHA cleanly and delete cleanly
  const adminMax = await POST(
    authedReq('http://localhost/api/favorites', 'POST', ADMIN_WALLET, {
      id: 'max-secret-1',
      kind: 'MAX_ALPHA',
      active: true,
    })
  );
  assert.equal(adminMax.status, 200);
  const adminMaxJson = await adminMax.json();
  assert.ok(adminMaxJson.favorites.some((f) => f.id === 'max-secret-1' && f.kind === 'MAX_ALPHA'));

  const delRes = await DELETE(
    authedReq('http://localhost/api/favorites?id=max-secret-1&kind=MAX_ALPHA', 'DELETE', ADMIN_WALLET)
  );
  assert.equal(delRes.status, 200);
  const delJson = await delRes.json();
  assert.equal(delJson.favorites.some((f) => f.id === 'max-secret-1'), false);
});
