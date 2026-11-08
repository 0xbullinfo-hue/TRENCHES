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
