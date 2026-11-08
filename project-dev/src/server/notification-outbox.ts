import crypto from 'crypto';
import { isAdminWallet } from '@/lib/config';
import type { AlphaRecord } from '@/server/alphas-data';
import { resolveTier } from '@/server/db';
import {
  KV_CONFIGURED,
  isKvConfigured,
  kvDel,
  kvHDel,
  kvHGet,
  kvHGetAll,
  kvOutboxClaimSubscriber,
  kvOutboxCompleteSubscriber,
  kvOutboxCreateEvent,
  kvOutboxFinalizeEvent,
  kvOutboxMarkSubscribersSeeded,
  kvOutboxRenewSubscriberLease,
  kvOutboxSeedSubscriber,
  kvSMembers,
  kvSRem,
} from '@/server/kv';
import {
  SITE_URL,
  SUBS_KEY,
  classifySendFailure,
  formatSlTriggeredMessage,
  formatTpTriggeredMessage,
  isProOnlyCall,
  tgCall,
  unlinkWallet,
  type TgCallResult,
} from '@/server/telegram';

export const OUTBOX_EVENTS_HASH = 'trench:tpsl:outbox:events:v1';
export const OUTBOX_PENDING_SET = 'trench:tpsl:outbox:pending:v1';
export const outboxSubsKey = (eventId: string): string => `trench:tpsl:outbox:subs:v1:${eventId}`;

export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;
export const DEFAULT_BASE_RETRY_DELAY_MS = 15_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 15 * 60_000;
export const DEFAULT_PROCESSING_LEASE_MS = 30_000;
export const DEFAULT_TELEGRAM_TIMEOUT_MS = 8_000;

export type OutboxTriggerType = 'TP' | 'SL';

export type SubscriberDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'delivered'
  | 'retry'
  | 'permanently_failed';

export type DeliveryFailureCategory =
  | 'network'
  | 'rate_limit'
  | 'server_error'
  | 'blocked'
  | 'invalid_recipient'
  | 'unqualified_tier'
  | 'unknown';

export interface OutboxEventRecord {
  eventId: string;
  callId: string;
  triggerType: OutboxTriggerType;
  targetId: string;
  targetLabel: string;
  marketCapLabel: string;
  call: AlphaRecord;
  createdAt: number;
  updatedAt: number;
  status: 'pending' | 'completed';
  subscribersSeeded: boolean;
}

export interface OutboxSubscriberDelivery {
  eventId: string;
  callId: string;
  triggerType: OutboxTriggerType;
  targetId: string;
  subscriberId: string;
  chatId: string;
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
  nextRetryAt: number;
  status: SubscriberDeliveryStatus;
  lastFailureCategory: DeliveryFailureCategory | null;
  processingToken?: string | null;
  leaseExpiresAt?: number | null;
  previousStatus?: SubscriberDeliveryStatus;
}

export interface EnqueueOutboxEventInput {
  call: AlphaRecord;
  triggerType: OutboxTriggerType;
  targetId: string;
  targetLabel: string;
  marketCapLabel: string;
  nowMs?: number;
}

export interface EnqueueOutboxEventResult {
  eventId: string;
  created: boolean;
  event: OutboxEventRecord;
}

export interface OutboxProcessResult {
  ok: boolean;
  incomplete: boolean;
  operationalFailure: boolean;
  failureReason?: string;
  eventsProcessed: number;
  notificationsSent: number;
  notificationsPending: number;
  notificationsRetried: number;
  notificationsPermanentlyFailed: number;
  errors: string[];
}

export interface NotificationOutboxDeps {
  isRedisConfigured: () => boolean;
  loadSubscribers: () => Promise<Record<string, string>>;
  resolveTier: (wallet: string) => Promise<'free' | 'member' | 'pro' | 'unknown'>;
  unlinkWallet: (wallet: string) => Promise<void>;
  sendTelegramMessage: (
    chatId: string | number,
    text: string,
    replyMarkup: Record<string, unknown>,
    timeoutMs: number
  ) => Promise<TgCallResult>;
  now: () => number;
  budgetMs: number;
  minRequestBudgetMs: number;
  maxTelegramTimeoutMs: number;
  leaseDurationMs: number;
  maxAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  batchSize: number;
  workerToken?: string;
}

export class OutboxOperationalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxOperationalError';
  }
}

/**
 * Generates a canonical target identifier for a Take-Profit target.
 */
export function buildTpTargetId(index: number, label: string): string {
  return `tp:${index}:${String(label ?? '').trim()}`;
}

/**
 * Generates a canonical target identifier for a Stop-Loss trigger.
 */
export function buildSlTargetId(stopLoss?: string): string {
  const norm = String(stopLoss ?? 'stop_loss').trim() || 'stop_loss';
  return `sl:${norm}`;
}

/**
 * Generates a deterministic, unique notification event ID based on call ID, trigger type, and target ID.
 * Retries reuse the original event ID; different TP targets and SL triggers never collide.
 */
export function buildNotificationEventId(
  callId: string,
  triggerType: OutboxTriggerType,
  targetId: string
): string {
  const cleanCallId = String(callId ?? '').trim();
  const cleanTargetId = String(targetId ?? '').trim();
  if (!cleanCallId || !cleanTargetId) {
    throw new Error('buildNotificationEventId requires non-empty callId and targetId');
  }
  return `tpsl:${cleanCallId}:${triggerType}:${cleanTargetId}`;
}

/**
 * Computes bounded exponential backoff in milliseconds, honoring Telegram `retry_after` when present.
 */
export function computeRetryDelayMs(
  attemptCount: number,
  retryAfterSec?: number,
  baseRetryDelayMs = DEFAULT_BASE_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS
): number {
  if (typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(maxRetryDelayMs, Math.max(1_000, Math.ceil(retryAfterSec * 1000)));
  }
  const exp = Math.max(0, Math.floor(attemptCount) - 1);
  const raw = baseRetryDelayMs * Math.pow(2, Math.min(exp, 10));
  return Math.min(maxRetryDelayMs, Math.max(1_000, Math.floor(raw)));
}

const normChat = (chatId: string | number) => (/^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId);

async function defaultSendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup: Record<string, unknown>,
  timeoutMs: number
): Promise<TgCallResult> {
  return tgCall(
    'sendMessage',
    {
      chat_id: normChat(chatId),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    },
    timeoutMs
  );
}

function resolveDeps(overrides: Partial<NotificationOutboxDeps> = {}): NotificationOutboxDeps {
  return {
    isRedisConfigured: () => KV_CONFIGURED || isKvConfigured(),
    loadSubscribers: () => kvHGetAll(SUBS_KEY),
    resolveTier,
    unlinkWallet,
    sendTelegramMessage: defaultSendTelegramMessage,
    now: Date.now,
    budgetMs: 40_000,
    minRequestBudgetMs: 250,
    maxTelegramTimeoutMs: DEFAULT_TELEGRAM_TIMEOUT_MS,
    leaseDurationMs: DEFAULT_PROCESSING_LEASE_MS,
    maxAttempts: DEFAULT_MAX_DELIVERY_ATTEMPTS,
    baseRetryDelayMs: DEFAULT_BASE_RETRY_DELAY_MS,
    maxRetryDelayMs: DEFAULT_MAX_RETRY_DELAY_MS,
    batchSize: 20,
    ...overrides,
  };
}

/**
 * Atomically persists a deterministic TP/SL notification event in the Redis outbox.
 * Idempotent: if the event already exists, returns `created: false` without overwriting it.
 * Never falls back to local filesystem persistence.
 */
export async function enqueueOutboxEvent(
  input: EnqueueOutboxEventInput,
  overrides: Partial<Pick<NotificationOutboxDeps, 'isRedisConfigured' | 'now'>> = {}
): Promise<EnqueueOutboxEventResult> {
  const isConfigured = overrides.isRedisConfigured ?? (() => KV_CONFIGURED || isKvConfigured());
  if (!isConfigured()) {
    throw new OutboxOperationalError(
      'Redis is not configured for durable notification outbox (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN required)'
    );
  }

  const nowMs = overrides.now ? overrides.now() : input.nowMs ?? Date.now();
  const eventId = buildNotificationEventId(input.call.id, input.triggerType, input.targetId);

  const event: OutboxEventRecord = {
    eventId,
    callId: input.call.id,
    triggerType: input.triggerType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    marketCapLabel: input.marketCapLabel,
    call: input.call,
    createdAt: nowMs,
    updatedAt: nowMs,
    status: 'pending',
    subscribersSeeded: false,
  };

  try {
    const created = await kvOutboxCreateEvent(
      OUTBOX_EVENTS_HASH,
      OUTBOX_PENDING_SET,
      eventId,
      JSON.stringify(event)
    );
    if (!created) {
      const existingRaw = await kvHGet(OUTBOX_EVENTS_HASH, eventId);
      if (existingRaw) {
        return {
          eventId,
          created: false,
          event: JSON.parse(existingRaw) as OutboxEventRecord,
        };
      }
    }
    return { eventId, created, event };
  } catch (err) {
    throw new OutboxOperationalError(
      `Failed to persist notification event ${eventId}: ${(err as Error).message}`
    );
  }
}

/**
 * Removes a newly created, unseeded outbox event if the accompanying registry save fails,
 * ensuring registry state and outbox state remain consistent.
 */
export async function rollbackCreatedOutboxEvents(eventIds: string[]): Promise<void> {
  for (const eventId of eventIds) {
    try {
      await kvSRem(OUTBOX_PENDING_SET, eventId);
      await kvHDel(OUTBOX_EVENTS_HASH, eventId);
      await kvDel(outboxSubsKey(eventId));
    } catch {
      // Best-effort cleanup during save failure rollback
    }
  }
}

/**
 * Seeds per-subscriber delivery records for an outbox event based on linked subscribers and tier rules.
 * Preserves Member ($20 held) and Pro ($250 staked / Max Alpha) eligibility restrictions.
 */
async function seedSubscribersForEvent(
  event: OutboxEventRecord,
  deps: NotificationOutboxDeps,
  deadlineMs: number
): Promise<{ complete: boolean }> {
  const subsMap = await deps.loadSubscribers();
  const entries = Object.entries(subsMap || {});
  const subsKey = outboxSubsKey(event.eventId);
  const proOnly = isProOnlyCall(event.call);

  for (const [wallet, chatId] of entries) {
    if (deps.now() + deps.minRequestBudgetMs > deadlineMs) {
      return { complete: false };
    }
    if (!wallet || !chatId) continue;

    let tier: 'free' | 'member' | 'pro' | 'unknown';
    try {
      tier = isAdminWallet(wallet) ? 'pro' : await deps.resolveTier(wallet);
    } catch {
      tier = 'unknown';
    }

    // Free users never receive alerts; Member users never receive Pro-only / Max Alpha alerts.
    if (tier === 'free') continue;
    if (tier === 'member' && proOnly) continue;

    // Note: if tier === 'unknown' (temporary RPC failure), we seed the subscriber as 'pending'
    // and re-verify tier during delivery so an RPC blip never drops an eligible subscriber.
    const nowMs = deps.now();
    const record: OutboxSubscriberDelivery = {
      eventId: event.eventId,
      callId: event.callId,
      triggerType: event.triggerType,
      targetId: event.targetId,
      subscriberId: wallet,
      chatId: String(chatId),
      createdAt: nowMs,
      lastAttemptAt: null,
      attemptCount: 0,
      nextRetryAt: nowMs,
      status: 'pending',
      lastFailureCategory: null,
    };

    await kvOutboxSeedSubscriber(subsKey, wallet, JSON.stringify(record));
  }

  await kvOutboxMarkSubscribersSeeded(OUTBOX_EVENTS_HASH, event.eventId, deps.now());
  return { complete: true };
}

/**
 * Retrieves and processes pending TP/SL notification events from the Redis outbox within the execution budget.
 */
export async function processNotificationOutbox(
  overrides: Partial<NotificationOutboxDeps> = {}
): Promise<OutboxProcessResult> {
  const deps = resolveDeps(overrides);
  const startedAt = deps.now();
  const deadlineMs = startedAt + Math.max(0, deps.budgetMs);
  const workerToken = deps.workerToken || crypto.randomUUID();

  const result: OutboxProcessResult = {
    ok: true,
    incomplete: false,
    operationalFailure: false,
    eventsProcessed: 0,
    notificationsSent: 0,
    notificationsPending: 0,
    notificationsRetried: 0,
    notificationsPermanentlyFailed: 0,
    errors: [],
  };

  if (!deps.isRedisConfigured()) {
    const msg =
      'Redis is not configured for durable notification outbox (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN required)';
    result.ok = false;
    result.incomplete = true;
    result.operationalFailure = true;
    result.failureReason = msg;
    result.errors.push(msg);
    return result;
  }

  let pendingEventIds: string[];
  try {
    pendingEventIds = await kvSMembers(OUTBOX_PENDING_SET);
  } catch (err) {
    const msg = `Failed to read pending notification outbox: ${(err as Error).message}`;
    result.ok = false;
    result.incomplete = true;
    result.operationalFailure = true;
    result.failureReason = msg;
    result.errors.push(msg);
    return result;
  }

  pendingEventIds.sort();

  const keyboard = { inline_keyboard: [[{ text: 'View on Terminal', url: `${SITE_URL}/dashboard` }]] };

  try {
    for (const eventId of pendingEventIds) {
      if (deps.now() + deps.minRequestBudgetMs > deadlineMs) {
        result.incomplete = true;
        break;
      }

      const evRaw = await kvHGet(OUTBOX_EVENTS_HASH, eventId);
      if (!evRaw) {
        await kvSRem(OUTBOX_PENDING_SET, eventId);
        continue;
      }

      const event = JSON.parse(evRaw) as OutboxEventRecord;
      if (event.status === 'completed') {
        await kvSRem(OUTBOX_PENDING_SET, eventId);
        continue;
      }

      result.eventsProcessed++;

      if (!event.subscribersSeeded) {
        const seeded = await seedSubscribersForEvent(event, deps, deadlineMs);
        if (!seeded.complete) {
          result.incomplete = true;
          break;
        }
        event.subscribersSeeded = true;
      }

      const subsKey = outboxSubsKey(eventId);
      const rawSubsMap = await kvHGetAll(subsKey);
      const subRecords: OutboxSubscriberDelivery[] = [];
      for (const [, subRaw] of Object.entries(rawSubsMap)) {
        try {
          subRecords.push(JSON.parse(subRaw) as OutboxSubscriberDelivery);
        } catch {
          // Ignore malformed entry
        }
      }

      // Deterministic order by subscriberId
      subRecords.sort((a, b) => a.subscriberId.localeCompare(b.subscriberId));

      const proOnly = isProOnlyCall(event.call);
      const messageText =
        event.triggerType === 'TP'
          ? formatTpTriggeredMessage(event.call, event.targetLabel, event.marketCapLabel)
          : formatSlTriggeredMessage(event.call, event.marketCapLabel);

      let budgetExhaustedDuringEvent = false;

      for (let i = 0; i < subRecords.length; i += deps.batchSize) {
        if (deps.now() + deps.minRequestBudgetMs > deadlineMs) {
          result.incomplete = true;
          budgetExhaustedDuringEvent = true;
          break;
        }

        const batch = subRecords.slice(i, i + deps.batchSize);

        for (const sub of batch) {
          const nowBeforeSub = deps.now();
          const remainingMs = deadlineMs - nowBeforeSub;
          if (remainingMs < deps.minRequestBudgetMs) {
            result.incomplete = true;
            budgetExhaustedDuringEvent = true;
            break;
          }

          // Check whether this subscriber is eligible for a delivery attempt right now
          if (sub.status === 'delivered' || sub.status === 'permanently_failed') {
            continue;
          }
          if (sub.status === 'retry' && sub.nextRetryAt > nowBeforeSub) {
            continue;
          }
          if (
            sub.status === 'processing' &&
            typeof sub.leaseExpiresAt === 'number' &&
            sub.leaseExpiresAt > nowBeforeSub
          ) {
            continue;
          }

          // Atomically claim the subscriber processing lease
          const claimedRaw = await kvOutboxClaimSubscriber(
            subsKey,
            sub.subscriberId,
            workerToken,
            nowBeforeSub,
            deps.leaseDurationMs
          );
          if (!claimedRaw) {
            continue;
          }

          const claimed = JSON.parse(claimedRaw) as OutboxSubscriberDelivery;
          const wasRetryAttempt = claimed.previousStatus === 'retry' || claimed.attemptCount > 1;

          // Verify tier eligibility before sending (protects Pro-only calls and handles previously 'unknown' tiers)
          let tier: 'free' | 'member' | 'pro' | 'unknown';
          try {
            tier = isAdminWallet(claimed.subscriberId)
              ? 'pro'
              : await deps.resolveTier(claimed.subscriberId);
          } catch {
            tier = 'unknown';
          }

          if (tier === 'free' || (proOnly && tier === 'member')) {
            // Ineligible tier: remove from required subscriber deliveries without sending
            await kvHDel(subsKey, claimed.subscriberId);
            continue;
          }

          if (tier === 'unknown') {
            const isPermanent = claimed.attemptCount >= deps.maxAttempts;
            const nextRetryAt = isPermanent
              ? 0
              : deps.now() +
                computeRetryDelayMs(
                  claimed.attemptCount,
                  undefined,
                  deps.baseRetryDelayMs,
                  deps.maxRetryDelayMs
                );
            const acked = await kvOutboxCompleteSubscriber(
              subsKey,
              claimed.subscriberId,
              workerToken,
              JSON.stringify({
                status: isPermanent ? 'permanently_failed' : 'retry',
                lastAttemptAt: deps.now(),
                nextRetryAt,
                lastFailureCategory: 'network' as DeliveryFailureCategory,
              })
            );
            if (acked) {
              if (isPermanent) result.notificationsPermanentlyFailed++;
              else result.notificationsRetried++;
            }
            continue;
          }

          const reqTimeoutMs = Math.max(
            50,
            Math.min(deps.maxTelegramTimeoutMs, Math.floor(deadlineMs - deps.now()))
          );

          // Renew processing lease if needed during longer sends
          const leaseRenewInterval = Math.max(100, Math.floor(deps.leaseDurationMs / 2));
          let leaseLost = false;
          const renewTimer = setInterval(async () => {
            try {
              const ok = await kvOutboxRenewSubscriberLease(
                subsKey,
                claimed.subscriberId,
                workerToken,
                deps.now() + deps.leaseDurationMs
              );
              if (!ok) leaseLost = true;
            } catch {
              leaseLost = true;
            }
          }, leaseRenewInterval);
          if (typeof renewTimer.unref === 'function') renewTimer.unref();

          let sendRes: TgCallResult;
          try {
            sendRes = await deps.sendTelegramMessage(
              claimed.chatId,
              messageText,
              keyboard,
              reqTimeoutMs
            );
          } catch (sendErr) {
            sendRes = {
              ok: false,
              status: 0,
              description: (sendErr as Error).message || 'network error',
            };
          } finally {
            clearInterval(renewTimer);
          }

          if (leaseLost) {
            continue;
          }

          const completedAt = deps.now();

          if (sendRes.ok) {
            const acked = await kvOutboxCompleteSubscriber(
              subsKey,
              claimed.subscriberId,
              workerToken,
              JSON.stringify({
                status: 'delivered' as SubscriberDeliveryStatus,
                lastAttemptAt: completedAt,
                nextRetryAt: 0,
                lastFailureCategory: null,
              })
            );
            if (acked) {
              result.notificationsSent++;
              if (wasRetryAttempt) {
                result.notificationsRetried++;
              }
            }
            continue;
          }

          const failureClass = classifySendFailure(sendRes.status, sendRes.description);

          if (failureClass === 'blocked') {
            await deps.unlinkWallet(claimed.subscriberId).catch(() => undefined);
            const acked = await kvOutboxCompleteSubscriber(
              subsKey,
              claimed.subscriberId,
              workerToken,
              JSON.stringify({
                status: 'permanently_failed' as SubscriberDeliveryStatus,
                lastAttemptAt: completedAt,
                nextRetryAt: 0,
                lastFailureCategory: 'blocked' as DeliveryFailureCategory,
              })
            );
            if (acked) {
              result.notificationsPermanentlyFailed++;
            }
            continue;
          }

          if (sendRes.status === 400) {
            const acked = await kvOutboxCompleteSubscriber(
              subsKey,
              claimed.subscriberId,
              workerToken,
              JSON.stringify({
                status: 'permanently_failed' as SubscriberDeliveryStatus,
                lastAttemptAt: completedAt,
                nextRetryAt: 0,
                lastFailureCategory: 'invalid_recipient' as DeliveryFailureCategory,
              })
            );
            if (acked) {
              result.notificationsPermanentlyFailed++;
            }
            continue;
          }

          // Retryable failure (network = 0, rate_limit = 429, server_error >= 500)
          const category: DeliveryFailureCategory =
            sendRes.status === 429
              ? 'rate_limit'
              : sendRes.status >= 500
                ? 'server_error'
                : sendRes.status === 0
                  ? 'network'
                  : 'unknown';

          const exhausted = claimed.attemptCount >= deps.maxAttempts;
          const nextRetryAt = exhausted
            ? 0
            : completedAt +
              computeRetryDelayMs(
                claimed.attemptCount,
                sendRes.retryAfter,
                deps.baseRetryDelayMs,
                deps.maxRetryDelayMs
              );

          const acked = await kvOutboxCompleteSubscriber(
            subsKey,
            claimed.subscriberId,
            workerToken,
            JSON.stringify({
              status: (exhausted ? 'permanently_failed' : 'retry') as SubscriberDeliveryStatus,
              lastAttemptAt: completedAt,
              nextRetryAt,
              lastFailureCategory: category,
            })
          );

          if (acked) {
            if (exhausted) {
              result.notificationsPermanentlyFailed++;
            } else {
              result.notificationsRetried++;
            }
          }
        }

        if (budgetExhaustedDuringEvent) break;
      }

      await kvOutboxFinalizeEvent(
        OUTBOX_EVENTS_HASH,
        OUTBOX_PENDING_SET,
        subsKey,
        eventId,
        deps.now()
      );
    }

    // Count remaining non-terminal subscriber deliveries across all still-pending events
    const remainingEventIds = await kvSMembers(OUTBOX_PENDING_SET);
    let pendingDeliveries = 0;
    for (const remEventId of remainingEventIds) {
      const evRaw = await kvHGet(OUTBOX_EVENTS_HASH, remEventId);
      if (!evRaw) continue;
      const ev = JSON.parse(evRaw) as OutboxEventRecord;
      if (ev.status === 'completed') continue;
      if (!ev.subscribersSeeded) {
        pendingDeliveries++;
        continue;
      }
      const subsMap = await kvHGetAll(outboxSubsKey(remEventId));
      for (const subRaw of Object.values(subsMap)) {
        try {
          const sub = JSON.parse(subRaw) as OutboxSubscriberDelivery;
          if (sub.status !== 'delivered' && sub.status !== 'permanently_failed') {
            pendingDeliveries++;
          }
        } catch {
          // ignore
        }
      }
    }

    result.notificationsPending = pendingDeliveries;
    if (pendingDeliveries > 0) {
      result.incomplete = true;
    }

    return result;
  } catch (err) {
    const msg = `Outbox processing failed: ${(err as Error).message}`;
    result.ok = false;
    result.incomplete = true;
    result.operationalFailure = true;
    result.failureReason = msg;
    result.errors.push(msg);
    return result;
  }
}

/**
 * Inspects the persisted state of an outbox event and its subscriber deliveries (for diagnostics and testing).
 */
export async function getOutboxEventState(eventId: string): Promise<{
  event: OutboxEventRecord | null;
  subscribers: Record<string, OutboxSubscriberDelivery>;
}> {
  const evRaw = await kvHGet(OUTBOX_EVENTS_HASH, eventId);
  const event = evRaw ? (JSON.parse(evRaw) as OutboxEventRecord) : null;
  const rawSubs = await kvHGetAll(outboxSubsKey(eventId));
  const subscribers: Record<string, OutboxSubscriberDelivery> = {};
  for (const [k, v] of Object.entries(rawSubs)) {
    subscribers[k] = JSON.parse(v) as OutboxSubscriberDelivery;
  }
  return { event, subscribers };
}

