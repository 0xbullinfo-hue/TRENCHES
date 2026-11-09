import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  OUTBOX_EVENTS_HASH,
  OUTBOX_PENDING_SET,
  buildNotificationEventId,
  buildSlTargetId,
  buildTpTargetId,
  computeRetryDelayMs,
  enqueueOutboxEvent,
  getOutboxEventState,
  outboxSubsKey,
  processNotificationOutbox,
} from '../../src/server/notification-outbox.ts';
import { runAutomatedAlertsMonitor } from '../../src/server/alerts-monitor.ts';
import { GET as monitorGet } from '../../src/app/api/telegram/monitor/route.ts';
import { SUBS_KEY, completeLink, createLinkCode, isLinked } from '../../src/server/telegram.ts';
import { SOL_TOKEN, SOL_OTHER } from './helpers/market-fixtures.mjs';

const NOW = Date.parse('2026-01-01T00:05:00.000Z');
const FRESH_ISO = new Date(NOW - 5_000).toISOString();

function makeCall(overrides = {}) {
  return {
    id: 'call-sol-1',
    name: 'SolX',
    ticker: '$SOLX',
    chain: 'SOL',
    quoteToken: 'SOL',
    ca: SOL_TOKEN,
    marketCap: '$100K',
    marketCapUsd: 100_000,
    entryMarketCap: '$100K',
    entryMarketCapUsd: 100_000,
    change24hPct: 0,
    calledAt: '2026-01-01T00:00:00.000Z',
    caller: 'Admin',
    callerWinRate: '80%',
    status: 'LIVE',
    statusLabel: 'ACTIVE',
    category: 'TRENCH',
    allocationLabel: 'Allocation',
    allocation: '1%',
    risk: 3,
    riskRewardRatio: '1:4 R:R',
    outcome: 'NEUTRAL',
    minTier: 'LAB_MEMBER',
    isMaxAlpha: false,
    pinned: false,
    links: [],
    summary: 'Test call',
    volume24h: '$50K',
    netInflow24h: '$10K',
    age: '5m',
    ageMinutes: 5,
    deployedVia: 'Pump.fun',
    sparkline: [1, 2],
    art: { bg: '#000', accent: '#0f0', glyph: 'S' },
    takeProfits: [
      { label: 'TP1 (2x)', multiple: 2.0, hit: false },
      { label: 'TP2 (5x)', multiple: 5.0, hit: false },
    ],
    stopLoss: '-25% SL',
    ...overrides,
  };
}

function makeTelemetry(overrides = {}) {
  return {
    chain: 'SOL',
    contractAddress: SOL_TOKEN,
    price: 0.25,
    marketCap: 250_000,
    volume24h: 50_000,
    priceChange24h: 15,
    liquidity: 40_000,
    imageUrl: null,
    status: 'LIVE',
    provider: 'COINSTATS',
    originProvider: 'COINSTATS',
    fetchedAt: FRESH_ISO,
    isFallback: false,
    ...overrides,
  };
}

/**
 * Full Upstash Redis REST simulator supporting Strings, Hashes, Sets, and all atomic Lua scripts in kv.ts.
 */
function createOutboxRedisSimulator() {
  const strings = new Map(); // key -> { value, expiresAt }
  const hashes = new Map(); // key -> Map<field, value>
  const sets = new Map(); // key -> Set<member>
  let nowMs = NOW;
  let failMode = null; // null | 'all' | 'write' | 'outbox_create'

  const getStr = (key) => {
    const e = strings.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && e.expiresAt <= nowMs) {
      strings.delete(key);
      return null;
    }
    return e.value;
  };

  const getHash = (key, create = false) => {
    let h = hashes.get(key);
    if (!h && create) {
      h = new Map();
      hashes.set(key, h);
    }
    return h || null;
  };

  const getSet = (key, create = false) => {
    let s = sets.get(key);
    if (!s && create) {
      s = new Set();
      sets.set(key, s);
    }
    return s || null;
  };

  const execCommand = (args) => {
    const op = String(args[0]).toUpperCase();
    if (failMode === 'all') {
      throw new Error('Simulated Redis outage');
    }
    if (
      failMode === 'write' &&
      (op === 'SET' || op === 'HSET' || op === 'SADD' || op === 'EVAL')
    ) {
      throw new Error('Simulated Redis write failure');
    }

    switch (op) {
      case 'GET':
        return getStr(String(args[1]));
      case 'GETDEL': {
        const k = String(args[1]);
        const v = getStr(k);
        strings.delete(k);
        return v;
      }
      case 'DEL': {
        const k = String(args[1]);
        strings.delete(k);
        hashes.delete(k);
        sets.delete(k);
        return 1;
      }
      case 'SET': {
        const key = String(args[1]);
        const val = String(args[2]);
        const rest = args.slice(3).map((x) => String(x).toUpperCase());
        const nx = rest.includes('NX');
        const exIdx = rest.indexOf('EX');
        const ttlSec = exIdx !== -1 ? Number(args[3 + exIdx + 1]) : null;
        if (nx && getStr(key) !== null) return null;
        strings.set(key, {
          value: val,
          expiresAt: ttlSec !== null ? nowMs + ttlSec * 1000 : null,
        });
        return 'OK';
      }
      case 'HGET': {
        const h = getHash(String(args[1]));
        return h ? (h.get(String(args[2])) ?? null) : null;
      }
      case 'HSET': {
        const h = getHash(String(args[1]), true);
        const field = String(args[2]);
        const isNew = !h.has(field);
        h.set(field, String(args[3]));
        return isNew ? 1 : 0;
      }
      case 'HDEL': {
        const h = getHash(String(args[1]));
        if (!h) return 0;
        return h.delete(String(args[2])) ? 1 : 0;
      }
      case 'HGETALL': {
        const h = getHash(String(args[1]));
        if (!h) return [];
        const flat = [];
        for (const [f, v] of h.entries()) {
          flat.push(f, v);
        }
        return flat;
      }
      case 'SADD': {
        const s = getSet(String(args[1]), true);
        const m = String(args[2]);
        const had = s.has(m);
        s.add(m);
        return had ? 0 : 1;
      }
      case 'SREM': {
        const s = getSet(String(args[1]));
        if (!s) return 0;
        return s.delete(String(args[2])) ? 1 : 0;
      }
      case 'SMEMBERS': {
        const s = getSet(String(args[1]));
        return s ? [...s] : [];
      }
      case 'EVAL': {
        const script = String(args[1]);
        const numKeys = Number(args[2]);
        const keys = args.slice(3, 3 + numKeys).map(String);
        const argv = args.slice(3 + numKeys).map(String);

        // 1. UNLOCK_LUA
        if (script.includes("redis.call('del',KEYS[1])")) {
          if (getStr(keys[0]) === argv[0]) {
            strings.delete(keys[0]);
            return 1;
          }
          return 0;
        }

        // 2. RENEW_LOCK_LUA
        if (script.includes("redis.call('expire',KEYS[1]")) {
          const e = strings.get(keys[0]);
          if (e && getStr(keys[0]) === argv[0]) {
            e.expiresAt = nowMs + Number(argv[1]) * 1000;
            return 1;
          }
          return 0;
        }

        // 3. SET_IF_LOCKED_LUA
        if (script.includes("redis.call('set',KEYS[2],ARGV[2])")) {
          if (getStr(keys[0]) === argv[0]) {
            strings.set(keys[1], { value: argv[1], expiresAt: null });
            return 1;
          }
          return 0;
        }

        // 4. OUTBOX_CREATE_EVENT_LUA
        if (script.includes("redis.call('sadd',KEYS[2],ARGV[1])") && script.includes("hexists")) {
          if (failMode === 'outbox_create') {
            throw new Error('Simulated outbox event creation failure');
          }
          const eventsHash = getHash(keys[0], true);
          const pendingSet = getSet(keys[1], true);
          const eventId = argv[0];
          const eventJson = argv[1];
          if (eventsHash.has(eventId)) {
            const existing = eventsHash.get(eventId);
            if (existing && !existing.includes('"status":"completed"')) {
              pendingSet.add(eventId);
            }
            return 0;
          }
          eventsHash.set(eventId, eventJson);
          pendingSet.add(eventId);
          return 1;
        }

        // 5. OUTBOX_SEED_SUB_LUA
        if (
          script.includes("if redis.call('hexists',KEYS[1],ARGV[1])==1 then return 0 else redis.call('hset'")
        ) {
          const subsHash = getHash(keys[0], true);
          const subId = argv[0];
          if (subsHash.has(subId)) return 0;
          subsHash.set(subId, argv[1]);
          return 1;
        }

        // 6. OUTBOX_MARK_SEEDED_LUA
        if (script.includes('ev.subscribersSeeded=true')) {
          const eventsHash = getHash(keys[0], true);
          const raw = eventsHash.get(argv[0]);
          if (!raw) return 0;
          const ev = JSON.parse(raw);
          ev.subscribersSeeded = true;
          ev.updatedAt = Number(argv[1]);
          eventsHash.set(argv[0], JSON.stringify(ev));
          return 1;
        }

        // 7. OUTBOX_CLAIM_SUB_LUA
        if (script.includes("rec.status='processing'")) {
          const subsHash = getHash(keys[0], true);
          const subId = argv[0];
          const raw = subsHash.get(subId);
          if (!raw) return null;
          const rec = JSON.parse(raw);
          const now = Number(argv[1]);
          const leaseMs = Number(argv[2]);
          const workerToken = argv[3];
          const st = rec.status;
          if (st === 'delivered' || st === 'permanently_failed') return null;
          if (st === 'processing' && typeof rec.leaseExpiresAt === 'number' && rec.leaseExpiresAt > now) {
            return null;
          }
          if (st === 'retry' && typeof rec.nextRetryAt === 'number' && rec.nextRetryAt > now) {
            return null;
          }
          if (typeof rec.nextTierCheckAt === 'number' && rec.nextTierCheckAt > now) {
            return null;
          }
          rec.previousStatus = st;
          rec.status = 'processing';
          rec.processingToken = workerToken;
          rec.leaseExpiresAt = now + leaseMs;
          const updated = JSON.stringify(rec);
          subsHash.set(subId, updated);
          return updated;
        }

        // 8. OUTBOX_RENEW_SUB_LUA
        if (script.includes('rec.leaseExpiresAt=tonumber(ARGV[3])')) {
          const subsHash = getHash(keys[0], true);
          const raw = subsHash.get(argv[0]);
          if (!raw) return 0;
          const rec = JSON.parse(raw);
          if (rec.status !== 'processing' || rec.processingToken !== argv[1]) return 0;
          rec.leaseExpiresAt = Number(argv[2]);
          subsHash.set(argv[0], JSON.stringify(rec));
          return 1;
        }

        // 9. OUTBOX_COMPLETE_SUB_LUA
        if (script.includes('local outcome=cjson.decode(ARGV[3])')) {
          const subsHash = getHash(keys[0], true);
          const raw = subsHash.get(argv[0]);
          if (!raw) return 0;
          const rec = JSON.parse(raw);
          if (rec.status === 'delivered') return 1;
          if (rec.status !== 'processing' || rec.processingToken !== argv[1]) return 0;
          const outcome = JSON.parse(argv[2]);
          rec.status = outcome.status;
          if (outcome.isTierCheckFailure === true) {
            rec.tierCheckAttemptCount =
              Number(outcome.tierCheckAttemptCount) || (Number(rec.tierCheckAttemptCount) || 0) + 1;
            rec.nextTierCheckAt = Number(outcome.nextTierCheckAt) || 0;
            rec.lastTierCheckFailureAt = outcome.lastTierCheckFailureAt ?? null;
          } else {
            if (outcome.attemptCount !== undefined && outcome.attemptCount !== null) {
              rec.attemptCount = Number(outcome.attemptCount);
            } else {
              rec.attemptCount = (Number(rec.attemptCount) || 0) + 1;
            }
            if (outcome.lastAttemptAt !== undefined && outcome.lastAttemptAt !== null) {
              rec.lastAttemptAt = outcome.lastAttemptAt;
            }
            if (outcome.nextRetryAt !== undefined && outcome.nextRetryAt !== null) {
              rec.nextRetryAt = Number(outcome.nextRetryAt);
            }
            if (outcome.lastFailureCategory !== undefined) {
              rec.lastFailureCategory = outcome.lastFailureCategory;
            }
            if (outcome.nextTierCheckAt !== undefined && outcome.nextTierCheckAt !== null) {
              rec.nextTierCheckAt = Number(outcome.nextTierCheckAt);
            }
          }
          rec.processingToken = null;
          rec.leaseExpiresAt = null;
          subsHash.set(argv[0], JSON.stringify(rec));
          return 1;
        }

        // 10. OUTBOX_FINALIZE_EVENT_LUA
        if (script.includes("ev.status='completed'")) {
          const eventsHash = getHash(keys[0], true);
          const pendingSet = getSet(keys[1], true);
          const subsHash = getHash(keys[2], true);
          const eventId = argv[0];
          const evRaw = eventsHash.get(eventId);
          if (!evRaw) {
            pendingSet.delete(eventId);
            return 'missing';
          }
          const ev = JSON.parse(evRaw);
          if (!ev.subscribersSeeded) return 'pending';
          for (const subRaw of subsHash.values()) {
            const sub = JSON.parse(subRaw);
            if (sub.status !== 'delivered' && sub.status !== 'permanently_failed') {
              return 'pending';
            }
          }
          ev.status = 'completed';
          ev.updatedAt = Number(argv[1]);
          eventsHash.set(eventId, JSON.stringify(ev));
          pendingSet.delete(eventId);
          return 'completed';
        }

        throw new Error(`Unhandled Lua script in simulator: ${script}`);
      }
      default:
        throw new Error(`Unhandled Redis op in simulator: ${op}`);
    }
  };

  const fetchMock = async (url, init) => {
    const body = JSON.parse(init.body);
    try {
      const result = execCommand(body);
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
    strings,
    hashes,
    sets,
    getNow: () => nowMs,
    setNow: (ms) => {
      nowMs = ms;
    },
    advanceTime: (deltaMs) => {
      nowMs += deltaMs;
    },
    setFailMode: (mode) => {
      failMode = mode;
    },
    seedLinkedSubscribers: (map) => {
      const h = getHash(SUBS_KEY, true);
      for (const [wallet, chatId] of Object.entries(map)) {
        h.set(wallet, String(chatId));
        strings.set(`tg:chat:${chatId}`, { value: wallet, expiresAt: null });
      }
    },
    fetchMock,
  };
}

async function withMockRedis(fn) {
  const sim = createOutboxRedisSimulator();
  const prevFetch = globalThis.fetch;
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  process.env.UPSTASH_REDIS_REST_URL = 'https://mock-outbox-redis.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-outbox-redis-token';

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith('https://mock-outbox-redis.upstash.io')) {
      return sim.fetchMock(url, init);
    }
    return prevFetch(input, init);
  };

  try {
    return await fn(sim);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken;
  }
}

// ============================================================================
// 1, 2, 3 & 5: TP Event Creation, SL Event Creation, Duplicate Trigger Prevention,
//              and Successful Delivery Acknowledgement
// ============================================================================
test('Outbox [1, 2, 3, 5, 17]: TP/SL event creation, duplicate trigger prevention, delivery acknowledgement, and duplicate delivery prevention', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletPro111111111111111111111111111111111: '1001',
      WalletMem222222222222222222222222222222222: '1002',
    });

    let storedRegistry = [makeCall()];
    const sentMessages = [];

    const monitorDeps = () => ({
      now: sim.getNow,
      maxDataAgeMs: 60_000,
      loadRegistry: async () => structuredClone(storedRegistry),
      saveRegistry: async (recs) => {
        storedRegistry = structuredClone(recs);
        return { success: true };
      },
      getMarketData: async () =>
        makeTelemetry({ marketCap: 220_000, fetchedAt: new Date(sim.getNow() - 1000).toISOString() }),
      outbox: {
        now: sim.getNow,
        resolveTier: async (w) => (w.startsWith('WalletPro') ? 'pro' : 'member'),
        sendTelegramMessage: async (chatId, text) => {
          sentMessages.push({ chatId: String(chatId), text });
          return { ok: true, status: 200 };
        },
      },
    });

    // Run 1: TP1 (2x) crossed at $220K
    const r1 = await runAutomatedAlertsMonitor(monitorDeps());
    assert.equal(r1.ok, true);
    assert.equal(r1.incomplete, false);
    assert.equal(r1.tpTriggered, 1);
    assert.equal(r1.slTriggered, 0);
    assert.equal(r1.eventsCreated, 1);
    assert.equal(r1.eventsProcessed, 1);
    assert.equal(r1.notificationsSent, 2);
    assert.equal(r1.notificationsPending, 0);
    assert.equal(sentMessages.length, 2);

    const tpEventId = buildNotificationEventId('call-sol-1', 'TP', buildTpTargetId(0, 'TP1 (2x)'));
    const tpState = await getOutboxEventState(tpEventId);
    assert.equal(tpState.event?.status, 'completed');
    assert.equal(
      tpState.subscribers['WalletPro111111111111111111111111111111111']?.status,
      'delivered'
    );
    assert.equal(
      tpState.subscribers['WalletMem222222222222222222222222222222222']?.status,
      'delivered'
    );

    // Run 2 at same $220K: Duplicate trigger prevented AND already-delivered subscribers never re-notified
    const r2 = await runAutomatedAlertsMonitor(monitorDeps());
    assert.equal(r2.tpTriggered, 0);
    assert.equal(r2.eventsCreated, 0);
    assert.equal(r2.notificationsSent, 0);
    assert.equal(sentMessages.length, 2, 'Successful deliveries must never be duplicated');

    // Run 3 at $70K (-30% vs -25% SL): SL event creation & delivery
    const slDeps = monitorDeps();
    slDeps.getMarketData = async () =>
      makeTelemetry({ marketCap: 70_000, fetchedAt: new Date(sim.getNow() - 1000).toISOString() });
    const r3 = await runAutomatedAlertsMonitor(slDeps);
    assert.equal(r3.slTriggered, 1);
    assert.equal(r3.eventsCreated, 1);
    assert.equal(r3.notificationsSent, 2);
    assert.equal(storedRegistry[0].status, 'CLOSED');
    assert.equal(storedRegistry[0].outcome, 'LOSS');

    const slEventId = buildNotificationEventId('call-sol-1', 'SL', buildSlTargetId('-25% SL'));
    assert.notEqual(tpEventId, slEventId, 'TP and SL event IDs must be distinct');
    const slState = await getOutboxEventState(slEventId);
    assert.equal(slState.event?.status, 'completed');
    assert.equal(slState.event?.triggerType, 'SL');
  });
});

// ============================================================================
// 4: Duplicate Event Prevention Across Concurrent Workers
// ============================================================================
test('Outbox [4]: atomic Redis Lua event creation prevents duplicate events across concurrent workers', async () => {
  await withMockRedis(async (sim) => {
    const call = makeCall();
    const targetId = buildTpTargetId(0, 'TP1 (2x)');
    const tp2TargetId = buildTpTargetId(1, 'TP2 (5x)');

    assert.notEqual(
      buildNotificationEventId(call.id, 'TP', targetId),
      buildNotificationEventId(call.id, 'TP', tp2TargetId),
      'Different TP targets on the same call must never share an event ID'
    );

    const [enqA, enqB, enqC] = await Promise.all([
      enqueueOutboxEvent(
        {
          call,
          triggerType: 'TP',
          targetId,
          targetLabel: 'TP1 (2x)',
          marketCapLabel: '$220.0K',
        },
        { now: sim.getNow }
      ),
      enqueueOutboxEvent(
        {
          call,
          triggerType: 'TP',
          targetId,
          targetLabel: 'TP1 (2x)',
          marketCapLabel: '$220.0K',
        },
        { now: sim.getNow }
      ),
      enqueueOutboxEvent(
        {
          call,
          triggerType: 'TP',
          targetId,
          targetLabel: 'TP1 (2x)',
          marketCapLabel: '$220.0K',
        },
        { now: sim.getNow }
      ),
    ]);

    const createdCount = [enqA, enqB, enqC].filter((r) => r.created).length;
    assert.equal(createdCount, 1, 'Exactly one concurrent worker may create the event');
    assert.equal(enqA.eventId, enqB.eventId);
    assert.equal(enqB.eventId, enqC.eventId);
  });
});

// ============================================================================
// 6 & 7: Retry After Network Failure & Retry After Telegram Rate Limiting (429 retry_after)
// ============================================================================
test('Outbox [6, 7]: retries temporary network failures with exponential backoff and honors Telegram 429 retry_after', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletNet111111111111111111111111111111111: '2001',
      WalletRate22222222222222222222222222222222: '2002',
    });

    const call = makeCall();
    const { eventId } = await enqueueOutboxEvent(
      {
        call,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$250.0K',
      },
      { now: sim.getNow }
    );

    let attemptByChat = { '2001': 0, '2002': 0 };

    // Run 1: Chat 2001 hits network error (status 0), Chat 2002 hits HTTP 429 with retryAfter=45s
    const run1 = await processNotificationOutbox({
      now: sim.getNow,
      baseRetryDelayMs: 15_000,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        const id = String(chatId);
        attemptByChat[id]++;
        if (id === '2001') {
          return { ok: false, status: 0, description: 'network error' };
        }
        return { ok: false, status: 429, description: 'Too Many Requests', retryAfter: 45 };
      },
    });

    assert.equal(run1.ok, true);
    assert.equal(run1.incomplete, true, 'Run with pending retryable deliveries must report incomplete: true');
    assert.equal(run1.notificationsSent, 0);
    assert.equal(run1.notificationsPending, 2);
    assert.equal(run1.notificationsRetried, 2);

    const stateAfterRun1 = await getOutboxEventState(eventId);
    assert.equal(stateAfterRun1.event?.status, 'pending', 'Event must not be marked completed while retries are pending');

    const subNet = stateAfterRun1.subscribers['WalletNet111111111111111111111111111111111'];
    const subRate = stateAfterRun1.subscribers['WalletRate22222222222222222222222222222222'];
    assert.equal(subNet.status, 'retry');
    assert.equal(subNet.lastFailureCategory, 'network');
    assert.equal(subNet.attemptCount, 1);
    assert.equal(subNet.nextRetryAt, NOW + 15_000, 'Network error uses 15s base backoff on attempt 1');

    assert.equal(subRate.status, 'retry');
    assert.equal(subRate.lastFailureCategory, 'rate_limit');
    assert.equal(subRate.attemptCount, 1);
    assert.equal(subRate.nextRetryAt, NOW + 45_000, 'Rate limit must honor 45s retry_after from Telegram');

    // Run 2 at NOW + 20s: Only WalletNet (due at +15s) is retried and succeeds; WalletRate (due at +45s) waits
    sim.advanceTime(20_000);
    const run2 = await processNotificationOutbox({
      now: sim.getNow,
      baseRetryDelayMs: 15_000,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        attemptByChat[String(chatId)]++;
        return { ok: true, status: 200 };
      },
    });

    assert.equal(run2.notificationsSent, 1);
    assert.equal(run2.notificationsPending, 1, 'WalletRate is still waiting for its 45s retry_after window');
    assert.equal(run2.incomplete, true);
    assert.equal(attemptByChat['2001'], 2);
    assert.equal(attemptByChat['2002'], 1, 'WalletRate must not be retried before nextRetryAt');

    // Run 3 at NOW + 50s: WalletRate is now due, retries, and succeeds -> event completes
    sim.advanceTime(30_000);
    const run3 = await processNotificationOutbox({
      now: sim.getNow,
      baseRetryDelayMs: 15_000,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        attemptByChat[String(chatId)]++;
        return { ok: true, status: 200 };
      },
    });

    assert.equal(run3.notificationsSent, 1);
    assert.equal(run3.notificationsRetried, 1);
    assert.equal(run3.notificationsPending, 0);
    assert.equal(run3.incomplete, false);

    const finalState = await getOutboxEventState(eventId);
    assert.equal(finalState.event?.status, 'completed');
    assert.equal(
      finalState.subscribers['WalletNet111111111111111111111111111111111'].status,
      'delivered'
    );
    assert.equal(
      finalState.subscribers['WalletRate22222222222222222222222222222222'].status,
      'delivered'
    );
  });
});

// ============================================================================
// 8 & 11: Deferred Delivery After Execution-Budget Exhaustion & Recovery After Interruption
// ============================================================================
test('Outbox [8, 11]: retains deferred subscribers when execution budget expires and resumes safely on next run without duplicate sends', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletSubA11111111111111111111111111111111: '3001',
      WalletSubB22222222222222222222222222222222: '3002',
      WalletSubC33333333333333333333333333333333: '3003',
    });

    const call = makeCall();
    const { eventId } = await enqueueOutboxEvent(
      {
        call,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$250.0K',
      },
      { now: sim.getNow }
    );

    const deliveredChats = [];

    // Run 1: Budget is 1,000ms; first send consumes 850ms, leaving < 250ms minRequestBudgetMs
    const run1 = await processNotificationOutbox({
      now: sim.getNow,
      budgetMs: 1_000,
      minRequestBudgetMs: 250,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        sim.advanceTime(850);
        deliveredChats.push(String(chatId));
        return { ok: true, status: 200 };
      },
    });

    assert.equal(run1.ok, true);
    assert.equal(run1.incomplete, true, 'Must report incomplete when budget expires mid-fanout');
    assert.equal(run1.notificationsSent, 1);
    assert.equal(run1.notificationsPending, 2, 'Remaining 2 subscribers must stay durably pending');
    assert.equal(deliveredChats.length, 1);

    const midState = await getOutboxEventState(eventId);
    assert.equal(midState.event?.status, 'pending');
    assert.equal(
      midState.subscribers['WalletSubA11111111111111111111111111111111'].status,
      'delivered'
    );
    assert.equal(
      midState.subscribers['WalletSubB22222222222222222222222222222222'].status,
      'pending'
    );
    assert.equal(
      midState.subscribers['WalletSubC33333333333333333333333333333333'].status,
      'pending'
    );

    // Run 2: Full budget available -> resumes and delivers only to SubB and SubC
    const run2 = await processNotificationOutbox({
      now: sim.getNow,
      budgetMs: 10_000,
      minRequestBudgetMs: 250,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        deliveredChats.push(String(chatId));
        return { ok: true, status: 200 };
      },
    });

    assert.equal(run2.ok, true);
    assert.equal(run2.incomplete, false);
    assert.equal(run2.notificationsSent, 2);
    assert.equal(run2.notificationsPending, 0);
    assert.deepEqual(deliveredChats, ['3001', '3002', '3003']);

    const endState = await getOutboxEventState(eventId);
    assert.equal(endState.event?.status, 'completed');
  });
});

// ============================================================================
// 9 & 10: Permanent Failure Handling & Blocked Telegram User Unlink Handling
// ============================================================================
test('Outbox [9, 10]: marks invalid recipients and exhausted retries as permanently_failed and unlinks blocked users', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletBlocked11111111111111111111111111111: '4001',
      WalletBadChat22222222222222222222222222222: '4002',
      WalletMaxFail33333333333333333333333333333: '4003',
    });

    const call = makeCall();
    const { eventId } = await enqueueOutboxEvent(
      {
        call,
        triggerType: 'SL',
        targetId: buildSlTargetId('-25% SL'),
        targetLabel: '-25% SL',
        marketCapLabel: '$70.0K',
      },
      { now: sim.getNow }
    );

    // Run 1 with maxAttempts = 2:
    // - 4001 returns 403 Forbidden (bot blocked) -> unlinked + permanently_failed immediately
    // - 4002 returns 400 Bad Request (invalid chat) -> permanently_failed immediately
    // - 4003 returns 502 Bad Gateway -> retry (attempt 1 of 2)
    const run1 = await processNotificationOutbox({
      now: sim.getNow,
      maxAttempts: 2,
      baseRetryDelayMs: 5_000,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async (chatId) => {
        const id = String(chatId);
        if (id === '4001') {
          return { ok: false, status: 403, description: 'Forbidden: bot was blocked by the user' };
        }
        if (id === '4002') {
          return { ok: false, status: 400, description: 'Bad Request: chat_id is empty' };
        }
        return { ok: false, status: 502, description: 'Bad Gateway' };
      },
    });

    assert.equal(run1.notificationsPermanentlyFailed, 2);
    assert.equal(run1.notificationsRetried, 1);
    assert.equal(run1.notificationsPending, 1);

    // Verify blocked user was unlinked from tg:subs
    const stillLinked = await isLinked('WalletBlocked11111111111111111111111111111');
    assert.equal(stillLinked, false, 'Blocked Telegram user must be unlinked');

    const state1 = await getOutboxEventState(eventId);
    assert.equal(
      state1.subscribers['WalletBlocked11111111111111111111111111111'].status,
      'permanently_failed'
    );
    assert.equal(
      state1.subscribers['WalletBlocked11111111111111111111111111111'].lastFailureCategory,
      'blocked'
    );
    assert.equal(
      state1.subscribers['WalletBadChat22222222222222222222222222222'].status,
      'permanently_failed'
    );
    assert.equal(
      state1.subscribers['WalletBadChat22222222222222222222222222222'].lastFailureCategory,
      'invalid_recipient'
    );
    assert.equal(
      state1.subscribers['WalletMaxFail33333333333333333333333333333'].status,
      'retry'
    );

    // Run 2 after backoff: 4003 fails a 2nd time (reaching maxAttempts = 2) -> permanently_failed
    sim.advanceTime(6_000);
    const run2 = await processNotificationOutbox({
      now: sim.getNow,
      maxAttempts: 2,
      baseRetryDelayMs: 5_000,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async () => ({ ok: false, status: 503, description: 'Service Unavailable' }),
    });

    assert.equal(run2.notificationsPermanentlyFailed, 1);
    assert.equal(run2.notificationsPending, 0);
    assert.equal(run2.incomplete, false);

    const state2 = await getOutboxEventState(eventId);
    assert.equal(
      state2.subscribers['WalletMaxFail33333333333333333333333333333'].status,
      'permanently_failed'
    );
    assert.equal(
      state2.subscribers['WalletMaxFail33333333333333333333333333333'].attemptCount,
      2
    );
    assert.equal(state2.event?.status, 'completed', 'Event completes once all subscribers are terminal');
  });
});

// ============================================================================
// 12: Expired Processing Lease Recovery & Stale Worker Rejection
// ============================================================================
test('Outbox [12]: prevents concurrent delivery during active lease, recovers expired processing lease, and blocks stale worker overwrite', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletLease1111111111111111111111111111111: '5001',
    });

    const call = makeCall();
    const { eventId } = await enqueueOutboxEvent(
      {
        call,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$250.0K',
      },
      { now: sim.getNow }
    );

    // Seed subscriber and manually simulate Worker 1 claiming a 10s lease and then stalling
    const { kvOutboxClaimSubscriber, kvOutboxCompleteSubscriber } = await import('../../src/server/kv.ts');

    // Run seeding pass by giving 0ms send budget after seeding
    const subsKey = outboxSubsKey(eventId);
    await processNotificationOutbox({
      now: sim.getNow,
      resolveTier: async () => 'pro',
      sendTelegramMessage: async () => {
        // Worker 1 claims the lease, then we simulate time advancing past lease expiration while Worker 2 runs!
        const duringClaim = await getOutboxEventState(eventId);
        const subDuring = duringClaim.subscribers['WalletLease1111111111111111111111111111111'];
        assert.equal(subDuring.status, 'processing');
        assert.equal(subDuring.processingToken, 'worker-token-1');

        // While lease is still valid (+2s < 10s lease), a concurrent Worker 2 cannot claim the subscriber
        sim.advanceTime(2_000);
        const concurrentClaim = await kvOutboxClaimSubscriber(
          subsKey,
          'WalletLease1111111111111111111111111111111',
          'worker-token-2',
          sim.getNow(),
          10_000
        );
        assert.equal(concurrentClaim, null, 'Active processing lease must block concurrent worker');

        // Now advance past Worker 1's 10s lease (+15s) and let Worker 2 reclaim and deliver!
        sim.advanceTime(15_000);
        const worker2Res = await processNotificationOutbox({
          now: sim.getNow,
          workerToken: 'worker-token-2',
          leaseDurationMs: 10_000,
          resolveTier: async () => 'pro',
          sendTelegramMessage: async () => ({ ok: true, status: 200 }),
        });
        assert.equal(worker2Res.notificationsSent, 1);

        // Now Worker 1 finishes late and returns a failure (500) -> must NOT overwrite Worker 2's delivered state!
        return { ok: false, status: 500, description: 'Stale worker late failure' };
      },
      workerToken: 'worker-token-1',
      leaseDurationMs: 10_000,
    });

    const finalState = await getOutboxEventState(eventId);
    assert.equal(
      finalState.subscribers['WalletLease1111111111111111111111111111111'].status,
      'delivered',
      'Stale Worker 1 must never overwrite Worker 2 delivered state'
    );

    // Also verify kvOutboxCompleteSubscriber directly rejects stale token when in processing state
    const rejectStale = await kvOutboxCompleteSubscriber(
      subsKey,
      'WalletLease1111111111111111111111111111111',
      'stale-token',
      JSON.stringify({ status: 'retry', lastAttemptAt: sim.getNow(), nextRetryAt: 999, lastFailureCategory: 'network' })
    );
    assert.equal(rejectStale, true, 'Delivering an already-delivered record is a safe idempotent no-op');
    assert.equal(
      (await getOutboxEventState(eventId)).subscribers['WalletLease1111111111111111111111111111111'].status,
      'delivered'
    );
  });
});

// ============================================================================
// 13 & 14: Redis Unavailable Behavior & Redis Persistence Failure Behavior
// ============================================================================
test('Outbox [13, 14]: fails safely and reports operationalFailure when Redis is unavailable or persistence fails (never falls back to filesystem)', async () => {
  // 13. Redis unconfigured when requireOutbox is true -> operationalFailure
  const registry = [makeCall()];
  const resUnconfigured = await runAutomatedAlertsMonitor({
    now: () => NOW,
    maxDataAgeMs: 60_000,
    requireOutbox: true,
    withLock: async (fn) => fn(),
    loadRegistry: async () => registry,
    saveRegistry: async () => ({ success: true }),
    getMarketData: async () => makeTelemetry({ marketCap: 250_000 }),
    outbox: {
      isRedisConfigured: () => false,
    },
  });

  assert.equal(resUnconfigured.ok, false);
  assert.equal(resUnconfigured.operationalFailure, true);
  assert.equal(resUnconfigured.incomplete, true);
  assert.equal(resUnconfigured.tpTriggered, 0);
  assert.equal(
    registry[0].takeProfits[0].hit,
    false,
    'In-memory registry must be rolled back when outbox persistence is unavailable'
  );

  // 14. Redis write failure during outbox event creation -> rolls back and reports operationalFailure
  await withMockRedis(async (sim) => {
    sim.setFailMode('outbox_create');
    const reg2 = [makeCall()];
    let registrySaved = false;

    const resWriteFail = await runAutomatedAlertsMonitor({
      now: sim.getNow,
      maxDataAgeMs: 60_000,
      withLock: async (fn) => fn(),
      loadRegistry: async () => reg2,
      saveRegistry: async () => {
        registrySaved = true;
        return { success: true };
      },
      getMarketData: async () => makeTelemetry({ marketCap: 250_000 }),
    });

    assert.equal(resWriteFail.ok, false);
    assert.equal(resWriteFail.operationalFailure, true);
    assert.equal(registrySaved, false, 'Registry must not be saved if outbox event creation failed');
    assert.equal(reg2[0].takeProfits[0].hit, false);
  });
});

// ============================================================================
// 15 & 16: Pro-Only Notification Restrictions & Member Notification Eligibility
// ============================================================================
test('Outbox [15, 16]: enforces Pro-only restrictions on PRO / Max Alpha calls and delivers general calls to both Member and Pro subscribers', async () => {
  await withMockRedis(async (sim) => {
    sim.seedLinkedSubscribers({
      WalletPro111111111111111111111111111111111: '6001',
      WalletMem222222222222222222222222222222222: '6002',
      WalletFree33333333333333333333333333333333: '6003',
    });

    const resolveTierMock = async (wallet) => {
      if (wallet.startsWith('WalletPro')) return 'pro';
      if (wallet.startsWith('WalletMem')) return 'member';
      return 'free';
    };

    // Case 15: Pro-only call (minTier: 'PRO' or isMaxAlpha: true) -> ONLY WalletPro receives notification
    const proCall = makeCall({ id: 'call-pro-only', minTier: 'PRO', isMaxAlpha: true });
    await enqueueOutboxEvent(
      {
        call: proCall,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$300.0K',
      },
      { now: sim.getNow }
    );

    const proCallRecipients = [];
    const resPro = await processNotificationOutbox({
      now: sim.getNow,
      resolveTier: resolveTierMock,
      sendTelegramMessage: async (chatId) => {
        proCallRecipients.push(String(chatId));
        return { ok: true, status: 200 };
      },
    });

    assert.equal(resPro.notificationsSent, 1);
    assert.deepEqual(proCallRecipients, ['6001'], 'Pro-only call must only be sent to Pro subscriber');

    // Case 16: General Member-tier call (minTier: 'LAB_MEMBER', isMaxAlpha: false) -> BOTH Pro and Member receive, Free does not
    const memberCall = makeCall({ id: 'call-member-eligible', minTier: 'LAB_MEMBER', isMaxAlpha: false });
    await enqueueOutboxEvent(
      {
        call: memberCall,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$300.0K',
      },
      { now: sim.getNow }
    );

    const memberCallRecipients = [];
    const resMem = await processNotificationOutbox({
      now: sim.getNow,
      resolveTier: resolveTierMock,
      sendTelegramMessage: async (chatId) => {
        memberCallRecipients.push(String(chatId));
        return { ok: true, status: 200 };
      },
    });

    assert.equal(resMem.notificationsSent, 2);
    assert.deepEqual(
      memberCallRecipients.sort(),
      ['6001', '6002'],
      'Member-eligible call must be delivered to both Pro and Member subscribers, but never Free'
    );
  });
});

// ============================================================================
// 18: Monitor Response Observability & Secret / PII Redaction
// ============================================================================
test('Outbox [18]: GET /api/telegram/monitor reports incomplete runs and outbox counters accurately without leaking wallets, chatIds, or secrets', async () => {
  await withMockRedis(async (sim) => {
    const prevCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'super-secret-cron-token';

    try {
      sim.seedLinkedSubscribers({
        SensitiveWalletAddress99999999999999999999: '987654321',
      });

      const call = makeCall({ id: 'call-route-obs' });
      await enqueueOutboxEvent(
        {
          call,
          triggerType: 'TP',
          targetId: buildTpTargetId(0, 'TP1 (2x)'),
          targetLabel: 'TP1 (2x)',
          marketCapLabel: '$250.0K',
        },
        { now: sim.getNow }
      );

      // Seed the subscriber as 'retry' in the future so the monitor route sees an outstanding retryable delivery
      const subsKey = outboxSubsKey(
        buildNotificationEventId('call-route-obs', 'TP', buildTpTargetId(0, 'TP1 (2x)'))
      );
      await processNotificationOutbox({
        now: sim.getNow,
        resolveTier: async () => 'pro',
        sendTelegramMessage: async () => ({ ok: false, status: 503, description: 'Service Unavailable' }),
      });

      const req = new NextRequest('http://localhost:3000/api/telegram/monitor', {
        headers: { authorization: 'Bearer super-secret-cron-token' },
      });
      const res = await monitorGet(req);
      assert.equal(res.status, 200);
      const rawText = await res.text();
      const body = JSON.parse(rawText);

      // Verify required observability fields
      assert.equal(body.ok, true);
      assert.equal(body.incomplete, true, 'Must report incomplete: true when retryable deliveries remain');
      assert.equal(body.operationalFailure, false);
      assert.equal(typeof body.eventsCreated, 'number');
      assert.equal(typeof body.eventsProcessed, 'number');
      assert.equal(typeof body.notificationsSent, 'number');
      assert.equal(body.notificationsPending, 1);
      assert.equal(typeof body.notificationsRetried, 'number');
      assert.equal(typeof body.notificationsPermanentlyFailed, 'number');

      // Verify zero leakage of wallet address, chatId, Redis keys, or secrets
      assert.ok(!rawText.includes('SensitiveWalletAddress99999999999999999999'));
      assert.ok(!rawText.includes('987654321'));
      assert.ok(!rawText.includes('super-secret-cron-token'));
      assert.ok(!rawText.includes(OUTBOX_EVENTS_HASH));
      assert.ok(!rawText.includes( subsKey ));
    } finally {
      if (prevCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevCronSecret;
    }
  });
});

// ============================================================================
// 19: Tier-Verification Retry Separation & Resilience (Fix 1)
// ============================================================================
test('Outbox [19]: tier RPC failures never increment Telegram delivery attemptCount, never permanently_fail subscribers, survive restarts, and preserve Admin/Pro/Member/Free rules', async () => {
  await withMockRedis(async (sim) => {
    const ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';
    const PRO_WALLET = 'WalletProTierRetry111111111111111111111111';
    const MEM_WALLET = 'WalletMemTierRetry222222222222222222222222';
    const FREE_WALLET = 'WalletFreeTierRetry33333333333333333333333';

    sim.seedLinkedSubscribers({
      [ADMIN_WALLET]: '7000',
      [PRO_WALLET]: '7001',
      [MEM_WALLET]: '7002',
      [FREE_WALLET]: '7003',
    });

    // Pro-only call: Admin receives immediately even during complete RPC outage;
    // PRO_WALLET and MEM_WALLET and FREE_WALLET experience 6 consecutive RPC failures (exceeding maxAttempts = 3!)
    const proCall = makeCall({ id: 'call-tier-retry-pro', minTier: 'PRO', isMaxAlpha: true });
    const { eventId } = await enqueueOutboxEvent(
      {
        call: proCall,
        triggerType: 'TP',
        targetId: buildTpTargetId(0, 'TP1 (2x)'),
        targetLabel: 'TP1 (2x)',
        marketCapLabel: '$250.0K',
      },
      { now: sim.getNow }
    );

    let rpcOutage = true;
    const deliveredTo = [];

    // Execute 6 consecutive worker runs during RPC outage with maxAttempts = 3
    for (let cycle = 1; cycle <= 6; cycle++) {
      const res = await processNotificationOutbox({
        now: sim.getNow,
        maxAttempts: 3,
        baseRetryDelayMs: 5_000,
        maxRetryDelayMs: 60_000,
        workerToken: `worker-restart-${cycle}`,
        resolveTier: async () => {
          if (rpcOutage) throw new Error('Solana RPC 503 Service Unavailable');
          return 'pro';
        },
        sendTelegramMessage: async (chatId, text) => {
          deliveredTo.push({ chatId: String(chatId), text });
          return { ok: true, status: 200 };
        },
      });

      if (cycle === 1) {
        assert.equal(res.notificationsSent, 1, 'Admin wallet must receive notification even during tier RPC outage');
        assert.equal(deliveredTo[0].chatId, '7000');
        assert.ok(deliveredTo[0].text.includes('Ref: <code>#'), 'Message must include non-sensitive eventRef');
      } else {
        assert.equal(res.notificationsSent, 0, 'No notification may be sent while tier eligibility is unknown');
      }
      assert.equal(
        res.notificationsPermanentlyFailed,
        0,
        `Cycle ${cycle}: tier RPC failure must NEVER permanently fail a subscriber`
      );
      assert.equal(res.incomplete, true, 'Event must remain incomplete while subscribers await tier verification');

      const state = await getOutboxEventState(eventId);
      const proSub = state.subscribers[PRO_WALLET];
      assert.equal(
        proSub.attemptCount,
        0,
        `Cycle ${cycle}: tier RPC failure must NEVER increment Telegram delivery attemptCount`
      );
      assert.equal(proSub.tierCheckAttemptCount, cycle, 'tierCheckAttemptCount must track RPC verification retries');
      assert.equal(proSub.status, 'pending', 'Subscriber status must remain pending during tier RPC backoff');
      assert.ok(proSub.nextTierCheckAt > sim.getNow(), 'Subscriber must have bounded nextTierCheckAt backoff');
      assert.equal(proSub.lastTierCheckFailureAt, sim.getNow());

      // Advance clock past bounded tier check backoff to simulate next scheduled run after restart
      sim.advanceTime(65_000);
    }

    // Also simulate a worker crash/interruption mid-lease before tier recovery:
    // Claim lease for PRO_WALLET and let it expire without completing
    const { kvOutboxClaimSubscriber } = await import('../../src/server/kv.ts');
    const claimedBeforeCrash = await kvOutboxClaimSubscriber(
      outboxSubsKey(eventId),
      PRO_WALLET,
      'crashed-worker-token',
      sim.getNow(),
      10_000
    );
    assert.ok(claimedBeforeCrash, 'Worker claims subscriber before crash');
    assert.equal(
      JSON.parse(claimedBeforeCrash).attemptCount,
      0,
      'Claiming lease before Telegram send must not inflate attemptCount'
    );
    // Advance past the 10s lease so the crashed worker's lease expires
    sim.advanceTime(15_000);

    // Now the tier RPC service recovers!
    // - PRO_WALLET resolves to 'pro' -> receives notification (attemptCount becomes 1, status 'delivered')
    // - MEM_WALLET resolves to 'member' -> excluded from Pro-only call without sending
    // - FREE_WALLET resolves to 'free' -> excluded without sending
    // - Event finalizes as 'completed'!
    rpcOutage = false;
    const recoveryRes = await processNotificationOutbox({
      now: sim.getNow,
      maxAttempts: 3,
      baseRetryDelayMs: 5_000,
      workerToken: 'worker-after-recovery',
      resolveTier: async (wallet) => {
        if (wallet === PRO_WALLET) return 'pro';
        if (wallet === MEM_WALLET) return 'member';
        return 'free';
      },
      sendTelegramMessage: async (chatId, text) => {
        deliveredTo.push({ chatId: String(chatId), text });
        return { ok: true, status: 200 };
      },
    });

    assert.equal(recoveryRes.ok, true);
    assert.equal(recoveryRes.incomplete, false, 'Event must complete once tier service recovers');
    assert.equal(recoveryRes.notificationsSent, 1, 'Only PRO_WALLET should receive the Pro-only notification on recovery');
    assert.equal(recoveryRes.notificationsPending, 0);
    assert.equal(recoveryRes.notificationsPermanentlyFailed, 0);
    assert.deepEqual(
      deliveredTo.map((d) => d.chatId),
      ['7000', '7001'],
      'Only Admin (7000) and Pro (7001) receive the Pro-only notification; Member (7002) and Free (7003) are excluded'
    );

    const finalState = await getOutboxEventState(eventId);
    assert.equal(finalState.event?.status, 'completed', 'Event must finalize after ineligible subscribers are cleared');
    assert.equal(finalState.subscribers[PRO_WALLET]?.status, 'delivered');
    assert.equal(
      finalState.subscribers[PRO_WALLET]?.attemptCount,
      1,
      'Exactly 1 Telegram delivery attempt was used after 6 prior tier RPC failures'
    );
    assert.equal(finalState.subscribers[MEM_WALLET], undefined, 'Ineligible member removed from Pro-only subs hash');
    assert.equal(finalState.subscribers[FREE_WALLET], undefined, 'Ineligible free user removed from subs hash');
  });
});

