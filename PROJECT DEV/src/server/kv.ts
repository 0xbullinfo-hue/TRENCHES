/**
 * Minimal Upstash Redis REST client (no extra dependency).
 * Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (server-only env vars).
 * Works on serverless hosts, unlike local-disk persistence.
 */
const KV_URL = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const KV_CONFIGURED = Boolean(KV_URL && KV_TOKEN);

async function cmd(args: Array<string | number>): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4_000);
  try {
    const res = await fetch(KV_URL as string, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
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
  return (await cmd(['SET', key, token, 'NX', 'EX', ttlSec])) === 'OK';
}

export async function kvUnlock(key: string, token: string): Promise<void> {
  await cmd([
    'EVAL',
    "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
    1,
    key,
    token,
  ]);
}
