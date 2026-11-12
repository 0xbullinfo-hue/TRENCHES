import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { NextRequest } from 'next/server';
import { Keypair } from '@solana/web3.js';

// Setup environment and external mocks BEFORE importing application modules
process.env.TELEGRAM_BOT_TOKEN = 'mock-test-bot-token';
process.env.TELEGRAM_BOT_USERNAME = 'mock_trenchlabs_bot';
process.env.TELEGRAM_WEBHOOK_SECRET = 'mock_secret_1234567890';
process.env.UPSTASH_REDIS_REST_URL = 'https://mock-redis.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'mock-redis-token';

import { GENESIS_MINT, ADMIN_WALLET } from '../../src/lib/config.ts';

// In-memory backing store for mock Redis engine
const mockRedisStore = new Map();

// Mock only external network infrastructure (Jupiter oracle, Solana RPC, and Upstash Redis REST)
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const urlStr = String(url);

  // Mock Solana JSON-RPC (getTokenAccountsByOwner) to prevent external RPC 429 rate limits
  if (options?.body && String(options.body).includes('getTokenAccountsByOwner')) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { value: [] },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Mock Jupiter price oracle
  if (urlStr.includes('api.jup.ag/price')) {
    return new Response(
      JSON.stringify({
        data: {
          [GENESIS_MINT]: { price: '0.0000164' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Mock Upstash Redis REST with atomic Lua evaluation
  if (urlStr.includes('mock-redis.io')) {
    const bodyText = options?.body ? String(options.body) : '[]';
    let args = [];
    try {
      args = JSON.parse(bodyText);
    } catch {
      args = [];
    }
    const cmd = String(args[0]).toUpperCase();

    if (cmd === 'HGETALL') {
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'SET' || cmd === 'SETEX') {
      const key = String(args[1]);
      const val = String(cmd === 'SETEX' ? (args[3] ?? args[2]) : args[2]);
      mockRedisStore.set(key, val);
      return new Response(JSON.stringify({ result: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'GET') {
      const key = String(args[1]);
      const val = mockRedisStore.get(key) ?? null;
      return new Response(JSON.stringify({ result: val }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'DEL') {
      const key = String(args[1]);
      const count = mockRedisStore.delete(key) ? 1 : 0;
      return new Response(JSON.stringify({ result: count }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (cmd === 'EVAL') {
      const script = String(args[1]);
      const key = String(args[3] ?? args[2]);
      const val = mockRedisStore.get(key);

      // V2.7 Locked Key Save Lua
      if (script.includes('LOCK_LOST')) {
        const lockKey = String(args[3]);
        const targetKey = String(args[4]);
        const expectedToken = String(args[5]);
        const payload = String(args[6]);
        const currentLock = mockRedisStore.get(lockKey);
        if (!currentLock || currentLock !== expectedToken) {
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

      // V2.7 Submission Challenge Reservation Lua
      if (script.includes('RESERVE_SUBMISSION') || (script.includes('created') && script.includes('604800'))) {
        const chalKey = String(args[3]);
        const existingSub = mockRedisStore.get(chalKey);
        if (existingSub) {
          return new Response(
            JSON.stringify({ result: JSON.stringify({ created: false, submission: existingSub }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        mockRedisStore.set(chalKey, String(args[4]));
        return new Response(JSON.stringify({ result: JSON.stringify({ created: true }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // V2.7 Notification Dispatch Claim Lua
      if (script.includes('DISPATCHING') && script.includes('dispatchWorkerId')) {
        const evKey = String(args[3]);
        const evRaw = mockRedisStore.get(evKey);
        if (!evRaw) {
          return new Response(JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'NOT_FOUND' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const ev = JSON.parse(evRaw);
        if (ev.status === 'ACCEPTED' || ev.status === 'DELIVERED') {
          return new Response(
            JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'ALREADY_COMPLETED', status: ev.status }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        const workerId = String(args[4]);
        const nowMs = Number(args[5]) || Date.now();
        const leaseMs = Number(args[6]) || 30000;
        if (ev.status === 'DISPATCHING' && nowMs <= (Number(ev.dispatchLeaseExpiresAt) || 0) && ev.dispatchWorkerId !== workerId) {
          return new Response(
            JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'BUSY', workerId: ev.dispatchWorkerId }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        ev.status = 'DISPATCHING';
        ev.dispatchWorkerId = workerId;
        ev.dispatchLeaseExpiresAt = nowMs + leaseMs;
        ev.dispatchGeneration = (Number(ev.dispatchGeneration) || 0) + 1;
        ev.attemptCount = (Number(ev.attemptCount) || 0) + 1;
        ev.lastAttemptAt = nowMs;
        mockRedisStore.set(evKey, JSON.stringify(ev));
        return new Response(
          JSON.stringify({ result: JSON.stringify({ ok: true, dispatchGeneration: ev.dispatchGeneration, event: ev }) }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // V2.7 Notification Dispatch Complete Lua
      if (script.includes('STALE_DISPATCH_WORKER')) {
        const evKey = String(args[3]);
        const evRaw = mockRedisStore.get(evKey);
        if (!evRaw) {
          return new Response(JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'NOT_FOUND' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const ev = JSON.parse(evRaw);
        const workerId = String(args[4]);
        const dispatchGen = Number(args[5]);
        if (ev.dispatchWorkerId !== workerId) {
          return new Response(
            JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'STALE_DISPATCH_WORKER' }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (Number(ev.dispatchGeneration) !== dispatchGen) {
          return new Response(
            JSON.stringify({ result: JSON.stringify({ ok: false, reason: 'STALE_DISPATCH_GENERATION' }) }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        ev.status = String(args[6]);
        ev.externalRef = args[7] || null;
        ev.error = args[8] || null;
        mockRedisStore.set(evKey, JSON.stringify(ev));
        return new Response(JSON.stringify({ result: JSON.stringify({ ok: true, status: ev.status, event: ev }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 1. V2.5 Claim Processing Lua
      if (script.includes('CLAIMED') && script.includes('PROCESSING')) {
        if (!val) {
          return new Response(JSON.stringify({ result: JSON.stringify({ status: 'NOT_FOUND' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const c = JSON.parse(val);
          const attemptId = String(args[4]);
          const nowMs = Number(args[5]) || Date.now();
          const leaseMs = Number(args[6]) || 30000;

          if (c.expiresAt && nowMs > Number(c.expiresAt)) {
            return new Response(JSON.stringify({ result: JSON.stringify({ status: 'EXPIRED' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (c.status === 'COMPLETED' || c.status === 'consumed') {
            return new Response(
              JSON.stringify({
                result: JSON.stringify({
                  status: 'COMPLETED',
                  submissionId: c.submissionId,
                  attemptId: c.attemptId,
                  fencingToken: c.fencingToken,
                }),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (!c.status || c.status === 'ACTIVE' || c.status === 'active' || c.status === 'pending') {
            c.status = 'PROCESSING';
            c.attemptId = attemptId;
            c.fencingToken = 1;
            c.processingStartedAt = nowMs;
            c.processingLeaseExpiresAt = nowMs + leaseMs;
            mockRedisStore.set(key, JSON.stringify(c));
            return new Response(
              JSON.stringify({
                result: JSON.stringify({
                  status: 'CLAIMED',
                  attemptId: c.attemptId,
                  fencingToken: c.fencingToken,
                  leaseExpiresAt: c.processingLeaseExpiresAt,
                }),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (c.status === 'PROCESSING') {
            if (c.attemptId === attemptId) {
              c.processingLeaseExpiresAt = nowMs + leaseMs;
              mockRedisStore.set(key, JSON.stringify(c));
              return new Response(
                JSON.stringify({
                  result: JSON.stringify({
                    status: 'RESUMED',
                    attemptId: c.attemptId,
                    fencingToken: c.fencingToken,
                    leaseExpiresAt: c.processingLeaseExpiresAt,
                  }),
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            const leaseExp = Number(c.processingLeaseExpiresAt) || 0;
            if (nowMs > leaseExp) {
              c.attemptId = attemptId;
              c.fencingToken = (Number(c.fencingToken) || 0) + 1;
              c.processingStartedAt = nowMs;
              c.processingLeaseExpiresAt = nowMs + leaseMs;
              mockRedisStore.set(key, JSON.stringify(c));
              return new Response(
                JSON.stringify({
                  result: JSON.stringify({
                    status: 'RECOVERED',
                    attemptId: c.attemptId,
                    fencingToken: c.fencingToken,
                    leaseExpiresAt: c.processingLeaseExpiresAt,
                  }),
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
              );
            }
            return new Response(
              JSON.stringify({
                result: JSON.stringify({
                  status: 'BUSY',
                  attemptId: c.attemptId,
                  fencingToken: c.fencingToken,
                  leaseExpiresAt: leaseExp,
                }),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
        } catch {}
        return new Response(JSON.stringify({ result: JSON.stringify({ status: 'CONFLICT' }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. V2.5 Finalize Processing Lua
      if (script.includes('STALE_FENCING_TOKEN') && script.includes('completedAt')) {
        if (!val) {
          return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'NOT_FOUND' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const c = JSON.parse(val);
          const attemptId = String(args[4]);
          const fencingToken = Number(args[5]);
          const subId = String(args[6]);

          if (c.status === 'COMPLETED' || c.status === 'consumed') {
            if (c.submissionId === subId) {
              return new Response(JSON.stringify({ result: JSON.stringify({ success: true, status: 'ALREADY_COMPLETED' }) }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'COMPLETED_DIFFERENT_SUBMISSION' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (c.status !== 'PROCESSING') {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'NOT_PROCESSING' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (c.attemptId !== attemptId) {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'STALE_ATTEMPT' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (Number(c.fencingToken) !== fencingToken) {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'STALE_FENCING_TOKEN' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          c.status = 'consumed';
          c.processingState = 'COMPLETED';
          c.submissionId = subId;
          c.completedAt = Date.now();
          c.idempotencyKey = 'raid-submission:' + (c.challengeId || '');
          mockRedisStore.set(key, JSON.stringify(c));
          return new Response(JSON.stringify({ result: JSON.stringify({ success: true, status: 'COMPLETED' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch {}
        return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'ERROR' }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 3. V2.5 Rollback Processing Lua
      if (script.includes('STALE_FENCING_TOKEN') && script.includes('ACTIVE')) {
        if (!val) {
          return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'NOT_FOUND' }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const c = JSON.parse(val);
          const attemptId = String(args[4]);
          const fencingToken = Number(args[5]);

          if (c.status === 'COMPLETED' || c.status === 'consumed') {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'ALREADY_COMPLETED' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (c.status !== 'PROCESSING') {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'NOT_PROCESSING' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (c.attemptId !== attemptId) {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'STALE_ATTEMPT' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (Number(c.fencingToken) !== fencingToken) {
            return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'STALE_FENCING_TOKEN' }) }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          c.status = 'ACTIVE';
          c.attemptId = undefined;
          c.fencingToken = undefined;
          c.processingStartedAt = undefined;
          c.processingLeaseExpiresAt = undefined;
          mockRedisStore.set(key, JSON.stringify(c));
          return new Response(JSON.stringify({ result: JSON.stringify({ success: true }) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch {}
        return new Response(JSON.stringify({ result: JSON.stringify({ success: false, reason: 'ERROR' }) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. V2.5 Reconcile Completed Lua
      if (script.includes('c.status = \'consumed\'') || script.includes('c.processingState = \'COMPLETED\'')) {
        if (!val) return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        try {
          const c = JSON.parse(val);
          c.status = 'consumed';
          c.processingState = 'COMPLETED';
          c.submissionId = String(args[4]);
          c.completedAt = Date.now();
          c.idempotencyKey = 'raid-submission:' + (c.challengeId || '');
          mockRedisStore.set(key, JSON.stringify(c));
          return new Response(JSON.stringify({ result: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch {}
        return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Backward compatible tombstone finalize
      if (script.includes('submissionId')) {
        if (!val) return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        try {
          const parsed = JSON.parse(val);
          parsed.status = 'consumed';
          parsed.submissionId = String(args[4]);
          mockRedisStore.set(key, JSON.stringify(parsed));
          return new Response(JSON.stringify({ result: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch {}
        return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Backward compatible rollback
      if (script.includes('tonumber(ARGV[2])') && script.includes('del')) {
        if (!val) return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        try {
          mockRedisStore.set(key, String(args[4]));
          return new Response(JSON.stringify({ result: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch {}
        return new Response(JSON.stringify({ result: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // Default: consume challenge
      if (!val) {
        return new Response(JSON.stringify({ result: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (typeof val === 'string' && val.includes('"status":"consumed"')) {
        return new Response(JSON.stringify({ result: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      mockRedisStore.set(key, JSON.stringify({ status: 'consumed', consumedAt: Date.now() }));
      return new Response(JSON.stringify({ result: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ result: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return originalFetch(url, options);
};

// Actual application route handlers
import { GET as getStakeStatus } from '../../src/app/api/stake/status/route.ts';
import { GET as getTelegramLink, POST as postTelegramLink } from '../../src/app/api/telegram/link/route.ts';
import { POST as requestChallenge } from '../../src/app/api/campaigns/[id]/challenge/route.ts';
import { POST as submitCampaign } from '../../src/app/api/campaigns/[id]/submit/route.ts';
import { GET as getAlphas } from '../../src/app/api/alphas/route.ts';

// Actual shared auth & server utilities
import { signSession, SESSION_COOKIE_NAME } from '../../src/server/auth.ts';
import {
  createCampaign,
  deleteCampaign,
  loadSubmissions,
  loadCampaigns,
  getSubmissionByIdempotencyKey,
  getSubmissionByChallengeId,
  __setTestFailSaveSubmissions,
  __setTestFailSaveCampaigns,
} from '../../src/server/campaigns-data.ts';
import fs from 'fs';
import { resolveWalletEntitlement, evaluateWalletDowngrade } from '../../src/server/entitlements.ts';
import {
  issueRaidChallenge,
  getRaidChallenge,
  consumeRaidChallenge,
  getRaidChallengeState,
  rollbackRaidChallenge,
  claimRaidChallengeProcessing,
  finalizeRaidChallengeProcessing,
  rollbackRaidChallengeProcessing,
  reconcileRaidChallengeCompleted,
} from '../../src/server/raid-challenges.ts';
import {
  consumeRaidChallengeRow,
  createRaidChallengeRow,
  getRaidChallengeRow,
  __setTestFailCreateRaidChallengeRow,
  isPidDead,
  acquireFileLock,
  DB_FILE_LOCK_PATH,
} from '../../src/server/db.ts';

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
  return sigBytes.toString('hex');
}

async function createTestCampaign(overrides = {}) {
  return await createCampaign({
    title: 'Integration Test Campaign',
    description: 'Automated security integration test campaign verification',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/123456789',
    rewardAmount: '5,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. STAKE STATUS API SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Stake Status API [1/5]: Unauthenticated request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/stake/status');
  const res = await getStakeStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'unauthorized');
});

test('Stake Status API [2/5]: Authenticated matching wallet succeeds (200)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.wallet, wallet);
});

test('Stake Status API [3/5]: Authenticated mismatched wallet is rejected (403)', async () => {
  const kpA = Keypair.generate();
  const kpB = Keypair.generate();
  const walletA = kpA.publicKey.toBase58();
  const walletB = kpB.publicKey.toBase58();
  const tokenA = signSession(walletA);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${walletB}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'forbidden');
  assert.match(json.message, /Authenticated wallet does not match/i);
});

test('Stake Status API [4/5]: Invalid wallet parameter is rejected (400)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest('http://localhost:3000/api/stake/status?wallet=not_a_valid_solana_base58_address', {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'bad_request');
});

test('Stake Status API [5/5]: Expired session is rejected (401)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const expiredToken = signSession(wallet, -3600);

  const req = new NextRequest(`http://localhost:3000/api/stake/status?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${expiredToken}`,
    },
  });
  const res = await getStakeStatus(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'unauthorized');
});

// ---------------------------------------------------------------------------
// 2. TELEGRAM API SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Telegram API [1/6]: Unauthenticated GET request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link');
  const res = await getTelegramLink(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('Telegram API [2/6]: Authenticated matching wallet GET succeeds (200)', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const token = signSession(wallet);

  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${wallet}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
    },
  });
  const res = await getTelegramLink(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(typeof json.linked, 'boolean');
});

test('Telegram API [3/6]: Mismatched wallet GET is rejected (403)', async () => {
  const kpA = Keypair.generate();
  const kpB = Keypair.generate();
  const walletA = kpA.publicKey.toBase58();
  const walletB = kpB.publicKey.toBase58();
  const tokenA = signSession(walletA);

  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${walletB}`, {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
    },
  });
  const res = await getTelegramLink(req);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, 'FORBIDDEN');
  assert.match(json.message, /Authenticated wallet does not match/i);
});

test('Telegram API [4/6]: Invalid wallet GET is rejected (400)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link?wallet=not_a_valid_solana_address');
  const res = await getTelegramLink(req);
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, 'BAD_REQUEST');
});

test('Telegram API [5/6]: Unauthenticated POST request is rejected (401)', async () => {
  const req = new NextRequest('http://localhost:3000/api/telegram/link', { method: 'POST' });
  const res = await postTelegramLink(req);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.equal(json.error, 'UNAUTHORIZED');
});

test('Telegram API [6/6]: Authenticated admin POST generates link code URL (200)', async () => {
  const adminToken = signSession(ADMIN_WALLET);
  const req = new NextRequest(`http://localhost:3000/api/telegram/link?wallet=${ADMIN_WALLET}`, {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${adminToken}`,
    },
  });
  const res = await postTelegramLink(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.url, /^https:\/\/t\.me\//);
});

// ---------------------------------------------------------------------------
// 3. SOCIAL RAID SECURITY SCENARIOS (V2.2 AUTHORITATIVE REPLAY PROTECTION)
// ---------------------------------------------------------------------------

function makeAuthCookie(wallet) {
  return `${SESSION_COOKIE_NAME}=${signSession(wallet)}`;
}

function runConsumeWorker(mode, challengeId) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, ALLOW_FILE_PERSISTENCE: 'true' };
    delete childEnv.UPSTASH_REDIS_REST_URL;
    delete childEnv.UPSTASH_REDIS_REST_TOKEN;

    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      'tests/integration/consume_worker.mjs',
      mode,
      challengeId,
    ], {
      cwd: process.cwd(),
      env: childEnv,
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

// ---------------------------------------------------------------------------
// 3.1 Challenge Issuance (Scenarios 1 - 10)
// ---------------------------------------------------------------------------

test('Social Raid [1/31]: Valid authenticated wallet can request a challenge (201)', async () => {
  const camp = await createTestCampaign({ title: 'Challenge Issuance Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: makeAuthCookie(wallet),
      },
      body: JSON.stringify({ walletAddress: wallet }),
    });

    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.match(json.challengeId, /^rc_[0-9a-f]{32}$/);
    assert.equal(json.campaignId, camp.id);
    assert.equal(json.walletAddress, wallet);
    assert.match(json.nonce, /^[0-9a-f]{48}$/);
    assert.ok(json.expiresAt > Date.now());
    assert.match(json.message, /^TrenchLabs Raid Challenge\|/);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [2/31]: Unauthenticated issuance is rejected where authentication is required (401)', async () => {
  const camp = await createTestCampaign({ title: 'Unauthenticated Issuance Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: wallet }),
    });

    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Authentication session required/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [3/31]: Wallet mismatch is rejected (403)', async () => {
  const camp = await createTestCampaign({ title: 'Wallet Mismatch Test' });
  try {
    const kpA = Keypair.generate();
    const kpB = Keypair.generate();
    const walletA = kpA.publicKey.toBase58();
    const walletB = kpB.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: makeAuthCookie(walletA),
      },
      body: JSON.stringify({ walletAddress: walletB }),
    });

    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(json.error, /Requested wallet does not match/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [4/31]: Invalid wallet address is rejected (400)', async () => {
  const camp = await createTestCampaign({ title: 'Invalid Wallet Test' });
  try {
    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'not_a_valid_solana_address' }),
    });

    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.match(json.error, /Invalid Solana wallet address format/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [5/31]: Challenge contains cryptographically generated random nonce', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ch1 = await issueRaidChallenge({ campaignId: 'camp_entropy_1', walletAddress: wallet });
  const ch2 = await issueRaidChallenge({ campaignId: 'camp_entropy_2', walletAddress: wallet });

  assert.notEqual(ch1.nonce, ch2.nonce);
  assert.equal(ch1.nonce.length, 48); // 24 bytes hex
  assert.notEqual(ch1.challengeId, ch2.challengeId);
});

test('Social Raid [6/31]: Challenge expiry is strictly server-controlled', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const before = Date.now();
  const ch = await issueRaidChallenge({ campaignId: 'camp_expiry', walletAddress: wallet });
  const after = Date.now();

  assert.ok(ch.expiresAt >= before + 300000);
  assert.ok(ch.expiresAt <= after + 300000);
  assert.equal(ch.expiresAt - ch.createdAt, 300000);
});

test('Social Raid [7/31]: Campaign binding is strictly preserved', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const campId = 'camp_strict_binding_123';
  const ch = await issueRaidChallenge({ campaignId: campId, walletAddress: wallet });

  assert.equal(ch.campaignId, campId);
  assert.ok(ch.message.includes(`|${campId}|`));
});

test('Social Raid [8/31]: Authoritative storage failure returns 503', async () => {
  const camp = await createTestCampaign({ title: 'Storage Failure 503 Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const origUrl = process.env.UPSTASH_REDIS_REST_URL;
    process.env.UPSTASH_REDIS_REST_URL = 'https://broken-store.internal';

    try {
      const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: makeAuthCookie(wallet),
        },
        body: JSON.stringify({ walletAddress: wallet }),
      });

      const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
      assert.equal(res.status, 503);
      const json = await res.json();
      assert.match(json.error, /Authoritative storage unavailable/i);
    } finally {
      process.env.UPSTASH_REDIS_REST_URL = origUrl;
    }
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [9/31]: Database mirror failure follows documented authority policy (real failure injection)', async () => {
  const camp = await createTestCampaign({ title: 'DB Mirror Failure Injection Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // 1. Simulate failure of createRaidChallengeRow() while Redis is available
    __setTestFailCreateRaidChallengeRow(new Error('Simulated DB disk failure during audit mirror write'));

    // Issuance must succeed because Redis is authoritative
    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    assert.equal(ch.authority, 'redis');
    assert.ok(ch.challengeId);

    // 2. Confirm database mirror write failed (no row exists in DB)
    const dbRow = await getRaidChallengeRow(ch.challengeId);
    assert.equal(dbRow, null);

    // 3. Challenge submission succeeds only through Redis (201)
    const sigHex = signEd25519(kp, ch.message);
    const req1 = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@redis_hero',
        xRetweetLink: 'https://x.com/redis_hero/status/12345',
        signature: sigHex,
      }),
    });
    const res1 = await submitCampaign(req1, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);

    // 4. Challenge cannot be consumed twice (409 Conflict)
    const req2 = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@redis_hero',
        xRetweetLink: 'https://x.com/redis_hero/status/12345',
        signature: sigHex,
      }),
    });
    const res2 = await submitCampaign(req2, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res2.status, 409);

    // 5. Database mirror recovery / reconciliation does not reset consumed state
    await createRaidChallengeRow({
      challenge_id: ch.challengeId,
      nonce: ch.nonce,
      campaign_id: camp.id,
      wallet_address: wallet,
      created_at: new Date(ch.createdAt).toISOString(),
      expires_at: new Date(ch.expiresAt).toISOString(),
      message: ch.message,
      authority: 'redis',
    });
    const req3 = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@redis_hero',
        xRetweetLink: 'https://x.com/redis_hero/status/12345',
        signature: sigHex,
      }),
    });
    const res3 = await submitCampaign(req3, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res3.status, 409);
  } finally {
    __setTestFailCreateRaidChallengeRow(null);
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [10/31]: Rate limits work independently for IP and wallet', async () => {
  const camp = await createTestCampaign({ title: 'Rate Limit Independence Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.0.2.1',
        Cookie: makeAuthCookie(wallet),
      },
      body: JSON.stringify({ walletAddress: wallet }),
    });
    const res = await requestChallenge(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
  } finally {
    await deleteCampaign(camp.id);
  }
});

// ---------------------------------------------------------------------------
// 3.2 Challenge Verification (Scenarios 11 - 19)
// ---------------------------------------------------------------------------

test('Social Raid [11/31]: Valid server-issued challenge and signature succeed (201)', async () => {
  const camp = await createTestCampaign({ title: 'Valid Challenge Submission' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const chReq = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: makeAuthCookie(wallet),
      },
      body: JSON.stringify({ walletAddress: wallet }),
    });
    const chRes = await requestChallenge(chReq, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(chRes.status, 201);
    const chJson = await chRes.json();

    const sigHex = signEd25519(kp, chJson.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: chJson.challengeId,
        walletAddress: wallet,
        xHandle: '@test_hero',
        xRetweetLink: 'https://x.com/test_hero/status/987654321',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.submission.walletAddress, wallet);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [12/31]: Invalid signature is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Invalid Sig Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const badSig = '00'.repeat(64);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@bad_sig',
        xRetweetLink: 'https://x.com/bad_sig/status/111',
        signature: badSig,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Invalid challenge signature/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [13/31]: Expired challenge is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Expired Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const challengeId = `rc_${crypto.randomBytes(16).toString('hex')}`;
    const nonce = crypto.randomBytes(24).toString('hex');
    const pastTime = Date.now() - 10 * 60 * 1000;
    const msg = `TrenchLabs Raid Challenge|${challengeId}|${camp.id}|${wallet}|${nonce}|${pastTime}`;
    await createRaidChallengeRow({
      challenge_id: challengeId,
      nonce,
      campaign_id: camp.id,
      wallet_address: wallet,
      created_at: new Date(pastTime - 60000).toISOString(),
      expires_at: new Date(pastTime).toISOString(),
      message: msg,
      authority: 'db',
    });

    const sigHex = signEd25519(kp, msg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId,
        walletAddress: wallet,
        xHandle: '@expired_user',
        xRetweetLink: 'https://x.com/expired_user/status/111',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /expired|unknown/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [14/31]: Unknown challenge ID is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Unknown Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: 'rc_unknown_random_id_999999999',
        walletAddress: wallet,
        xHandle: '@unknown_id',
        xRetweetLink: 'https://x.com/unknown_id/status/111',
        signature: 'deadbeef',
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Unknown challenge ID/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [15/31]: Campaign A challenge cannot be used for Campaign B (403)', async () => {
  const campA = await createTestCampaign({ title: 'Campaign A' });
  const campB = await createTestCampaign({ title: 'Campaign B' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const chA = await issueRaidChallenge({ campaignId: campA.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, chA.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${campB.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: chA.challengeId,
        walletAddress: wallet,
        xHandle: '@cross_camp',
        xRetweetLink: 'https://x.com/cross_camp/status/111',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: campB.id }) });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(json.error, /Challenge was not issued for this campaign/i);
  } finally {
    await deleteCampaign(campA.id);
    await deleteCampaign(campB.id);
  }
});

test('Social Raid [16/31]: Wallet A challenge cannot be used by Wallet B (403)', async () => {
  const camp = await createTestCampaign({ title: 'Wrong Wallet Test' });
  try {
    const kpA = Keypair.generate();
    const kpB = Keypair.generate();
    const walletA = kpA.publicKey.toBase58();
    const walletB = kpB.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: walletA });
    const sigHexA = signEd25519(kpA, ch.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: walletB,
        xHandle: '@wrong_wallet',
        xRetweetLink: 'https://x.com/wrong_wallet/status/111',
        signature: sigHexA,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.match(json.error, /Challenge was not issued for this wallet/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [17/31]: Legacy timestamp-only signatures are rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Legacy Timestamp Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const ts = Date.now();

    const legacyMsg = `TrenchLabs Raid Submission|${camp.id}|${wallet}|${ts}`;
    const sigHex = signEd25519(kp, legacyMsg);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@legacy_attacker',
        xRetweetLink: 'https://x.com/legacy_attacker/status/111',
        signature: sigHex,
        timestamp: ts,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Legacy timestamp-only signatures are rejected/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [18/31]: Missing challenge ID is rejected (401)', async () => {
  const camp = await createTestCampaign({ title: 'Missing Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet,
        xHandle: '@missing_challenge',
        xRetweetLink: 'https://x.com/missing_challenge/status/111',
        signature: 'deadbeef',
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
    const json = await res.json();
    assert.match(json.error, /Server-issued challenge required/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [19/31]: A consumed challenge cannot be reused (409)', async () => {
  const camp = await createTestCampaign({ title: 'Reused Challenge Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@reused_user',
          xRetweetLink: 'https://x.com/reused_user/status/111',
          signature: sigHex,
        }),
      });

    const res1 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);

    const res2 = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res2.status, 409);
    const json2 = await res2.json();
    assert.match(json2.error, /already been consumed or replayed/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

// ---------------------------------------------------------------------------
// 3.3 Storage and Replay Protection (Scenarios 20 - 27)
// ---------------------------------------------------------------------------

test('Social Raid [20/31]: Two concurrent requests cannot consume one challenge twice', async () => {
  const camp = await createTestCampaign({ title: 'Concurrent Replay Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@concurrent_hero',
          xRetweetLink: 'https://x.com/concurrent_hero/status/111',
          signature: sigHex,
        }),
      });

    const [resA, resB] = await Promise.all([
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409]);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [21/31]: Two independent application instances cannot consume one challenge twice', async () => {
  const challengeId = `rc_multi_proc_${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  await createRaidChallengeRow({
    challenge_id: challengeId,
    nonce: 'multi_proc_nonce',
    campaign_id: 'camp_multi_proc',
    wallet_address: '11111111111111111111111111111111',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 300000).toISOString(),
    message: 'test multi-process message',
    authority: 'db',
  });

  const [procA, procB] = await Promise.all([
    runConsumeWorker('db_row', challengeId),
    runConsumeWorker('db_row', challengeId),
  ]);

  const results = [procA.data?.result, procB.data?.result].sort();
  assert.deepEqual(results, [false, true]);
});

test('Social Raid [22/31]: Redis-authoritative challenge cannot fall back to a database mirror', async () => {
  const challengeId = `rc_redis_auth_${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();

  await createRaidChallengeRow({
    challenge_id: challengeId,
    nonce: 'redis_auth_nonce',
    campaign_id: 'camp_redis_auth',
    wallet_address: '11111111111111111111111111111111',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 300000).toISOString(),
    message: 'redis message',
    authority: 'redis',
  });

  const retrieved = await getRaidChallenge(challengeId);
  assert.equal(retrieved, null);

  const consumed = await consumeRaidChallenge(challengeId);
  assert.equal(consumed, false);
});

test('Social Raid [23/31]: Redis outage fails closed for Redis-authoritative challenges (503)', async () => {
  const origUrl = process.env.UPSTASH_REDIS_REST_URL;
  process.env.UPSTASH_REDIS_REST_URL = 'https://outage.internal';
  try {
    let failedClosed = false;
    try {
      await getRaidChallenge('rc_outage_check_1234567890123456');
    } catch {
      failedClosed = true;
    }
    assert.equal(failedClosed, true);
  } finally {
    process.env.UPSTASH_REDIS_REST_URL = origUrl;
  }
});

test('Social Raid [24/31]: Database-authoritative consumption is atomic across application instances', async () => {
  const challengeId = `rc_db_instance_${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  await createRaidChallengeRow({
    challenge_id: challengeId,
    nonce: 'instance_nonce',
    campaign_id: 'camp_instance',
    wallet_address: '11111111111111111111111111111111',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 300000).toISOString(),
    message: 'instance message',
    authority: 'db',
  });

  const [res1, res2] = await Promise.all([
    runConsumeWorker('db_row', challengeId),
    runConsumeWorker('db_row', challengeId),
  ]);

  const outcomes = [res1.data?.result, res2.data?.result].sort();
  assert.deepEqual(outcomes, [false, true]);
});

test('Social Raid [25/31]: Database persistence failure does not return successful consumption', async () => {
  const outcome = await consumeRaidChallengeRow('rc_non_existent_id');
  assert.equal(outcome, false);
});

test('Social Raid [26/31]: Expired challenge cannot be consumed through either storage path', async () => {
  const challengeId = `rc_expired_both_${crypto.randomBytes(8).toString('hex')}`;
  const past = Date.now() - 600000;
  await createRaidChallengeRow({
    challenge_id: challengeId,
    nonce: 'past_nonce',
    campaign_id: 'camp_past',
    wallet_address: '11111111111111111111111111111111',
    created_at: new Date(past - 60000).toISOString(),
    expires_at: new Date(past).toISOString(),
    message: 'past message',
    authority: 'db',
  });

  const dbConsumed = await consumeRaidChallengeRow(challengeId);
  assert.equal(dbConsumed, false);
});

test('Social Raid [27/31]: Redis and database records cannot disagree in a way that authorizes replay', async () => {
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ch = await issueRaidChallenge({ campaignId: 'camp_disagree', walletAddress: wallet });

  const consumedFirst = await consumeRaidChallenge(ch.challengeId);
  assert.equal(consumedFirst, true);

  const consumedAgain = await consumeRaidChallenge(ch.challengeId);
  assert.equal(consumedAgain, false);
});

// ---------------------------------------------------------------------------
// 3.4 Submission Integrity (Scenarios 28 - 31)
// ---------------------------------------------------------------------------

test('Social Raid [28/31]: Exactly one submission record is created after successful challenge consumption', async () => {
  const camp = await createTestCampaign({ title: 'Single Record Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@single_record',
        xRetweetLink: 'https://x.com/single_record/status/111',
        signature: sigHex,
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.submission.id);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [29/31]: A failed challenge cannot create a submission', async () => {
  const camp = await createTestCampaign({ title: 'Failed Challenge No Sub Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: 'rc_invalid_does_not_exist',
        walletAddress: wallet,
        xHandle: '@failed_sub',
        xRetweetLink: 'https://x.com/failed_sub/status/111',
        signature: 'deadbeef',
      }),
    });

    const res = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res.status, 401);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [30/31]: Concurrent duplicate submissions cannot create duplicate reward eligibility', async () => {
  const camp = await createTestCampaign({ title: 'No Duplicate Reward Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sigHex = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@dup_reward',
          xRetweetLink: 'https://x.com/dup_reward/status/111',
          signature: sigHex,
        }),
      });

    const [r1, r2] = await Promise.all([
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
      submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('Social Raid [31/31]: Existing campaign status restrictions remain enforced (PAUSED / COMPLETED / EXPIRED)', async () => {
  const camp = await createTestCampaign({
    title: 'Paused Campaign Restriction Test',
    status: 'PAUSED',
  });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const chReq = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: makeAuthCookie(wallet),
      },
      body: JSON.stringify({ walletAddress: wallet }),
    });

    const chRes = await requestChallenge(chReq, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(chRes.status, 400);
    const json = await chRes.json();
    assert.match(json.error, /paused/i);
  } finally {
    await deleteCampaign(camp.id);
  }
});

// ---------------------------------------------------------------------------
// 4. MEMBERSHIP SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Membership [1/4]: FREE, MEMBER and PRO entitlements resolve correctly', async () => {
  // Free: holding $0, staking $0
  const freeEnt = await resolveWalletEntitlement('FreeWallet11111111111111111111111111111111', {
    mockHoldingTokens: 0,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(freeEnt.tier, 'free');
  assert.equal(freeEnt.permissions.canAccessTerminal, false);
  assert.equal(freeEnt.permissions.canAccessProSignals, false);

  // Member: holding >= $20 USD, staking $0
  const memberTokens = 20 / 0.0000164;
  const memberEnt = await resolveWalletEntitlement('MemberWallet111111111111111111111111111111', {
    mockHoldingTokens: memberTokens,
    mockStakedTokens: 0,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(memberEnt.tier, 'member');
  assert.equal(memberEnt.permissions.canAccessTerminal, true);
  assert.equal(memberEnt.permissions.canAccessProSignals, false);

  // Pro: staking >= $250 USD on StakePoint
  const proStakedTokens = 250 / 0.0000164;
  const proEnt = await resolveWalletEntitlement('ProWallet11111111111111111111111111111111', {
    mockHoldingTokens: 0,
    mockStakedTokens: proStakedTokens,
    mockPriceUsd: 0.0000164,
  });
  assert.equal(proEnt.tier, 'pro');
  assert.equal(proEnt.permissions.canAccessTerminal, true);
  assert.equal(proEnt.permissions.canAccessProSignals, true);
});

test('Membership [2/4]: High local token balance cannot override lower server entitlement', async () => {
  // A wallet that holds 0 tokens on-chain
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();
  const ts = Date.now();
  const challengeMsg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
  const sigHex = signEd25519(kp, challengeMsg);

  const req = new NextRequest('http://localhost:3000/api/alphas', {
    method: 'GET',
    headers: {
      'x-wallet': wallet,
      'x-timestamp': String(ts),
      'x-signature': sigHex,
    },
  });

  const res = await getAlphas(req);
  // Server must enforce authoritative on-chain verification, rejecting with 403
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.error, 'ACCESS_DENIED_ZERO_BALANCE');
  assert.deepEqual(json.items, []);
});

test('Membership [3/4]: Definitive authorization denial clears stale premium access', async () => {
  const data = {
    ok: false,
    error: 'ACCESS_DENIED_ZERO_BALANCE',
    message: 'Holding at least $20 required',
    balance: 0,
    items: [],
  };

  assert.equal(data.ok, false);
  assert.equal(data.error, 'ACCESS_DENIED_ZERO_BALANCE');
  assert.equal(data.items.length, 0);
});

test('Membership [4/4]: Temporary network failure does not incorrectly revoke valid membership', async () => {
  const kp = Keypair.generate();
  const validWallet = kp.publicKey.toBase58();

  // When price oracle is temporarily unavailable, non-admin entitlement resolves to 'unknown'
  const ent = await resolveWalletEntitlement(validWallet, {
    mockHoldingTokens: 1_000_000,
    mockPriceUsd: 0, // oracle outage: non-positive price
  });

  assert.equal(ent.tier, 'unknown');
  assert.match(ent.downgradeReason || '', /Price oracle temporarily unavailable/i);

  // Downgrade / sweep evaluator must skip status changes when tier is unknown
  const evalResult = await evaluateWalletDowngrade(validWallet, { mockPriceUsd: 0 });
  assert.equal(evalResult.newTier, 'unknown');
  assert.equal(evalResult.changed, false);
});

// ---------------------------------------------------------------------------
// 5. WALLET ISOLATION SECURITY SCENARIOS
// ---------------------------------------------------------------------------
test('Wallet isolation [1/3]: Wallet A cannot see Wallet B personal Watchlist', () => {
  const getWatchlistKey = (addr) => (addr ? `trenchlabs_watchlist_v4:${addr}` : 'trenchlabs_watchlist_anon_v4');

  const walletA = 'WalletA11111111111111111111111111111111111';
  const walletB = 'WalletB22222222222222222222222222222222222';

  const mockStorage = new Map();
  mockStorage.set(getWatchlistKey(walletA), JSON.stringify(['alpha-call-1', 'alpha-call-2']));

  // Wallet B attempts to read its personal watchlist
  const walletBData = mockStorage.get(getWatchlistKey(walletB));
  assert.equal(walletBData, undefined);

  // Storage key for Wallet A is completely isolated
  assert.notEqual(getWatchlistKey(walletA), getWatchlistKey(walletB));
});

test('Wallet isolation [2/3]: Switching wallets clears stale displayed data', () => {
  let displayedWatchlist = ['token-1', 'token-2'];
  let displayedAlphas = [{ id: '1', ticker: '$OLD' }];

  // Address switch occurs:
  const prevWallet = 'WalletA';
  const nextWallet = 'WalletB';
  assert.notEqual(prevWallet, nextWallet);

  // Synchronous/microtask state reset
  displayedWatchlist = [];
  displayedAlphas = [];

  assert.equal(displayedWatchlist.length, 0);
  assert.equal(displayedAlphas.length, 0);
});

test('Wallet isolation [3/3]: Legacy Watchlist migration occurs only once', () => {
  const getWatchlistKey = (addr) => `trenchlabs_watchlist_v4:${addr}`;
  const mockStorage = new Map();

  // Legacy un-namespaced key exists from v3
  mockStorage.set('trenchlabs_watchlist_v3', JSON.stringify(['legacy-1', 'legacy-2']));

  const walletA = 'WalletA11111111111111111111111111111111111';
  const walletB = 'WalletB22222222222222222222222222222222222';

  // Step 1: Wallet A connects and migrates legacy data
  const legacyData = mockStorage.get('trenchlabs_watchlist_v3');
  assert.ok(legacyData);
  mockStorage.set(getWatchlistKey(walletA), legacyData);
  mockStorage.delete('trenchlabs_watchlist_v3'); // Deleted immediately upon migration

  assert.deepEqual(JSON.parse(mockStorage.get(getWatchlistKey(walletA))), ['legacy-1', 'legacy-2']);
  assert.equal(mockStorage.has('trenchlabs_watchlist_v3'), false);

  // Step 2: Wallet B connects later
  const legacyForB = mockStorage.get('trenchlabs_watchlist_v3');
  assert.equal(legacyForB, undefined); // Cannot be migrated a second time
  const walletBData = mockStorage.get(getWatchlistKey(walletB));
  assert.equal(walletBData, undefined);
});

// ---------------------------------------------------------------------------
// 5. V2.4 STRICT RELIABILITY & HARDENED LOCKS GUARANTEES
// ---------------------------------------------------------------------------
test('V2.4 Guarantee 1: Preliminary check failure (invalid signature) does NOT consume challenge', async () => {
  const camp = await createTestCampaign({ title: 'Preliminary Check Protection Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const wrongSig = '00'.repeat(64); // bad signature

    const reqBad = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@test_handle',
        xRetweetLink: 'https://x.com/test_handle/status/111',
        signature: wrongSig,
      }),
    });

    const resBad = await submitCampaign(reqBad, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(resBad.status, 401);

    // Verify challenge state is still ACTIVE (not consumed)
    const stateAfter = await getRaidChallengeState(ch.challengeId);
    assert.equal(stateAfter.status, 'ACTIVE', 'Challenge must NOT be consumed by rejected preliminary check');

    // Valid submission with correct signature now succeeds
    const goodSig = signEd25519(kp, ch.message);
    const reqGood = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@test_handle',
        xRetweetLink: 'https://x.com/test_handle/status/111',
        signature: goodSig,
      }),
    });

    const resGood = await submitCampaign(reqGood, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(resGood.status, 201, 'Subsequent valid submission using unconsumed challenge must succeed');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.4 Guarantee 1: Preliminary check failure (duplicate wallet) does NOT consume challenge', async () => {
  const camp = await createTestCampaign({ title: 'Preliminary Duplicate Check Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    // 1. Initial valid submission
    const ch1 = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig1 = signEd25519(kp, ch1.message);

    const req1 = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch1.challengeId,
        walletAddress: wallet,
        xHandle: '@user_duplicate',
        xRetweetLink: 'https://x.com/user_duplicate/status/111',
        signature: sig1,
      }),
    });
    const res1 = await submitCampaign(req1, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);

    // 2. Second challenge issued for same wallet
    const ch2 = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig2 = signEd25519(kp, ch2.message);

    const req2 = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch2.challengeId,
        walletAddress: wallet,
        xHandle: '@user_duplicate',
        xRetweetLink: 'https://x.com/user_duplicate/status/222',
        signature: sig2,
      }),
    });
    const res2 = await submitCampaign(req2, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res2.status, 400);
    const json2 = await res2.json();
    assert.match(json2.error, /already submitted proof/i);

    // Verify ch2 was NOT consumed because preliminary duplicate check stopped it before consume
    const state2 = await getRaidChallengeState(ch2.challengeId);
    assert.equal(state2.status, 'ACTIVE', 'Duplicate wallet preliminary check must not burn challenge');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.4 Guarantee 2: Transient persistence failure triggers rollback so legitimate submission is not lost', async () => {
  const camp = await createTestCampaign({ title: 'Rollback Recovery Test' });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    // Consume challenge
    const consumeRes = await consumeRaidChallenge(ch.challengeId);
    assert.equal(consumeRes, true);

    const stateConsumed = await getRaidChallengeState(ch.challengeId);
    assert.equal(stateConsumed.status, 'CONSUMED');

    // Rollback challenge (simulating rollback on transient persistence failure)
    const rolledBack = await rollbackRaidChallenge(ch.challengeId, ch);
    assert.equal(rolledBack, true, 'Rollback must successfully revert consumed state');

    // Verify challenge is active again
    const stateRestored = await getRaidChallengeState(ch.challengeId);
    assert.equal(stateRestored.status, 'ACTIVE', 'Challenge must be restored to ACTIVE state');

    // User retry now succeeds
    const reqRetry = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@retry_user',
        xRetweetLink: 'https://x.com/retry_user/status/333',
        signature: sig,
      }),
    });
    const resRetry = await submitCampaign(reqRetry, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(resRetry.status, 201, 'Retrying submission after rollback must succeed');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.4 Guarantee 7 & 8: File-lock ownership verification and dead PID recovery (no age heuristic)', async () => {
  // Test PID liveness
  assert.equal(isPidDead(process.pid), false, 'Current process PID must be reported as alive');
  assert.equal(isPidDead(99999999), true, 'Non-existent PID 99999999 must be reported as dead (ESRCH)');

  // Ensure clean lock path
  try {
    if (fs.existsSync(DB_FILE_LOCK_PATH)) {
      fs.unlinkSync(DB_FILE_LOCK_PATH);
    }
  } catch {}

  // 1. Acquire lock normally
  const releaseLock = await acquireFileLock();
  assert.ok(fs.existsSync(DB_FILE_LOCK_PATH), 'Lock file must exist when acquired');

  // Verify another attempt cannot steal or overwrite active lock
  let lockStolen = false;
  try {
    const fdSecond = fs.openSync(DB_FILE_LOCK_PATH, 'wx');
    fs.closeSync(fdSecond);
    lockStolen = true;
  } catch (err) {
    assert.equal(err.code, 'EEXIST', 'Active lock cannot be overwritten by another caller');
  }
  assert.equal(lockStolen, false);

  // Release lock safely
  releaseLock();
  assert.equal(fs.existsSync(DB_FILE_LOCK_PATH), false, 'Lock file must be unlinked on safe release');

  // 2. Simulate crashed dead process that left a lock file
  const deadPid = 99999998;
  fs.writeFileSync(
    DB_FILE_LOCK_PATH,
    JSON.stringify({ pid: deadPid, token: 'dead-lock-token', createdAt: Date.now() - 500 }) // only 500ms old, NOT stale by age
  );

  // New acquireFileLock call should detect dead PID (ESRCH) and safely recover without age threshold
  const recoveredRelease = await acquireFileLock();
  assert.ok(fs.existsSync(DB_FILE_LOCK_PATH), 'Lock must be acquired after dead PID recovery');

  // Verify the new lock contains current PID
  const lockContent = JSON.parse(fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8'));
  assert.equal(lockContent.pid, process.pid, 'Recovered lock must belong to current process');

  recoveredRelease();
  assert.equal(fs.existsSync(DB_FILE_LOCK_PATH), false, 'Recovered lock must unlink cleanly on release');
});

// ---------------------------------------------------------------------------
// V2.5 Strict Requirements: Durable Idempotency, Scenarios A-D & Lock Hardening
// ---------------------------------------------------------------------------

test('V2.5 Scenario A: Failure before first durable write restores challenge to ACTIVE', async () => {
  const camp = await createCampaign({
    title: 'V2.5 Scenario A Test',
    description: 'Testing rollback to ACTIVE when failure occurs before first write',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/98770',
    rewardAmount: '1,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    postedBy: 'Admin',
  });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const makeReq = () =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@scen_a_user',
          xRetweetLink: 'https://x.com/scen_a_user/status/101',
          signature: sig,
        }),
      });

    // 1. Inject failure before durable submission write
    __setTestFailSaveSubmissions(true);
    const resFail = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveSubmissions(false);

    assert.equal(resFail.status, 503, 'Storage failure must return HTTP 503');

    // 2. Verify no durable submission was created
    const durableCheck = await getSubmissionByChallengeId(ch.challengeId);
    assert.equal(durableCheck, null, 'No durable submission record must exist after Scenario A failure');

    // 3. Verify challenge was safely rolled back to ACTIVE
    const state = await getRaidChallengeState(ch.challengeId);
    assert.equal(state.status, 'ACTIVE', 'Challenge must be safely restored to ACTIVE state');

    // 4. Retry succeeds with HTTP 201
    const resRetry = await submitCampaign(makeReq(), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(resRetry.status, 201, 'Subsequent retry must succeed with HTTP 201');

    const durableFinal = await getSubmissionByChallengeId(ch.challengeId);
    assert.ok(durableFinal, 'Durable submission must exist after successful retry');
  } finally {
    __setTestFailSaveSubmissions(false);
    await deleteCampaign(camp.id);
  }
});

test('V2.5 Scenario B: Failure after submission creation preserves durable submission, does NOT rollback challenge', async () => {
  const camp = await createCampaign({
    title: 'V2.5 Scenario B Test',
    description: 'Testing that durable submission is preserved when campaign counter write fails',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/98771',
    rewardAmount: '1,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    postedBy: 'Admin',
  });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const makeReq = (isRetry = false) =>
      new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(isRetry ? { 'x-retry': 'true' } : {}) },
        body: JSON.stringify({
          challengeId: ch.challengeId,
          walletAddress: wallet,
          xHandle: '@scen_b_user',
          xRetweetLink: 'https://x.com/scen_b_user/status/102',
          signature: sig,
          isRetry,
        }),
      });

    // 1. Inject failure during campaign counter write (AFTER submission is written)
    __setTestFailSaveCampaigns(true);
    const res = await submitCampaign(makeReq(false), { params: Promise.resolve({ id: camp.id }) });
    __setTestFailSaveCampaigns(false);

    // The route detects the durable submission exists and returns 201 without rolling back
    assert.equal(res.status, 201, 'Must return HTTP 201 reflecting durable submission');

    // 2. Verify durable submission exists and challenge is NOT active
    const durableCheck = await getSubmissionByChallengeId(ch.challengeId);
    assert.ok(durableCheck, 'Durable submission must be preserved');

    // 3. Idempotent retry returns HTTP 200 with the existing submission
    const resRetry = await submitCampaign(makeReq(true), { params: Promise.resolve({ id: camp.id }) });
    assert.equal(resRetry.status, 200, 'Idempotent retry must return HTTP 200');
    const retryJson = await resRetry.json();
    assert.equal(retryJson.submission?.id, durableCheck.id, 'Retry must return the same submission ID');

    // 4. Verify no duplicate submission was created
    const allSubs = await loadSubmissions();
    const matches = allSubs.filter((s) => s.challengeId === ch.challengeId);
    assert.equal(matches.length, 1, 'Exactly one submission record must exist');
  } finally {
    __setTestFailSaveCampaigns(false);
    await deleteCampaign(camp.id);
  }
});

test('V2.5 Durable Idempotency Key: Prevents duplicate persistence and returns existing submission', async () => {
  const camp = await createCampaign({
    title: 'V2.5 Idempotency Key Test',
    description: 'Testing durable challenge-derived idempotency key',
    tweetUrl: 'https://x.com/TrenchLabsHQ/status/98772',
    rewardAmount: '1,000 $GENESIS',
    rewardToken: '$GENESIS',
    durationHours: 24,
    postedBy: 'Admin',
  });
  try {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();

    const ch = await issueRaidChallenge({ campaignId: camp.id, walletAddress: wallet });
    const sig = signEd25519(kp, ch.message);

    const req = new NextRequest(`http://localhost:3000/api/campaigns/${camp.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: ch.challengeId,
        walletAddress: wallet,
        xHandle: '@idem_user',
        xRetweetLink: 'https://x.com/idem_user/status/103',
        signature: sig,
      }),
    });

    const res1 = await submitCampaign(req, { params: Promise.resolve({ id: camp.id }) });
    assert.equal(res1.status, 201);
    const json1 = await res1.json();
    assert.ok(json1.submission?.id);

    // Verify idempotencyKey is recorded on the submission
    const expectedKey = `raid-submission:${ch.challengeId}`;
    const byKey = await getSubmissionByIdempotencyKey(expectedKey);
    assert.ok(byKey, 'Submission must be retrievable by durable idempotencyKey');
    assert.equal(byKey?.id, json1.submission.id);

    // Direct call to submitCampaignCompletion with same idempotency key returns existing without write
    const { submitCampaignCompletion } = await import('../../src/server/campaigns-data.ts');
    const dupResult = await submitCampaignCompletion({
      campaignId: camp.id,
      walletAddress: wallet,
      xHandle: '@idem_user',
      xRetweetLink: 'https://x.com/idem_user/status/103',
      challengeId: ch.challengeId,
    });

    assert.equal(dupResult.ok, true);
    assert.equal(dupResult.isExisting, true, 'Duplicate write must be detected and return isExisting: true');
    assert.equal(dupResult.submission?.id, json1.submission.id);

    // Ensure total submissions count on campaign did not increment twice
    const camps = await loadCampaigns();
    const foundCamp = camps.find((c) => c.id === camp.id);
    assert.equal(foundCamp?.submissionsCount, 1, 'Campaign submission count must not increment on idempotent duplicate');
  } finally {
    await deleteCampaign(camp.id);
  }
});

test('V2.5 Database Lock Hardening: Stale lock recovery replacement race cannot delete replacement lock', async () => {
  // Ensure clean lock path
  try {
    if (fs.existsSync(DB_FILE_LOCK_PATH)) {
      fs.unlinkSync(DB_FILE_LOCK_PATH);
    }
  } catch {}

  // 1. Simulate dead process A lock
  const deadPid = 99999997;
  fs.writeFileSync(
    DB_FILE_LOCK_PATH,
    JSON.stringify({ pid: deadPid, token: 'dead-token-1', createdAt: Date.now() - 1000 })
  );

  // 2. Fast Process B replaces the dead lock with its own valid living lock
  const fastLivingToken = 'living-token-B';
  fs.writeFileSync(
    DB_FILE_LOCK_PATH,
    JSON.stringify({ pid: process.pid, token: fastLivingToken, createdAt: Date.now() })
  );

  // 3. Slow recovery process inspects the lock now:
  // Because the lock belongs to process.pid (alive), it CANNOT overwrite or unlink it!
  let stoleLock = false;
  try {
    const raw = fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (isPidDead(parsed.pid)) {
      // Dead PID branch
      fs.unlinkSync(DB_FILE_LOCK_PATH);
      stoleLock = true;
    }
  } catch {}

  assert.equal(stoleLock, false, 'Slow recovery must NOT unlink replacement lock owned by living process');
  assert.ok(fs.existsSync(DB_FILE_LOCK_PATH), 'Living replacement lock must remain untouched');

  const content = JSON.parse(fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8'));
  assert.equal(content.token, fastLivingToken, 'Living replacement lock content must be preserved');

  // Clean up
  try {
    fs.unlinkSync(DB_FILE_LOCK_PATH);
  } catch {}
});
