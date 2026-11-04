import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { ADMIN_WALLET } from '@/lib/config';
import { KV_CONFIGURED, kvLock } from './kv';

const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

export interface AdminAuthResult {
  authorized: boolean;
  error?: string;
}

export interface WalletAuthResult {
  ok: boolean;
  wallet?: string;
  error?: string;
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
