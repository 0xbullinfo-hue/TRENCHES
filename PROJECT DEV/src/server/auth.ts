import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { ADMIN_WALLET } from '@/lib/config';
import { KV_CONFIGURED, kvLock } from './kv';
import { resolveTier } from './db';

const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

export const SESSION_COOKIE_NAME = 'trench_session';
export const SESSION_MAX_AGE_SEC = 24 * 3600; // 24 hours
const DEV_ONLY_SESSION_SECRET = 'dev-only-session-secret-do-not-use-in-production';

/**
 * Session HMAC secret. Production REQUIRES a dedicated SESSION_SECRET (>= 32 chars); there is no
 * fallback to any other secret. Resolved lazily so `next build` does not need it.
 */
function getSessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === 'production') {
    console.error('[TrenchLabs Auth] SESSION_SECRET is missing or shorter than 32 chars; sessions are disabled.');
    return null;
  }
  return DEV_ONLY_SESSION_SECRET;
}

export interface AdminAuthResult {
  authorized: boolean;
  error?: string;
}

export interface WalletAuthResult {
  ok: boolean;
  wallet?: string;
  error?: string;
}

export interface AuthSession {
  wallet: string;
  tier: 'free' | 'member' | 'pro';
}

export function signSession(wallet: string, maxAgeSec = SESSION_MAX_AGE_SEC): string {
  const secret = getSessionSecret();
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const exp = Math.floor(Date.now() / 1000) + maxAgeSec;
  const payload = `${wallet}|${exp}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hmac}`;
}

export function verifySessionToken(token: string): { wallet: string } | null {
  if (!token) return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const secret = getSessionSecret();
  if (!secret) return null; // fail closed

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [wallet, expStr] = payload.split('|');
  const exp = Number(expStr);
  if (!wallet || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return { wallet };
}

export function parseCookieHeader(cookieHeader?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx);
    const v = trimmed.slice(idx + 1);
    if (!v) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Validates authenticated request session from cookie or cryptographic headers.
 */
export async function getAuthSession(req: Request): Promise<AuthSession | null> {
  // 1. Try session cookie first
  const cookieHeader = req.headers.get('cookie');
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    const verified = verifySessionToken(token);
    if (verified?.wallet) {
      const tier = await resolveTier(verified.wallet);
      return { wallet: verified.wallet, tier };
    }
  }

  // 2. Fallback to cryptographic headers if provided
  const walletAuth = verifyWalletAuth(req);
  if (walletAuth.ok && walletAuth.wallet) {
    const tier = await resolveTier(walletAuth.wallet);
    return { wallet: walletAuth.wallet, tier };
  }

  return null;
}

/**
 * Cryptographically verifies an ed25519 signature from a Solana wallet.
 */
export function verifySolanaSignature(
  publicKeyBase58: string,
  signatureHex: string,
  message: string
): boolean {
  try {
    const pubKeyBytes = new PublicKey(publicKeyBase58).toBuffer();
    const spki = Buffer.concat([ED25519_SPKI_DER_PREFIX, pubKeyBytes]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const sigBytes = Buffer.from(signatureHex, 'hex');
    const msgBytes = Buffer.from(message, 'utf-8');
    return crypto.verify(null, msgBytes, pubKey, sigBytes);
  } catch {
    return false;
  }
}

/**
 * Proves the caller controls `x-wallet` by verifying an ed25519 signature over a short-lived message.
 */
export function verifyWalletAuth(req: Request): WalletAuthResult {
  const headers = req.headers;
  const wallet = headers.get('x-wallet')?.trim();
  const sig = headers.get('x-signature')?.trim();
  const ts = Number(headers.get('x-timestamp'));

  if (!wallet || !sig || !Number.isFinite(ts)) {
    return { ok: false, error: 'Missing x-wallet / x-timestamp / x-signature headers.' };
  }

  if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return { ok: false, error: 'Signature expired or timestamp drift exceeded.' };
  }

  // Bound to method + path so a captured signature cannot be replayed against any other endpoint.
  const msg = ['TrenchLabs Access', req.method, new URL(req.url).pathname, ts].join('|');
  if (!verifySolanaSignature(wallet, sig, msg)) {
    return { ok: false, error: 'Invalid wallet cryptographic signature.' };
  }

  return { ok: true, wallet };
}

// In-memory signature replay cache (signature -> expiry timestamp)
const seenSignatures = new Map<string, number>();

/**
 * Validates admin request authorization for mutations (POST, PATCH, DELETE).
 * Cryptographically verifies that the request was signed by the ADMIN_WALLET,
 * binds the signature to method + path + body hash, and enforces replay prevention.
 */
export async function verifyAdminAuth(req: Request, rawBody: string): Promise<AdminAuthResult> {
  const h = req.headers;
  const wallet = h.get('x-admin-wallet')?.trim();
  const ts = Number(h.get('x-admin-timestamp'));
  const sig = h.get('x-admin-signature')?.trim();

  if (wallet !== ADMIN_WALLET) {
    return { authorized: false, error: 'Not the authorized admin wallet.' };
  }

  if (!sig || !Number.isFinite(ts)) {
    return { authorized: false, error: 'Missing cryptographic signature or timestamp header.' };
  }

  if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return { authorized: false, error: 'Admin signature expired.' };
  }

  const url = new URL(req.url);
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const msg = ['TrenchLabs Admin', req.method, url.pathname + url.search, ts, bodyHash].join('|');

  if (!verifySolanaSignature(wallet, sig, msg)) {
    return { authorized: false, error: 'Invalid admin cryptographic signature.' };
  }

  const replayId = crypto.createHash('sha256').update(sig).digest('hex');
  const ttlSeconds = Math.ceil(MAX_TIMESTAMP_DRIFT_MS / 1000);

  if (process.env.NODE_ENV === 'production' && !KV_CONFIGURED) {
    return { authorized: false, error: 'Shared replay protection is unavailable.' };
  }

  if (KV_CONFIGURED) {
    // Shared atomic lock across serverless instances
    const firstUse = await kvLock(`admin-replay:${replayId}`, 'used', ttlSeconds);
    if (!firstUse) {
      return { authorized: false, error: 'Signature replay detected.' };
    }
  } else {
    // Development-only process fallback
    if (seenSignatures.has(sig)) {
      return { authorized: false, error: 'Signature replay detected.' };
    }
    const now = Date.now();
    seenSignatures.set(sig, now + MAX_TIMESTAMP_DRIFT_MS);
    for (const [k, exp] of seenSignatures) {
      if (exp < now) seenSignatures.delete(k);
    }
  }

  return { authorized: true };
}
