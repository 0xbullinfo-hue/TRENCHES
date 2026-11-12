/**
 * TRENCHLABS V2.3 Real Redis Atomic Challenge & Cross-Instance Integration Test Suite.
 *
 * Verifies:
 * 1. Execution of the actual Lua script (CONSUME_CHALLENGE_LUA) and kvConsumeChallenge from
 *    src/server/kv.ts against a genuine running redis-server (C Lua 5.1 engine).
 * 2. 20 concurrent atomic consume operations against real Redis.
 * 3. Cross-instance distributed concurrency using independent Node.js OS child processes
 *    connected to the same shared real Redis instance.
 * 4. Deterministic replay response via Redis consumed tombstones.
 * 5. Fail-closed behaviour on Redis outages, timeouts, and malformed responses.
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
import { Keypair } from '@solana/web3.js';
import { NextRequest } from 'next/server';

import {
  kvConsumeChallenge,
  kvGet,
  kvSetEx,
  CONSUME_CHALLENGE_LUA,
} from '../../src/server/kv.ts';
import {
  issueRaidChallenge,
  getRaidChallengeState,
  consumeRaidChallengeOutcome,
  consumeRaidChallenge,
} from '../../src/server/raid-challenges.ts';
import {
  createCampaign,
  deleteCampaign,
  loadCampaigns,
  loadSubmissions,
} from '../../src/server/campaigns-data.ts';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';

// ---------------------------------------------------------------------------
// Real Redis Process & HTTP-to-RESP Bridge
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
let redisVersion = 'unknown';
let bridgeServer = null;
let bridgePort = 0;
let bridgeRejectNext = false;
let bridgeDelayMs = 0;
let bridgeMalformedNext = false;
let prevRedisUrl;
let prevRedisToken;
const trackedKeys = new Set();

function signEd25519(keypair, message) {
  const messageBytes = Buffer.from(message, 'utf-8');
  const sigBytes = crypto.sign(null, messageBytes, {
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(keypair.secretKey.slice(0, 32)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return sigBytes.subarray(sigBytes.length - 64).toString('hex');
}

before(async () => {
  prevRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  prevRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  const bin = resolveRedisBinary();
  if (!bin) {
    throw new Error('Real redis-server binary not found; required for real Redis integration suite.');
  }

  redisPort = await getFreePort();
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

  const info = await sendRespCommand(redisPort, ['INFO', 'server']);
  const verMatch = typeof info === 'string' ? info.match(/redis_version:([^\r\n]+)/) : null;
  redisVersion = verMatch ? verMatch[1] : 'unknown';
  console.log(`[Real Redis Suite] Connected to real redis-server v${redisVersion} on 127.0.0.1:${redisPort}`);

  // HTTP REST bridge for Upstash compatibility
  bridgeServer = http.createServer(async (req, res) => {
    if (bridgeDelayMs > 0) {
      await new Promise((r) => {
        const timer = setTimeout(r, bridgeDelayMs);
        req.on('close', () => {
          clearTimeout(timer);
          r();
        });
      });
      if (req.destroyed) return;
    }
    if (bridgeRejectNext) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Simulated Upstash Redis REST service unavailable' }));
      return;
    }
    if (bridgeMalformedNext) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"result": MALFORMED_JSON_ERROR');
      return;
    }

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
  const addr = bridgeServer.address();
  bridgePort = typeof addr === 'object' && addr ? addr.port : 0;

  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${bridgePort}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'real-redis-test-token-xyz';
});

afterEach(async () => {
  bridgeRejectNext = false;
  bridgeDelayMs = 0;
  bridgeMalformedNext = false;
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
    await new Promise((resolve) => bridgeServer.close(() => resolve()));
  }
  if (redisProc) {
    redisProc.kill();
  }
});

// ---------------------------------------------------------------------------
// Critical Issue B: Real Redis Atomic Verification
// ---------------------------------------------------------------------------

test('Real Redis Atomic [1/8]: First valid consume succeeds on genuine redis-server', async () => {
  const challengeId = `rc_real_first_${crypto.randomBytes(8).toString('hex')}`;
  const key = `raid:challenge:${challengeId}`;
  trackedKeys.add(key);

  const payload = {
    challengeId,
    nonce: 'real_nonce_1',
    campaignId: 'camp_real_1',
    walletAddress: '11111111111111111111111111111111',
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    status: 'pending',
  };
  await kvSetEx(key, JSON.stringify(payload), 300);

  // Execute real Lua script against real Redis
  const outcome = await kvConsumeChallenge(key, Date.now(), 60);
  assert.equal(outcome, 'CONSUMED');

  // Verify real Redis state now holds consumed tombstone
  const stored = await kvGet(key);
  assert.ok(stored);
  const parsed = JSON.parse(stored);
  assert.equal(parsed.status, 'consumed');
  assert.ok(parsed.consumedAt > 0);
  // Authoritative authorization material was stripped
  assert.equal(parsed.nonce, undefined);
  assert.equal(parsed.message, undefined);
});

test('Real Redis Atomic [2/8]: Second consume on genuine redis-server returns ALREADY_CONSUMED', async () => {
  const challengeId = `rc_real_sec_${crypto.randomBytes(8).toString('hex')}`;
  const key = `raid:challenge:${challengeId}`;
  trackedKeys.add(key);

  const payload = {
    challengeId,
    nonce: 'real_nonce_2',
    campaignId: 'camp_real_2',
    walletAddress: '11111111111111111111111111111111',
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    status: 'pending',
  };
  await kvSetEx(key, JSON.stringify(payload), 300);

  const first = await kvConsumeChallenge(key, Date.now(), 60);
  assert.equal(first, 'CONSUMED');

  // Second consume must return ALREADY_CONSUMED
  const second = await kvConsumeChallenge(key, Date.now(), 60);
  assert.equal(second, 'ALREADY_CONSUMED');
});

test('Real Redis Atomic [3/8]: 20 simultaneous consume attempts on genuine redis-server yield exactly one success', async () => {
  const challengeId = `rc_real_20concur_${crypto.randomBytes(8).toString('hex')}`;
  const key = `raid:challenge:${challengeId}`;
  trackedKeys.add(key);

  const payload = {
    challengeId,
    nonce: 'real_nonce_20',
    campaignId: 'camp_real_20',
    walletAddress: '11111111111111111111111111111111',
    createdAt: Date.now(),
    expiresAt: Date.now() + 300000,
    status: 'pending',
  };
  await kvSetEx(key, JSON.stringify(payload), 300);

  // Fire 20 simultaneous atomic consume operations
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(kvConsumeChallenge(key, Date.now(), 60));
  }
  const results = await Promise.all(promises);

  const consumedCount = results.filter((r) => r === 'CONSUMED').length;
  const alreadyConsumedCount = results.filter((r) => r === 'ALREADY_CONSUMED').length;

  assert.equal(consumedCount, 1, 'Exactly one caller must successfully consume the challenge');
  assert.equal(alreadyConsumedCount, 19, 'All other 19 callers must be rejected as ALREADY_CONSUMED');
});

test('Real Redis Atomic [4/8]: Missing key returns NOT_FOUND on genuine redis-server', async () => {
  const missingKey = `raid:challenge:rc_non_existent_${crypto.randomBytes(8).toString('hex')}`;
  const outcome = await kvConsumeChallenge(missingKey, Date.now(), 60);
  assert.equal(outcome, 'NOT_FOUND');
});

test('Real Redis Atomic [5/8]: Expired challenge returns EXPIRED on genuine redis-server', async () => {
  const challengeId = `rc_real_exp_${crypto.randomBytes(8).toString('hex')}`;
  const key = `raid:challenge:${challengeId}`;
  trackedKeys.add(key);

  const past = Date.now() - 50000;
  const payload = {
    challengeId,
    nonce: 'real_exp_nonce',
    campaignId: 'camp_real_exp',
    walletAddress: '11111111111111111111111111111111',
    createdAt: past - 300000,
    expiresAt: past, // Expired
    status: 'pending',
  };
  await kvSetEx(key, JSON.stringify(payload), 300);

  const outcome = await kvConsumeChallenge(key, Date.now(), 60);
  assert.equal(outcome, 'EXPIRED');
});

test('Real Redis Atomic [6/8]: Redis outage fails closed', async () => {
  bridgeRejectNext = true;
  const testKey = 'raid:challenge:rc_outage_test';
  await assert.rejects(
    async () => {
      await kvConsumeChallenge(testKey, Date.now(), 60);
    },
    /KV (HTTP|error)|unavailable/i
  );
});

test('Real Redis Atomic [7/8]: Invalid/malformed Redis response fails closed', async () => {
  bridgeMalformedNext = true;
  const testKey = 'raid:challenge:rc_malformed_test';
  await assert.rejects(
    async () => {
      await kvConsumeChallenge(testKey, Date.now(), 60);
    },
    /SyntaxError|KV HTTP|failed/i
  );
});

test('Real Redis Atomic [8/8]: Redis timeout aborts and fails closed', async () => {
  bridgeDelayMs = 5000; // cmd abort timeout is 4000ms in src/server/kv.ts
  const testKey = 'raid:challenge:rc_timeout_test';
  await assert.rejects(
    async () => {
      await kvConsumeChallenge(testKey, Date.now(), 60);
    },
    /aborted|timeout|fetch failed/i
  );
});

// ---------------------------------------------------------------------------
// Critical Issue C: Cross-Instance Production Testing
// ---------------------------------------------------------------------------

function runInstanceSubmissionWorker(campaignId, challengeId, walletAddress, signature) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      'tests/integration/distributed_submission_worker.mjs',
      campaignId,
      challengeId,
      walletAddress,
      signature,
      '@dist_tester',
      'https://x.com/dist_tester/status/12345',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${bridgePort}`,
        UPSTASH_REDIS_REST_TOKEN: 'real-redis-test-token-xyz',
        ALLOW_FILE_PERSISTENCE: 'true',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"ok"[\s\S]*\}/);
        if (jsonMatch) {
          resolve({ code, data: JSON.parse(jsonMatch[0]) });
        } else {
          resolve({ code, data: JSON.parse(stdout.trim()) });
        }
      } catch (err) {
        resolve({ code, error: err.message, stdout, stderr });
      }
    });
  });
}

test('Cross-Instance Testing: Two independent application instances cannot consume one challenge twice via shared Redis', async () => {
  const camp = await createCampaign({
    title: 'Distributed Cross-Instance Test Campaign',
    description: 'Testing distributed atomicity across separate Node processes sharing real Redis',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/98765',
    rewardAmount: '1,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    postedBy: 'Admin',
  });

  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // 1. Create one valid challenge in shared real Redis
    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    assert.equal(ch.authority, 'redis');
    trackedKeys.add(`raid:challenge:${ch.challengeId}`);

    const sigHex = signEd25519(kp, ch.message);

    // 2. Start Instance A and Instance B simultaneously in independent OS processes
    const [instA, instB] = await Promise.all([
      runInstanceSubmissionWorker(camp.id, ch.challengeId, wallet, sigHex),
      runInstanceSubmissionWorker(camp.id, ch.challengeId, wallet, sigHex),
    ]);

    const statuses = [instA.data?.status, instB.data?.status].sort();

    // 3. Exactly one request returns success (201), the other is rejected (409)
    assert.deepEqual(statuses, [201, 409], 'Exactly one process must succeed with 201 and the other with 409');

    // 4. Inspect the shared Redis state: must be a consumed tombstone
    const redisState = await kvGet(`raid:challenge:${ch.challengeId}`);
    assert.ok(redisState, 'Key must exist as tombstone');
    const parsedState = JSON.parse(redisState);
    assert.equal(parsedState.status, 'consumed', 'Redis must record consumed tombstone');

    // 5. Inspect resulting submission records: exactly one submission must exist
    const submissions = await loadSubmissions();
    const matchingSubs = submissions.filter(
      (s) => s.campaignId === camp.id && s.walletAddress === wallet
    );
    assert.equal(matchingSubs.length, 1, 'Exactly one submission record must exist in persistence');

    // 6. Verify replay attempt from a third instance is also rejected (409)
    const instC = await runInstanceSubmissionWorker(camp.id, ch.challengeId, wallet, sigHex);
    assert.equal(instC.data?.status, 409, 'Replay attempt must be rejected with 409 Conflict');
  } finally {
    await deleteCampaign(camp.id);
  }
});
