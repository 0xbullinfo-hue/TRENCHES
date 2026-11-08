import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kvLock,
  kvRenewLock,
  kvVerifyLock,
  kvUnlock,
  kvSetIfLocked,
  kvGet,
  isKvConfigured,
} from '../../src/server/kv.ts';
import {
  DEFAULT_REGISTRY_LOCK_TTL_SEC,
  KV_KEY,
  KV_LOCK_KEY,
  withRegistryLock,
  loadCallsRegistry,
  saveCallsRegistry,
} from '../../src/server/alphas-data.ts';

/**
 * In-memory simulator of Upstash Redis REST endpoint supporting:
 * - GET, SET (with NX / EX), DEL, EXPIRE
 * - The exact Lua scripts used by kvUnlock, kvRenewLock, and kvSetIfLocked
 */
function createMockRedisServer() {
  const store = new Map(); // key -> { value, expiresAt }
  let nowMs = Date.now();
  let failMode = null; // null | 'all' | 'renew'
  const commands = [];

  const getEntry = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= nowMs) {
      store.delete(key);
      return null;
    }
    return entry;
  };

  const handleCommand = (args) => {
    commands.push(args);
    const op = String(args[0]).toUpperCase();
    if (failMode === 'all') {
      throw new Error('Simulated Redis outage');
    }

    if (op === 'GET') {
      const e = getEntry(String(args[1]));
      return e ? e.value : null;
    }

    if (op === 'SET') {
      const key = String(args[1]);
      const value = String(args[2]);
      const rest = args.slice(3).map((x) => String(x).toUpperCase());
      const nx = rest.includes('NX');
      const exIdx = rest.indexOf('EX');
      const ttlSec = exIdx !== -1 ? Number(args[3 + exIdx + 1]) : null;

      if (nx && getEntry(key) !== null) {
        return null;
      }
      store.set(key, {
        value,
        expiresAt: ttlSec !== null ? nowMs + ttlSec * 1000 : null,
      });
      return 'OK';
    }

    if (op === 'EVAL') {
      const script = String(args[1]);
      const numKeys = Number(args[2]);
      const keys = args.slice(3, 3 + numKeys).map(String);
      const argv = args.slice(3 + numKeys).map(String);

      // Unlock script: if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end
      if (script.includes("redis.call('del',KEYS[1])")) {
        const cur = getEntry(keys[0]);
        if (cur && cur.value === argv[0]) {
          store.delete(keys[0]);
          return 1;
        }
        return 0;
      }

      // Renew script: if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('expire',KEYS[1],tonumber(ARGV[2])) else return 0 end
      if (script.includes("redis.call('expire',KEYS[1]")) {
        if (failMode === 'renew') {
          throw new Error('Simulated Redis renewal failure');
        }
        const cur = getEntry(keys[0]);
        if (cur && cur.value === argv[0]) {
          cur.expiresAt = nowMs + Number(argv[1]) * 1000;
          return 1;
        }
        return 0;
      }

      // Set-if-locked script: if redis.call('get',KEYS[1])==ARGV[1] then redis.call('set',KEYS[2],ARGV[2]) return 1 else return 0 end
      if (script.includes("redis.call('set',KEYS[2],ARGV[2])")) {
        const cur = getEntry(keys[0]);
        if (cur && cur.value === argv[0]) {
          store.set(keys[1], { value: argv[1], expiresAt: null });
          return 1;
        }
        return 0;
      }

      throw new Error(`Unsupported EVAL script in mock: ${script}`);
    }

    throw new Error(`Unsupported Redis command in mock: ${op}`);
  };

  const fetchMock = async (_url, init) => {
    const body = JSON.parse(init.body);
    try {
      const result = handleCommand(body);
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };

  return {
    store,
    commands,
    fetchMock,
    advanceMs(ms) {
      nowMs += ms;
    },
    setFailMode(mode) {
      failMode = mode;
    },
    getEntry,
  };
}

function withMockedUpstash(fn) {
  return async () => {
    const origFetch = globalThis.fetch;
    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    const origToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    const redis = createMockRedisServer();
    globalThis.fetch = redis.fetchMock;
    process.env.UPSTASH_REDIS_REST_URL = 'https://mock-upstash.local';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-upstash-token';

    try {
      await fn(redis);
    } finally {
      globalThis.fetch = origFetch;
      if (origUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = origUrl;
      if (origToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = origToken;
    }
  };
}

test('Redis Locking: DEFAULT_REGISTRY_LOCK_TTL_SEC exceeds 60s serverless maxDuration', () => {
  assert.ok(
    DEFAULT_REGISTRY_LOCK_TTL_SEC > 60,
    `Expected lock TTL (${DEFAULT_REGISTRY_LOCK_TTL_SEC}s) to exceed 60s maxDuration`
  );
  assert.equal(DEFAULT_REGISTRY_LOCK_TTL_SEC, 65);
});

test(
  'Redis Locking: atomic acquisition, expiration, renewal, ownership verification, and safe release via Upstash REST',
  withMockedUpstash(async (redis) => {
    assert.equal(isKvConfigured(), true);

    const tokenA = 'worker-a-uuid-1111';
    const tokenB = 'worker-b-uuid-2222';

    // 1. Worker A acquires lock with 65s TTL
    const acquiredA = await kvLock(KV_LOCK_KEY, tokenA, 65);
    assert.equal(acquiredA, true);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenA), true);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenB), false);

    // 2. Concurrent acquisition by Worker B while Worker A holds lock -> rejected (NX)
    const acquiredBWhileHeld = await kvLock(KV_LOCK_KEY, tokenB, 65);
    assert.equal(acquiredBWhileHeld, false);

    // 3. Advance clock 40s, Worker A renews lease for another 65s
    redis.advanceMs(40_000);
    // Wrong worker cannot renew Worker A's lock
    assert.equal(await kvRenewLock(KV_LOCK_KEY, tokenB, 65), false);
    // Worker A renews successfully
    assert.equal(await kvRenewLock(KV_LOCK_KEY, tokenA, 65), true);

    // Advance another 40s (total 80s > original 65s TTL, but within renewed 65s lease)
    redis.advanceMs(40_000);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenA), true, 'Renewed lock must still be held at 80s');
    assert.equal(await kvLock(KV_LOCK_KEY, tokenB, 65), false, 'Worker B still cannot steal renewed lock');

    // 4. Advance 70s without renewal -> Worker A's lock expires
    redis.advanceMs(70_000);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenA), false, 'Lock must expire after TTL elapses');

    // 5. Worker B now acquires the expired lock
    const acquiredBAfterExpiry = await kvLock(KV_LOCK_KEY, tokenB, 65);
    assert.equal(acquiredBAfterExpiry, true);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenB), true);

    // 6. Expired Worker A attempts to renew, write, or unlock -> ALL rejected without affecting Worker B!
    assert.equal(await kvRenewLock(KV_LOCK_KEY, tokenA, 65), false);
    assert.equal(await kvSetIfLocked(KV_LOCK_KEY, tokenA, KV_KEY, '[{"id":"stale-a"}]'), false);
    assert.equal(
      await kvUnlock(KV_LOCK_KEY, tokenA),
      false,
      'Expired Worker A must NOT be able to delete Worker B lock'
    );
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenB), true, 'Worker B still owns the lock');

    // 7. Worker B writes protected state and unlocks cleanly
    assert.equal(await kvSetIfLocked(KV_LOCK_KEY, tokenB, KV_KEY, '[{"id":"valid-b"}]'), true);
    assert.equal(await kvGet(KV_KEY), '[{"id":"valid-b"}]');
    assert.equal(await kvUnlock(KV_LOCK_KEY, tokenB), true);
    assert.equal(await kvVerifyLock(KV_LOCK_KEY, tokenB), false);
  })
);

test(
  'Redis Locking: withRegistryLock renews lease automatically during long execution and stops on completion',
  withMockedUpstash(async (redis) => {
    let renewCount = 0;
    const origRenew = kvRenewLock;

    const result = await withRegistryLock(
      async (ctx) => {
        assert.equal(ctx.isDistributed, true);
        assert.equal(ctx.ttlSec, 65);
        assert.match(ctx.token, /^[0-9a-f-]{36}$/i);

        // Wait for at least 2 renewal ticks
        await new Promise((r) => setTimeout(r, 90));
        await ctx.assertOwned();
        return 'completed-ok';
      },
      {
        ttlSec: 65,
        renewIntervalMs: 30,
        kv: {
          renew: async (key, token, ttl) => {
            renewCount++;
            return origRenew(key, token, ttl);
          },
        },
      }
    );

    assert.equal(result, 'completed-ok');
    assert.ok(renewCount >= 2, `Expected at least 2 lease renewals, got ${renewCount}`);

    // Lock must be released after completion and no further renewals may fire
    const countAfterRelease = renewCount;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(renewCount, countAfterRelease, 'Lease renewal timer must stop after worker finishes');
    assert.equal(redis.getEntry(KV_LOCK_KEY), null, 'Lock key must be deleted after withRegistryLock finishes');
  })
);

test(
  'Redis Locking: worker that loses lock ownership aborts saveCallsRegistry and cannot overwrite another worker',
  withMockedUpstash(async (redis) => {
    // Seed initial registry in Redis
    redis.store.set(KV_KEY, { value: JSON.stringify([{ id: 'initial-call' }]), expiresAt: null });

    await assert.rejects(
      async () => {
        await withRegistryLock(
          async () => {
            // Simulate lock expiring and being acquired by Worker B before Worker A saves
            redis.store.set(KV_LOCK_KEY, { value: 'worker-b-new-owner-token', expiresAt: null });

            const saveRes = await saveCallsRegistry([{ id: 'corrupt-write-from-expired-worker-a' }]);
            assert.equal(saveRes.success, false);
            assert.match(saveRes.error, /ownership lost/i);
          },
          { ttlSec: 65, renewIntervalMs: 10_000 }
        );
      },
      /ownership lost/i
    );

    // Verify Redis registry was NOT overwritten by Worker A, and Worker B's lock is still intact!
    assert.equal(await kvGet(KV_KEY), JSON.stringify([{ id: 'initial-call' }]));
    assert.equal(redis.getEntry(KV_LOCK_KEY)?.value, 'worker-b-new-owner-token');
  })
);

test(
  'Redis Locking: Redis errors during lock acquisition are never treated as successful lock acquisition',
  withMockedUpstash(async (redis) => {
    redis.setFailMode('all');
    let executed = false;

    await assert.rejects(
      async () => {
        await withRegistryLock(
          async () => {
            executed = true;
          },
          { maxAttempts: 2, retryDelayMs: 10 }
        );
      },
      /KV HTTP 500|Simulated Redis outage/
    );

    assert.equal(executed, false, 'Protected callback must NEVER run when Redis lock acquisition errors');
  })
);

test('Redis Locking: missing production Redis configuration fails safely instead of silent in-memory fallback', async () => {
  const prodNoRedisEnv = {
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    ALLOW_FILE_PERSISTENCE: 'false',
  };

  let ran = false;
  await assert.rejects(
    async () => {
      await withRegistryLock(
        async () => {
          ran = true;
        },
        {
          env: prodNoRedisEnv,
          kv: { isConfigured: () => false },
        }
      );
    },
    /Production distributed lock requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/
  );
  assert.equal(ran, false, 'Must not silently run in-memory lock in serverless production without Redis');
});

