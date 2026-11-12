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
  kvReserveSubmissionChallenge,
  kvAdvanceSubmissionReservation,
  kvSetLocked,
  kvScan,
  kvSet,
  kvGet,
  RESERVE_SUBMISSION_CHALLENGE_LUA,
  ADVANCE_SUBMISSION_RESERVATION_LUA,
  SAVE_LOCKED_KEY_LUA,
} from '../../src/server/kv.ts';

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

  if (prefix === '+') return { value: headerPayload, nextOffset };
  if (prefix === '-') return { error: new Error(headerPayload), nextOffset };
  if (prefix === ':') return { value: Number(headerPayload), nextOffset };
  if (prefix === '$') {
    const len = Number(headerPayload);
    if (len === -1) return { value: null, nextOffset };
    const end = nextOffset + len;
    if (buf.length < end + 2) return null;
    const str = buf.subarray(nextOffset, end).toString('utf8');
    return { value: str, nextOffset: end + 2 };
  }
  if (prefix === '*') {
    const count = Number(headerPayload);
    if (count === -1) return { value: null, nextOffset };
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
  } catch {}
  if (isWin) {
    const cachedBin = path.join(os.homedir(), '.cache', 'redis-win', 'redis-server.exe');
    if (fs.existsSync(cachedBin)) return cachedBin;
  }
  return null;
}

let redisProc = null;
let redisPort = 0;
let bridgeServer = null;
let bridgePort = 0;
let prevRedisUrl;
let prevRedisToken;
const trackedKeys = new Set();

before(async () => {
  prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  const bin = resolveRedisBinary();
  if (!bin) {
    console.warn('[Real Redis Suite] redis-server binary not found; skipping suite');
    return;
  }

  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  redisPort = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));

  redisProc = spawn(
    bin,
    ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

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
    throw new Error(`Failed to start redis-server on port ${redisPort}`);
  }

  bridgeServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await sendRespCommand(redisPort, args);
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      }
    } catch (err) {
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  await new Promise((resolve) => bridgeServer.listen(0, '127.0.0.1', resolve));
  bridgePort = bridgeServer.address().port;

  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${bridgePort}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'real-redis-test-v28';
});

afterEach(async () => {
  if (redisPort > 0) {
    for (const k of trackedKeys) {
      await sendRespCommand(redisPort, ['DEL', k]).catch(() => {});
    }
    trackedKeys.clear();
  }
});

after(async () => {
  if (prevRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL = prevRedisUrl;
  if (prevRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN = prevRedisToken;

  if (bridgeServer) {
    await new Promise((resolve) => bridgeServer.close(resolve));
  }
  if (redisProc) {
    redisProc.kill();
  }
});

test('Real Redis V2.8 [1/4]: kvReserveSubmissionChallenge atomic creation and conflict rejection (§2)', async () => {
  if (!redisProc) return;

  const challengeId = `v28_test_ch_${crypto.randomBytes(4).toString('hex')}`;
  const resKey = `trench:sub:reservation:${challengeId}`;
  const setKey = 'trench:sub:reservations_set';
  trackedKeys.add(resKey);
  trackedKeys.add(setKey);

  const initialRecord = {
    challengeId,
    campaignId: 'camp-123',
    walletAddress: 'SolanaWallet11111111111111111111111111111111',
    submissionId: 'sub-abc',
    idempotencyKey: `idem-${challengeId}`,
    state: 'RESERVED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptId: 'att-1',
    fencingGeneration: 1,
  };

  // 1. First reservation must succeed
  const first = await kvReserveSubmissionChallenge(
    resKey,
    JSON.stringify(initialRecord),
    600,
    setKey,
    challengeId
  );
  assert.equal(first.created, true, 'First reservation must be created');

  // 2. Second reservation with same key must be rejected
  const second = await kvReserveSubmissionChallenge(
    resKey,
    JSON.stringify({ ...initialRecord, attemptId: 'att-2' }),
    600,
    setKey,
    challengeId
  );
  assert.equal(second.created, false, 'Conflicting reservation must not be created');
  assert.ok(second.submission);
  const parsedExisting = JSON.parse(second.submission);
  assert.equal(parsedExisting.state, 'RESERVED');
  assert.equal(parsedExisting.attemptId, 'att-1');

  // Verify stored payload in real Redis
  const raw = await kvGet(resKey);
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.attemptId, 'att-1');
});

test('Real Redis V2.8 [2/4]: kvAdvanceSubmissionReservation advances lifecycle conditionally (§2)', async () => {
  if (!redisProc) return;

  const challengeId = `v28_test_adv_${crypto.randomBytes(4).toString('hex')}`;
  const resKey = `trench:sub:reservation:${challengeId}`;
  trackedKeys.add(resKey);

  const record = {
    challengeId,
    campaignId: 'camp-456',
    walletAddress: 'SolanaWallet11111111111111111111111111111111',
    submissionId: 'sub-xyz',
    idempotencyKey: `idem-${challengeId}`,
    state: 'RESERVED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptId: 'att-adv',
    fencingGeneration: 1,
  };

  await kvSet(resKey, JSON.stringify(record));

  // 1. Advancing to PERSISTED succeeds
  const adv1 = await kvAdvanceSubmissionReservation(resKey, 'PERSISTED', Date.now(), {
    persistedAt: 12345,
  });
  assert.equal(adv1.ok, true, 'Transition to PERSISTED must succeed');
  assert.equal(adv1.reservation.state, 'PERSISTED');
  assert.equal(adv1.reservation.recoveryMetadata.persistedAt, 12345);

  // 2. Advancing to COMPLETED succeeds
  const adv2 = await kvAdvanceSubmissionReservation(resKey, 'COMPLETED', Date.now());
  assert.equal(adv2.ok, true, 'Transition to COMPLETED must succeed');
  assert.equal(adv2.reservation.state, 'COMPLETED');
});

test('Real Redis V2.8 [3/4]: kvSetLocked enforces lock ownership and fencing generation (§3 & §4)', async () => {
  if (!redisProc) return;

  const dataKey = `trench:test:protected_data_${crypto.randomBytes(4).toString('hex')}`;
  const lockKey = `trench:test:lock_${crypto.randomBytes(4).toString('hex')}`;
  trackedKeys.add(dataKey);
  trackedKeys.add(lockKey);

  const ownerToken = 'worker-owner-token-111';
  const initialFencing = 5;

  // Set up the lock in real Redis with token and fencingGeneration metadata
  await kvSet(lockKey, JSON.stringify({ token: ownerToken, fencingGeneration: initialFencing }));

  // 1. Write with matching ownerToken and valid fencing succeeds
  const write1 = await kvSetLocked(lockKey, dataKey, ownerToken, 'valid-payload-1', initialFencing);
  assert.equal(write1.success, true, 'Write with matching token must succeed');

  // 2. Write with wrong owner token fails
  const writeWrongToken = await kvSetLocked(lockKey, dataKey, 'wrong-token', 'rogue-payload', initialFencing);
  assert.equal(writeWrongToken.success, false, 'Write with wrong token must fail');
  assert.match(writeWrongToken.reason || '', /LOCK_LOST/);

  // 3. Write with mismatched fencing generation fails
  const writeStaleGen = await kvSetLocked(lockKey, dataKey, ownerToken, 'stale-payload', initialFencing + 99);
  assert.equal(writeStaleGen.success, false, 'Write with mismatched fencing generation must fail');
  assert.match(writeStaleGen.reason || '', /FENCING_GENERATION_MISMATCH/);

  // Data remains original
  const currentData = await kvGet(dataKey);
  assert.equal(currentData, 'valid-payload-1');
});

test('Real Redis V2.8 [4/4]: kvScan paginates keyspace in bounded batches (§6)', async () => {
  if (!redisProc) return;

  const prefix = `trench:scan_test_${crypto.randomBytes(4).toString('hex')}:`;
  for (let i = 0; i < 15; i++) {
    const k = `${prefix}item_${i}`;
    trackedKeys.add(k);
    await kvSet(k, `val_${i}`);
  }

  // Scan with pattern
  let cursor = '0';
  const allScanned = [];
  do {
    const [nextCursor, keys] = await kvScan(cursor, `${prefix}*`, 5);
    allScanned.push(...keys);
    cursor = nextCursor;
  } while (cursor !== '0');

  assert.equal(allScanned.length, 15, 'All 15 keys must be discovered across bounded pages');
});
