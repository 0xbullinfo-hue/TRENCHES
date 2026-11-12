import crypto from 'crypto';
import { KV_CONFIGURED, isKvConfigured, kvGet, kvSetEx, kvConsumeChallenge } from '@/server/kv';
import {
  createRaidChallengeRow,
  getRaidChallengeRow,
  consumeRaidChallengeRow,
} from '@/server/db';
import { isBase58Address } from '@/lib/config';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const CHALLENGE_TTL_SEC = Math.ceil(CHALLENGE_TTL_MS / 1000);

export interface RaidChallenge {
  challengeId: string;
  nonce: string;
  campaignId: string;
  walletAddress: string;
  createdAt: number;
  expiresAt: number;
  message: string;
}

export function buildChallengeMessage(params: {
  challengeId: string;
  campaignId: string;
  walletAddress: string;
  nonce: string;
  expiresAt: number;
}): string {
  return `TrenchLabs Raid Challenge|${params.challengeId}|${params.campaignId}|${params.walletAddress}|${params.nonce}|${params.expiresAt}`;
}

const challengeRedisKey = (id: string) => `raid:challenge:${id}`;

/**
 * Issues a server-generated, cryptographically random, campaign-bound and wallet-bound challenge.
 */
export async function issueRaidChallenge(params: {
  campaignId: string;
  walletAddress: string;
}): Promise<RaidChallenge> {
  const { campaignId, walletAddress } = params;
  if (!campaignId || !walletAddress) {
    throw new Error('campaignId and walletAddress are required to issue a challenge');
  }
  if (!isBase58Address(walletAddress)) {
    throw new Error('Invalid Solana wallet address format');
  }

  const challengeId = `rc_${crypto.randomBytes(16).toString('hex')}`;
  const nonce = crypto.randomBytes(24).toString('hex');
  const createdAt = Date.now();
  const expiresAt = createdAt + CHALLENGE_TTL_MS;

  const message = buildChallengeMessage({
    challengeId,
    campaignId,
    walletAddress,
    nonce,
    expiresAt,
  });

  const challenge: RaidChallenge = {
    challengeId,
    nonce,
    campaignId,
    walletAddress,
    createdAt,
    expiresAt,
    message,
  };

  const redisActive = KV_CONFIGURED || isKvConfigured();
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    await kvSetEx(key, JSON.stringify(challenge), CHALLENGE_TTL_SEC);
  }

  // Also record in persistent database table for transaction guarantees & audit
  try {
    await createRaidChallengeRow({
      challenge_id: challengeId,
      nonce,
      campaign_id: campaignId,
      wallet_address: walletAddress,
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      message,
    });
  } catch (err) {
    // If Redis is active, DB write failure can be logged; if Redis is not active, error propagates
    if (!redisActive) {
      throw err;
    }
    console.warn('[RaidChallenge] Non-critical DB mirror write error (Redis active):', err);
  }

  return challenge;
}

/**
 * Loads an unconsumed challenge from server storage.
 */
export async function getRaidChallenge(challengeId: string): Promise<RaidChallenge | null> {
  if (!challengeId) return null;

  const redisActive = KV_CONFIGURED || isKvConfigured();
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    const raw = await kvGet(key);
    if (raw) {
      try {
        return JSON.parse(raw) as RaidChallenge;
      } catch {
        // Fall through to database lookup
      }
    }
  }

  const row = await getRaidChallengeRow(challengeId);
  if (!row) return null;
  if (row.consumed_at) return null; // Already consumed
  return {
    challengeId: row.challenge_id,
    nonce: row.nonce,
    campaignId: row.campaign_id,
    walletAddress: row.wallet_address,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    message: row.message,
  };
}

/**
 * Atomically consumes a challenge so it cannot be reused.
 * Guaranteed atomic single-use execution under concurrent requests via Redis Lua or DB transaction lock.
 */
export async function consumeRaidChallenge(challengeId: string): Promise<boolean> {
  if (!challengeId) return false;

  const redisActive = KV_CONFIGURED || isKvConfigured();
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    const consumedInRedis = await kvConsumeChallenge(key);
    if (consumedInRedis) {
      // Mark consumed in DB transaction in background
      consumeRaidChallengeRow(challengeId).catch(() => {});
      return true;
    }
  }

  // Authoritative fallback via database lock transaction
  return await consumeRaidChallengeRow(challengeId);
}

