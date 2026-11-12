import crypto from 'crypto';
import {
  KV_CONFIGURED,
  isKvConfigured,
  kvGet,
  kvSetEx,
  kvConsumeChallenge,
  kvFinalizeChallengeTombstone,
  kvRollbackChallenge,
  kvClaimChallengeProcessing,
  kvFinalizeChallengeProcessing,
  kvRollbackChallengeProcessing,
  kvReconcileChallengeCompleted,
  KvChallengeClaimResult,
  KvChallengeFinalizeResult,
  KvChallengeRollbackResult,
} from '@/server/kv';
import {
  createRaidChallengeRow,
  getRaidChallengeRow,
  consumeRaidChallengeRow,
  rollbackRaidChallengeRow,
  claimRaidChallengeProcessingRow,
  finalizeRaidChallengeProcessingRow,
  rollbackRaidChallengeProcessingRow,
  reconcileRaidChallengeCompletedRow,
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

export type RaidChallengeState =
  | { status: 'ACTIVE'; challenge: RaidChallenge }
  | {
      status: 'PROCESSING';
      attemptId?: string;
      fencingToken?: number;
      leaseExpiresAt?: number;
      isLeaseExpired?: boolean;
      challenge: RaidChallenge;
    }
  | {
      status: 'COMPLETED';
      completedAt?: number;
      submissionId?: string;
      attemptId?: string;
      idempotencyKey?: string;
    }
  | { status: 'CONSUMED'; consumedAt?: number; submissionId?: string; attemptId?: string }
  | { status: 'EXPIRED' }
  | { status: 'NOT_FOUND' };

export type ConsumeChallengeOutcome = {
  success: boolean;
  status: 'CONSUMED' | 'ALREADY_CONSUMED' | 'EXPIRED' | 'NOT_FOUND';
};

/**
 * Loads the authoritative lifecycle state of a challenge.
 * Returns explicit state (ACTIVE, PROCESSING, COMPLETED, CONSUMED, EXPIRED, NOT_FOUND) without relying on asynchronous DB mirror timing.
 */
export async function getRaidChallengeState(challengeId: string): Promise<RaidChallengeState> {
  if (!challengeId) return { status: 'NOT_FOUND' };

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
        const parsed = JSON.parse(raw);
        if (parsed.status === 'consumed') {
          return {
            status: 'CONSUMED',
            consumedAt: parsed.consumedAt || parsed.completedAt,
            submissionId: parsed.submissionId,
            attemptId: parsed.attemptId,
          };
        }
        if (parsed.status === 'COMPLETED') {
          return {
            status: 'COMPLETED',
            completedAt: parsed.completedAt || parsed.consumedAt,
            submissionId: parsed.submissionId,
            attemptId: parsed.attemptId,
            idempotencyKey: parsed.idempotencyKey || `raid-submission:${parsed.challengeId || challengeId}`,
          };
        }
        if (parsed.status === 'PROCESSING') {
          const isLeaseExpired =
            typeof parsed.processingLeaseExpiresAt === 'number' &&
            Date.now() > parsed.processingLeaseExpiresAt;
          return {
            status: 'PROCESSING',
            attemptId: parsed.attemptId,
            fencingToken: parsed.fencingToken,
            leaseExpiresAt: parsed.processingLeaseExpiresAt,
            isLeaseExpired,
            challenge: parsed as RaidChallenge,
          };
        }
        if (Date.now() > parsed.expiresAt) {
          return { status: 'EXPIRED' };
        }
        return { status: 'ACTIVE', challenge: parsed as RaidChallenge };
      } catch {
        return { status: 'NOT_FOUND' };
      }
    }

    // Key was NOT found in Redis.
    // Check if this challenge was issued under DB authority or has a recorded DB mirror
    const row = await getRaidChallengeRow(challengeId);
    if (!row) return { status: 'NOT_FOUND' };

    // MANDATORY RULE: A challenge issued under Redis authority MUST NEVER fall back to DB mirror to authorize!
    if (row.authority === 'redis') {
      if ((row.status as string) === 'consumed' || (row.consumed_at && row.status !== 'COMPLETED')) {
        return {
          status: 'CONSUMED',
          consumedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
          submissionId: row.submission_id || undefined,
          attemptId: row.attempt_id || undefined,
        };
      }
      if (row.status === 'COMPLETED') {
        return {
          status: 'COMPLETED',
          completedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
          submissionId: row.submission_id || undefined,
          attemptId: row.attempt_id || undefined,
        };
      }
      return { status: 'NOT_FOUND' };
    }

    // Genuine DB-authoritative challenge
    if ((row.status as string) === 'consumed' || (row.consumed_at && row.status !== 'COMPLETED')) {
      return {
        status: 'CONSUMED',
        consumedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
        submissionId: row.submission_id || undefined,
        attemptId: row.attempt_id || undefined,
      };
    }
    if (row.status === 'COMPLETED') {
      return {
        status: 'COMPLETED',
        completedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
        submissionId: row.submission_id || undefined,
        attemptId: row.attempt_id || undefined,
      };
    }
    if (row.status === 'PROCESSING') {
      const leaseExp = row.processing_lease_expires_at
        ? new Date(row.processing_lease_expires_at).getTime()
        : 0;
      return {
        status: 'PROCESSING',
        attemptId: row.attempt_id || undefined,
        fencingToken: row.fencing_token || undefined,
        leaseExpiresAt: leaseExp,
        isLeaseExpired: Date.now() > leaseExp,
        challenge: {
          challengeId: row.challenge_id,
          nonce: row.nonce,
          campaignId: row.campaign_id,
          walletAddress: row.wallet_address,
          createdAt: new Date(row.created_at).getTime(),
          expiresAt: new Date(row.expires_at).getTime(),
          message: row.message,
          authority: 'db',
        },
      };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { status: 'EXPIRED' };
    }
    return {
      status: 'ACTIVE',
      challenge: {
        challengeId: row.challenge_id,
        nonce: row.nonce,
        campaignId: row.campaign_id,
        walletAddress: row.wallet_address,
        createdAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        message: row.message,
        authority: 'db',
      },
    };
  }

  // Redis is NOT configured
  const row = await getRaidChallengeRow(challengeId);
  if (!row) return { status: 'NOT_FOUND' };

  // If the challenge was issued with Redis authority, but Redis is now unavailable: Fail closed!
  if (row.authority === 'redis') {
    throw new Error('Authoritative Redis store is unavailable');
  }

  if (row.status === 'COMPLETED' || row.consumed_at) {
    return {
      status: 'COMPLETED',
      completedAt: row.consumed_at ? new Date(row.consumed_at).getTime() : undefined,
      submissionId: row.submission_id || undefined,
      attemptId: row.attempt_id || undefined,
    };
  }
  if (row.status === 'PROCESSING') {
    const leaseExp = row.processing_lease_expires_at
      ? new Date(row.processing_lease_expires_at).getTime()
      : 0;
    return {
      status: 'PROCESSING',
      attemptId: row.attempt_id || undefined,
      fencingToken: row.fencing_token || undefined,
      leaseExpiresAt: leaseExp,
      isLeaseExpired: Date.now() > leaseExp,
      challenge: {
        challengeId: row.challenge_id,
        nonce: row.nonce,
        campaignId: row.campaign_id,
        walletAddress: row.wallet_address,
        createdAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        message: row.message,
        authority: 'db',
      },
    };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { status: 'EXPIRED' };
  }
  return {
    status: 'ACTIVE',
    challenge: {
      challengeId: row.challenge_id,
      nonce: row.nonce,
      campaignId: row.campaign_id,
      walletAddress: row.wallet_address,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
      message: row.message,
      authority: 'db',
    },
  };
}

/**
 * Loads an unconsumed challenge from the authoritative storage backend.
 * Enforces single-authority: a Redis-authoritative challenge is NEVER loaded from DB mirror.
 */
export async function getRaidChallenge(challengeId: string): Promise<RaidChallenge | null> {
  const state = await getRaidChallengeState(challengeId);
  if (state.status === 'ACTIVE') {
    return state.challenge;
  }
  return null;
}

/**
 * Atomically consumes a challenge so it cannot be reused.
 * Returns detailed outcome (CONSUMED, ALREADY_CONSUMED, EXPIRED, NOT_FOUND).
 */
export async function consumeRaidChallengeOutcome(
  challengeId: string
): Promise<ConsumeChallengeOutcome> {
  if (!challengeId) return { success: false, status: 'NOT_FOUND' };

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    let redisStatus;
    try {
      redisStatus = await kvConsumeChallenge(key, Date.now(), 120);
    } catch (err) {
      console.error('[RaidChallenge] Authoritative Redis consume error:', err);
      // MANDATORY RULE: Redis errors produce a fail-closed result. No silent DB fallback.
      throw new Error('Authoritative Redis store is unavailable');
    }

    if (redisStatus === 'CONSUMED') {
      // Background DB mirror update for audit logging only (definitive decision already made in Redis)
      consumeRaidChallengeRow(challengeId).catch(() => {});
      return { success: true, status: 'CONSUMED' };
    }

    if (redisStatus === 'ALREADY_CONSUMED') {
      return { success: false, status: 'ALREADY_CONSUMED' };
    }

    if (redisStatus === 'EXPIRED') {
      return { success: false, status: 'EXPIRED' };
    }

    // Key was NOT_FOUND in Redis.
    // Check if it was issued as a genuine DB-authoritative challenge
    const row = await getRaidChallengeRow(challengeId);
    if (!row) return { success: false, status: 'NOT_FOUND' };

    // MANDATORY RULE: Redis-authoritative challenge cannot fall back to DB mirror!
    if (row.authority === 'redis') {
      if (row.consumed_at) {
        return { success: false, status: 'ALREADY_CONSUMED' };
      }
      return { success: false, status: 'NOT_FOUND' };
    }

    // Genuine DB-authoritative challenge
    const rowConsumed = await consumeRaidChallengeRow(challengeId);
    if (rowConsumed) {
      return { success: true, status: 'CONSUMED' };
    }
    if (row.consumed_at) {
      return { success: false, status: 'ALREADY_CONSUMED' };
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return { success: false, status: 'EXPIRED' };
    }
    return { success: false, status: 'NOT_FOUND' };
  }

  // Redis is NOT configured
  const row = await getRaidChallengeRow(challengeId);
  if (!row) return { success: false, status: 'NOT_FOUND' };

  // If issued under Redis, fail closed
  if (row.authority === 'redis') {
    throw new Error('Authoritative Redis store is unavailable');
  }

  if (row.consumed_at) {
    return { success: false, status: 'ALREADY_CONSUMED' };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { success: false, status: 'EXPIRED' };
  }

  const rowConsumed = await consumeRaidChallengeRow(challengeId);
  if (rowConsumed) {
    return { success: true, status: 'CONSUMED' };
  }
  return { success: false, status: 'ALREADY_CONSUMED' };
}

/**
 * Backward-compatible boolean consumer.
 */
export async function consumeRaidChallenge(challengeId: string): Promise<boolean> {
  const outcome = await consumeRaidChallengeOutcome(challengeId);
  return outcome.success;
}

/**
 * Finalizes the consumed tombstone with the persisted submissionId.
 */
export async function finalizeRaidChallengeTombstone(
  challengeId: string,
  submissionId: string
): Promise<void> {
  if (!challengeId || !submissionId) return;
  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    await kvFinalizeChallengeTombstone(key, submissionId).catch((err) => {
      console.warn('[RaidChallenge] Failed to finalize tombstone with submissionId in Redis:', err);
    });
  }
}

/**
 * Rolls back a consumed challenge in authoritative storage when submission persistence fails.
 * Guarantees a transient storage error does not permanently destroy a legitimate user submission.
 */
export async function rollbackRaidChallenge(
  challengeId: string,
  challenge: RaidChallenge
): Promise<boolean> {
  if (!challengeId || !challenge) return false;
  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    const remainingMs = challenge.expiresAt - Date.now();
    if (remainingMs <= 0) return false;
    const remainingSec = Math.ceil(remainingMs / 1000);
    try {
      return await kvRollbackChallenge(key, JSON.stringify(challenge), remainingSec);
    } catch (err) {
      console.error('[RaidChallenge] Rollback error in Redis:', err);
      return false;
    }
  }

  // Database-authoritative mode rollback
  return await rollbackRaidChallengeRow(challengeId);
}

/**
 * V2.5 Ownership-Controlled Processing Lifecycle:
 * Atomically claims a challenge for processing with a unique attempt ID and fencing token.
 */
export async function claimRaidChallengeProcessing(
  challengeId: string,
  attemptId: string,
  leaseDurationMs = 30000
): Promise<KvChallengeClaimResult> {
  if (!challengeId || !attemptId) return { status: 'NOT_FOUND' };

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    let claimRes: KvChallengeClaimResult;
    try {
      claimRes = await kvClaimChallengeProcessing(key, attemptId, Date.now(), leaseDurationMs, 120);
    } catch (err) {
      console.error('[RaidChallenge] Authoritative Redis claim error:', err);
      throw new Error('Authoritative Redis store is unavailable');
    }

    if (claimRes.status === 'NOT_FOUND') {
      // Check if genuine DB-authoritative challenge
      const row = await getRaidChallengeRow(challengeId);
      if (!row) return { status: 'NOT_FOUND' };
      if (row.authority === 'redis') {
        if (row.status === 'COMPLETED' || row.consumed_at) {
          return {
            status: 'COMPLETED',
            submissionId: row.submission_id || undefined,
            attemptId: row.attempt_id || undefined,
          };
        }
        return { status: 'NOT_FOUND' };
      }
      return await claimRaidChallengeProcessingRow(challengeId, attemptId, leaseDurationMs);
    }

    return claimRes;
  }

  // Database-authoritative mode
  const row = await getRaidChallengeRow(challengeId);
  if (!row) return { status: 'NOT_FOUND' };

  if (row.authority === 'redis') {
    throw new Error('Authoritative Redis store is unavailable');
  }

  return await claimRaidChallengeProcessingRow(challengeId, attemptId, leaseDurationMs);
}

/**
 * V2.5 Finalizes processing to COMPLETED only if the worker's attemptId and fencingToken match.
 */
export async function finalizeRaidChallengeProcessing(
  challengeId: string,
  attemptId: string,
  fencingToken: number,
  submissionId: string
): Promise<KvChallengeFinalizeResult> {
  if (!challengeId || !attemptId) return { success: false, reason: 'INVALID_PARAMS' };

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    let finalizeRes: KvChallengeFinalizeResult;
    try {
      finalizeRes = await kvFinalizeChallengeProcessing(
        key,
        attemptId,
        fencingToken,
        submissionId,
        Date.now(),
        120
      );
    } catch (err) {
      console.warn('[RaidChallenge] Redis finalization threw error:', err);
      throw new Error('Authoritative Redis store is unavailable during finalization');
    }

    // Mirror to DB under background task
    finalizeRaidChallengeProcessingRow(challengeId, attemptId, fencingToken, submissionId).catch(() => {});
    return finalizeRes;
  }

  return await finalizeRaidChallengeProcessingRow(challengeId, attemptId, fencingToken, submissionId);
}

/**
 * V2.5 Ownership-Protected Rollback:
 * Atomically rolls back a PROCESSING challenge to ACTIVE only if the original attempt still holds ownership.
 */
export async function rollbackRaidChallengeProcessing(
  challengeId: string,
  attemptId: string,
  fencingToken: number,
  challenge: RaidChallenge
): Promise<KvChallengeRollbackResult> {
  if (!challengeId || !attemptId || !challenge) return { success: false, reason: 'INVALID_PARAMS' };

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());

  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    const remainingMs = challenge.expiresAt - Date.now();
    if (remainingMs <= 0) return { success: false, reason: 'EXPIRED' };
    const remainingSec = Math.ceil(remainingMs / 1000);
    try {
      return await kvRollbackChallengeProcessing(key, attemptId, fencingToken, remainingSec);
    } catch (err) {
      console.error('[RaidChallenge] Ownership rollback error in Redis:', err);
      return { success: false, reason: 'REDIS_ERROR' };
    }
  }

  return await rollbackRaidChallengeProcessingRow(challengeId, attemptId, fencingToken);
}

/**
 * Reconciles challenge state to COMPLETED when a retry finds the durable submission in the DB
 * after an interrupted previous Redis finalization.
 */
export async function reconcileRaidChallengeCompleted(
  challengeId: string,
  submissionId: string
): Promise<boolean> {
  if (!challengeId || !submissionId) return false;

  const redisActive = Boolean(KV_CONFIGURED || isKvConfigured());
  if (redisActive) {
    const key = challengeRedisKey(challengeId);
    try {
      await kvReconcileChallengeCompleted(key, submissionId, Date.now(), 120);
    } catch (err) {
      console.warn('[RaidChallenge] Redis reconciliation error:', err);
    }
  }

  return await reconcileRaidChallengeCompletedRow(challengeId, submissionId);
}
