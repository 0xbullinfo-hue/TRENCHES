import { KV_CONFIGURED, kvIncrWindow } from './kv';

const mem = new Map<string, { n: number; reset: number }>();

export interface RateResult {
  ok: boolean;
  retryAfter: number;
}

/**
 * Fixed-window rate limiter. Uses Upstash when configured (shared across instances),
 * otherwise an in-process map (per instance — fine for a single server / dev).
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateResult> {
  const now = Date.now();
  const bucket = Math.floor(now / (windowSec * 1000));
  const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowSec * 1000 - now) / 1000));

  if (KV_CONFIGURED) {
    try {
      const n = await kvIncrWindow(`rl:${key}:${bucket}`, windowSec);
      return { ok: n <= limit, retryAfter };
    } catch {
      // fall through to in-memory limiter if the KV is unreachable
    }
  }

  if (mem.size > 10_000) {
    for (const [k, v] of mem) if (v.reset < now) mem.delete(k);
    if (mem.size > 10_000) mem.clear();
  }
  const cur = mem.get(key);
  if (!cur || cur.reset < now) {
    mem.set(key, { n: 1, reset: now + windowSec * 1000 });
    return { ok: true, retryAfter };
  }
  cur.n += 1;
  return { ok: cur.n <= limit, retryAfter: Math.max(1, Math.ceil((cur.reset - now) / 1000)) };
}

/** Client IP. Only trustworthy behind a proxy that overwrites x-forwarded-for (Vercel, Cloudflare, nginx). */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}
