import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { ADMIN_WALLET } from '@/lib/config';

const ED25519_SPKI_DER_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

export interface AdminAuthResult {
  authorized: boolean;
  error?: string;
  isSimulatedDev?: boolean;
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
 * Validates admin request authorization for mutations (POST, PATCH, DELETE).
 * Enforces cryptographic ed25519 wallet signature verification in production.
 */
export function verifyAdminAuth(headers: Headers): AdminAuthResult {
  const adminWallet = headers.get('x-admin-wallet')?.trim();
  const timestampStr = headers.get('x-admin-timestamp')?.trim();
  const signatureHex = headers.get('x-admin-signature')?.trim();
  const isSimulated = headers.get('x-admin-simulated') === 'true';

  if (!adminWallet) {
    return { authorized: false, error: 'Missing x-admin-wallet header.' };
  }

  if (adminWallet !== ADMIN_WALLET) {
    return {
      authorized: false,
      error: `Address ${adminWallet} is not authorized as master admin.`,
    };
  }

  // In non-production local development only, allow explicit preview simulation mode
  if (process.env.NODE_ENV !== 'production' && isSimulated) {
    return { authorized: true, isSimulatedDev: true };
  }

  if (!timestampStr || !signatureHex) {
    return {
      authorized: false,
      error: 'Cryptographic authorization required: missing timestamp or signature header.',
    };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp)) {
    return { authorized: false, error: 'Invalid x-admin-timestamp header.' };
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > MAX_TIMESTAMP_DRIFT_MS) {
    return {
      authorized: false,
      error: `Signature expired or clock drift exceeded (max 5 minutes). Request time: ${timestamp}, Server time: ${now}`,
    };
  }

  const expectedMessage = `TrenchLabs Admin Auth: ${timestamp}`;
  const valid = verifySolanaSignature(adminWallet, signatureHex, expectedMessage);

  if (!valid) {
    return {
      authorized: false,
      error: 'Cryptographic signature verification failed for admin wallet.',
    };
  }

  return { authorized: true };
}

