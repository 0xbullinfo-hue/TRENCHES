/**
 * Real Redis Lua Integration Test Suite for the Durable TP/SL Notification Outbox.
 *
 * Unlike unit tests that simulate Redis operations in JavaScript, this suite spawns an
 * isolated real `redis-server` process and routes `src/server/kv.ts` Upstash REST calls
 * through a thin local HTTP-to-RESP TCP bridge directly into the real Redis C Lua 5.1 + `cjson` engine.
 *
 * Safety guarantees:
 * - Never connects to production Upstash Redis.
 * - Uses an ephemeral localhost port (`127.0.0.1`) with persistence disabled (`--save "" --appendonly no`).
 * - Uses isolated per-test key namespaces (`test:itg:<testId>:...`) and cleans up all keys after every test.
 */
import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

import {
  kvDel,
  kvGet,
  kvHDel,
  kvHGet,
  kvHGetAll,
  kvLock,
  kvOutboxClaimSubscriber,
  kvOutboxCompleteSubscriber,
  kvOutboxCreateEvent,
  kvOutboxFinalizeEvent,
  kvOutboxMarkSubscribersSeeded,
  kvOutboxRenewSubscriberLease,
  kvOutboxSeedSubscriber,
  kvRenewLock,
  kvSetIfLocked,
  kvSMembers,
  kvUnlock,
} from '../../src/server/kv.ts';
import {
  OUTBOX_EVENTS_HASH,
  OUTBOX_PENDING_SET,
  buildNotificationEventId,
  buildTpTargetId,
  enqueueOutboxEvent,
  getOutboxEventState,
  outboxSubsKey,
  processNotificationOutbox,
} from '../../src/server/notification-outbox.ts';
import { SUBS_KEY } from '../../src/server/telegram.ts';
import { SOL_TOKEN } from '../unit/helpers/market-fixtures.mjs';

const NOW = Date.parse('2026-01-01T00:05:00.000Z');

// ---------------------------------------------------------------------------
// Minimal Redis RESP TCP Client + Upstash REST HTTP-to-RESP Bridge
// ---------------------------------------------------------------------------

function encodeRespCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const str = String(arg);
    const byteLen = Buffer.byteLength(str, 'utf8');
    parts.push(`$${byteLen}\r\n${str}\r\n`);
  }
  return Buffer.from(parts.join(''), 'utf8');
}

function parseRespValue(buf, offset = 0) {
  if (offset >= buf.length) return null;
  const prefix = String.fromCharCode(buf[offset]);
  const lineEnd = buf.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;

  const headerPayload = buf.subarray(offset + 1, lineEnd).toString('utf8');
  const nextOffset = lineEnd + 2;

  if (prefix === '+') {
    return { value: headerPayload, nextOffset };
  }
  if (prefix === '-') {
    return { error: new Error(headerPayload), nextOffset };
  }
  if (prefix === ':') {
    return { value: Number(headerPayload), nextOffset };
  }
  if (prefix === '$') {
    const len = Number(headerPayload);
    if (len === -1) {
      return { value: null, nextOffset };
    }
    const end = nextOffset + len;
    if (buf.length < end + 2) return null;
    const str = buf.subarray(nextOffset, end).toString('utf8');
    return { value: str, nextOffset: end + 2 };
  }
  if (prefix === '*') {
    const count = Number(headerPayload);
    if (count === -1) {
      return { value: null, nextOffset };
    }
    const items = [];
    let cur = nextOffset;
    for (let i = 0; i < count; i++) {
      const parsed = parseRespValue(buf, cur);
      if (!parsed) return null;
      if (parsed.error) return parsed;
      items.push(parsed.value);
      cur = parsed.nextOffset;
    }
    return { value: items, nextOffset: cur };
  }
  throw new Error(`Unexpected RESP prefix: ${prefix}`);
}

function sendRespCommand(port, args, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(encodeRespCommand(args));
    });
    const chunks = [];
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const combined = Buffer.concat(chunks);
      let parsed;
      try {
        parsed = parseRespValue(combined, 0);
      } catch (err) {
        socket.destroy();
        reject(err);
        return;
      }
      if (parsed) {
        socket.end();
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.value);
      }
    });
    socket.on('error', (err) => reject(err));
  });
}

function resolveRedisBinary() {
  if (process.env.REDIS_SERVER_BIN && fs.existsSync(process.env.REDIS_SERVER_BIN)) {
    return process.env.REDIS_SERVER_BIN;
  }
  const isWin = process.platform === 'win32';
  try {
    const cmd = isWin ? 'where.exe' : 'which';
    const out = execFileSync(cmd, [isWin ? 'redis-server.exe' : 'redis-server'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {
    // Fallback to local cache on Windows
  }
  if (isWin) {
    const cachedBin = path.join(os.homedir(), '.cache', 'redis-win', 'redis-server.exe');
    if (fs.existsSync(cachedBin)) return cachedBin;
  }
  return null;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

let redisProc = null;
let redisPort = 0;
let bridgeServer = null;
let bridgePort = 0;
let bridgeRejectNext = false;
let prevRedisUrl;
let prevRedisToken;
const trackedKeys = new Set();

function nsKey(suffix) {
  const k = `test:itg:${crypto.randomUUID()}:${suffix}`;
  trackedKeys.add(k);
  return k;
}

function makeCall(overrides = {}) {
  return {
    id: 'call-itg-1',
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
    summary: 'Integration test call',
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

function makeSubscriberRecord(eventId, subscriberId, chatId, overrides = {}) {
  return {
    eventId,
    callId: 'call-itg-1',
    triggerType: 'TP',
    targetId: 'tp:0:TP1 (2x)',
    subscriberId,
    chatId: String(chatId),
    createdAt: NOW,
    lastAttemptAt: null,
    attemptCount: 0,
    nextRetryAt: NOW,
    tierCheckAttemptCount: 0,
    nextTierCheckAt: NOW,
    lastTierCheckFailureAt: null,
    status: 'pending',
    lastFailureCategory: null,
    ...overrides,
  };
}

before(async () => {
  prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (process.env.REDIS_TEST_PORT) {
    redisPort = Number(process.env.REDIS_TEST_PORT);
  } else {
    const bin = resolveRedisBinary();
    if (!bin) {
      throw new Error(
        'Real redis-server binary is required for tests/integration/redis-lua-outbox.test.mjs. Install redis-server or set REDIS_SERVER_BIN / REDIS_TEST_PORT.'
      );
    }
    redisPort = await getFreePort();
    redisProc = spawn(
      bin,
      ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    // Wait for redis-server to accept PING over TCP
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        const pong = await sendRespCommand(redisPort, ['PING']);
        if (pong === 'PONG') {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!ready) {
      throw new Error(`Failed to start local redis-server on port ${redisPort}`);
    }
  }

  // Verify real Redis server info
  const info = await sendRespCommand(redisPort, ['INFO', 'server']);
  assert.ok(
    typeof info === 'string' && info.includes('redis_version:'),
    'Must be connected to a genuine Redis server instance'
  );
  const verMatch = info.match(/redis_version:([^\r\n]+)/);
  console.log(`[Redis Integration] Connected to real redis-server version=${verMatch ? verMatch[1] : 'unknown'} on 127.0.0.1:${redisPort}`);

  // Start HTTP-to-RESP bridge for src/server/kv.ts
  bridgeServer = http.createServer(async (req, res) => {
    if (bridgeRejectNext) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Simulated Redis bridge outage' }));
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await sendRespCommand(redisPort, args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  await new Promise((resolve) => bridgeServer.listen(0, '127.0.0.1', resolve));
  const addr = bridgeServer.address();
  bridgePort = typeof addr === 'object' && addr ? addr.port : 0;

  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${bridgePort}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'local-real-redis-integration-token';
});

afterEach(async () => {
  bridgeRejectNext = false;
  if (redisPort > 0) {
    for (const k of trackedKeys) {
      await sendRespCommand(redisPort, ['DEL', k]).catch(() => {});
    }
    trackedKeys.clear();
    await sendRespCommand(redisPort, ['DEL', OUTBOX_EVENTS_HASH, OUTBOX_PENDING_SET, SUBS_KEY]).catch(() => {});
  }
});

after(async () => {
  if (prevRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = prevRedisUrl;
  if (prevRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = prevRedisToken;

  if (bridgeServer) {
    await new Promise((resolve) => bridgeServer.close(() => resolve()));
  }
  if (redisProc) {
    redisProc.kill();
  }
});

// ============================================================================
// Scenarios 1 & 2: Atomic Event Creation & Duplicate Event Prevention
// ============================================================================
test('Real Redis Lua [1, 2]: atomic event creation and duplicate event prevention across concurrent callers', async () => {
  const eventsHash = nsKey('events');
  const pendingSet = nsKey('pending');
  const eventId = 'tpsl:call-1:TP:tp:0:TP1 (2x)';
  const eventJson = JSON.stringify({
    eventId,
    callId: 'call-1',
    triggerType: 'TP',
    targetId: 'tp:0:TP1 (2x)',
    status: 'pending',
    subscribersSeeded: false,
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Fire 5 concurrent kvOutboxCreateEvent executions against real Redis Lua
  const results = await Promise.all([
    kvOutboxCreateEvent(eventsHash, pendingSet, eventId, eventJson),
    kvOutboxCreateEvent(eventsHash, pendingSet, eventId, eventJson),
    kvOutboxCreateEvent(eventsHash, pendingSet, eventId, eventJson),
    kvOutboxCreateEvent(eventsHash, pendingSet, eventId, eventJson),
    kvOutboxCreateEvent(eventsHash, pendingSet, eventId, eventJson),
  ]);

  const createdCount = results.filter(Boolean).length;
  assert.equal(createdCount, 1, 'Exactly one concurrent caller may create the event in Redis');

  const storedRaw = await kvHGet(eventsHash, eventId);
  assert.ok(storedRaw);
  assert.equal(JSON.parse(storedRaw).eventId, eventId);

  const pendingMembers = await kvSMembers(pendingSet);
  assert.deepEqual(pendingMembers, [eventId]);
});

// ============================================================================
// Scenarios 3, 4 & 5: Concurrent Subscriber Claims, Active Lease Rejection & Expired Lease Recovery
// ============================================================================
test('Real Redis Lua [3, 4, 5]: concurrent subscriber claims, active lease rejection, and expired lease recovery', async () => {
  const subsKey = nsKey('subs');
  const eventId = 'tpsl:call-lease:TP:tp:0:TP1 (2x)';
  const subId = 'WalletRealRedis111111111111111111111111111';
  const initialRecord = makeSubscriberRecord(eventId, subId, '1001');

  const seeded = await kvOutboxSeedSubscriber(subsKey, subId, JSON.stringify(initialRecord));
  assert.equal(seeded, true);
  const duplicateSeed = await kvOutboxSeedSubscriber(subsKey, subId, JSON.stringify({ ...initialRecord, chatId: '9999' }));
  assert.equal(duplicateSeed, false, 'HSETNX Lua primitive must not overwrite an existing subscriber record');

  // Scenario 3: 4 concurrent workers try to claim the same pending subscriber at NOW with a 10s lease
  const claimResults = await Promise.all([
    kvOutboxClaimSubscriber(subsKey, subId, 'worker-A', NOW, 10_000),
    kvOutboxClaimSubscriber(subsKey, subId, 'worker-B', NOW, 10_000),
    kvOutboxClaimSubscriber(subsKey, subId, 'worker-C', NOW, 10_000),
    kvOutboxClaimSubscriber(subsKey, subId, 'worker-D', NOW, 10_000),
  ]);

  const successfulClaims = claimResults.filter((r) => r !== null);
  assert.equal(successfulClaims.length, 1, 'Exactly one concurrent worker may claim the subscriber lease');
  const winner = JSON.parse(successfulClaims[0]);
  assert.equal(winner.status, 'processing');
  assert.equal(winner.leaseExpiresAt, NOW + 10_000);
  assert.ok(['worker-A', 'worker-B', 'worker-C', 'worker-D'].includes(winner.processingToken));

  // Scenario 4: Active processing lease rejects another claim at NOW + 5s (< NOW + 10s)
  const rejectedActive = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-intruder', NOW + 5_000, 10_000);
  assert.equal(rejectedActive, null, 'Active processing lease must reject concurrent worker claim');

  // Winning worker can renew its lease while active; non-owner cannot
  const badRenew = await kvOutboxRenewSubscriberLease(subsKey, subId, 'worker-intruder', NOW + 25_000);
  assert.equal(badRenew, false, 'Non-owning worker must not renew lease');
  const okRenew = await kvOutboxRenewSubscriberLease(subsKey, subId, winner.processingToken, NOW + 20_000);
  assert.equal(okRenew, true, 'Owning worker must be able to renew lease');

  // Still active at NOW + 15s because renewed to NOW + 20s
  const stillActive = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-intruder', NOW + 15_000, 10_000);
  assert.equal(stillActive, null);

  // Scenario 5: After lease expires at NOW + 21s (> NOW + 20s), recovery worker reclaims the subscriber
  const recoveredRaw = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-recovery', NOW + 21_000, 10_000);
  assert.ok(recoveredRaw, 'Expired processing lease must be recoverable by a new worker');
  const recovered = JSON.parse(recoveredRaw);
  assert.equal(recovered.status, 'processing');
  assert.equal(recovered.processingToken, 'worker-recovery');
  assert.equal(recovered.leaseExpiresAt, NOW + 31_000);
});

// ============================================================================
// Scenarios 6, 7 & 8: Stale Worker Rejection, Successful Delivery Ack & Retry-State Persistence
// ============================================================================
test('Real Redis Lua [6, 7, 8]: rejects stale worker acknowledgement, persists retry state, and acknowledges delivery', async () => {
  const subsKey = nsKey('subs');
  const eventId = 'tpsl:call-ack:TP:tp:0:TP1 (2x)';
  const subId = 'WalletAckRedis1111111111111111111111111111';
  await kvOutboxSeedSubscriber(subsKey, subId, JSON.stringify(makeSubscriberRecord(eventId, subId, '2001')));

  // Worker 1 claims at NOW (10s lease), then stalls until NOW + 15s when Worker 2 reclaims
  await kvOutboxClaimSubscriber(subsKey, subId, 'worker-1-stale', NOW, 10_000);
  const w2Claim = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-2-current', NOW + 15_000, 10_000);
  assert.ok(w2Claim);

  // Scenario 6: Stale Worker 1 tries to complete with 'retry' or 'permanently_failed' -> MUST be rejected (returns false)
  const staleAck = await kvOutboxCompleteSubscriber(
    subsKey,
    subId,
    'worker-1-stale',
    JSON.stringify({
      status: 'permanently_failed',
      attemptCount: 1,
      lastAttemptAt: NOW + 16_000,
      nextRetryAt: 0,
      lastFailureCategory: 'invalid_recipient',
    })
  );
  assert.equal(staleAck, false, 'Redis Lua must reject completion from stale worker token');

  // Scenario 8: Current Worker 2 records a retryable failure ('retry' state with nextRetryAt = NOW + 60s)
  const retryAck = await kvOutboxCompleteSubscriber(
    subsKey,
    subId,
    'worker-2-current',
    JSON.stringify({
      status: 'retry',
      attemptCount: 1,
      lastAttemptAt: NOW + 16_000,
      nextRetryAt: NOW + 60_000,
      lastFailureCategory: 'rate_limit',
    })
  );
  assert.equal(retryAck, true);

  const retryState = JSON.parse(await kvHGet(subsKey, subId));
  assert.equal(retryState.status, 'retry');
  assert.equal(retryState.attemptCount, 1);
  assert.equal(retryState.nextRetryAt, NOW + 60_000);
  assert.equal(retryState.lastFailureCategory, 'rate_limit');
  assert.equal(retryState.processingToken, null);
  assert.equal(retryState.leaseExpiresAt, null);

  // Cannot be claimed before nextRetryAt (NOW + 30s < NOW + 60s)
  const earlyClaim = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-3', NOW + 30_000, 10_000);
  assert.equal(earlyClaim, null, 'Subscriber in retry state must not be claimed before nextRetryAt');

  // Scenario 7: At NOW + 61s, Worker 3 claims and records successful delivery ('delivered')
  const dueClaim = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-3', NOW + 61_000, 10_000);
  assert.ok(dueClaim);
  const deliveredAck = await kvOutboxCompleteSubscriber(
    subsKey,
    subId,
    'worker-3',
    JSON.stringify({
      status: 'delivered',
      attemptCount: 2,
      lastAttemptAt: NOW + 62_000,
      nextRetryAt: 0,
      lastFailureCategory: null,
    })
  );
  assert.equal(deliveredAck, true);

  const deliveredState = JSON.parse(await kvHGet(subsKey, subId));
  assert.equal(deliveredState.status, 'delivered');
  assert.equal(deliveredState.attemptCount, 2);
  assert.equal(deliveredState.lastFailureCategory, null);

  // Once delivered, can never be claimed again
  const postDeliveredClaim = await kvOutboxClaimSubscriber(subsKey, subId, 'worker-4', NOW + 100_000, 10_000);
  assert.equal(postDeliveredClaim, null, 'Delivered subscriber must never be claimed again');
});

// ============================================================================
// Scenarios 9, 10 & 11: Event Finalization Rules
// ============================================================================
test('Real Redis Lua [9, 10, 11]: event finalizes only after subscriber seeding completes and all subscribers reach terminal states', async () => {
  const eventsHash = nsKey('events');
  const pendingSet = nsKey('pending');
  const subsKey = nsKey('subs');
  const eventId = 'tpsl:call-fin:TP:tp:0:TP1 (2x)';

  await kvOutboxCreateEvent(
    eventsHash,
    pendingSet,
    eventId,
    JSON.stringify({
      eventId,
      callId: 'call-fin',
      triggerType: 'TP',
      targetId: 'tp:0:TP1 (2x)',
      status: 'pending',
      subscribersSeeded: false,
      createdAt: NOW,
      updatedAt: NOW,
    })
  );

  // Scenario 11: Event must NOT finalize before subscriber seeding completes (subscribersSeeded === false)
  const beforeSeed = await kvOutboxFinalizeEvent(eventsHash, pendingSet, subsKey, eventId, NOW + 1_000);
  assert.equal(beforeSeed, 'pending', 'Event must not finalize before subscribersSeeded is true');
  assert.deepEqual(await kvSMembers(pendingSet), [eventId]);

  // Seed 2 subscribers and mark event as seeded
  await kvOutboxSeedSubscriber(
    subsKey,
    'SubA',
    JSON.stringify(makeSubscriberRecord(eventId, 'SubA', '3001', { status: 'delivered' }))
  );
  await kvOutboxSeedSubscriber(
    subsKey,
    'SubB',
    JSON.stringify(makeSubscriberRecord(eventId, 'SubB', '3002', { status: 'pending' }))
  );
  const markedSeeded = await kvOutboxMarkSubscribersSeeded(eventsHash, eventId, NOW + 2_000);
  assert.equal(markedSeeded, true);

  // Scenario 10: Event must NOT finalize while SubB remains 'pending' (or 'retry' / 'processing')
  const whilePending = await kvOutboxFinalizeEvent(eventsHash, pendingSet, subsKey, eventId, NOW + 3_000);
  assert.equal(whilePending, 'pending', 'Event must not finalize while any subscriber is pending');
  assert.equal(JSON.parse(await kvHGet(eventsHash, eventId)).status, 'pending');
  assert.deepEqual(await kvSMembers(pendingSet), [eventId]);

  // Transition SubB to terminal 'permanently_failed'
  await kvOutboxClaimSubscriber(subsKey, 'SubB', 'worker-fin', NOW + 4_000, 10_000);
  await kvOutboxCompleteSubscriber(
    subsKey,
    'SubB',
    'worker-fin',
    JSON.stringify({
      status: 'permanently_failed',
      attemptCount: 3,
      lastAttemptAt: NOW + 5_000,
      nextRetryAt: 0,
      lastFailureCategory: 'blocked',
    })
  );

  // Scenario 9: Now both SubA ('delivered') and SubB ('permanently_failed') are terminal -> event finalizes!
  const finalized = await kvOutboxFinalizeEvent(eventsHash, pendingSet, subsKey, eventId, NOW + 6_000);
  assert.equal(finalized, 'completed', 'Event must finalize once all subscribers are in terminal states');

  const finalEvent = JSON.parse(await kvHGet(eventsHash, eventId));
  assert.equal(finalEvent.status, 'completed');
  assert.equal(finalEvent.updatedAt, NOW + 6_000);
  assert.deepEqual(await kvSMembers(pendingSet), [], 'Completed event must be removed from pending set');
});

// ============================================================================
// Scenario 12 + Full End-to-End Outbox Lifecycle & Distributed Lock Lua Scripts on Real Redis
// ============================================================================
test('Real Redis Lua [12]: distributed lock Lua primitives and Redis failure handling in outbox', async () => {
  // Verify lock Lua primitives (UNLOCK_LUA, RENEW_LOCK_LUA, SET_IF_LOCKED_LUA) on real Redis
  const lockKey = nsKey('lock');
  const dataKey = nsKey('data');
  assert.equal(await kvLock(lockKey, 'token-1', 30), true);
  assert.equal(await kvLock(lockKey, 'token-2', 30), false);
  assert.equal(await kvRenewLock(lockKey, 'token-2', 60), false);
  assert.equal(await kvRenewLock(lockKey, 'token-1', 60), true);
  assert.equal(await kvSetIfLocked(lockKey, 'token-2', dataKey, 'bad'), false);
  assert.equal(await kvSetIfLocked(lockKey, 'token-1', dataKey, 'good'), true);
  assert.equal(await kvGet(dataKey), 'good');
  assert.equal(await kvUnlock(lockKey, 'token-2'), false);
  assert.equal(await kvUnlock(lockKey, 'token-1'), true);

  // Full end-to-end enqueueOutboxEvent + processNotificationOutbox against real Redis
  const call = makeCall({ id: 'call-real-e2e' });
  const targetId = buildTpTargetId(0, 'TP1 (2x)');
  const eventId = buildNotificationEventId(call.id, 'TP', targetId);
  trackedKeys.add(outboxSubsKey(eventId));

  const enq = await enqueueOutboxEvent({
    call,
    triggerType: 'TP',
    targetId,
    targetLabel: 'TP1 (2x)',
    marketCapLabel: '$250.0K',
    nowMs: NOW,
  });
  assert.equal(enq.created, true);

  // Scenario 12: Simulate Redis failure during processNotificationOutbox -> reports operationalFailure: true
  bridgeRejectNext = true;
  const failRes = await processNotificationOutbox({
    now: () => NOW,
    loadSubscribers: async () => ({ WalletRealSub1111111111111111111111111111: '9001' }),
    resolveTier: async () => 'pro',
    sendTelegramMessage: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.operationalFailure, true);
  assert.equal(failRes.incomplete, true);

  // Restore Redis bridge -> processNotificationOutbox recovers, verifies tier, delivers, and finalizes on real Redis
  bridgeRejectNext = false;
  const okRes = await processNotificationOutbox({
    now: () => NOW,
    loadSubscribers: async () => ({ WalletRealSub1111111111111111111111111111: '9001' }),
    resolveTier: async () => 'pro',
    sendTelegramMessage: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.operationalFailure, false);
  assert.equal(okRes.incomplete, false);
  assert.equal(okRes.notificationsSent, 1);
  assert.equal(okRes.notificationsPending, 0);

  const state = await getOutboxEventState(eventId);
  assert.equal(state.event?.status, 'completed');
  assert.equal(state.subscribers['WalletRealSub1111111111111111111111111111']?.status, 'delivered');
  assert.equal(state.subscribers['WalletRealSub1111111111111111111111111111']?.attemptCount, 1);
});

