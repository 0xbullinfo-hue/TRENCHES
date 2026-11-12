/**
 * Minimal Upstash Redis REST client (no extra dependency).
 * Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (server-only env vars).
 * Works on serverless hosts, unlike local-disk persistence.
 */
const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const KV_CONFIGURED = Boolean(KV_URL && KV_TOKEN);

export function isKvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim());
}

const UNLOCK_LUA =
  "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";

const RENEW_LOCK_LUA =
  "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('expire',KEYS[1],tonumber(ARGV[2])) else return 0 end";

const SET_IF_LOCKED_LUA =
  "if redis.call('get',KEYS[1])==ARGV[1] then redis.call('set',KEYS[2],ARGV[2]) return 1 else return 0 end";

async function cmd(args: Array<string | number>): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || KV_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || KV_TOKEN;
  if (!url || !token) {
    throw new Error('KV error: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not configured');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
    const json = (await res.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error(`KV error: ${json.error}`);
    return json.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function kvGet(key: string): Promise<string | null> {
  return ((await cmd(['GET', key])) as string | null) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  await cmd(['SET', key, value]);
}

/** Fixed-window counter. Returns the count within the current window. */
export async function kvIncrWindow(key: string, windowSec: number): Promise<number> {
  const n = Number(await cmd(['INCR', key]));
  if (n === 1) await cmd(['EXPIRE', key, windowSec]);
  return n;
}

export async function kvLock(key: string, token: string, ttlSec: number): Promise<boolean> {
  if (!key || !token) throw new Error('kvLock requires non-empty key and token');
  const safeTtl = Math.max(1, Math.ceil(ttlSec));
  if (!Number.isFinite(safeTtl)) throw new Error('kvLock requires a finite positive ttlSec');
  return (await cmd(['SET', key, token, 'NX', 'EX', safeTtl])) === 'OK';
}

/**
 * Atomically extends the lock TTL only when the existing lock token matches `token`.
 * Returns true if the lease was renewed, false if the lock expired or is held by another owner.
 */
export async function kvRenewLock(key: string, token: string, ttlSec: number): Promise<boolean> {
  if (!key || !token) return false;
  const safeTtl = Math.max(1, Math.ceil(ttlSec));
  if (!Number.isFinite(safeTtl)) return false;
  const res = await cmd(['EVAL', RENEW_LOCK_LUA, 1, key, token, safeTtl]);
  return Number(res) === 1;
}

/** Checks whether the lock key is currently owned by `token`. */
export async function kvVerifyLock(key: string, token: string): Promise<boolean> {
  if (!key || !token) return false;
  return (await kvGet(key)) === token;
}

/**
 * Atomically releases the lock only when the existing lock token matches `token`.
 * Returns true if deleted, false if already expired or owned by another worker.
 */
export async function kvUnlock(key: string, token: string): Promise<boolean> {
  if (!key || !token) return false;
  const res = await cmd(['EVAL', UNLOCK_LUA, 1, key, token]);
  return Number(res) === 1;
}

/**
 * Atomically writes `dataKey = value` ONLY if `lockKey` is currently held by `lockToken`.
 * Prevents a worker whose lock expired from overwriting shared state.
 */
export async function kvSetIfLocked(
  lockKey: string,
  lockToken: string,
  dataKey: string,
  value: string
): Promise<boolean> {
  if (!lockKey || !lockToken || !dataKey) return false;
  const res = await cmd(['EVAL', SET_IF_LOCKED_LUA, 2, lockKey, dataKey, lockToken, value]);
  return Number(res) === 1;
}

export async function kvSetEx(key: string, value: string, ttlSec: number): Promise<void> {
  await cmd(['SET', key, value, 'EX', ttlSec]);
}

/** Atomic read-and-delete (one-time codes). */
export async function kvGetDel(key: string): Promise<string | null> {
  return ((await cmd(['GETDEL', key])) as string | null) ?? null;
}

export async function kvDel(key: string): Promise<void> {
  await cmd(['DEL', key]);
}

export type KvChallengeConsumeStatus =
  | 'CONSUMED'
  | 'ALREADY_CONSUMED'
  | 'EXPIRED'
  | 'NOT_FOUND';

export const CONSUME_CHALLENGE_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return 0 end " +
  "if string.find(raw, '\"status\":\"consumed\"') or string.find(raw, '\"consumed\":true') then return 2 end " +
  "if ARGV[1] then " +
  "  local nowMs = tonumber(ARGV[1]) " +
  "  local expStart, expEnd, expStr = string.find(raw, '\"expiresAt\":(%d+)') " +
  "  if expStr then " +
  "    local expMs = tonumber(expStr) " +
  "    if expMs and nowMs and nowMs > expMs then return 3 end " +
  "  end " +
  "end " +
  "local nowMsStr = ARGV[1] or '0' " +
  "local tombstone = '{\"status\":\"consumed\",\"consumedAt\":' .. nowMsStr .. '}' " +
  "local ttl = redis.call('ttl', KEYS[1]) " +
  "local tombstoneTtl = ttl " +
  "local minRetention = tonumber(ARGV[2]) or 120 " +
  "if not tombstoneTtl or tombstoneTtl < minRetention then tombstoneTtl = minRetention end " +
  "redis.call('set', KEYS[1], tombstone, 'EX', tombstoneTtl) " +
  "return 1";

/**
 * Atomically consumes a challenge key in Redis with deterministic tombstoning.
 * Guarantees exactly-once execution across instances and bounded tombstone retention for deterministic replay responses.
 */
export async function kvConsumeChallenge(
  key: string,
  nowMs = Date.now(),
  minRetentionSec = 120
): Promise<KvChallengeConsumeStatus> {
  const res = await cmd(['EVAL', CONSUME_CHALLENGE_LUA, 1, key, nowMs, minRetentionSec]);
  const num = Number(res);
  if (num === 1) return 'CONSUMED';
  if (num === 2) return 'ALREADY_CONSUMED';
  if (num === 3) return 'EXPIRED';
  return 'NOT_FOUND';
}

export const FINALIZE_CHALLENGE_TOMBSTONE_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return 0 end " +
  "if string.find(raw, '\"status\":\"consumed\"') then " +
  "  local nowMs = tonumber(ARGV[3]) or 0 " +
  "  local finalTombstone = '{\"status\":\"consumed\",\"consumedAt\":' .. nowMs .. ',\"submissionId\":\"' .. ARGV[1] .. '\"}' " +
  "  local ttl = redis.call('ttl', KEYS[1]) " +
  "  local tombstoneTtl = ttl " +
  "  local minRetention = tonumber(ARGV[2]) or 120 " +
  "  if not tombstoneTtl or tombstoneTtl < minRetention then tombstoneTtl = minRetention end " +
  "  redis.call('set', KEYS[1], finalTombstone, 'EX', tombstoneTtl) " +
  "  return 1 " +
  "end " +
  "return 0";

export const ROLLBACK_CHALLENGE_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if raw and string.find(raw, '\"status\":\"consumed\"') then " +
  "  local ttl = tonumber(ARGV[2]) " +
  "  if ttl and ttl > 0 then " +
  "    redis.call('set', KEYS[1], ARGV[1], 'EX', ttl) " +
  "    return 1 " +
  "  else " +
  "    redis.call('del', KEYS[1]) " +
  "    return 1 " +
  "  end " +
  "end " +
  "return 0";

/**
 * V2.5 State transition and ownership Lua scripts:
 * ACTIVE -> PROCESSING -> COMPLETED
 */
export const CLAIM_CHALLENGE_PROCESSING_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ status = 'NOT_FOUND' }) end " +
  "local c = cjson.decode(raw) " +
  "local nowMs = tonumber(ARGV[2]) or 0 " +
  "local leaseMs = tonumber(ARGV[3]) or 30000 " +
  "local attemptId = ARGV[1] " +
  "if c.expiresAt and nowMs > tonumber(c.expiresAt) then return cjson.encode({ status = 'EXPIRED' }) end " +
  "if c.status == 'COMPLETED' or c.status == 'consumed' then " +
  "  return cjson.encode({ status = 'COMPLETED', submissionId = c.submissionId, attemptId = c.attemptId, fencingToken = c.fencingToken, completedAt = c.completedAt }) " +
  "end " +
  "if not c.status or c.status == 'ACTIVE' or c.status == 'active' or c.status == 'pending' then " +
  "  c.status = 'PROCESSING' " +
  "  c.attemptId = attemptId " +
  "  c.fencingToken = 1 " +
  "  c.processingStartedAt = nowMs " +
  "  c.processingLeaseExpiresAt = nowMs + leaseMs " +
  "  local ttl = redis.call('ttl', KEYS[1]) " +
  "  local retention = tonumber(ARGV[4]) or 120 " +
  "  if not ttl or ttl < retention then ttl = retention end " +
  "  redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "  return cjson.encode({ status = 'CLAIMED', attemptId = c.attemptId, fencingToken = c.fencingToken, leaseExpiresAt = c.processingLeaseExpiresAt }) " +
  "end " +
  "if c.status == 'PROCESSING' then " +
  "  if c.attemptId == attemptId then " +
  "    c.processingLeaseExpiresAt = nowMs + leaseMs " +
  "    local ttl = redis.call('ttl', KEYS[1]) " +
  "    local retention = tonumber(ARGV[4]) or 120 " +
  "    if not ttl or ttl < retention then ttl = retention end " +
  "    redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "    return cjson.encode({ status = 'RESUMED', attemptId = c.attemptId, fencingToken = c.fencingToken, leaseExpiresAt = c.processingLeaseExpiresAt }) " +
  "  end " +
  "  local leaseExp = tonumber(c.processingLeaseExpiresAt) or 0 " +
  "  if nowMs > leaseExp then " +
  "    c.attemptId = attemptId " +
  "    c.fencingToken = (tonumber(c.fencingToken) or 0) + 1 " +
  "    c.processingStartedAt = nowMs " +
  "    c.processingLeaseExpiresAt = nowMs + leaseMs " +
  "    local ttl = redis.call('ttl', KEYS[1]) " +
  "    local retention = tonumber(ARGV[4]) or 120 " +
  "    if not ttl or ttl < retention then ttl = retention end " +
  "    redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "    return cjson.encode({ status = 'RECOVERED', attemptId = c.attemptId, fencingToken = c.fencingToken, leaseExpiresAt = c.processingLeaseExpiresAt }) " +
  "  else " +
  "    return cjson.encode({ status = 'CONFLICT', attemptId = c.attemptId, fencingToken = c.fencingToken, leaseExpiresAt = leaseExp }) " +
  "  end " +
  "end " +
  "return cjson.encode({ status = 'CONFLICT' })";

export const FINALIZE_CHALLENGE_PROCESSING_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ success = false, reason = 'NOT_FOUND' }) end " +
  "local c = cjson.decode(raw) " +
  "if c.status == 'COMPLETED' or c.status == 'consumed' then " +
  "  if c.submissionId == ARGV[3] then " +
  "    return cjson.encode({ success = true, status = 'ALREADY_COMPLETED' }) " +
  "  end " +
  "  return cjson.encode({ success = false, reason = 'COMPLETED_DIFFERENT_SUBMISSION' }) " +
  "end " +
  "if c.status ~= 'PROCESSING' then " +
  "  return cjson.encode({ success = false, reason = 'NOT_PROCESSING' }) " +
  "end " +
  "if c.attemptId ~= ARGV[1] then " +
  "  return cjson.encode({ success = false, reason = 'STALE_ATTEMPT' }) " +
  "end " +
  "if tonumber(c.fencingToken) ~= tonumber(ARGV[2]) then " +
  "  return cjson.encode({ success = false, reason = 'STALE_FENCING_TOKEN' }) " +
  "end " +
  "c.status = 'consumed' " +
  "c.processingState = 'COMPLETED' " +
  "c.submissionId = ARGV[3] " +
  "c.completedAt = tonumber(ARGV[4]) or 0 " +
  "c.idempotencyKey = 'raid-submission:' .. (c.challengeId or '') " +
  "local ttl = redis.call('ttl', KEYS[1]) " +
  "local retention = tonumber(ARGV[5]) or 120 " +
  "if not ttl or ttl < retention then ttl = retention end " +
  "redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "return cjson.encode({ success = true, status = 'COMPLETED' })";

export const ROLLBACK_CHALLENGE_PROCESSING_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ success = false, reason = 'NOT_FOUND' }) end " +
  "local c = cjson.decode(raw) " +
  "if c.status == 'COMPLETED' or c.status == 'consumed' then " +
  "  return cjson.encode({ success = false, reason = 'ALREADY_COMPLETED' }) " +
  "end " +
  "if c.status ~= 'PROCESSING' then " +
  "  return cjson.encode({ success = false, reason = 'NOT_PROCESSING' }) " +
  "end " +
  "if c.attemptId ~= ARGV[1] then " +
  "  return cjson.encode({ success = false, reason = 'STALE_ATTEMPT' }) " +
  "end " +
  "if tonumber(c.fencingToken) ~= tonumber(ARGV[2]) then " +
  "  return cjson.encode({ success = false, reason = 'STALE_FENCING_TOKEN' }) " +
  "end " +
  "c.status = 'ACTIVE' " +
  "c.attemptId = nil " +
  "c.fencingToken = nil " +
  "c.processingStartedAt = nil " +
  "c.processingLeaseExpiresAt = nil " +
  "local ttl = tonumber(ARGV[3]) " +
  "if ttl and ttl > 0 then " +
  "  redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "else " +
  "  redis.call('del', KEYS[1]) " +
  "end " +
  "return cjson.encode({ success = true })";

export const RECONCILE_CHALLENGE_COMPLETED_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ success = false, reason = 'NOT_FOUND' }) end " +
  "local c = cjson.decode(raw) " +
  "if ARGV[4] and ARGV[4] ~= '' and c.campaignId and c.campaignId ~= ARGV[4] then " +
  "  return cjson.encode({ success = false, reason = 'CAMPAIGN_MISMATCH' }) " +
  "end " +
  "if ARGV[5] and ARGV[5] ~= '' and c.walletAddress and string.lower(c.walletAddress) ~= string.lower(ARGV[5]) then " +
  "  return cjson.encode({ success = false, reason = 'WALLET_MISMATCH' }) " +
  "end " +
  "if c.status == 'COMPLETED' or c.status == 'consumed' or c.processingState == 'COMPLETED' then " +
  "  if c.submissionId == ARGV[1] then " +
  "    return cjson.encode({ success = true, status = 'ALREADY_COMPLETED', submissionId = c.submissionId }) " +
  "  end " +
  "  return cjson.encode({ success = false, reason = 'COMPLETED_DIFFERENT_SUBMISSION', existingSubmissionId = c.submissionId }) " +
  "end " +
  "local nowMs = tonumber(ARGV[2]) or 0 " +
  "if c.expiresAt and nowMs > tonumber(c.expiresAt) and (not c.status or c.status == 'ACTIVE') then " +
  "  return cjson.encode({ success = false, reason = 'EXPIRED' }) " +
  "end " +
  "if c.status == 'PROCESSING' then " +
  "  local callerFencingToken = tonumber(ARGV[7]) or 0 " +
  "  local currentFencingToken = tonumber(c.fencingToken) or 0 " +
  "  if callerFencingToken > 0 and currentFencingToken > callerFencingToken then " +
  "    return cjson.encode({ success = false, reason = 'STALE_FENCING_TOKEN' }) " +
  "  end " +
  "  local callerAttemptId = ARGV[6] " +
  "  if callerAttemptId and callerAttemptId ~= '' and c.attemptId and c.attemptId ~= '' and c.attemptId ~= callerAttemptId then " +
  "    local leaseExp = tonumber(c.processingLeaseExpiresAt) or 0 " +
  "    if nowMs <= leaseExp then " +
  "      return cjson.encode({ success = false, reason = 'STALE_ATTEMPT' }) " +
  "    end " +
  "  end " +
  "end " +
  "c.status = 'consumed' " +
  "c.processingState = 'COMPLETED' " +
  "c.submissionId = ARGV[1] " +
  "c.completedAt = nowMs " +
  "c.idempotencyKey = 'raid-submission:' .. (c.challengeId or '') " +
  "local ttl = redis.call('ttl', KEYS[1]) " +
  "local retention = tonumber(ARGV[3]) or 120 " +
  "if not ttl or ttl < retention then ttl = retention end " +
  "redis.call('set', KEYS[1], cjson.encode(c), 'EX', ttl) " +
  "return cjson.encode({ success = true, status = 'COMPLETED', submissionId = c.submissionId })";

export type KvChallengeClaimResult =
  | { status: 'CLAIMED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'RESUMED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'RECOVERED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'BUSY'; attemptId?: string; fencingToken?: number; leaseExpiresAt?: number }
  | { status: 'COMPLETED'; submissionId?: string; attemptId?: string; fencingToken?: number; completedAt?: number }
  | { status: 'EXPIRED' }
  | { status: 'NOT_FOUND' }
  | { status: 'CONFLICT' };

export type KvChallengeFinalizeResult = {
  success: boolean;
  status?: string;
  reason?: string;
};

export type KvChallengeRollbackResult = {
  success: boolean;
  reason?: string;
};

export async function kvClaimChallengeProcessing(
  key: string,
  attemptId: string,
  nowMs = Date.now(),
  leaseDurationMs = 30000,
  minRetentionSec = 120
): Promise<KvChallengeClaimResult> {
  const res = await cmd(['EVAL', CLAIM_CHALLENGE_PROCESSING_LUA, 1, key, attemptId, nowMs, leaseDurationMs, minRetentionSec]);
  if (!res) return { status: 'NOT_FOUND' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as KvChallengeClaimResult;
  } catch {
    return { status: 'CONFLICT' };
  }
}

export async function kvFinalizeChallengeProcessing(
  key: string,
  attemptId: string,
  fencingToken: number,
  submissionId: string,
  nowMs = Date.now(),
  minRetentionSec = 120
): Promise<KvChallengeFinalizeResult> {
  const res = await cmd(['EVAL', FINALIZE_CHALLENGE_PROCESSING_LUA, 1, key, attemptId, fencingToken, submissionId, nowMs, minRetentionSec]);
  if (!res) return { success: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as KvChallengeFinalizeResult;
  } catch {
    return { success: false, reason: 'PARSE_ERROR' };
  }
}

export async function kvRollbackChallengeProcessing(
  key: string,
  attemptId: string,
  fencingToken: number,
  remainingTtlSec: number
): Promise<KvChallengeRollbackResult> {
  const res = await cmd(['EVAL', ROLLBACK_CHALLENGE_PROCESSING_LUA, 1, key, attemptId, fencingToken, remainingTtlSec]);
  if (!res) return { success: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as KvChallengeRollbackResult;
  } catch {
    return { success: false, reason: 'PARSE_ERROR' };
  }
}

export type KvChallengeReconcileResult = {
  success: boolean;
  status?: 'COMPLETED' | 'ALREADY_COMPLETED';
  reason?: string;
  submissionId?: string;
  existingSubmissionId?: string;
};

export async function kvReconcileChallengeCompleted(
  key: string,
  submissionId: string,
  nowMs = Date.now(),
  minRetentionSec = 120,
  options?: {
    campaignId?: string;
    walletAddress?: string;
    attemptId?: string;
    fencingToken?: number;
  }
): Promise<KvChallengeReconcileResult> {
  const res = await cmd([
    'EVAL',
    RECONCILE_CHALLENGE_COMPLETED_LUA,
    1,
    key,
    submissionId,
    nowMs,
    minRetentionSec,
    options?.campaignId || '',
    options?.walletAddress || '',
    options?.attemptId || '',
    options?.fencingToken ? String(options.fencingToken) : '0',
  ]);
  if (!res) return { success: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as KvChallengeReconcileResult;
  } catch {
    return { success: false, reason: 'PARSE_ERROR' };
  }
}

/**
 * Atomically binds a completed submission ID to the challenge tombstone in Redis.
 * Enables idempotent replay recovery where a retried request can return the existing submission.
 */
export async function kvFinalizeChallengeTombstone(
  key: string,
  submissionId: string,
  minRetentionSec = 120,
  nowMs = Date.now()
): Promise<boolean> {
  const res = await cmd(['EVAL', FINALIZE_CHALLENGE_TOMBSTONE_LUA, 1, key, submissionId, minRetentionSec, nowMs]);
  return Number(res) === 1;
}

/**
 * Atomically rolls back a consumed challenge to its original unconsumed state if persistence fails.
 * Guarantees that legitimate submissions are not permanently lost due to downstream transient persistence outages.
 */
export async function kvRollbackChallenge(
  key: string,
  originalChallengeJson: string,
  remainingTtlSec: number
): Promise<boolean> {
  const res = await cmd(['EVAL', ROLLBACK_CHALLENGE_LUA, 1, key, originalChallengeJson, remainingTtlSec]);
  return Number(res) === 1;
}

export async function kvHGet(key: string, field: string): Promise<string | null> {
  return ((await cmd(['HGET', key, field])) as string | null) ?? null;
}

export async function kvHSet(key: string, field: string, value: string): Promise<void> {
  await cmd(['HSET', key, field, value]);
}

export async function kvHDel(key: string, field: string): Promise<void> {
  await cmd(['HDEL', key, field]);
}

export async function kvHGetAll(key: string): Promise<Record<string, string>> {
  const flat = ((await cmd(['HGETALL', key])) as string[] | null) ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
  return out;
}

export async function kvSAdd(key: string, member: string): Promise<number> {
  return Number(await cmd(['SADD', key, member]));
}

export async function kvSRem(key: string, member: string): Promise<number> {
  return Number(await cmd(['SREM', key, member]));
}

export async function kvSMembers(key: string): Promise<string[]> {
  return ((await cmd(['SMEMBERS', key])) as string[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Atomic Lua primitives for the Durable TP/SL Notification Outbox
// ---------------------------------------------------------------------------

const OUTBOX_CREATE_EVENT_LUA =
  "if redis.call('hexists',KEYS[1],ARGV[1])==1 then " +
  "local existing=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if existing and not string.find(existing,'\"status\":\"completed\"',1,true) then redis.call('sadd',KEYS[2],ARGV[1]) end " +
  "return 0 " +
  "else " +
  "redis.call('hset',KEYS[1],ARGV[1],ARGV[2]) " +
  "redis.call('sadd',KEYS[2],ARGV[1]) " +
  "return 1 " +
  "end";

const OUTBOX_SEED_SUB_LUA =
  "if redis.call('hexists',KEYS[1],ARGV[1])==1 then return 0 else redis.call('hset',KEYS[1],ARGV[1],ARGV[2]) return 1 end";

const OUTBOX_MARK_SEEDED_LUA =
  "local raw=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if not raw then return 0 end " +
  "local ev=cjson.decode(raw) " +
  "ev.subscribersSeeded=true " +
  "ev.updatedAt=tonumber(ARGV[2]) " +
  "redis.call('hset',KEYS[1],ARGV[1],cjson.encode(ev)) " +
  "return 1";

const OUTBOX_CLAIM_SUB_LUA =
  "local raw=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if not raw then return nil end " +
  "local rec=cjson.decode(raw) " +
  "local now=tonumber(ARGV[2]) " +
  "local leaseMs=tonumber(ARGV[3]) " +
  "local st=rec.status " +
  "if st=='delivered' or st=='permanently_failed' then return nil end " +
  "if st=='processing' and rec.leaseExpiresAt and type(rec.leaseExpiresAt)=='number' and rec.leaseExpiresAt>now then return nil end " +
  "if st=='retry' and rec.nextRetryAt and type(rec.nextRetryAt)=='number' and rec.nextRetryAt>now then return nil end " +
  "if rec.nextTierCheckAt and type(rec.nextTierCheckAt)=='number' and rec.nextTierCheckAt>now then return nil end " +
  "rec.previousStatus=st " +
  "rec.status='processing' " +
  "rec.processingToken=ARGV[4] " +
  "rec.leaseExpiresAt=now+leaseMs " +
  "local updated=cjson.encode(rec) " +
  "redis.call('hset',KEYS[1],ARGV[1],updated) " +
  "return updated";

const OUTBOX_RENEW_SUB_LUA =
  "local raw=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if not raw then return 0 end " +
  "local rec=cjson.decode(raw) " +
  "if rec.status~='processing' or rec.processingToken~=ARGV[2] then return 0 end " +
  "rec.leaseExpiresAt=tonumber(ARGV[3]) " +
  "redis.call('hset',KEYS[1],ARGV[1],cjson.encode(rec)) " +
  "return 1";

const OUTBOX_COMPLETE_SUB_LUA =
  "local raw=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if not raw then return 0 end " +
  "local rec=cjson.decode(raw) " +
  "if rec.status=='delivered' then return 1 end " +
  "if rec.status~='processing' or rec.processingToken~=ARGV[2] then return 0 end " +
  "local outcome=cjson.decode(ARGV[3]) " +
  "rec.status=outcome.status " +
  "if outcome.isTierCheckFailure==true then " +
  "rec.tierCheckAttemptCount=tonumber(outcome.tierCheckAttemptCount) or ((tonumber(rec.tierCheckAttemptCount) or 0)+1) " +
  "rec.nextTierCheckAt=tonumber(outcome.nextTierCheckAt) or 0 " +
  "rec.lastTierCheckFailureAt=outcome.lastTierCheckFailureAt " +
  "else " +
  "if outcome.attemptCount~=nil and outcome.attemptCount~=cjson.null then " +
  "rec.attemptCount=tonumber(outcome.attemptCount) " +
  "else " +
  "rec.attemptCount=(tonumber(rec.attemptCount) or 0)+1 " +
  "end " +
  "if outcome.lastAttemptAt~=nil and outcome.lastAttemptAt~=cjson.null then rec.lastAttemptAt=outcome.lastAttemptAt end " +
  "if outcome.nextRetryAt~=nil and outcome.nextRetryAt~=cjson.null then rec.nextRetryAt=tonumber(outcome.nextRetryAt) end " +
  "if outcome.lastFailureCategory~=nil then rec.lastFailureCategory=outcome.lastFailureCategory end " +
  "if outcome.nextTierCheckAt~=nil and outcome.nextTierCheckAt~=cjson.null then rec.nextTierCheckAt=tonumber(outcome.nextTierCheckAt) end " +
  "end " +
  "rec.processingToken=cjson.null " +
  "rec.leaseExpiresAt=cjson.null " +
  "redis.call('hset',KEYS[1],ARGV[1],cjson.encode(rec)) " +
  "return 1";

const OUTBOX_FINALIZE_EVENT_LUA =
  "local evRaw=redis.call('hget',KEYS[1],ARGV[1]) " +
  "if not evRaw then redis.call('srem',KEYS[2],ARGV[1]) return 'missing' end " +
  "local ev=cjson.decode(evRaw) " +
  "if not ev.subscribersSeeded then return 'pending' end " +
  "local flat=redis.call('hgetall',KEYS[3]) " +
  "for i=2,#flat,2 do " +
  "local sub=cjson.decode(flat[i]) " +
  "if sub.status~='delivered' and sub.status~='permanently_failed' then return 'pending' end " +
  "end " +
  "ev.status='completed' " +
  "ev.updatedAt=tonumber(ARGV[2]) " +
  "redis.call('hset',KEYS[1],ARGV[1],cjson.encode(ev)) " +
  "redis.call('srem',KEYS[2],ARGV[1]) " +
  "return 'completed'";

/**
 * Atomically creates an outbox event if it does not already exist.
 * Returns true if newly created, false if the event already existed.
 */
export async function kvOutboxCreateEvent(
  eventsHashKey: string,
  pendingSetKey: string,
  eventId: string,
  eventJson: string
): Promise<boolean> {
  const res = await cmd(['EVAL', OUTBOX_CREATE_EVENT_LUA, 2, eventsHashKey, pendingSetKey, eventId, eventJson]);
  return Number(res) === 1;
}

/**
 * Atomically seeds a subscriber delivery record only if not already present (HSETNX semantics via Lua).
 */
export async function kvOutboxSeedSubscriber(
  subsHashKey: string,
  subscriberId: string,
  subscriberJson: string
): Promise<boolean> {
  const res = await cmd(['EVAL', OUTBOX_SEED_SUB_LUA, 1, subsHashKey, subscriberId, subscriberJson]);
  return Number(res) === 1;
}

/**
 * Atomically marks an outbox event's subscribersSeeded flag as true.
 */
export async function kvOutboxMarkSubscribersSeeded(
  eventsHashKey: string,
  eventId: string,
  nowMs: number
): Promise<boolean> {
  const res = await cmd(['EVAL', OUTBOX_MARK_SEEDED_LUA, 1, eventsHashKey, eventId, nowMs]);
  return Number(res) === 1;
}

/**
 * Atomically claims a subscriber delivery lease if the record is eligible (`pending`, due `retry`, or expired `processing`).
 * Returns the updated JSON string when claimed, or null if not claimable.
 */
export async function kvOutboxClaimSubscriber(
  subsHashKey: string,
  subscriberId: string,
  workerToken: string,
  nowMs: number,
  leaseDurationMs: number
): Promise<string | null> {
  const res = await cmd(['EVAL', OUTBOX_CLAIM_SUB_LUA, 1, subsHashKey, subscriberId, nowMs, leaseDurationMs, workerToken]);
  return (res as string | null) ?? null;
}

/**
 * Atomically renews a subscriber delivery processing lease only when owned by `workerToken`.
 */
export async function kvOutboxRenewSubscriberLease(
  subsHashKey: string,
  subscriberId: string,
  workerToken: string,
  newLeaseExpiresAtMs: number
): Promise<boolean> {
  const res = await cmd(['EVAL', OUTBOX_RENEW_SUB_LUA, 1, subsHashKey, subscriberId, workerToken, newLeaseExpiresAtMs]);
  return Number(res) === 1;
}

/**
 * Atomically records the delivery outcome for a subscriber only if currently owned by `workerToken`
 * (or returns true idempotently if already `delivered`).
 */
export async function kvOutboxCompleteSubscriber(
  subsHashKey: string,
  subscriberId: string,
  workerToken: string,
  outcomeJson: string
): Promise<boolean> {
  const res = await cmd(['EVAL', OUTBOX_COMPLETE_SUB_LUA, 1, subsHashKey, subscriberId, workerToken, outcomeJson]);
  return Number(res) === 1;
}

/**
 * Atomically checks if all subscribers for `eventId` have reached a terminal state (`delivered` or `permanently_failed`),
 * and if so marks the event `completed` and removes it from `pendingSetKey`.
 */
export async function kvOutboxFinalizeEvent(
  eventsHashKey: string,
  pendingSetKey: string,
  subsHashKey: string,
  eventId: string,
  nowMs: number
): Promise<'completed' | 'pending' | 'missing'> {
  const res = await cmd([
    'EVAL',
    OUTBOX_FINALIZE_EVENT_LUA,
    3,
    eventsHashKey,
    pendingSetKey,
    subsHashKey,
    eventId,
    nowMs,
  ]);
  return (res as 'completed' | 'pending' | 'missing') ?? 'pending';
}

// ---------------------------------------------------------------------------
// V2.7 Atomic Ownership, Submission Uniqueness & Outbox Dispatch Primitives
// ---------------------------------------------------------------------------

export const SAVE_LOCKED_KEY_LUA =
  "local lockVal = redis.call('get', KEYS[1]) " +
  "if not lockVal then " +
  "  return cjson.encode({ success = false, reason = 'LOCK_LOST' }) " +
  "end " +
  "if lockVal ~= ARGV[1] then " +
  "  local ok, parsed = pcall(cjson.decode, lockVal) " +
  "  if ok and type(parsed) == 'table' then " +
  "    if parsed.token ~= ARGV[1] then " +
  "      return cjson.encode({ success = false, reason = 'LOCK_LOST' }) " +
  "    end " +
  "    if ARGV[3] and ARGV[3] ~= '' and parsed.fencingGeneration and tonumber(parsed.fencingGeneration) ~= tonumber(ARGV[3]) then " +
  "      return cjson.encode({ success = false, reason = 'FENCING_GENERATION_MISMATCH' }) " +
  "    end " +
  "  else " +
  "    return cjson.encode({ success = false, reason = 'LOCK_LOST' }) " +
  "  end " +
  "end " +
  "redis.call('set', KEYS[2], ARGV[2]) " +
  "return cjson.encode({ success = true })";

export async function kvSetLocked(
  lockKey: string,
  targetKey: string,
  ownerToken: string,
  payload: string,
  fencingGeneration?: number
): Promise<{ success: boolean; reason?: string }> {
  const args: Array<string | number> = [
    'EVAL',
    SAVE_LOCKED_KEY_LUA,
    2,
    lockKey,
    targetKey,
    ownerToken,
    payload,
  ];
  if (fencingGeneration !== undefined && fencingGeneration !== null) {
    args.push(fencingGeneration);
  }
  const res = await cmd(args);
  if (!res) return { success: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as { success: boolean; reason?: string };
  } catch {
    return { success: false, reason: 'PARSE_ERROR' };
  }
}

export const RESERVE_SUBMISSION_CHALLENGE_LUA =
  "local existing = redis.call('get', KEYS[1]) " +
  "if existing then " +
  "  return cjson.encode({ created = false, submission = existing }) " +
  "end " +
  "local ttl = tonumber(ARGV[2]) or 604800 " +
  "redis.call('set', KEYS[1], ARGV[1], 'EX', ttl) " +
  "if KEYS[2] and ARGV[3] and ARGV[3] ~= '' then " +
  "  redis.call('sadd', KEYS[2], ARGV[3]) " +
  "end " +
  "return cjson.encode({ created = true })";

export async function kvReserveSubmissionChallenge(
  challengeKey: string,
  submissionJson: string,
  ttlSec = 604800,
  indexSetKey?: string,
  indexMember?: string
): Promise<{ created: boolean; submission?: string }> {
  const args: Array<string | number> = [
    'EVAL',
    RESERVE_SUBMISSION_CHALLENGE_LUA,
    indexSetKey ? 2 : 1,
    challengeKey,
  ];
  if (indexSetKey) args.push(indexSetKey);
  args.push(submissionJson, ttlSec);
  if (indexMember) args.push(indexMember);

  const res = await cmd(args);
  if (!res) return { created: false };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as { created: boolean; submission?: string };
  } catch {
    return { created: false };
  }
}

export const ADVANCE_SUBMISSION_RESERVATION_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ ok = false, reason = 'NOT_FOUND' }) end " +
  "local r = cjson.decode(raw) " +
  "local nowMs = tonumber(ARGV[2]) or 0 " +
  "local newState = ARGV[1] " +
  "r.state = newState " +
  "r.updatedAt = nowMs " +
  "if ARGV[3] and ARGV[3] ~= '' then " +
  "  local ok, meta = pcall(cjson.decode, ARGV[3]) " +
  "  if ok and type(meta) == 'table' then " +
  "    if not r.recoveryMetadata then r.recoveryMetadata = {} end " +
  "    for k, v in pairs(meta) do r.recoveryMetadata[k] = v end " +
  "  end " +
  "end " +
  "local ttl = tonumber(ARGV[4]) or 604800 " +
  "redis.call('set', KEYS[1], cjson.encode(r), 'EX', ttl) " +
  "return cjson.encode({ ok = true, reservation = r })";

export async function kvAdvanceSubmissionReservation(
  challengeKey: string,
  newState: string,
  nowMs = Date.now(),
  metadata?: Record<string, unknown>,
  ttlSec = 604800
): Promise<{ ok: boolean; reason?: string; reservation?: unknown }> {
  const metaJson = metadata ? JSON.stringify(metadata) : '';
  const res = await cmd([
    'EVAL',
    ADVANCE_SUBMISSION_RESERVATION_LUA,
    1,
    challengeKey,
    newState,
    nowMs,
    metaJson,
    ttlSec,
  ]);
  if (!res) return { ok: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as {
      ok: boolean;
      reason?: string;
      reservation?: unknown;
    };
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' };
  }
}

export async function kvScan(
  cursor: string | number,
  pattern: string,
  count = 100
): Promise<[string, string[]]> {
  const res = (await cmd(['SCAN', cursor, 'MATCH', pattern, 'COUNT', count])) as [
    string | number,
    string[]
  ];
  if (!res || !Array.isArray(res)) return ['0', []];
  return [String(res[0]), Array.isArray(res[1]) ? res[1] : []];
}

export const CLAIM_NOTIFICATION_DISPATCH_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ ok = false, reason = 'NOT_FOUND' }) end " +
  "local e = cjson.decode(raw) " +
  "if e.status == 'ACCEPTED' or e.status == 'DELIVERED' then " +
  "  return cjson.encode({ ok = false, reason = 'ALREADY_COMPLETED', status = e.status }) " +
  "end " +
  "local nowMs = tonumber(ARGV[2]) " +
  "local leaseMs = tonumber(ARGV[3]) " +
  "if e.status == 'DISPATCHING' then " +
  "  local leaseExp = tonumber(e.dispatchLeaseExpiresAt) or 0 " +
  "  if nowMs <= leaseExp and e.dispatchWorkerId ~= ARGV[1] then " +
  "    return cjson.encode({ ok = false, reason = 'BUSY', workerId = e.dispatchWorkerId }) " +
  "  end " +
  "end " +
  "e.status = 'DISPATCHING' " +
  "e.dispatchWorkerId = ARGV[1] " +
  "e.dispatchLeaseExpiresAt = nowMs + leaseMs " +
  "e.dispatchGeneration = (tonumber(e.dispatchGeneration) or 0) + 1 " +
  "e.attemptCount = (tonumber(e.attemptCount) or 0) + 1 " +
  "e.lastAttemptAt = nowMs " +
  "redis.call('set', KEYS[1], cjson.encode(e)) " +
  "return cjson.encode({ ok = true, dispatchGeneration = e.dispatchGeneration, event = e })";

export async function kvClaimNotificationDispatch(
  eventKey: string,
  workerId: string,
  nowMs = Date.now(),
  leaseMs = 30000
): Promise<{ ok: boolean; dispatchGeneration?: number; reason?: string; status?: string; event?: unknown }> {
  const res = await cmd(['EVAL', CLAIM_NOTIFICATION_DISPATCH_LUA, 1, eventKey, workerId, nowMs, leaseMs]);
  if (!res) return { ok: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as {
      ok: boolean;
      dispatchGeneration?: number;
      reason?: string;
      status?: string;
      event?: unknown;
    };
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' };
  }
}

export const COMPLETE_NOTIFICATION_DISPATCH_LUA =
  "local raw = redis.call('get', KEYS[1]) " +
  "if not raw then return cjson.encode({ ok = false, reason = 'NOT_FOUND' }) end " +
  "local e = cjson.decode(raw) " +
  "if e.dispatchWorkerId ~= ARGV[1] then " +
  "  return cjson.encode({ ok = false, reason = 'STALE_DISPATCH_WORKER' }) " +
  "end " +
  "if tonumber(e.dispatchGeneration) ~= tonumber(ARGV[2]) then " +
  "  return cjson.encode({ ok = false, reason = 'STALE_DISPATCH_GENERATION' }) " +
  "end " +
  "e.status = ARGV[3] " +
  "if ARGV[4] and ARGV[4] ~= '' then e.externalRef = ARGV[4] end " +
  "if ARGV[5] and ARGV[5] ~= '' then e.error = ARGV[5] else e.error = nil end " +
  "e.updatedAt = tonumber(ARGV[6]) or 0 " +
  "redis.call('set', KEYS[1], cjson.encode(e)) " +
  "return cjson.encode({ ok = true, status = e.status, event = e })";

export async function kvCompleteNotificationDispatch(
  eventKey: string,
  workerId: string,
  dispatchGeneration: number,
  status: string,
  externalRef = '',
  error = '',
  nowMs = Date.now()
): Promise<{ ok: boolean; reason?: string; status?: string; event?: unknown }> {
  const res = await cmd([
    'EVAL',
    COMPLETE_NOTIFICATION_DISPATCH_LUA,
    1,
    eventKey,
    workerId,
    dispatchGeneration,
    status,
    externalRef,
    error,
    nowMs,
  ]);
  if (!res) return { ok: false, reason: 'NO_RESPONSE' };
  try {
    return (typeof res === 'string' ? JSON.parse(res) : res) as {
      ok: boolean;
      reason?: string;
      status?: string;
      event?: unknown;
    };
  } catch {
    return { ok: false, reason: 'PARSE_ERROR' };
  }
}
