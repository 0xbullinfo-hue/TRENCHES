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
