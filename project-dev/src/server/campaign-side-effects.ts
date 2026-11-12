import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isKvConfigured,
  KV_CONFIGURED,
  kvGet,
  kvSet,
  kvClaimNotificationDispatch,
  kvCompleteNotificationDispatch,
} from '@/server/kv';
import {
  withCampaignsLock,
  loadCampaigns,
  loadSubmissions,
  reconcileCampaignSubmission,
} from '@/server/campaigns-data';
import type { CampaignSubmission, Campaign } from '@/lib/types';

export type SideEffectType = 'REWARD' | 'NOTIFICATION';
export type SideEffectStatus = 'CREATED' | 'DISPATCHING' | 'ACCEPTED' | 'DELIVERED' | 'FAILED';

export interface CampaignSideEffectEvent {
  idempotencyKey: string;
  submissionId: string;
  campaignId: string;
  walletAddress: string;
  type: SideEffectType;
  status: SideEffectStatus;
  payload: Record<string, unknown>;
  attemptCount: number;
  lastAttemptAt?: string | null;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
  externalRef?: string | null;
  dispatchWorkerId?: string | null;
  dispatchLeaseExpiresAt?: number | null;
  dispatchGeneration?: number | null;
}

const SIDE_EFFECTS_DIR = path.join(process.cwd(), 'data', 'campaign_side_effects');
const KV_SIDE_EFFECT_PREFIX = 'trench:camp:sideeffect:';

const isKvActive = () => Boolean(KV_CONFIGURED || isKvConfigured());

export function buildRewardIdempotencyKey(submissionId: string, rewardType = 'airdrop'): string {
  if (!submissionId) throw new Error('submissionId is required for reward idempotency key');
  return `camp_reward:${submissionId}:${rewardType}`;
}

export function buildNotificationIdempotencyKey(submissionId: string, notificationType = 'submission_verified'): string {
  if (!submissionId) throw new Error('submissionId is required for notification idempotency key');
  return `camp_notify:${submissionId}:${notificationType}`;
}

// Test failure injection hooks
let _testFailNextRewardRecord: Error | null = null;
let _testFailNextNotificationEnqueue: Error | null = null;
let _testFailNextNotificationDispatch: Error | null = null;

export function __setTestFailNextRewardRecord(err: Error | null) {
  _testFailNextRewardRecord = err;
}

export function __setTestFailNextNotificationEnqueue(err: Error | null) {
  _testFailNextNotificationEnqueue = err;
}

export function __setTestFailNextNotificationDispatch(err: Error | null) {
  _testFailNextNotificationDispatch = err;
}

export async function getSideEffectEvent(idempotencyKey: string): Promise<CampaignSideEffectEvent | null> {
  if (!idempotencyKey) return null;

  if (isKvActive()) {
    try {
      const raw = await kvGet(`${KV_SIDE_EFFECT_PREFIX}${idempotencyKey}`);
      if (raw) return JSON.parse(raw) as CampaignSideEffectEvent;
    } catch {}
    return null;
  }

  const filePath = path.join(SIDE_EFFECTS_DIR, `${encodeURIComponent(idempotencyKey)}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as CampaignSideEffectEvent;
  } catch {
    return null;
  }
}

async function saveSideEffectEvent(event: CampaignSideEffectEvent): Promise<void> {
  event.updatedAt = new Date().toISOString();
  if (isKvActive()) {
    await kvSet(`${KV_SIDE_EFFECT_PREFIX}${event.idempotencyKey}`, JSON.stringify(event));
    return;
  }

  fs.mkdirSync(SIDE_EFFECTS_DIR, { recursive: true });
  const filePath = path.join(SIDE_EFFECTS_DIR, `${encodeURIComponent(event.idempotencyKey)}.json`);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(event, null, 2), 'utf-8');
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    fs.writeFileSync(filePath, JSON.stringify(event, null, 2), 'utf-8');
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Idempotently records a durable reward allocation tied to a submission.
 * Enforces stable identity: `camp_reward:${submissionId}:${rewardType}`.
 * If called repeatedly or concurrently, returns the existing durable reward without duplicating.
 */
export async function recordCampaignRewardAllocation(params: {
  submission: CampaignSubmission;
  campaign: Campaign;
  rewardType?: string;
}): Promise<{ ok: boolean; isExisting: boolean; event: CampaignSideEffectEvent; error?: string }> {
  const { submission, campaign, rewardType = 'airdrop' } = params;
  const idempotencyKey = buildRewardIdempotencyKey(submission.id, rewardType);

  return withCampaignsLock(async () => {
    // 1. Check if reward already exists
    const existing = await getSideEffectEvent(idempotencyKey);
    if (existing) {
      return { ok: true, isExisting: true, event: existing };
    }

    // 2. Failure injection for fault testing
    if (_testFailNextRewardRecord) {
      const err = _testFailNextRewardRecord;
      _testFailNextRewardRecord = null;
      throw err;
    }

    const newEvent: CampaignSideEffectEvent = {
      idempotencyKey,
      submissionId: submission.id,
      campaignId: campaign.id,
      walletAddress: submission.walletAddress,
      type: 'REWARD',
      status: 'CREATED',
      payload: {
        rewardAmount: campaign.rewardAmount,
        rewardToken: campaign.rewardToken || '$GENESIS',
        rewardType,
      },
      attemptCount: 0,
      lastAttemptAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveSideEffectEvent(newEvent);
    return { ok: true, isExisting: false, event: newEvent };
  });
}

/**
 * Idempotently enqueues a durable notification event in the outbox.
 * Enforces stable identity: `camp_notify:${submissionId}:${notificationType}`.
 */
export async function enqueueCampaignNotification(params: {
  submission: CampaignSubmission;
  campaign: Campaign;
  notificationType?: string;
}): Promise<{ ok: boolean; isExisting: boolean; event: CampaignSideEffectEvent; error?: string }> {
  const { submission, campaign, notificationType = 'submission_verified' } = params;
  const idempotencyKey = buildNotificationIdempotencyKey(submission.id, notificationType);

  return withCampaignsLock(async () => {
    const existing = await getSideEffectEvent(idempotencyKey);
    if (existing) {
      return { ok: true, isExisting: true, event: existing };
    }

    if (_testFailNextNotificationEnqueue) {
      const err = _testFailNextNotificationEnqueue;
      _testFailNextNotificationEnqueue = null;
      throw err;
    }

    const newEvent: CampaignSideEffectEvent = {
      idempotencyKey,
      submissionId: submission.id,
      campaignId: campaign.id,
      walletAddress: submission.walletAddress,
      type: 'NOTIFICATION',
      status: 'CREATED',
      payload: {
        notificationType,
        xHandle: submission.xHandle,
        campaignTitle: campaign.title,
      },
      attemptCount: 0,
      lastAttemptAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveSideEffectEvent(newEvent);
    return { ok: true, isExisting: false, event: newEvent };
  });
}

/**
 * Atomically claims a dispatch lease for a notification event.
 * Prevents multiple workers from dispatching the same event concurrently.
 */
export async function claimNotificationDispatch(
  idempotencyKey: string,
  workerId: string,
  leaseMs = 30000
): Promise<{
  ok: boolean;
  dispatchGeneration?: number;
  reason?: string;
  status?: string;
  event?: CampaignSideEffectEvent;
}> {
  if (isKvActive()) {
    const res = await kvClaimNotificationDispatch(
      `${KV_SIDE_EFFECT_PREFIX}${idempotencyKey}`,
      workerId,
      Date.now(),
      leaseMs
    );
    if (!res.ok) {
      return { ok: false, reason: res.reason, status: res.status };
    }
    return { ok: true, dispatchGeneration: res.dispatchGeneration, event: res.event as CampaignSideEffectEvent };
  }

  return withCampaignsLock(async () => {
    const event = await getSideEffectEvent(idempotencyKey);
    if (!event) return { ok: false, reason: 'NOT_FOUND' };
    if (event.status === 'ACCEPTED' || event.status === 'DELIVERED') {
      return { ok: false, reason: 'ALREADY_COMPLETED', status: event.status, event };
    }
    const now = Date.now();
    if (event.status === 'DISPATCHING') {
      const leaseExp = Number(event.dispatchLeaseExpiresAt) || 0;
      if (now <= leaseExp && event.dispatchWorkerId !== workerId) {
        return { ok: false, reason: 'BUSY', status: 'DISPATCHING', event };
      }
    }
    event.status = 'DISPATCHING';
    event.dispatchWorkerId = workerId;
    event.dispatchLeaseExpiresAt = now + leaseMs;
    event.dispatchGeneration = (Number(event.dispatchGeneration) || 0) + 1;
    event.attemptCount = (Number(event.attemptCount) || 0) + 1;
    event.lastAttemptAt = new Date().toISOString();
    await saveSideEffectEvent(event);
    return { ok: true, dispatchGeneration: event.dispatchGeneration, event };
  });
}

/**
 * Atomically records completion for a notification event dispatch attempt.
 * Verifies that workerId and dispatchGeneration match the current lease.
 */
export async function completeNotificationDispatch(
  idempotencyKey: string,
  workerId: string,
  dispatchGeneration: number,
  status: SideEffectStatus,
  externalRef?: string | null,
  error?: string | null
): Promise<{ ok: boolean; reason?: string; event?: CampaignSideEffectEvent }> {
  if (isKvActive()) {
    const res = await kvCompleteNotificationDispatch(
      `${KV_SIDE_EFFECT_PREFIX}${idempotencyKey}`,
      workerId,
      dispatchGeneration,
      status,
      externalRef || '',
      error || ''
    );
    if (!res.ok) return { ok: false, reason: res.reason };
    return { ok: true, event: res.event as CampaignSideEffectEvent };
  }

  return withCampaignsLock(async () => {
    const event = await getSideEffectEvent(idempotencyKey);
    if (!event) return { ok: false, reason: 'NOT_FOUND' };
    if (event.dispatchWorkerId !== workerId) {
      return { ok: false, reason: 'STALE_DISPATCH_WORKER' };
    }
    if (Number(event.dispatchGeneration) !== dispatchGeneration) {
      return { ok: false, reason: 'STALE_DISPATCH_GENERATION' };
    }
    event.status = status;
    event.externalRef = externalRef || null;
    event.error = error || null;
    await saveSideEffectEvent(event);
    return { ok: true, event };
  });
}

/**
 * Dispatches an enqueued durable notification event through an external delivery provider.
 * Guarantees dispatch ownership through atomic leases and generation checks.
 */
export async function dispatchCampaignNotification(
  idempotencyKey: string,
  dispatcher: (event: CampaignSideEffectEvent) => Promise<{
    accepted: boolean;
    delivered?: boolean;
    externalRef?: string;
    error?: string;
  }>,
  options?: { workerId?: string; leaseMs?: number }
): Promise<{ ok: boolean; status: SideEffectStatus; event: CampaignSideEffectEvent; error?: string }> {
  const workerId = options?.workerId || `dispatch-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const leaseMs = options?.leaseMs || 30000;

  const claimRes = await claimNotificationDispatch(idempotencyKey, workerId, leaseMs);
  if (!claimRes.ok || !claimRes.event) {
    if (claimRes.reason === 'ALREADY_COMPLETED') {
      const existing = (await getSideEffectEvent(idempotencyKey)) || claimRes.event;
      return { ok: true, status: (claimRes.status as SideEffectStatus) || 'ACCEPTED', event: existing! };
    }
    const current = await getSideEffectEvent(idempotencyKey);
    return {
      ok: false,
      status: current?.status || 'FAILED',
      event: current!,
      error: claimRes.reason || 'Failed to claim dispatch lease',
    };
  }

  const generation = claimRes.dispatchGeneration || 1;
  const event = claimRes.event;

  if (_testFailNextNotificationDispatch) {
    const err = _testFailNextNotificationDispatch;
    _testFailNextNotificationDispatch = null;
    await completeNotificationDispatch(idempotencyKey, workerId, generation, 'FAILED', null, err.message);
    const updated = await getSideEffectEvent(idempotencyKey);
    return { ok: false, status: 'FAILED', event: updated || event, error: err.message };
  }

  try {
    const result = await dispatcher(event);
    const finalStatus: SideEffectStatus = result.accepted ? (result.delivered ? 'DELIVERED' : 'ACCEPTED') : 'FAILED';
    const compRes = await completeNotificationDispatch(
      idempotencyKey,
      workerId,
      generation,
      finalStatus,
      result.externalRef || null,
      result.error || null
    );
    if (!compRes.ok) {
      const current = await getSideEffectEvent(idempotencyKey);
      return { ok: false, status: current?.status || finalStatus, event: current || event, error: compRes.reason };
    }
    return { ok: result.accepted, status: finalStatus, event: compRes.event || event, error: result.error };
  } catch (dispatchErr) {
    const errMsg = (dispatchErr as Error).message || 'Dispatch network error';
    await completeNotificationDispatch(idempotencyKey, workerId, generation, 'FAILED', null, errMsg);
    const updated = await getSideEffectEvent(idempotencyKey);
    return { ok: false, status: 'FAILED', event: updated || event, error: errMsg };
  }
}

/**
 * Durable side-effect integration: ensures reward allocation and notification events
 * are durably persisted upon accepted or recovered submission.
 */
export async function ensureCampaignSubmissionSideEffects(params: {
  submission: CampaignSubmission;
  campaign: Campaign;
}): Promise<{
  ok: boolean;
  rewardEvent?: CampaignSideEffectEvent;
  notificationEvent?: CampaignSideEffectEvent;
  error?: string;
  missingEvents: string[];
}> {
  const { submission, campaign } = params;
  let rewardEvent: CampaignSideEffectEvent | undefined;
  let notificationEvent: CampaignSideEffectEvent | undefined;
  const missingEvents: string[] = [];

  try {
    const rewardRes = await recordCampaignRewardAllocation({ submission, campaign });
    if (rewardRes.ok) {
      rewardEvent = rewardRes.event;
    } else {
      missingEvents.push('REWARD');
    }
  } catch {
    missingEvents.push('REWARD');
  }

  try {
    const notifyRes = await enqueueCampaignNotification({ submission, campaign });
    if (notifyRes.ok) {
      notificationEvent = notifyRes.event;
    } else {
      missingEvents.push('NOTIFICATION');
    }
  } catch {
    missingEvents.push('NOTIFICATION');
  }

  return {
    ok: missingEvents.length === 0,
    rewardEvent,
    notificationEvent,
    missingEvents,
    error: missingEvents.length > 0 ? `Missing events: ${missingEvents.join(', ')}` : undefined,
  };
}

/**
 * Recovers incomplete background operations across campaigns and submissions.
 */
export async function reconcilePendingCampaignOperations(): Promise<{
  reconciledCounters: number;
  reconciledRewards: number;
  reconciledNotifications: number;
  recoveredDispatchEvents: number;
}> {
  let reconciledCounters = 0;
  let reconciledRewards = 0;
  let reconciledNotifications = 0;
  let recoveredDispatchEvents = 0;

  const campaigns = await loadCampaigns();
  const submissions = await loadSubmissions();

  // 1. Counter reconciliations
  for (const campaign of campaigns) {
    const matching = submissions.filter((s) => s.campaignId === campaign.id);
    if ((campaign.submissionsCount || 0) < matching.length) {
      for (const sub of matching) {
        const res = await reconcileCampaignSubmission(campaign.id, sub.id);
        if (res.ok) {
          reconciledCounters += 1;
          break;
        }
      }
    }
  }

  // 2. Missing side-effects
  for (const sub of submissions) {
    const campaign = campaigns.find((c) => c.id === sub.campaignId);
    if (campaign) {
      const rewardKey = buildRewardIdempotencyKey(sub.id);
      const existingReward = await getSideEffectEvent(rewardKey);
      if (!existingReward) {
        const res = await recordCampaignRewardAllocation({ submission: sub, campaign });
        if (res.ok) reconciledRewards += 1;
      }

      const notifyKey = buildNotificationIdempotencyKey(sub.id);
      const existingNotify = await getSideEffectEvent(notifyKey);
      if (!existingNotify) {
        const res = await enqueueCampaignNotification({ submission: sub, campaign });
        if (res.ok) reconciledNotifications += 1;
      } else if (existingNotify.status === 'DISPATCHING') {
        const leaseExp = Number(existingNotify.dispatchLeaseExpiresAt) || 0;
        if (Date.now() > leaseExp) {
          existingNotify.status = 'CREATED';
          existingNotify.dispatchWorkerId = null;
          existingNotify.dispatchLeaseExpiresAt = null;
          await saveSideEffectEvent(existingNotify);
          recoveredDispatchEvents += 1;
        }
      }
    }
  }

  return {
    reconciledCounters,
    reconciledRewards,
    reconciledNotifications,
    recoveredDispatchEvents,
  };
}

