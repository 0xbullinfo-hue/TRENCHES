import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isKvConfigured, KV_CONFIGURED, kvGet, kvSet } from '@/server/kv';
import { withCampaignsLock } from '@/server/campaigns-data';
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
 * Dispatches an enqueued durable notification event through an external delivery provider.
 * Distinguishes explicitly between:
 * - Event Creation (`CREATED`)
 * - Dispatch Attempt (`DISPATCHING`)
 * - Provider Acceptance (`ACCEPTED`)
 * - Confirmed Delivery (`DELIVERED`)
 * - Delivery Failure (`FAILED`, preserved for safe retry)
 */
export async function dispatchCampaignNotification(
  idempotencyKey: string,
  dispatcher: (event: CampaignSideEffectEvent) => Promise<{
    accepted: boolean;
    delivered?: boolean;
    externalRef?: string;
    error?: string;
  }>
): Promise<{ ok: boolean; status: SideEffectStatus; event: CampaignSideEffectEvent; error?: string }> {
  return withCampaignsLock(async () => {
    const event = await getSideEffectEvent(idempotencyKey);
    if (!event) {
      throw new Error(`Notification event ${idempotencyKey} not found`);
    }

    // If already accepted or delivered, do not re-dispatch (idempotent)
    if (event.status === 'ACCEPTED' || event.status === 'DELIVERED') {
      return { ok: true, status: event.status, event };
    }

    // Record dispatch attempt
    event.status = 'DISPATCHING';
    event.attemptCount += 1;
    event.lastAttemptAt = new Date().toISOString();
    await saveSideEffectEvent(event);

    if (_testFailNextNotificationDispatch) {
      const err = _testFailNextNotificationDispatch;
      _testFailNextNotificationDispatch = null;
      event.status = 'FAILED';
      event.error = err.message;
      await saveSideEffectEvent(event);
      return { ok: false, status: 'FAILED', event, error: err.message };
    }

    try {
      const result = await dispatcher(event);
      if (result.accepted) {
        event.status = result.delivered ? 'DELIVERED' : 'ACCEPTED';
        event.externalRef = result.externalRef || null;
        event.error = null;
        await saveSideEffectEvent(event);
        return { ok: true, status: event.status, event };
      }

      event.status = 'FAILED';
      event.error = result.error || 'Provider rejected notification';
      await saveSideEffectEvent(event);
      return { ok: false, status: 'FAILED', event, error: event.error };
    } catch (dispatchErr) {
      event.status = 'FAILED';
      event.error = (dispatchErr as Error).message || 'Dispatch network error';
      await saveSideEffectEvent(event);
      return { ok: false, status: 'FAILED', event, error: event.error };
    }
  });
}

