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

export type ChallengeAuthority = 'redis' | 'db';

export interface RaidChallenge {
  challengeId: string;
  nonce: string;
  campaignId: string;
  walletAddress: string;
  createdAt: number;
  expiresAt: number;
  message: string;
  authority: ChallengeAuthority;
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
 * Assigns an explicit authoritative storage backend ('redis' or 'db').
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

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());
  const authority: ChallengeAuthority = redisActive ? 'redis' : 'db';

  const challenge: RaidChallenge = {
    challengeId,
    nonce,
    campaignId,
    walletAddress,
    createdAt,
    expiresAt,
    message,
    authority,
  };

  if (authority === 'redis') {
    // 1. Authoritative Redis write (must succeed; throws on network/config failure -> fails closed)
    const key = challengeRedisKey(challengeId);
    await kvSetEx(key, JSON.stringify(challenge), CHALLENGE_TTL_SEC);

    // 2. Database audit/mirror record
    try {
      await createRaidChallengeRow({
        challenge_id: challengeId,
        nonce,
        campaign_id: campaignId,
        wallet_address: walletAddress,
        created_at: new Date(createdAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        message,
        authority: 'redis',
      });
    } catch (mirrorErr) {
      // Redis is authoritative; DB mirror write failure is logged for audit but does not fail issuance
      console.warn('[RaidChallenge] DB mirror write error (Redis authoritative):', mirrorErr);
    }
  } else {
    // Database-authoritative mode
    await createRaidChallengeRow({
      challenge_id: challengeId,
      nonce,
      campaign_id: campaignId,
      wallet_address: walletAddress,
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      message,
      authority: 'db',
    });
  }

  return challenge;
}

/**
 * Loads an unconsumed challenge from the authoritative storage backend.
 * Enforces single-authority: a Redis-authoritative challenge is NEVER loaded from DB mirror.
 */
export async function getRaidChallenge(challengeId: string): Promise<RaidChallenge | null> {
  if (!challengeId) return null;

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    let raw: string | null = null;
    try {
      raw = await kvGet(key);
    } catch (err) {
      console.error('[RaidChallenge] Authoritative Redis get error:', err);
      // Fail closed when configured authoritative Redis fails
      throw new Error('Authoritative Redis store is unavailable');
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as RaidChallenge;
        if (Date.now() > parsed.expiresAt) return null;
        return parsed;
      } catch {
        return null;
      }
    }

    // Key was NOT found in Redis.
    // Check if this challenge was issued under DB authority
    const row = await getRaidChallengeRow(challengeId);
    if (!row) return null;

    // MANDATORY RULE: A challenge issued under Redis authority MUST NEVER fall back to DB mirror!
    if (row.authority === 'redis') {
      return null;
    }

    // Genuine DB-authoritative challenge
    if (row.consumed_at) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    return {
      challengeId: row.challenge_id,
      nonce: row.nonce,
      campaignId: row.campaign_id,
      walletAddress: row.wallet_address,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
      message: row.message,
      authority: 'db',
    };
  }

  // Redis is NOT configured
  const row = await getRaidChallengeRow(challengeId);
  if (!row) return null;

  // If the challenge was issued with Redis authority, but Redis is now unavailable: Fail closed!
  if (row.authority === 'redis') {
    throw new Error('Authoritative Redis store is unavailable');
  }

  if (row.consumed_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    challengeId: row.challenge_id,
    nonce: row.nonce,
    campaignId: row.campaign_id,
    walletAddress: row.wallet_address,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
    message: row.message,
    authority: 'db',
  };
}

/**
 * Atomically consumes a challenge so it cannot be reused.
 * Guaranteed single-use execution under concurrent requests and across instances.
 * If Redis is authoritative, Redis Lua is the ONLY authority (never falls back to DB).
 * If Redis is unavailable during consumption, fails closed.
 */
export async function consumeRaidChallenge(challengeId: string): Promise<boolean> {
  if (!challengeId) return false;

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    let consumedInRedis = false;
    try {
      consumedInRedis = await kvConsumeChallenge(key);
    } catch (err) {
      console.error('[RaidChallenge] Authoritative Redis consume error:', err);
      // MANDATORY RULE: Redis errors produce a fail-closed result. No silent DB fallback.
      throw new Error('Authoritative Redis store is unavailable');
    }

    if (consumedInRedis) {
      // Background DB mirror update for audit logging only (definitive decision already made in Redis)
      consumeRaidChallengeRow(challengeId).catch(() => {});
      return true;
    }

    // Key was missing or already consumed in Redis.
    // Check if it was issued as a genuine DB-authoritative challenge
    const row = await getRaidChallengeRow(challengeId);
    if (!row) return false;

    // MANDATORY RULE: Redis-authoritative challenge cannot fall back to DB mirror!
    if (row.authority === 'redis') {
      return false;
    }

    return await consumeRaidChallengeRow(challengeId);
  }

  // Redis is NOT configured
  const row = await getRaidChallengeRow(challengeId);
  if (!row) return false;

  // If issued under Redis, fail closed
  if (row.authority === 'redis') {
    throw new Error('Authoritative Redis store is unavailable');
  }

  return await consumeRaidChallengeRow(challengeId);
}
