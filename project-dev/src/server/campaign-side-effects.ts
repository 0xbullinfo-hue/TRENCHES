import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  isKvConfigured,
  KV_CONFIGURED,
  kvGet,
  kvSet,
  kvSetLocked,
  kvSaveSideEffectEventLocked,
  kvSAdd,
  kvSMembers,
  kvScan,
  kvClaimNotificationDispatch,
  kvCompleteNotificationDispatch,
} from '@/server/kv';
import { tgCall } from '@/server/telegram';
import {
  withCampaignsLock,
  campaignsLockStorage,
  loadCampaigns,
  loadSubmissions,
  reconcileCampaignSubmission,
  reconcileAllPendingCampaignCounters,
  getPendingSubmissionReservations,
  recoverSubmissionReservation,
  SubmissionReservationRecord,
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

// Test failure injection and mock dispatcher hooks
let _testFailNextRewardRecord: Error | null = null;
let _testFailNextNotificationEnqueue: Error | null = null;
let _testFailNextNotificationDispatch: Error | null = null;
let _testMockDispatcher:
  | ((event: CampaignSideEffectEvent) => Promise<{ accepted: boolean; delivered?: boolean; externalRef?: string; error?: string; status?: string }>)
  | null = null;

export function __setTestFailNextRewardRecord(err: Error | null) {
  _testFailNextRewardRecord = err;
}

export function __setTestFailNextNotificationEnqueue(err: Error | null) {
  _testFailNextNotificationEnqueue = err;
}

export function __setTestFailNextNotificationDispatch(err: Error | null) {
  _testFailNextNotificationDispatch = err;
}

export function __setTestMockNotificationDispatcher(
  fn:
    | ((event: CampaignSideEffectEvent) => Promise<{ accepted: boolean; delivered?: boolean; externalRef?: string; error?: string; status?: string }>)
    | null
) {
  _testMockDispatcher = fn;
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

const KV_SIDE_EFFECT_SET = 'trench:camp:sideeffects_set';

async function saveSideEffectEvent(event: CampaignSideEffectEvent): Promise<void> {
  event.updatedAt = new Date().toISOString();
  const activeLock = campaignsLockStorage.getStore();
  if (activeLock) {
    try {
      activeLock.assertOwned();
    } catch (assertErr) {
      throw new Error(`Cannot save side effect: ${(assertErr as Error).message}`);
    }
  }

  if (isKvActive()) {
    const key = `${KV_SIDE_EFFECT_PREFIX}${event.idempotencyKey}`;
    const payload = JSON.stringify(event);
    const lockKey = activeLock && activeLock.lockType === 'kv' ? 'trench:campaigns:lock' : undefined;
    const lockToken = activeLock && activeLock.lockType === 'kv' ? activeLock.token : undefined;
    const fencing = activeLock && activeLock.lockType === 'kv' ? activeLock.fencingGeneration : undefined;

    const res = await kvSaveSideEffectEventLocked(
      key,
      payload,
      KV_SIDE_EFFECT_SET,
      event.idempotencyKey,
      lockKey,
      lockToken,
      fencing
    );
    if (!res.success) {
      throw new Error(`Side effect write rejected: ${res.reason || 'Lock lost or persistence failed'}`);
    }
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

export async function getEligibleNotificationEvents(
  batchSize = 50
): Promise<CampaignSideEffectEvent[]> {
  const safeBatch = Math.max(1, Math.min(batchSize, 200));
  const results: CampaignSideEffectEvent[] = [];

  if (isKvActive()) {
    try {
      const members = await kvSMembers(KV_SIDE_EFFECT_SET);
      if (Array.isArray(members)) {
        for (const m of members.slice(0, safeBatch * 2)) {
          const ev = await getSideEffectEvent(m);
          if (ev && ev.type === 'NOTIFICATION') {
            results.push(ev);
            if (results.length >= safeBatch) break;
          }
        }
      }
      return results;
    } catch (kvErr) {
      console.error('[TrenchLabs Outbox] Redis error reading eligible notifications:', kvErr);
      throw kvErr;
    }
  }

  if (!fs.existsSync(SIDE_EFFECTS_DIR)) return [];
  try {
    const files = fs.readdirSync(SIDE_EFFECTS_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(SIDE_EFFECTS_DIR, f), 'utf8');
          const ev = JSON.parse(raw) as CampaignSideEffectEvent;
          if (ev && ev.type === 'NOTIFICATION') {
            results.push(ev);
            if (results.length >= safeBatch) break;
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

export async function defaultCampaignNotificationDispatcher(
  event: CampaignSideEffectEvent
): Promise<{ accepted: boolean; delivered?: boolean; externalRef?: string; error?: string; status?: string }> {
  if (_testMockDispatcher) {
    return _testMockDispatcher(event);
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_ALERT_CHANNEL_ID || process.env.TELEGRAM_MEMBER_GROUP_ID;
  const webhookUrl = process.env.CAMPAIGN_NOTIFICATION_WEBHOOK_URL;

  // 1. If real Telegram bot credentials and destination channel are configured, dispatch via Telegram Bot API
  if (telegramToken && telegramChatId) {
    try {
      const text =
        `🚀 *Raid Submission Verified*\n` +
        `• Campaign: \`${String(event.payload?.campaignTitle || event.campaignId)}\`\n` +
        `• Participant: \`${event.payload?.xHandle || event.walletAddress.slice(0, 4) + '...' + event.walletAddress.slice(-4)}\`\n` +
        `• Status: Verified\n` +
        `• Submission ID: \`${event.submissionId}\``;

      const tgRes = await tgCall('sendMessage', {
        chat_id: telegramChatId,
        text,
        parse_mode: 'Markdown',
      });

      if (tgRes.ok) {
        const msgId = (tgRes.result as { message_id?: number })?.message_id;
        return {
          accepted: true,
          delivered: true,
          externalRef: `tg_msg_${msgId || Date.now()}`,
        };
      } else {
        return {
          accepted: false,
          delivered: false,
          status: 'FAILED',
          error: tgRes.description || 'Telegram API rejected notification message',
        };
      }
    } catch (tgErr) {
      return {
        accepted: false,
        delivered: false,
        status: 'FAILED',
        error: (tgErr as Error).message || 'Telegram communication failure',
      };
    }
  }

  // 2. If dedicated notification webhook URL is configured, POST payload to provider webhook
  if (webhookUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': event.idempotencyKey,
        },
        body: JSON.stringify({
          idempotencyKey: event.idempotencyKey,
          submissionId: event.submissionId,
          campaignId: event.campaignId,
          walletAddress: event.walletAddress,
          type: event.type,
          payload: event.payload,
          timestamp: new Date().toISOString(),
        }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const externalRef = res.headers.get('x-provider-ref') || `webhook_${res.status}_${Date.now()}`;
        return {
          accepted: true,
          delivered: res.status >= 200 && res.status < 300,
          externalRef,
        };
      } else {
        const errText = await res.text().catch(() => '');
        return {
          accepted: false,
          delivered: false,
          status: 'FAILED',
          error: `Webhook returned HTTP ${res.status}: ${errText.slice(0, 100)}`,
        };
      }
    } catch (whErr) {
      return {
        accepted: false,
        delivered: false,
        status: 'FAILED',
        error: (whErr as Error).message || 'Webhook communication failure',
      };
    }
  }

  // 3. Neither Telegram bot nor webhook provider is configured: FAIL CLOSED
  // Do NOT fabricate acceptance.
  return {
    accepted: false,
    delivered: false,
    status: 'BLOCKED',
    error: 'Notification provider not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_ALERT_CHANNEL_ID or CAMPAIGN_NOTIFICATION_WEBHOOK_URL missing)',
  };
}

export async function processNotificationOutboxBatch(options?: {
  batchSize?: number;
  workerId?: string;
  leaseMs?: number;
  dispatcher?: (event: CampaignSideEffectEvent) => Promise<{
    accepted: boolean;
    delivered?: boolean;
    externalRef?: string;
    error?: string;
  }>;
}): Promise<{
  discovered: number;
  dispatched: number;
  failed: number;
  retryable: number;
}> {
  const batchSize = options?.batchSize || 50;
  const workerId = options?.workerId || `worker-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const leaseMs = options?.leaseMs || 30000;
  const dispatcher = options?.dispatcher || defaultCampaignNotificationDispatcher;

  const events = await getEligibleNotificationEvents(batchSize);
  let discovered = 0;
  let dispatched = 0;
  let failed = 0;
  let retryable = 0;

  for (const event of events) {
    discovered += 1;
    const now = Date.now();
    let isEligible = false;

    if (event.status === 'CREATED') {
      isEligible = true;
    } else if (event.status === 'FAILED') {
      const attempts = Number(event.attemptCount) || 1;
      const backoffMs = Math.min(300_000, 1000 * Math.pow(2, attempts));
      const lastAttempt = event.lastAttemptAt ? new Date(event.lastAttemptAt).getTime() : 0;
      if (now - lastAttempt >= backoffMs) {
        isEligible = true;
      } else {
        retryable += 1;
      }
    }

    if (isEligible) {
      const res = await dispatchCampaignNotification(event.idempotencyKey, dispatcher, {
        workerId,
        leaseMs,
      });
      if (res.ok) {
        dispatched += 1;
      } else {
        failed += 1;
        retryable += 1;
      }
    }
  }

  return { discovered, dispatched, failed, retryable };
}

export interface CampaignRecoveryWorkerResult {
  ok: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'COMPLETED';
  workerId: string;
  durationMs: number;
  recordsDiscovered: number;
  recordsProcessed: number;
  recordsRecovered: number;
  recordsStillPending: number;
  failedOperations: number;
  retryableFailures: number;
  reconciledCounters: number;
  recoveredReservations: number;
  dispatchedNotifications: number;
  details: {
    reservations: { discovered: number; recovered: number; failed: number };
    counters: { attempted: number; reconciled: number; failed: number };
    sideEffects: {
      reconciledRewards: number;
      reconciledNotifications: number;
      recoveredDispatchEvents: number;
    };
    outboxDispatch: { discovered: number; dispatched: number; failed: number; retryable: number };
  };
}

export async function runCampaignRecoveryWorker(options?: {
  workerId?: string;
  batchSize?: number;
}): Promise<CampaignRecoveryWorkerResult> {
  const workerId = options?.workerId || `recovery-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const batchSize = Math.max(1, Math.min(options?.batchSize || 50, 200));
  const startMs = Date.now();

  let recordsDiscovered = 0;
  let recordsProcessed = 0;
  let recordsRecovered = 0;
  let recordsStillPending = 0;
  let failedOperations = 0;
  let retryableFailures = 0;

  let reservations: SubmissionReservationRecord[] = [];
  let resRecovered = 0;
  let resFailed = 0;

  try {
    // 1. Recover Pending / Stalled Submission Reservations
    reservations = await getPendingSubmissionReservations(batchSize);

    for (const res of reservations) {
      recordsDiscovered += 1;
      if (res.state === 'RESERVED' || res.state === 'RETRYABLE' || res.state === 'PERSISTED') {
        if (Date.now() - res.updatedAt > 2000) {
          recordsProcessed += 1;
          const recResult = await recoverSubmissionReservation(res.challengeId);
          if (recResult.ok) {
            recordsRecovered += 1;
            resRecovered += 1;
          } else {
            resFailed += 1;
            failedOperations += 1;
            retryableFailures += 1;
            recordsStillPending += 1;
          }
        } else {
          recordsStillPending += 1;
        }
      }
    }
  } catch (resErr) {
    console.error('[TrenchLabs Worker] Critical error discovering/recovering reservations:', resErr);
    failedOperations += 1;
    return {
      ok: false,
      status: 'FAILED',
      workerId,
      durationMs: Date.now() - startMs,
      recordsDiscovered,
      recordsProcessed,
      recordsRecovered,
      recordsStillPending: recordsStillPending + 1,
      failedOperations,
      retryableFailures,
      reconciledCounters: 0,
      recoveredReservations: 0,
      dispatchedNotifications: 0,
      details: {
        reservations: { discovered: reservations.length, recovered: resRecovered, failed: resFailed + 1 },
        counters: { attempted: 0, reconciled: 0, failed: 0 },
        sideEffects: { reconciledRewards: 0, reconciledNotifications: 0, recoveredDispatchEvents: 0 },
        outboxDispatch: { discovered: 0, dispatched: 0, failed: 0, retryable: 0 },
      },
    };
  }

  // 2. Reconcile Campaign Counters
  let counterRes = { attempted: 0, reconciled: 0, failed: 0, errors: [] as any[] };
  try {
    counterRes = await reconcileAllPendingCampaignCounters(batchSize);
    recordsDiscovered += counterRes.attempted;
    recordsProcessed += counterRes.attempted;
    recordsRecovered += counterRes.reconciled;
    failedOperations += counterRes.failed;
    recordsStillPending += counterRes.failed;
    if (counterRes.failed > 0) retryableFailures += counterRes.failed;
  } catch (cErr) {
    console.error('[TrenchLabs Worker] Counter reconciliation failure:', cErr);
    failedOperations += 1;
  }

  // 3. Reconcile Missing Outbox Events & Expired Leases
  let sideOps = { reconciledRewards: 0, reconciledNotifications: 0, recoveredDispatchEvents: 0 };
  try {
    sideOps = await reconcilePendingCampaignOperations();
    recordsRecovered += sideOps.reconciledRewards + sideOps.reconciledNotifications + sideOps.recoveredDispatchEvents;
  } catch (sErr) {
    console.error('[TrenchLabs Worker] Side effects reconciliation failure:', sErr);
    failedOperations += 1;
  }

  // 4. Dispatch Eligible Outbox Notifications
  let dispatchRes = { discovered: 0, dispatched: 0, failed: 0, retryable: 0 };
  try {
    dispatchRes = await processNotificationOutboxBatch({ batchSize, workerId });
    recordsDiscovered += dispatchRes.discovered;
    recordsProcessed += dispatchRes.dispatched + dispatchRes.failed;
    recordsRecovered += dispatchRes.dispatched;
    failedOperations += dispatchRes.failed;
    retryableFailures += dispatchRes.retryable;
    recordsStillPending += dispatchRes.retryable;
  } catch (dErr) {
    console.error('[TrenchLabs Worker] Notification outbox dispatch failure:', dErr);
    failedOperations += 1;
  }

  // Determine explicit status:
  // If critical operations failed and nothing was recovered, FAILED.
  // If some operations failed or records remain pending, PARTIAL.
  // If zero operations failed and no critical unrecovered records remain, SUCCESS.
  let overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'COMPLETED' = 'SUCCESS';
  if (failedOperations > 0 && recordsRecovered === 0 && recordsProcessed > 0) {
    overallStatus = 'FAILED';
  } else if (resFailed > 0 || counterRes.failed > 0 || (dispatchRes.failed > 0 && dispatchRes.dispatched === 0)) {
    overallStatus = 'PARTIAL';
  } else if (failedOperations > 0 || recordsStillPending > 0) {
    // If background retries are waiting for backoff, mark PARTIAL unless all processed items succeeded
    overallStatus = dispatchRes.dispatched > 0 && failedOperations === 0 ? 'SUCCESS' : 'PARTIAL';
  }

  // Backward compatibility alias for V2.8 tests: if all operations completed without failure, status is COMPLETED
  if ((overallStatus as string) === 'SUCCESS') {
    overallStatus = 'COMPLETED';
  }

  const ok = (overallStatus as string) === 'SUCCESS' || overallStatus === 'COMPLETED' || overallStatus === 'PARTIAL';

  return {
    ok,
    status: overallStatus,
    workerId,
    durationMs: Date.now() - startMs,
    recordsDiscovered,
    recordsProcessed,
    recordsRecovered,
    recordsStillPending,
    failedOperations,
    retryableFailures,
    reconciledCounters: counterRes.reconciled,
    recoveredReservations: resRecovered,
    dispatchedNotifications: dispatchRes.dispatched,
    details: {
      reservations: { discovered: reservations.length, recovered: resRecovered, failed: resFailed },
      counters: { attempted: counterRes.attempted, reconciled: counterRes.reconciled, failed: counterRes.failed },
      sideEffects: {
        reconciledRewards: sideOps.reconciledRewards,
        reconciledNotifications: sideOps.reconciledNotifications,
        recoveredDispatchEvents: sideOps.recoveredDispatchEvents,
      },
      outboxDispatch: dispatchRes,
    },
  };
}

