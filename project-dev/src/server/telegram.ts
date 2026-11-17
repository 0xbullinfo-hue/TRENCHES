import crypto from 'crypto';
import { isAdminWallet } from '@/lib/config';
import type { CommunityTier, GroupStatus, TelegramStatusResult, UserTier } from '@/lib/telegram-types';
import {
  KV_CONFIGURED,
  isKvConfigured,
  kvDel,
  kvGet,
  kvGetDel,
  kvHDel,
  kvHGetAll,
  kvHSet,
  kvSet,
  kvSetEx,
  kvLock,
  kvUnlock,
} from '@/server/kv';
import type { AlphaRecord } from '@/server/alphas-data';
import { resolveUserEntitlement } from '@/server/entitlements';
import {
  DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS,
  MAX_WEBHOOK_ATTEMPTS,
  bindTelegramIdentityAndPendingInvite,
  claimRetryableEventForWalletInteractive,
  claimRetryableMembershipEvents,
  claimVerificationSession,
  completeVerificationSession,
  consumeLinkCodeRow,
  createLinkCodeRow,
  disableTelegramNotificationsByChatId,
  enforceDbNotificationEntitlement,
  getTelegramMember,
  getTelegramMemberByChatId,
  getTelegramMemberByTelegramUserId,
  getVerificationSession,
  hashSecretToken,
  listMembersNeedingReconciliation,
  listNotificationSubscribersFromDb,
  listTrackedTelegramMembers,
  markVerificationSessionFailed,
  markVerificationSessionRetryable,
  markWebhookUpdateCompleted,
  markWebhookUpdatePermanentlyFailed,
  persistRetryableMembershipEvent,
  recordAuditLog,
  recordMembershipMismatch,
  recordUnknownEntitlementState,
  releaseInteractiveWebhookProbe,
  resolveTier,
  setTelegramNotificationStatus,
  updateTelegramGroupMembership,
  type TelegramMemberRow,
} from '@/server/db';

const FILE_PERSISTENCE_ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_FILE_PERSISTENCE === 'true';

export const getBotToken = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
export const getBotUsername = () =>
  (process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || '').replace(/^@/, '').trim();
export const getWebhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
export const getSiteUrl = () =>
  (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://trenchlabshq.xyz').replace(/\/$/, '');
export const getTelegramGroups = () => ({
  member: process.env.TELEGRAM_MEMBER_GROUP_ID?.trim() || undefined,
  pro: process.env.TELEGRAM_PRO_GROUP_ID?.trim() || undefined,
});

export function getCommunityTierFromGroupId(groupId: string | null | undefined): CommunityTier | null {
  const clean = groupId ? String(groupId).trim() : '';
  if (!clean) return null;
  const groups = getTelegramGroups();
  if (groups.pro && clean === groups.pro) return 'pro';
  if (groups.member && clean === groups.member) return 'member';
  return null;
}

export function getExpectedCommunity(
  entitlement:
    | UserTier
    | { tier: UserTier; baseTier?: 'free' | 'member' | 'pro' | 'unknown'; isAdmin?: boolean }
): CommunityTier | null {
  if (typeof entitlement === 'string') {
    if (entitlement === 'admin' || entitlement === 'pro') return 'pro';
    if (entitlement === 'member') return 'member';
    return null;
  }
  if (
    entitlement.tier === 'admin' ||
    entitlement.isAdmin ||
    entitlement.tier === 'pro' ||
    entitlement.baseTier === 'pro'
  ) {
    return 'pro';
  }
  if (entitlement.tier === 'member' || entitlement.baseTier === 'member') {
    return 'member';
  }
  return null;
}

/**
 * Authoritative community membership policy check:
 * - Admin is authorized in both `pro` and `member` groups without mismatch or eviction.
 * - Pro is authorized in `pro` only.
 * - Member is authorized in `member` only.
 * - Free/unknown are authorized in neither community group.
 */
export function isAuthorizedGroupForEntitlement(
  entitlement: { tier: UserTier; baseTier?: 'free' | 'member' | 'pro' | 'unknown'; isAdmin?: boolean },
  actualGroup: CommunityTier | null
): boolean {
  if (!actualGroup) return false;
  if (entitlement.isAdmin || entitlement.tier === 'admin') {
    return actualGroup === 'pro' || actualGroup === 'member';
  }
  const expected = getExpectedCommunity(entitlement);
  return expected !== null && actualGroup === expected;
}

export function canReceiveNotifications(
  userPreference: 'enabled' | 'disabled',
  entitlementAllowed: boolean
): boolean {
  return userPreference === 'enabled' && entitlementAllowed;
}

export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
export const SITE_URL = (
  process.env.SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'https://trenchlabshq.xyz'
).replace(/\/$/, '');

/**
 * @deprecated Static fallback invite links are forbidden in the active verification flow.
 * Retained only as empty export markers during migration checks.
 */
export const MEMBER_INVITE_URL = '';
/** @deprecated Static fallback invite links are forbidden in the active verification flow. */
export const PRO_INVITE_URL = '';

export const TELEGRAM_GROUPS = {
  get member() {
    return process.env.TELEGRAM_MEMBER_GROUP_ID?.trim() || undefined;
  },
  get pro() {
    return process.env.TELEGRAM_PRO_GROUP_ID?.trim() || undefined;
  },
};

export const SUBS_KEY = 'tg:subs'; // legacy/KV cache: wallet -> chatId
const chatKey = (chatId: string | number) => `tg:chat:${chatId}`; // chatId -> wallet
const codeKey = (codeHash: string) => `tg:code:${codeHash}`;
const CODE_TTL_SEC = 600;
const INVITE_TTL_SEC = 3600;
const ENTITLEMENT_UNKNOWN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Alerts & bot webhook need bot credentials AND an active persistence store. */
export const telegramConfigured = () =>
  Boolean(
    getBotToken() &&
      getBotUsername() &&
      getWebhookSecret() &&
      (KV_CONFIGURED || isKvConfigured() || FILE_PERSISTENCE_ALLOWED)
  );

const kvStoreEnabled = () => Boolean(KV_CONFIGURED || isKvConfigured());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TgCallResult {
  ok: boolean;
  status: number;
  description?: string;
  retryAfter?: number;
  result?: unknown;
}

const normChat = (chatId: string | number) => (/^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId);

/** Low-level Bot API call with bounded timeout. Never throws. */
export async function tgCall(
  method: string,
  body: Record<string, unknown>,
  timeoutMs = 8_000
): Promise<TgCallResult> {
  const token = getBotToken();
  const apiBase = process.env.TELEGRAM_API_BASE || API_BASE;
  if (!token) return { ok: false, status: 0, description: 'bot token not configured' };
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(50, Math.floor(timeoutMs)) : 8_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), safeTimeoutMs);
  try {
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
      result?: unknown;
      parameters?: { retry_after?: number };
    } | null;
    return {
      ok: res.ok && json?.ok !== false,
      status: res.status,
      description: json?.description,
      retryAfter: json?.parameters?.retry_after,
      result: json?.result,
    };
  } catch {
    return { ok: false, status: 0, description: 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a message; on HTTP 429 waits the server-provided retry_after (max 5s) and retries once. Default parse_mode is HTML. */
export async function tgSend(
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<TgCallResult> {
  const payload = {
    chat_id: normChat(chatId),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  };
  let res = await tgCall('sendMessage', payload);
  if (res.status === 429) {
    await sleep(Math.min((res.retryAfter ?? 1) * 1000, 5_000));
    res = await tgCall('sendMessage', payload);
  }
  return res;
}

export async function tgAnswerCallbackQuery(
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<TgCallResult> {
  return tgCall('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    show_alert: showAlert,
  });
}

/**
 * Decides what a failed sendMessage means. Only a definitive "this chat will never accept messages"
 * (blocked / deactivated / chat gone) may unlink a subscriber; a 400 for any other reason
 * (e.g. malformed message) must never remove people.
 */
export function classifySendFailure(status: number, description = ''): 'blocked' | 'retry' | 'other' {
  const d = description.toLowerCase();
  if (status === 403) return 'blocked';
  if (status === 400 && (d.includes('chat not found') || d.includes('user is deactivated') || d.includes('bot was blocked'))) {
    return 'blocked';
  }
  if (status === 429 || status === 0 || status >= 500) return 'retry';
  return 'other';
}

export async function removeChatMember(
  groupId: string,
  userId: number
): Promise<{ ok: boolean; error?: string }> {
  const banRes = await tgCall('banChatMember', {
    chat_id: normChat(groupId),
    user_id: userId,
  });
  if (!banRes.ok) {
    return { ok: false, error: banRes.description || `HTTP ${banRes.status}` };
  }
  // Unban immediately with only_if_banned=true so user is evicted without a permanent block if they re-qualify later.
  await tgCall('unbanChatMember', {
    chat_id: normChat(groupId),
    user_id: userId,
    only_if_banned: true,
  });
  return { ok: true };
}

export interface GeneratedInvite {
  inviteLink: string;
  inviteHash: string;
  expiresAtIso: string;
  groupId: string;
}

/**
 * Issues a single-use, expiring dynamic invite link strictly via Telegram's `createChatInviteLink`.
 * Security rule: static fallback invite URLs are strictly prohibited and never returned.
 */
export async function createTelegramInviteWithMeta(
  tier: 'member' | 'pro',
  userId?: number
): Promise<GeneratedInvite> {
  const token = getBotToken();
  const groups = getTelegramGroups();
  const rawGroupId = tier === 'pro' ? groups.pro : groups.member;

  if (!token || !rawGroupId) {
    throw new Error(
      `Unable to generate invite link for ${tier} group: Bot credentials or group ID not configured`
    );
  }

  const expireUnix = Math.floor(Date.now() / 1000) + INVITE_TTL_SEC;
  const expiresAtIso = new Date(expireUnix * 1000).toISOString();

  const res = await tgCall('createChatInviteLink', {
    chat_id: normChat(rawGroupId),
    member_limit: 1,
    expire_date: expireUnix,
    creates_join_request: false,
    name: `TrenchLabs ${tier.toUpperCase()} (${userId || 'verified'})`,
  });

  const link = (res.result as { invite_link?: string } | undefined)?.invite_link;
  if (!res.ok || !link) {
    throw new Error(
      `Unable to generate invite link for ${tier} group: Telegram API ${res.status} (${res.description || 'failed'})`
    );
  }

  return {
    inviteLink: link,
    inviteHash: hashSecretToken(link),
    expiresAtIso,
    groupId: rawGroupId,
  };
}

/**
 * Issues an invite link string for the designated tier ('member' | 'pro').
 * Fail-closed: rejects when credentials, group IDs, or Telegram API fail (never falls back to static URLs).
 */
export async function createTelegramInvite(
  tier: 'member' | 'pro',
  userId?: number
): Promise<string> {
  const meta = await createTelegramInviteWithMeta(tier, userId);
  return meta.inviteLink;
}

function formatTierLabel(tier: UserTier): string {
  switch (tier) {
    case 'admin':
      return 'ADMIN';
    case 'pro':
      return 'PRO';
    case 'member':
      return 'MEMBER';
    case 'free':
      return 'FREE';
    default:
      return 'Temporarily Unavailable';
  }
}

function formatGroupStatusLabel(status: GroupStatus): string {
  switch (status) {
    case 'joined':
      return 'Joined';
    case 'invite_pending':
      return 'Invitation Pending';
    case 'left':
      return 'Left';
    case 'kicked':
      return 'Removed from Group';
    case 'revoked':
      return 'Access Revoked';
    case 'mismatch':
      return 'Mismatch';
    default:
      return 'Not Joined';
  }
}

function formatNotifStatusLabel(status: string): string {
  switch (status) {
    case 'enabled':
      return 'Enabled';
    case 'pending':
      return 'Pending';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Disabled';
  }
}

function buildAlertsKeyboard(
  notificationEnabled: boolean,
  isQualified: boolean,
  dashboardUrl: string
): Record<string, unknown> {
  const rows: Array<Array<Record<string, unknown>>> = [];
  if (isQualified) {
    rows.push([
      notificationEnabled
        ? { text: '🔕 Disable Private Alerts', callback_data: 'notif:disable' }
        : { text: '🔔 Enable Private Alerts', callback_data: 'notif:enable' },
    ]);
  }
  rows.push([{ text: 'Open Lab Analysis', url: dashboardUrl }]);
  return { inline_keyboard: rows };
}

export interface VerificationProcessResult {
  replyText: string;
  success: boolean;
  reason?: string;
  replyMarkup?: Record<string, unknown>;
}

/**
 * Consumes `vs_<session_id>` verification deep link.
 * Validated flow:
 * 1. Check session validity & expiry safely without burning session permanently on transient failures.
 * 2. Recheck wallet entitlement server-side BEFORE persisting completion.
 * 3. Enforce unique Telegram user ID -> wallet binding (no silent identity takeover).
 * 4. Generate single-use expiring dynamic invite strictly for verified tier's group ID.
 * 5. Record `group_status: 'invite_pending'` (NEVER `'joined'` until confirmed by `chat_member`).
 * 6. Complete verification session atomically only after durable DB persistence succeeds.
 */
export async function handleTelegramVerification(
  sessionId: string,
  chatId: number | string,
  userId?: number
): Promise<VerificationProcessResult> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;
  const effectiveUserId =
    typeof userId === 'number' && Number.isFinite(userId) && userId > 0
      ? userId
      : typeof chatId === 'number' && Number.isFinite(chatId) && chatId > 0
      ? chatId
      : /^\d+$/.test(String(chatId))
      ? Number(chatId)
      : null;

  if (!effectiveUserId) {
    return {
      replyText: `Could not verify your Telegram numeric user ID. Please open your dashboard and start verification again:\n${dashboard}`,
      success: false,
      reason: 'invalid_telegram_user',
    };
  }

  // Peek first to fail fast cleanly on expired/completed before atomic claim
  const existingSession = await getVerificationSession(sessionId);
  if (!existingSession) {
    return {
      replyText: `This link is invalid. Get a new one from your dashboard: ${dashboard}`,
      success: false,
      reason: 'invalid_session',
    };
  }
  if (existingSession.status === 'completed') {
    return {
      replyText: 'This verification link was already completed. Run /status to review your current access.',
      success: false,
      reason: 'already_completed',
    };
  }

  const claim = await claimVerificationSession(sessionId, effectiveUserId, chatId);
  if (claim.status !== 'ok') {
    const replies = {
      not_found: `This link is invalid. Get a new one from your dashboard: ${dashboard}`,
      used: 'This link was already used. Run /status or request a new link from your dashboard.',
      expired: `This link expired. Get a new one from your dashboard: ${dashboard}`,
    } as const;
    return {
      replyText: replies[claim.status],
      success: false,
      reason: claim.status === 'used' ? 'already_completed' : `${claim.status}_session`,
    };
  }

  const wallet = claim.session.wallet_address;
  const targetTier = claim.session.tier;
  const shortWallet = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

  try {
    // Prevent silent takeover: confirm Telegram user ID isn't bound to another wallet,
    // and confirm wallet isn't already connected to a different Telegram user.
    const existingByTg = await getTelegramMemberByTelegramUserId(effectiveUserId);
    if (existingByTg && existingByTg.wallet_address !== wallet) {
      await markVerificationSessionFailed(sessionId, 'telegram_identity_already_linked');
      return {
        replyText:
          `⛔ <b>Verification Rejected</b>\n\n` +
          `This Telegram account is already linked to a different TrenchLabs wallet.\n` +
          `To protect account security, one Telegram account cannot be silently reassigned between wallets.`,
        success: false,
        reason: 'telegram_identity_already_linked',
      };
    }

    const existingByWallet = await getTelegramMember(wallet);
    if (
      existingByWallet &&
      existingByWallet.telegram_user_id !== null &&
      existingByWallet.telegram_user_id !== effectiveUserId &&
      existingByWallet.identity_status === 'connected'
    ) {
      await markVerificationSessionFailed(sessionId, 'wallet_already_linked_to_other_telegram');
      return {
        replyText:
          `⛔ <b>Verification Rejected</b>\n\n` +
          `Wallet ${shortWallet} is already verified with another Telegram identity.`,
        success: false,
        reason: 'wallet_already_linked_to_other_telegram',
      };
    }

    // Recheck authoritative entitlement server-side
    const entitlement = await resolveUserEntitlement(wallet);

    if (entitlement.tier === 'unknown') {
      await markVerificationSessionRetryable(sessionId, 'entitlement_unavailable');
      return {
        replyText:
          `⏳ <b>Verification Temporarily Unavailable</b>\n\n` +
          `We could not verify on-chain eligibility for ${shortWallet} right now due to a temporary network/oracle outage.\n\n` +
          `Your link is still valid for retries — tap /start again in a minute or check ${dashboard}.`,
        success: false,
        reason: 'entitlement_unavailable',
      };
    }

    if (entitlement.tier === 'free') {
      await markVerificationSessionRetryable(sessionId, 'not_eligible');
      return {
        replyText:
          `Your wallet ${shortWallet} doesn't currently qualify.\n\n` +
          `• Member access: Hold at least $20 in $H42\n` +
          `• Pro access: Stake $250 in $H42 for 90 days\n\n` +
          `Top up on the dashboard: ${dashboard}`,
        success: false,
        reason: 'not_eligible',
      };
    }

    const qualifiedGroupTier: 'member' | 'pro' =
      entitlement.isAdmin || entitlement.baseTier === 'pro' ? 'pro' : 'member';

    // Strict Member -> Pro gate enforcement: NEVER issue a Pro invite to a Member-only wallet
    if (targetTier === 'pro' && qualifiedGroupTier !== 'pro') {
      await markVerificationSessionRetryable(sessionId, 'pro_tier_required');
      return {
        replyText:
          `⚠️ <b>Pro Eligibility Not Met (${shortWallet})</b>\n\n` +
          `Your wallet qualifies as <b>Member</b> (Hold at least $20 in $H42), but does not have an active Stake $250 in $H42 for 90 days position for Pro.\n\n` +
          `No Pro group invitation was generated.\n` +
          `Start Member verification on your dashboard or stake $250 for Pro:\n` +
          `🔗 ${siteUrl}/dashboard/stake`,
        success: false,
        reason: 'pro_tier_required',
      };
    }

    // Generate or safely reuse an unexpired single-use dynamic invitation for the exact target tier group
    const groups = getTelegramGroups();
    const expectedGroupId = qualifiedGroupTier === 'pro' ? groups.pro : groups.member;
    let invite: GeneratedInvite;

    const existingInviteValid =
      existingByWallet &&
      existingByWallet.group_status === 'invite_pending' &&
      existingByWallet.group_id === expectedGroupId &&
      existingByWallet.pending_invite_link &&
      existingByWallet.invite_expires_at &&
      new Date(existingByWallet.invite_expires_at).getTime() > Date.now() + 60_000;

    try {
      if (existingInviteValid && existingByWallet.pending_invite_link) {
        invite = {
          inviteLink: existingByWallet.pending_invite_link,
          inviteHash: existingByWallet.invite_link_hash || hashSecretToken(existingByWallet.pending_invite_link),
          expiresAtIso: existingByWallet.invite_expires_at!,
          groupId: expectedGroupId!,
        };
      } else {
        invite = await createTelegramInviteWithMeta(qualifiedGroupTier, effectiveUserId);
      }
    } catch (inviteErr) {
      console.error(`[TrenchLabs] ${qualifiedGroupTier} invite generation failed:`, inviteErr);
      await markVerificationSessionRetryable(sessionId, 'invite_creation_failed');
      return {
        replyText:
          `⚠️ <b>Wallet Qualified (${qualifiedGroupTier.toUpperCase()}), Invite Unavailable</b>\n\n` +
          `Your wallet ${shortWallet} passed verification, but generating a single-use group invite failed right now.\n\n` +
          `Please try tapping your verification link again shortly or retry from the dashboard:\n` +
          `🔗 ${dashboard}`,
        success: false,
        reason: 'invite_creation_failed',
      };
    }

    // Persist identity & pending group invitation (never marks 'joined' until chat_member confirms)
    const bindRes = await bindTelegramIdentityAndPendingInvite({
      wallet_address: wallet,
      telegram_user_id: effectiveUserId,
      telegram_chat_id: String(chatId),
      entitlement_tier: entitlement.tier,
      target_tier: qualifiedGroupTier,
      group_id: invite.groupId,
      invite_link_hash: invite.inviteHash,
      invite_expires_at: invite.expiresAtIso,
      pending_invite_link: invite.inviteLink,
    });

    if (!bindRes.ok) {
      await markVerificationSessionFailed(sessionId, bindRes.reason);
      return {
        replyText:
          `⛔ <b>Verification Rejected</b>\n\n` +
          `This Telegram identity cannot be linked to ${shortWallet} because an existing conflicting link is active.`,
        success: false,
        reason: bindRes.reason,
      };
    }

    await completeVerificationSession(sessionId, effectiveUserId, chatId);

    const notifEnabled = bindRes.member.notification_status === 'enabled';
    const alreadyJoined = bindRes.member.group_status === 'joined';
    const communityName = qualifiedGroupTier === 'pro' ? 'Pro' : 'Member';
    const replyMarkup = buildAlertsKeyboard(notifEnabled, true, dashboard);

    if (alreadyJoined) {
      return {
        replyText:
          `✅ <b>Telegram Identity Verified (${communityName})</b>\n\n` +
          `Wallet: <code>${shortWallet}</code>\n` +
          `Community Membership: <b>Joined (${communityName})</b>\n` +
          `Private Notifications: <b>${formatNotifStatusLabel(bindRes.member.notification_status)}</b>\n\n` +
          `Use /status anytime to check your account status.`,
        success: true,
        replyMarkup,
      };
    }

    if (qualifiedGroupTier === 'pro') {
      return {
        replyText:
          `✅ <b>Verified as PRO</b>\n\n` +
          `Welcome to TrenchLabs Pro (${shortWallet}). Use your personal single-use link below to join the Pro community (expires in 60 minutes):\n` +
          `👉 ${invite.inviteLink}\n\n` +
          `Group status will update to <b>Joined</b> once you enter the group.\n` +
          `Private Notifications: <b>${formatNotifStatusLabel(bindRes.member.notification_status)}</b>`,
        success: true,
        replyMarkup,
      };
    }

    return {
      replyText:
        `✅ <b>Verified as Member</b>\n\n` +
        `Welcome to TrenchLabsHQ (${shortWallet}). Use your personal single-use link below to join the Member community (expires in 60 minutes):\n` +
        `👉 ${invite.inviteLink}\n\n` +
        `Group status will update to <b>Joined</b> once you enter the group.\n` +
        `Private Notifications: <b>${formatNotifStatusLabel(bindRes.member.notification_status)}</b>\n\n` +
        `Want Pro signals? Stake $250 in $H42 for 90 days on your dashboard:\n` +
        `🔗 ${siteUrl}/dashboard/stake`,
      success: true,
      replyMarkup,
    };
  } catch (err) {
    console.error('[TrenchLabs] Telegram verification error:', err);
    await markVerificationSessionRetryable(
      sessionId,
      err instanceof Error ? err.message : 'verification_error'
    ).catch(() => {});
    return {
      replyText: 'Temporary error verifying your wallet. Your link is still valid — tap Start again in a minute.',
      success: false,
      reason: 'retryable_error',
    };
  }
}

export function mapTelegramMemberStatus(
  status: string | undefined,
  isMemberFlag?: boolean
): 'joined' | 'left' | 'kicked' | 'revoked' | 'unknown' {
  switch (status) {
    case 'member':
    case 'administrator':
    case 'creator':
      return 'joined';
    case 'left':
      return 'left';
    case 'kicked':
      return 'kicked';
    case 'restricted':
      return isMemberFlag === true ? 'joined' : 'revoked';
    default:
      return 'unknown';
  }
}

export interface TelegramChatMemberUpdate {
  chat: { id: number | string; type?: string; title?: string };
  from?: { id: number; is_bot?: boolean };
  new_chat_member?: {
    user?: { id: number; is_bot?: boolean };
    status?: string;
    is_member?: boolean;
  };
  old_chat_member?: {
    status?: string;
    is_member?: boolean;
  };
}

export interface ChatMemberHandleResult {
  handled: boolean;
  action: string;
  status: 'completed' | 'retryable' | 'permanently_failed';
  reason?: string;
}

export async function enforceNotificationEntitlement(
  wallet: string,
  tier: UserTier
): Promise<void> {
  if (tier === 'unknown') {
    await recordUnknownEntitlementState(wallet).catch(() => {});
    return;
  }
  const allowed = tier !== 'free';
  const updated = await enforceDbNotificationEntitlement(wallet, {
    entitlementTier: tier,
    allowed,
  });
  if (!allowed && kvStoreEnabled()) {
    const chatId = updated?.telegram_chat_id;
    await kvHDel(SUBS_KEY, wallet).catch(() => {});
    if (chatId) await kvDel(chatKey(chatId)).catch(() => {});
  } else if (
    allowed &&
    updated?.notification_status === 'enabled' &&
    updated.telegram_chat_id &&
    kvStoreEnabled()
  ) {
    await kvHSet(SUBS_KEY, wallet, String(updated.telegram_chat_id)).catch(() => {});
    await kvSet(chatKey(updated.telegram_chat_id), wallet).catch(() => {});
  }
}

async function createOrReuseCommunityInvitation(
  member: TelegramMemberRow,
  expectedCommunity: CommunityTier,
  userId: number
): Promise<{ invite: GeneratedInvite; reused: boolean }> {
  const groups = getTelegramGroups();
  const expectedGroupId = expectedCommunity === 'pro' ? groups.pro : groups.member;
  const hasValidExisting =
    member.group_status === 'invite_pending' &&
    member.group_id === expectedGroupId &&
    Boolean(member.pending_invite_link) &&
    Boolean(member.invite_expires_at) &&
    Date.parse(member.invite_expires_at!) > Date.now() + 60_000;

  if (hasValidExisting && member.pending_invite_link && expectedGroupId) {
    return {
      invite: {
        inviteLink: member.pending_invite_link,
        inviteHash: member.invite_link_hash || hashSecretToken(member.pending_invite_link),
        expiresAtIso: member.invite_expires_at!,
        groupId: expectedGroupId,
      },
      reused: true,
    };
  }

  const invite = await createTelegramInviteWithMeta(expectedCommunity, userId);
  return { invite, reused: false };
}

/**
 * Service 3 — Processes Telegram `chat_member` updates for Member/Pro community groups.
 * Enforces bidirectional Member/Pro group routing, persists retryable reconciliation state on
 * temporary `'unknown'` entitlement failures, and verifies removal results without faking success.
 */
export async function handleTelegramChatMemberUpdate(
  chatMember: TelegramChatMemberUpdate,
  opts?: {
    updateId?: number;
    leaseToken?: string;
    nowMs?: number;
    retryDelaysMs?: readonly number[];
    maxAttempts?: number;
  }
): Promise<ChatMemberHandleResult> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;
  const chatIdStr = String(chatMember?.chat?.id ?? '').trim();
  const actualGroup = getCommunityTierFromGroupId(chatIdStr);

  if (!actualGroup) {
    return { handled: false, status: 'completed', action: 'ignored_unconfigured_group' };
  }

  const targetUser = chatMember.new_chat_member?.user || chatMember.from;
  if (!targetUser || targetUser.is_bot || typeof targetUser.id !== 'number') {
    return { handled: false, status: 'completed', action: 'ignored_non_user' };
  }
  const userId = targetUser.id;
  const mappedStatus = mapTelegramMemberStatus(
    chatMember.new_chat_member?.status,
    chatMember.new_chat_member?.is_member
  );

  const member = await getTelegramMemberByTelegramUserId(userId);
  if (!member) {
    if (mappedStatus === 'joined') {
      const rm = await removeChatMember(chatIdStr, userId);
      await recordAuditLog('telegram_unverified_join_removed', null, {
        group_tier: actualGroup,
        removed: rm.ok,
        error: rm.error ?? null,
      }).catch(() => {});
      return {
        handled: true,
        status: 'completed',
        action: rm.ok ? 'removed_unlinked_user' : 'unlinked_user_removal_failed',
      };
    }
    return { handled: true, status: 'completed', action: 'ignored_unknown_user_exit' };
  }

  // Handle exits & kicks immediately
  if (mappedStatus === 'left' || mappedStatus === 'kicked' || mappedStatus === 'revoked') {
    // If user exited a non-active secondary group (e.g. old Member group while holding a pending Pro invite),
    // clear actual_group_* metadata if it matches that group without clobbering their active/pending target group.
    if (
      (member.group_status === 'invite_pending' && member.group_id && member.group_id !== chatIdStr) ||
      (member.group_status === 'joined' && (member.actual_group_id ?? member.group_id) !== chatIdStr)
    ) {
      if (member.actual_group_id === chatIdStr) {
        await updateTelegramGroupMembership(member.wallet_address, {
          group_status: member.group_status,
          clear_actual_group: true,
        });
      }
      return { handled: true, status: 'completed', action: 'ignored_secondary_group_exit' };
    }

    // Preserve 'revoked' state if this 'left' event came right after our own sweep/wrong-group unban step
    const recentRevoke =
      member.group_status === 'revoked' &&
      mappedStatus === 'left' &&
      member.revoked_at &&
      Date.now() - Date.parse(member.revoked_at) < 120_000;

    if (!recentRevoke) {
      await updateTelegramGroupMembership(member.wallet_address, {
        group_status: mappedStatus,
        group_id: chatIdStr,
        clear_actual_group: true,
        reconciliation_required: false,
        reconciliation_reason: null,
      });
    }
    return { handled: true, status: 'completed', action: `recorded_${mappedStatus}` };
  }

  if (mappedStatus === 'unknown') {
    await recordAuditLog('telegram_unknown_member_status', member.wallet_address, {
      group_tier: actualGroup,
      raw_status: chatMember.new_chat_member?.status || 'missing',
    }).catch(() => {});
    return { handled: true, status: 'completed', action: 'ignored_unknown_status' };
  }

  // mappedStatus === 'joined' -> Authoritatively recheck wallet entitlement before recording any join.
  const entitlement = await resolveUserEntitlement(member.wallet_address);

  if (entitlement.tier === 'unknown') {
    const reason = entitlement.reason || 'entitlement_unavailable';
    await recordUnknownEntitlementState(
      member.wallet_address,
      'Entitlement unavailable during Telegram group join validation'
    );

    if (opts?.updateId !== undefined) {
      const persisted = await persistRetryableMembershipEvent({
        updateId: opts.updateId,
        eventType: 'chat_member',
        payload: chatMember,
        walletAddress: member.wallet_address,
        telegramUserId: userId,
        groupId: chatIdStr,
        reason,
        leaseToken: opts.leaseToken,
        nowMs: opts.nowMs,
        retryDelaysMs: opts.retryDelaysMs,
        maxAttempts: opts.maxAttempts,
      });
      if (persisted.status === 'permanently_failed') {
        return {
          handled: true,
          status: 'permanently_failed',
          action: 'reconciliation_exhausted',
          reason,
        };
      }
      return {
        handled: true,
        status: 'retryable',
        action: 'deferred_unknown_entitlement',
        reason,
      };
    }

    // Fallback reconciliation flag if called outside webhook update context
    const nextAttempt = (member.reconciliation_attempt_count ?? 0) + 1;
    const delays = opts?.retryDelaysMs || DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS;
    const delayMs = delays[Math.max(0, Math.min(delays.length - 1, nextAttempt - 1))] ?? DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS[0];
    await recordMembershipMismatch({
      walletAddress: member.wallet_address,
      entitlementTier: member.entitlement_tier,
      expectedCommunity: null,
      actualGroupId: chatIdStr,
      actualGroupTier: actualGroup,
      reason: 'entitlement_unavailable',
      reconciliationRequired: true,
      attemptCount: nextAttempt,
      nextReconciliationAt: (opts?.nowMs ?? Date.now()) + delayMs,
    });
    return {
      handled: true,
      status: 'retryable',
      action: 'deferred_unknown_entitlement',
      reason,
    };
  }

  await enforceNotificationEntitlement(member.wallet_address, entitlement.tier);

  const expectedGroup = getExpectedCommunity(entitlement);

  // Admin policy: admins are authorized for BOTH Pro and Member groups and are never kicked or flagged as mismatch.
  if (entitlement.isAdmin || entitlement.tier === 'admin') {
    if (actualGroup === 'pro') {
      await updateTelegramGroupMembership(member.wallet_address, {
        group_status: 'joined',
        group_id: chatIdStr,
        actual_group_id: chatIdStr,
        actual_group_tier: 'pro',
        tier: 'pro',
        entitlement_tier: 'admin',
        reconciliation_required: false,
        reconciliation_reason: null,
      });
      return { handled: true, status: 'completed', action: 'confirmed_joined_pro' };
    }
    // Admin entering Member group: keep Pro if already in Pro, otherwise record Member presence without downgrade.
    if (member.group_status === 'joined' && member.actual_group_tier === 'pro') {
      return { handled: true, status: 'completed', action: 'admin_preserved_pro_group' };
    }
    await updateTelegramGroupMembership(member.wallet_address, {
      group_status: 'joined',
      group_id: chatIdStr,
      actual_group_id: chatIdStr,
      actual_group_tier: 'member',
      tier: 'pro',
      entitlement_tier: 'admin',
      reconciliation_required: false,
      reconciliation_reason: null,
    });
    return { handled: true, status: 'completed', action: 'admin_joined_member' };
  }

  // Free user (expectedGroup === null) -> Reject entry into EITHER Member or Pro group.
  if (!expectedGroup) {
    const rm = await removeChatMember(chatIdStr, userId);
    if (!rm.ok) {
      await recordMembershipMismatch({
        walletAddress: member.wallet_address,
        entitlementTier: 'free',
        expectedCommunity: null,
        actualGroupId: chatIdStr,
        actualGroupTier: actualGroup,
        reason: `wrong_community_removal_failed:${rm.error || 'unknown'}`,
        reconciliationRequired: true,
        nextReconciliationAt: (opts?.nowMs ?? Date.now()) + DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS[0],
      });
      await recordAuditLog('telegram_free_removal_failed', member.wallet_address, {
        actualGroup,
        error: rm.error ?? 'unknown',
      }).catch(() => {});
      return { handled: true, status: 'completed', action: 'wrong_group_removal_failed' };
    }

    await updateTelegramGroupMembership(member.wallet_address, {
      group_status: 'revoked',
      group_id: chatIdStr,
      clear_actual_group: true,
      entitlement_tier: 'free',
      revoked_reason:
        actualGroup === 'pro'
          ? 'Wallet does not meet Pro $250 90-day stake requirement'
          : 'Wallet no longer holds $20 minimum in $H42',
      disable_notifications: true,
    });
    if (member.telegram_chat_id) {
      await tgSend(
        member.telegram_chat_id,
        `⚠️ <b>Community Access Restricted</b>\n\n` +
          `Your wallet does not currently meet the $20 $H42 (Member) or $250 90-day stake (Pro) requirement. Visit ${dashboard} to verify eligibility.`
      );
    }
    return { handled: true, status: 'completed', action: `revoked_unqualified_${actualGroup}` };
  }

  // Wrong community in EITHER direction:
  // - Member entering Pro group
  // - Pro entering Member group
  if (actualGroup !== expectedGroup) {
    const rm = await removeChatMember(chatIdStr, userId);
    await recordAuditLog('telegram_wrong_community_join', member.wallet_address, {
      actualGroup,
      expectedGroup,
      removed: rm.ok,
      error: rm.error ?? null,
    }).catch(() => {});

    // Always issue or reuse invitation for the user's true expected community (never silently convert Pro->Member or mark joined)
    let expectedInvite: GeneratedInvite | null = null;
    if (rm.ok) {
      try {
        const resInvite = await createOrReuseCommunityInvitation(member, expectedGroup, userId);
        expectedInvite = resInvite.invite;
      } catch (invErr) {
        console.warn(`[TrenchLabs] Failed generating ${expectedGroup} invite after wrong-group removal:`, invErr);
      }
    }

    if (!rm.ok || !expectedInvite) {
      await recordMembershipMismatch({
        walletAddress: member.wallet_address,
        entitlementTier: entitlement.tier,
        expectedCommunity: expectedGroup,
        actualGroupId: rm.ok ? null : chatIdStr,
        actualGroupTier: rm.ok ? null : actualGroup,
        reason: !rm.ok ? `wrong_community_removal_failed:${rm.error || 'unknown'}` : 'wrong_community_reconcile_invite_failed',
        reconciliationRequired: true,
        nextReconciliationAt: (opts?.nowMs ?? Date.now()) + DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS[0],
      });

      if (member.telegram_chat_id) {
        await tgSend(
          member.telegram_chat_id,
          expectedGroup === 'pro'
            ? `⚠️ <b>Wrong Community Group (PRO Wallet)</b>\n\n` +
                `Your wallet holds <b>Pro</b> status, not Member-only. Visit ${dashboard} to get your personal Pro group invitation.`
            : `⚠️ <b>Pro Community Access Restricted</b>\n\n` +
                `Your wallet qualifies as <b>Member</b>, not <b>Pro</b>. Visit ${dashboard} to verify your Member group access.`
        );
      }

      return {
        handled: true,
        status: 'completed',
        action: !rm.ok
          ? `wrong_group_${actualGroup}_removal_failed`
          : `wrong_group_${actualGroup}_reconcile_pending`,
      };
    }

    // Wrong group removed AND personal invite for expectedGroup issued cleanly
    await updateTelegramGroupMembership(member.wallet_address, {
      group_status: 'invite_pending',
      group_id: expectedInvite.groupId,
      clear_actual_group: true,
      tier: expectedGroup,
      entitlement_tier: entitlement.tier,
      invite_created_at: new Date().toISOString(),
      invite_expires_at: expectedInvite.expiresAtIso,
      invite_link_hash: expectedInvite.inviteHash,
      pending_invite_link: expectedInvite.inviteLink,
      reconciliation_required: false,
      reconciliation_reason: null,
      revoked_reason:
        expectedGroup === 'pro'
          ? 'Pro wallet entered Member group; redirected to Pro community'
          : 'Member wallet entered Pro group; redirected to Member community',
    });

    if (member.telegram_chat_id) {
      if (expectedGroup === 'member') {
        await tgSend(
          member.telegram_chat_id,
          `⚠️ <b>Pro Community Access Restricted</b>\n\n` +
            `Your wallet qualifies as <b>Member</b>, not <b>Pro</b>, so access to the Pro group was removed.\n\n` +
            `Join the Member community here (single-use):\n👉 ${expectedInvite.inviteLink}\n\n` +
            `To unlock Pro, stake $250 in $H42 for 90 days: ${siteUrl}/dashboard/stake`
        );
      } else {
        await tgSend(
          member.telegram_chat_id,
          `⚠️ <b>Wrong Community Group (PRO Wallet)</b>\n\n` +
            `Your wallet holds <b>Pro</b> status and belongs in the Pro community rather than the Member group, so your Member group join was removed.\n\n` +
            `Join the Pro community here (single-use):\n👉 ${expectedInvite.inviteLink}`
        );
      }
    }

    return {
      handled: true,
      status: 'completed',
      action:
        actualGroup === 'pro' ? 'revoked_wrong_group_pro' : 'revoked_wrong_group_member',
    };
  }

  // Confirmed authorized join in exact expectedGroup!
  const previousActualGroupId = member.actual_group_id ?? member.group_id;
  await updateTelegramGroupMembership(member.wallet_address, {
    group_status: 'joined',
    group_id: chatIdStr,
    actual_group_id: chatIdStr,
    actual_group_tier: actualGroup,
    tier: expectedGroup,
    entitlement_tier: entitlement.tier,
  });

  // If upgrading from Member to Pro and user just confirmed join in Pro, remove cleanly from old Member group
  const groups = getTelegramGroups();
  if (
    actualGroup === 'pro' &&
    groups.member &&
    previousActualGroupId === groups.member &&
    groups.member !== chatIdStr
  ) {
    await removeChatMember(groups.member, userId).catch(() => {});
  }

  return { handled: true, status: 'completed', action: `confirmed_joined_${actualGroup}` };
}

/**
 * Processes `my_chat_member` updates (bot blocked/unblocked in private chat or bot group permissions).
 */
export async function handleBotMembershipUpdate(
  mcm: TelegramChatMemberUpdate
): Promise<{ handled: boolean; action: string }> {
  const chatType = mcm?.chat?.type;
  const status = mcm?.new_chat_member?.status;
  const chatId = mcm?.chat?.id;
  if (!chatId) return { handled: false, action: 'missing_chat' };

  if (chatType === 'private') {
    if (status === 'kicked' || status === 'left') {
      const disabled = await disableTelegramNotificationsByChatId(chatId, 'blocked');
      if (disabled.wallet && kvStoreEnabled()) {
        await kvHDel(SUBS_KEY, disabled.wallet).catch(() => {});
        await kvDel(chatKey(chatId)).catch(() => {});
      }
      return { handled: true, action: 'private_bot_blocked' };
    }
    if (status === 'member') {
      const existing = await getTelegramMemberByChatId(chatId);
      if (existing && existing.identity_status === 'blocked') {
        await setTelegramNotificationStatus(existing.wallet_address, 'disabled');
      }
      return { handled: true, action: 'private_bot_unblocked' };
    }
  }

  return { handled: true, action: `bot_group_${status || 'unknown'}` };
}

/**
 * Computes authoritative, un-conflated status separating:
 * 1. Wallet connection & verified entitlement tier
 * 2. Telegram identity connection state
 * 3. Eligible community tier vs. actual confirmed Telegram group membership
 * 4. Notification preference vs. notification entitlement
 */
export function buildTelegramStatusResult(
  member: TelegramMemberRow | null,
  entitlement: {
    tier: UserTier;
    baseTier?: 'free' | 'member' | 'pro' | 'unknown';
    isAdmin?: boolean;
  } | null
): TelegramStatusResult {
  if (!member || !entitlement) {
    return {
      walletConnected: Boolean(member),
      entitlement: {
        tier: entitlement?.tier ?? 'unknown',
        status:
          entitlement?.tier === 'unknown'
            ? 'unknown'
            : entitlement && entitlement.tier !== 'free'
            ? 'verified'
            : 'unverified',
      },
      identity: { status: member ? member.identity_status : 'not_connected' },
      community: {
        eligibleCommunity: entitlement ? getExpectedCommunity(entitlement) : null,
        actualGroup: null,
        membershipStatus: 'not_joined',
      },
      notifications: {
        preference: 'disabled',
        entitlementAllowed: false,
        effectiveStatus: 'disabled',
      },
    };
  }

  const eligibleCommunity = getExpectedCommunity(entitlement);

  // Actual group must NEVER be derived from entitlement — only from actual group confirmation.
  let actualGroup: CommunityTier | null = null;
  if (member.actual_group_tier === 'pro' || member.actual_group_tier === 'member') {
    actualGroup = member.actual_group_tier;
  } else if (member.actual_group_id) {
    actualGroup = getCommunityTierFromGroupId(member.actual_group_id);
  } else if (member.group_status === 'joined') {
    actualGroup = getCommunityTierFromGroupId(member.group_id) ?? member.tier;
  }

  const isAdmin = Boolean(entitlement.isAdmin || entitlement.tier === 'admin');
  let membershipStatus: TelegramStatusResult['community']['membershipStatus'];
  if (entitlement.tier === 'unknown') {
    membershipStatus = 'unknown';
  } else if (actualGroup !== null && !isAuthorizedGroupForEntitlement(entitlement, actualGroup)) {
    membershipStatus = 'mismatch';
  } else if (member.group_status === 'mismatch') {
    membershipStatus = isAdmin && actualGroup !== null ? 'joined' : 'mismatch';
  } else {
    membershipStatus = member.group_status;
  }

  const preference: 'enabled' | 'disabled' =
    member.notification_preference === 'enabled' || member.notification_preference === 'disabled'
      ? member.notification_preference
      : member.notification_status === 'enabled'
      ? 'enabled'
      : 'disabled';
  const entitlementAllowed = entitlement.tier !== 'free' && entitlement.tier !== 'unknown';
  const effectiveStatus: 'enabled' | 'disabled' =
    entitlementAllowed &&
    canReceiveNotifications(preference, entitlementAllowed) &&
    member.identity_status !== 'blocked' &&
    member.notification_status !== 'blocked'
      ? 'enabled'
      : 'disabled';

  return {
    walletConnected: true,
    entitlement: {
      tier: entitlement.tier,
      status:
        entitlement.tier === 'unknown'
          ? 'unknown'
          : entitlement.tier === 'free'
          ? 'unverified'
          : 'verified',
    },
    identity: {
      status: member.identity_status,
    },
    community: {
      eligibleCommunity,
      actualGroup,
      membershipStatus,
    },
    notifications: {
      preference,
      entitlementAllowed,
      effectiveStatus,
    },
  };
}

function formatCommunityTierName(tier: CommunityTier | null): string {
  if (tier === 'pro') return 'Pro';
  if (tier === 'member') return 'Member';
  return 'None';
}

/**
 * Generates an accurate database- and entitlement-backed `/status` message.
 * Distinguishes Eligible Community from Actual Recorded Group Membership.
 */
export async function handleStatusCommand(
  chatId: number | string,
  userId?: number
): Promise<{ text: string; replyMarkup?: Record<string, unknown> }> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;
  const effectiveUserId =
    typeof userId === 'number' && Number.isFinite(userId) && userId > 0 ? userId : undefined;

  let member = await getTelegramMemberByChatId(chatId);
  if (!member && effectiveUserId) {
    member = await getTelegramMemberByTelegramUserId(effectiveUserId);
  }

  // Fallback compatibility check for un-migrated legacy Redis alert links
  if (!member && kvStoreEnabled()) {
    const kvWallet = await kvGet(chatKey(chatId)).catch(() => null);
    if (kvWallet) {
      const entitlement = await resolveUserEntitlement(kvWallet);
      await setTelegramNotificationStatus(kvWallet, 'enabled', {
        telegram_chat_id: String(chatId),
        telegram_user_id: effectiveUserId,
        entitlement_tier: entitlement.tier,
      }).catch(() => {});
      member = await getTelegramMember(kvWallet);
    }
  }

  if (!member) {
    return {
      text:
        `<b>TRENCHLABS ACCOUNT STATUS</b>\n\n` +
        `Wallet: Not Connected\n` +
        `Tier: Unverified\n\n` +
        `Telegram Identity: Not Connected\n` +
        `Eligible Community: None\n` +
        `Actual Group: None\n` +
        `Group Membership: Not Joined\n\n` +
        `Private Notifications: Disabled\n\n` +
        `Action Required:\n` +
        `Connect your wallet at ${dashboard} and start Telegram verification from the Overview card.`,
    };
  }

  let entitlement = await resolveUserEntitlement(member.wallet_address);
  if (entitlement.tier === 'unknown') {
    await recordUnknownEntitlementState(member.wallet_address);
  } else {
    const fastRecovered = await recoverWalletMembershipEventsIfEligible(
      member.wallet_address,
      entitlement,
      { telegramUserId: member.telegram_user_id }
    ).catch(() => ({ recovered: 0, deferred: false }));
    if (fastRecovered.recovered > 0) {
      member = (await getTelegramMember(member.wallet_address)) || member;
      entitlement = await resolveUserEntitlement(member.wallet_address);
    }
  }

  const shortWallet = `${member.wallet_address.slice(0, 6)}...${member.wallet_address.slice(-4)}`;
  const statusView = buildTelegramStatusResult(member, entitlement);
  const identityLabel =
    member.identity_status === 'blocked'
      ? 'Blocked'
      : member.identity_status === 'disconnected'
      ? 'Disconnected'
      : 'Connected';

  if (entitlement.tier === 'unknown') {
    const text =
      `<b>TRENCHLABS ACCOUNT STATUS</b>\n\n` +
      `Wallet: Connected (<code>${shortWallet}</code>)\n` +
      `Tier: <b>Temporarily Unavailable</b>\n\n` +
      `Telegram Identity: ${identityLabel}\n` +
      `Community: Requires Reverification\n` +
      `Actual Group: ${formatCommunityTierName(statusView.community.actualGroup)}\n\n` +
      `Private Notifications: <b>Current Eligibility Unavailable</b>\n\n` +
      `Action Required:\n` +
      `Retry verification later.\n\n` +
      `<b>Commands:</b>\n` +
      `/status — View your status\n` +
      `/start — Connect or resume verification\n` +
      `/stop — Disable private alerts\n` +
      `/help — View help`;

    return {
      text,
      replyMarkup: buildAlertsKeyboard(false, false, dashboard),
    };
  }

  const isAdmin = Boolean(entitlement.isAdmin || entitlement.tier === 'admin');
  const eligibleName = isAdmin
    ? 'Pro & Member (Admin)'
    : formatCommunityTierName(statusView.community.eligibleCommunity);
  const actualName = formatCommunityTierName(statusView.community.actualGroup);
  const isQualified = entitlement.tier !== 'free';

  let membershipLabel: string;
  if (statusView.community.membershipStatus === 'mismatch') {
    membershipLabel = 'Mismatch';
  } else if (entitlement.tier === 'free') {
    membershipLabel = member.group_status === 'revoked' ? 'Not Eligible (Revoked)' : 'Not Eligible';
  } else {
    membershipLabel = formatGroupStatusLabel(
      statusView.community.membershipStatus === 'unknown'
        ? member.group_status
        : statusView.community.membershipStatus
    );
  }

  const notifLabel =
    member.identity_status === 'blocked'
      ? 'Blocked'
      : statusView.notifications.effectiveStatus === 'enabled'
      ? 'Enabled'
      : 'Disabled';

  const accessState =
    statusView.community.membershipStatus === 'mismatch'
      ? 'Synchronization Required'
      : !isQualified
      ? 'Inactive (Does Not Meet Eligibility)'
      : statusView.community.membershipStatus === 'joined' ||
        statusView.notifications.effectiveStatus === 'enabled'
      ? 'Active'
      : statusView.community.membershipStatus === 'invite_pending'
      ? 'Pending Group Join'
      : 'Verified (Action Available)';

  let actionLine = '';
  if (statusView.community.membershipStatus === 'mismatch') {
    actionLine = `\n\nAction Required:\nYour community membership requires synchronization. Visit ${dashboard} to receive your personal ${eligibleName} invitation.`;
  } else if (entitlement.tier === 'free') {
    actionLine =
      `\n\nAction Required:\nYour wallet does not currently meet Member ($20 in $H42) or Pro ($250 staked 90d) eligibility. Check ${dashboard}.`;
  } else if (statusView.community.membershipStatus === 'invite_pending') {
    actionLine = `\n\nAction Required:\nUse your personal ${eligibleName} invitation to join (or re-verify from ${dashboard} if expired).`;
  } else if (statusView.community.membershipStatus !== 'joined') {
    actionLine = `\n\nAction Required:\nComplete Telegram verification on ${dashboard} to get a fresh single-use ${eligibleName} group invitation.`;
  }

  const text =
    `<b>TRENCHLABS ACCOUNT STATUS</b>\n\n` +
    `Wallet: Connected (<code>${shortWallet}</code>)\n` +
    `Tier: <b>${formatTierLabel(entitlement.tier)}</b>\n\n` +
    `Telegram Identity: ${identityLabel}\n` +
    `Eligible Community: ${eligibleName}\n` +
    `Actual Group: ${actualName}\n` +
    `Group Membership: <b>${membershipLabel}</b>\n\n` +
    `Private Notifications: <b>${notifLabel}</b>\n\n` +
    `Access: <b>${accessState}</b>${actionLine}\n\n` +
    `<b>Commands:</b>\n` +
    `/status — View your status\n` +
    `/start — Connect or resume verification\n` +
    `/stop — Disable private alerts\n` +
    `/help — View help`;

  return {
    text,
    replyMarkup: buildAlertsKeyboard(
      statusView.notifications.effectiveStatus === 'enabled',
      isQualified,
      dashboard
    ),
  };
}

/**
 * Handles bare `/start` without a token — state-aware, never falsely verifies or re-enables stopped notifications.
 */
export async function handleStartCommand(
  chatId: number | string,
  userId?: number
): Promise<{ text: string; replyMarkup?: Record<string, unknown> }> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;
  const effectiveUserId =
    typeof userId === 'number' && Number.isFinite(userId) && userId > 0 ? userId : undefined;

  let existing = await getTelegramMemberByChatId(chatId);
  if (!existing && effectiveUserId) {
    existing = await getTelegramMemberByTelegramUserId(effectiveUserId);
  }

  if (!existing) {
    return {
      text:
        `<b>Welcome to TrenchLabsHQ Bot</b>\n\n` +
        `Your Telegram account is not connected to a verified TrenchLabs wallet yet.\n\n` +
        `To get verified:\n` +
        `1. Open ${dashboard}\n` +
        `2. Connect & verify your Solana wallet\n` +
        `3. Tap <b>Connect &amp; Verify Telegram</b> in Overview\n\n` +
        `• Member Tier: Hold at least $20 in $H42\n` +
        `• Pro Tier: Stake $250 in $H42 for 90 days`,
      replyMarkup: { inline_keyboard: [[{ text: 'Open Lab Analysis', url: dashboard }]] },
    };
  }

  // Existing connected user -> display verified status and next action without resetting verification or re-enabling alerts
  return await handleStatusCommand(chatId, userId);
}

/**
 * `/stop` disables private notifications ONLY — preserves wallet identity, tier, and community group membership.
 */
export async function handleStopCommand(chatId: number | string): Promise<{ text: string }> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;

  const dbDisabled = await disableTelegramNotificationsByChatId(chatId, 'disabled');
  let kvRemoved = false;

  if (kvStoreEnabled()) {
    const kvWallet = dbDisabled.wallet || (await kvGet(chatKey(chatId)).catch(() => null));
    if (kvWallet) {
      await kvHDel(SUBS_KEY, kvWallet).catch(() => {});
      await kvDel(chatKey(chatId)).catch(() => {});
      kvRemoved = true;
    }
  }

  if (!dbDisabled.wallet && !kvRemoved) {
    return {
      text: `No TrenchLabs account or alerts were linked to this chat. Connect your wallet at ${dashboard}.`,
    };
  }

  return {
    text:
      `<b>Private Notifications: Disabled</b>\n\n` +
      `Community Membership: Unchanged\n\n` +
      `Use /start or the dashboard to review or re-enable your notification settings:\n` +
      `🔗 ${dashboard}`,
  };
}

export function handleHelpCommand(): { text: string } {
  const siteUrl = getSiteUrl();
  return {
    text:
      `<b>TrenchLabsHQ Bot</b>\n\n` +
      `Connect your wallet at ${siteUrl}/dashboard to verify access.\n\n` +
      `• <b>Member Tier ($20 held):</b> Hold at least $20 in $H42 for terminal access & Member community\n` +
      `• <b>Pro Tier ($250 staked):</b> Stake $250 in $H42 for 90 days for real-time alpha alerts & Pro group\n\n` +
      `<b>Commands:</b>\n` +
      `/status — View wallet, tier, identity, community & notification status\n` +
      `/start — Connect or view verification status\n` +
      `/stop — Disable private alerts only (keeps group access)\n` +
      `/help — View this help message`,
  };
}

export interface TelegramCallbackQueryUpdate {
  id: string;
  from: { id: number; is_bot?: boolean };
  message?: { chat?: { id: number | string; type?: string } };
  data?: string;
}

export async function handleCallbackQuery(
  cb: TelegramCallbackQueryUpdate
): Promise<{ handled: boolean }> {
  const chatId = cb.message?.chat?.id;
  const userId = cb.from?.id;
  const data = typeof cb.data === 'string' ? cb.data.trim() : '';

  if (!cb.id || !chatId || !userId || cb.message?.chat?.type !== 'private') {
    return { handled: false };
  }

  const member =
    (await getTelegramMemberByTelegramUserId(userId)) ||
    (await getTelegramMemberByChatId(chatId));

  if (data === 'notif:enable') {
    if (!member) {
      await tgAnswerCallbackQuery(cb.id, 'Connect a wallet on the dashboard first.', true);
      return { handled: true };
    }
    const entitlement = await resolveUserEntitlement(member.wallet_address);
    if (entitlement.tier === 'unknown') {
      await tgAnswerCallbackQuery(cb.id, 'Verification temporarily unavailable. Retry shortly.', true);
      return { handled: true };
    }
    if (entitlement.tier === 'free') {
      await tgAnswerCallbackQuery(cb.id, 'Member ($20+ $H42) or Pro ($250 staked) required for alerts.', true);
      return { handled: true };
    }
    await setPrivateNotificationsEnabled(member.wallet_address, true, {
      telegram_user_id: userId,
      telegram_chat_id: chatId,
      entitlement_tier: entitlement.tier,
    });
    await tgAnswerCallbackQuery(cb.id, 'Private notifications enabled!');
    const statusView = await handleStatusCommand(chatId, userId);
    await tgSend(chatId, statusView.text, { reply_markup: statusView.replyMarkup });
    return { handled: true };
  }

  if (data === 'notif:disable') {
    const res = await handleStopCommand(chatId);
    await tgAnswerCallbackQuery(cb.id, 'Private alerts disabled.');
    await tgSend(chatId, res.text);
    return { handled: true };
  }

  if (data === 'status:refresh') {
    await tgAnswerCallbackQuery(cb.id, 'Status updated');
    const statusView = await handleStatusCommand(chatId, userId);
    await tgSend(chatId, statusView.text, { reply_markup: statusView.replyMarkup });
    return { handled: true };
  }

  await tgAnswerCallbackQuery(cb.id);
  return { handled: false };
}

export interface SweepResult {
  checked: number;
  upgradedToPro: number;
  demotedToMember: number;
  evicted: number;
  reconciled: number;
  recoveredEvents: number;
  errors: number;
  truncated: boolean;
}

export interface RetryRecoveryResult {
  processed: number;
  completed: number;
  retryable: number;
  permanentlyFailed: number;
  reconciledMembers: number;
}

export async function reconcileUserAccess(
  member: TelegramMemberRow,
  resolvedEntitlement?: Awaited<ReturnType<typeof resolveUserEntitlement>>,
  options?: {
    sendDm?: boolean;
    nowMs?: number;
    retryDelaysMs?: readonly number[];
    maxAttempts?: number;
  }
): Promise<{ outcome: 'unchanged' | 'upgraded_to_pro' | 'demoted_to_member' | 'revoked' | 'restored_member' | 'deferred_unknown' | 'reconcile_retryable' }> {
  const siteUrl = getSiteUrl();
  const dashboard = `${siteUrl}/dashboard`;
  const groups = getTelegramGroups();
  const userId = member.telegram_user_id as number;
  const chatId = member.telegram_chat_id || userId;
  const sendDm = options?.sendDm !== false;

  if (!userId || !Number.isFinite(userId)) {
    return { outcome: 'unchanged' };
  }

  const entitlement = resolvedEntitlement || (await resolveUserEntitlement(member.wallet_address));

  if (entitlement.tier === 'unknown') {
    await recordUnknownEntitlementState(
      member.wallet_address,
      entitlement.reason || 'Temporary entitlement check error during reconciliation'
    );
    return { outcome: 'deferred_unknown' };
  }

  await enforceNotificationEntitlement(member.wallet_address, entitlement.tier);

  if (isAdminWallet(member.wallet_address) || entitlement.isAdmin || entitlement.tier === 'admin') {
    if (member.reconciliation_required || member.group_status === 'mismatch') {
      await updateTelegramGroupMembership(member.wallet_address, {
        group_status:
          member.group_status === 'mismatch'
            ? member.actual_group_id
              ? 'joined'
              : 'not_joined'
            : member.group_status,
        tier: 'pro',
        entitlement_tier: 'admin',
        reconciliation_required: false,
        reconciliation_reason: null,
        reconciliation_attempt_count: 0,
        next_reconciliation_at: null,
      });
    }
    return { outcome: 'unchanged' };
  }

  const expectedCommunity = getExpectedCommunity(entitlement);

  // Free tier: revoke restricted notifications unconditionally (already done above) AND reconcile group access independently.
  if (!expectedCommunity) {
    const hasRestrictedPresence =
      member.in_group ||
      member.group_status === 'joined' ||
      member.group_status === 'invite_pending' ||
      member.group_status === 'mismatch' ||
      Boolean(member.actual_group_id);

    if (!hasRestrictedPresence) {
      if (member.reconciliation_required) {
        await updateTelegramGroupMembership(member.wallet_address, {
          group_status: member.group_status,
          entitlement_tier: 'free',
          clear_actual_group: true,
          disable_notifications: true,
          reconciliation_required: false,
          reconciliation_reason: null,
          reconciliation_attempt_count: 0,
          next_reconciliation_at: null,
        });
      }
      return { outcome: 'unchanged' };
    }

    const removalTargets = new Set<string>();
    if (member.actual_group_id) removalTargets.add(member.actual_group_id);
    if (member.group_id) removalTargets.add(member.group_id);
    if (groups.pro && (member.tier === 'pro' || member.actual_group_tier === 'pro')) removalTargets.add(groups.pro);
    if (groups.member && (member.tier === 'member' || member.actual_group_tier === 'member')) removalTargets.add(groups.member);

    let failedTarget: string | null = null;
    for (const gid of removalTargets) {
      const rm = await removeChatMember(gid, userId);
      if (!rm.ok) {
        failedTarget = gid;
      }
    }

    if (failedTarget) {
      const nextAttempt = (member.reconciliation_attempt_count ?? 0) + 1;
      const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_ATTEMPTS;
      const delays = options?.retryDelaysMs || DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS;
      const delayMs = delays[Math.max(0, Math.min(delays.length - 1, nextAttempt - 1))] ?? DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS[0];
      const exhausted = nextAttempt >= maxAttempts;
      await recordMembershipMismatch({
        walletAddress: member.wallet_address,
        entitlementTier: 'free',
        expectedCommunity: null,
        actualGroupId: failedTarget,
        actualGroupTier: getCommunityTierFromGroupId(failedTarget),
        reason: 'free_eviction_failed',
        reconciliationRequired: !exhausted,
        attemptCount: nextAttempt,
        nextReconciliationAt: exhausted ? null : (options?.nowMs ?? Date.now()) + delayMs,
      });
      return { outcome: 'reconcile_retryable' };
    }

    const wasPro = member.tier === 'pro' || member.actual_group_tier === 'pro';
    await updateTelegramGroupMembership(member.wallet_address, {
      group_status: 'revoked',
      clear_actual_group: true,
      entitlement_tier: 'free',
      revoked_reason: wasPro
        ? 'Pro stake ended and balance below $20 minimum'
        : 'Wallet balance fell below $20 minimum',
      disable_notifications: true,
      reconciliation_required: false,
      reconciliation_reason: null,
      reconciliation_attempt_count: 0,
      next_reconciliation_at: null,
    });

    if (sendDm && chatId) {
      await tgSend(
        chatId,
        wasPro
          ? `⚠️ <b>Access Expired</b>\n\n` +
              `Your Pro stake has ended and your wallet no longer holds the minimum $20 in $H42.\n\n` +
              `Top up or re-stake on the dashboard to regain access:\n🔗 ${dashboard}`
          : `⚠️ Your wallet no longer holds the minimum $20 in $H42 required for Member access. You have been removed from the Member group.\n\n` +
              `Top up at ${dashboard} to get a new invite.`
      );
    }

    return { outcome: 'revoked' };
  }

  // Qualified Member or Pro user
  const actualGroupTier =
    member.actual_group_tier ??
    (member.actual_group_id
      ? getCommunityTierFromGroupId(member.actual_group_id)
      : member.group_status === 'joined'
      ? getCommunityTierFromGroupId(member.group_id) ?? member.tier
      : null);

  // Already confirmed joined in the exact expected community -> idempotent no-op (sync stale fields only if needed)
  if (member.group_status === 'joined' && actualGroupTier === expectedCommunity) {
    if (member.reconciliation_required || member.tier !== expectedCommunity) {
      await updateTelegramGroupMembership(member.wallet_address, {
        group_status: 'joined',
        tier: expectedCommunity,
        entitlement_tier: entitlement.tier,
        reconciliation_required: false,
        reconciliation_reason: null,
        reconciliation_attempt_count: 0,
        next_reconciliation_at: null,
      });
    }
    return { outcome: 'unchanged' };
  }

  // Currently in the WRONG group (e.g. Member upgraded to Pro while in Member group, Pro entered Member, or downgraded Pro still in Pro)
  let wrongGroupRemovalFailed = false;
  if (actualGroupTier && actualGroupTier !== expectedCommunity) {
    const wrongGroupId =
      member.actual_group_id || (actualGroupTier === 'pro' ? groups.pro : groups.member);
    if (wrongGroupId) {
      const rm = await removeChatMember(wrongGroupId, userId);
      if (!rm.ok) {
        wrongGroupRemovalFailed = true;
        const nextAttempt = (member.reconciliation_attempt_count ?? 0) + 1;
        const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_ATTEMPTS;
        const delays = options?.retryDelaysMs || DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS;
        const delayMs = delays[Math.max(0, Math.min(delays.length - 1, nextAttempt - 1))] ?? DEFAULT_MEMBERSHIP_RETRY_DELAYS_MS[0];
        const exhausted = nextAttempt >= maxAttempts;
        await recordMembershipMismatch({
          walletAddress: member.wallet_address,
          entitlementTier: entitlement.tier,
          expectedCommunity,
          actualGroupId: wrongGroupId,
          actualGroupTier,
          reason: 'wrong_group_removal_failed',
          reconciliationRequired: !exhausted,
          attemptCount: nextAttempt,
          nextReconciliationAt: exhausted ? null : (options?.nowMs ?? Date.now()) + delayMs,
        });
        return { outcome: 'reconcile_retryable' };
      }
    }
  }

  if (wrongGroupRemovalFailed) {
    return { outcome: 'reconcile_retryable' };
  }

  const wasPro = member.tier === 'pro';
  const wasRevoked = member.group_status === 'revoked';
  const wasDemoted = wasPro && expectedCommunity === 'member' && !wasRevoked;
  const wasUpgraded =
    expectedCommunity === 'pro' && (!wasPro || wasRevoked || member.group_status === 'mismatch' || member.group_status === 'not_joined' || member.group_status === 'left' || member.group_status === 'kicked');

  // Create or reuse an active unexpired single-use invite for expectedCommunity (never duplicate active invites, never reuse expired!)
  let inviteResult: { invite: GeneratedInvite; reused: boolean };
  try {
    inviteResult = await createOrReuseCommunityInvitation(member, expectedCommunity, userId);
  } catch (invErr) {
    console.warn(`[TrenchLabs Reconciliation] ${expectedCommunity} invite generation failed:`, invErr);
    if (wasDemoted) {
      await updateTelegramGroupMembership(member.wallet_address, {
        group_status: 'not_joined',
        group_id: groups.member || null,
        clear_actual_group: true,
        tier: 'member',
        entitlement_tier: 'member',
        invite_created_at: null,
        invite_expires_at: null,
        invite_link_hash: null,
        pending_invite_link: null,
        revoked_reason: 'Pro stake expired; downgraded to Member',
      });
      if (sendDm && chatId) {
        await tgSend(
          chatId,
          `⚠️ <b>Your Pro Access Has Ended</b>\n\n` +
            `Your 90-day stake has ended. Because your wallet still holds $20+ in $H42, you remain qualified as a <b>Member</b>.\n\n` +
            `Request a personal Member invite on your dashboard: 🔗 ${dashboard}\n\n` +
            `To regain full Pro access and priority signals, re-stake at least $250 in $H42:\n🔗 ${siteUrl}/dashboard/stake`
        );
      }
      return { outcome: 'demoted_to_member' };
    }
    return { outcome: 'reconcile_retryable' };
  }

  // Already holds a valid active invitation for the exact same tier & group -> idempotent (do not resend spam or duplicate invite)
  if (inviteResult.reused && !member.reconciliation_required) {
    return { outcome: 'unchanged' };
  }

  await updateTelegramGroupMembership(member.wallet_address, {
    group_status: 'invite_pending',
    group_id: inviteResult.invite.groupId,
    clear_actual_group: true,
    tier: expectedCommunity,
    entitlement_tier: entitlement.tier,
    invite_created_at: new Date().toISOString(),
    invite_expires_at: inviteResult.invite.expiresAtIso,
    invite_link_hash: inviteResult.invite.inviteHash,
    pending_invite_link: inviteResult.invite.inviteLink,
    reconciliation_required: false,
    reconciliation_reason: null,
    reconciliation_attempt_count: 0,
    next_reconciliation_at: null,
    ...(wasDemoted ? { revoked_reason: 'Pro stake expired; downgraded to Member' } : {}),
  });

  await recordAuditLog('telegram_access_reconciled', member.wallet_address, {
    expectedCommunity,
    previousGroupStatus: member.group_status,
    reusedInvite: inviteResult.reused,
  }).catch(() => {});

  if (sendDm && chatId && !inviteResult.reused) {
    if (wasDemoted) {
      await tgSend(
        chatId,
        `⚠️ <b>Your Pro Access Has Ended</b>\n\n` +
          `Your 90-day stake has ended. Because your wallet still holds $20+ in $H42, you remain qualified as a <b>Member</b>.\n\n` +
          `👉 <b>Join the Member Group (single-use invite):</b> ${inviteResult.invite.inviteLink}\n\n` +
          `To regain full Pro access and priority signals, re-stake at least $250 in $H42:\n🔗 ${siteUrl}/dashboard/stake`
      );
    } else if (expectedCommunity === 'pro') {
      await tgSend(
        chatId,
        `🎉 <b>${wasRevoked ? 'Pro Access Restored!' : 'Upgraded to PRO!'}</b>\n\n` +
          `Your active StakePoint $250 90-day stake qualifies you for the Pro community.\n\n` +
          `Join the Pro group with your single-use link (expires in 60 minutes):\n👉 ${inviteResult.invite.inviteLink}`
      );
    } else {
      await tgSend(
        chatId,
        `✅ <b>Member Access ${wasRevoked ? 'Restored' : 'Ready'}</b>\n\n` +
          `Your wallet meets the $20+ $H42 Member requirement.\n\n` +
          `Join the Member community with your single-use link (expires in 60 minutes):\n👉 ${inviteResult.invite.inviteLink}`
      );
    }
  }

  if (wasDemoted) return { outcome: 'demoted_to_member' };
  if (wasUpgraded && expectedCommunity === 'pro') return { outcome: 'upgraded_to_pro' };
  return { outcome: 'restored_member' };
}

/**
 * Processes durable retryable Telegram membership webhook events and pending member reconciliations.
 * Uses leased atomic claiming so concurrent recovery workers never duplicate invites or alerts.
 */
export async function processRetryableMembershipEvents(options?: {
  nowMs?: number;
  budgetMs?: number;
  limit?: number;
  retryDelaysMs?: readonly number[];
  maxAttempts?: number;
}): Promise<RetryRecoveryResult> {
  const res: RetryRecoveryResult = {
    processed: 0,
    completed: 0,
    retryable: 0,
    permanentlyFailed: 0,
    reconciledMembers: 0,
  };

  const lockKey = 'lock:telegram_membership_recovery';
  const lockToken = crypto.randomUUID();
  let locked = false;
  if (kvStoreEnabled()) {
    locked = await kvLock(lockKey, lockToken, 60).catch(() => false);
    if (!locked) return res;
  }

  try {
    const nowMs = options?.nowMs ?? Date.now();
    const budgetMs = options?.budgetMs ?? 20_000;
    const started = Date.now();
    const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_ATTEMPTS;

    const claimedEvents = await claimRetryableMembershipEvents({
      nowMs,
      limit: options?.limit ?? 25,
      maxAttempts,
    });

    for (const ev of claimedEvents) {
      if (Date.now() - started > budgetMs) break;
      res.processed++;

      const payload = ev.payload as TelegramChatMemberUpdate | null;
      if (!payload || !payload.chat || payload.chat.id === undefined) {
        await markWebhookUpdatePermanentlyFailed(
          ev.update_id,
          'Invalid or missing chat_member payload',
          ev.lease_token || undefined
        );
        res.permanentlyFailed++;
        continue;
      }

      try {
        const outcome = await handleTelegramChatMemberUpdate(payload, {
          updateId: ev.update_id,
          leaseToken: ev.lease_token || undefined,
          nowMs,
          retryDelaysMs: options?.retryDelaysMs,
          maxAttempts,
        });

        if (outcome.status === 'completed') {
          await markWebhookUpdateCompleted(ev.update_id, ev.lease_token || undefined);
          res.completed++;
        } else if (outcome.status === 'permanently_failed') {
          await markWebhookUpdatePermanentlyFailed(
            ev.update_id,
            outcome.reason || outcome.action,
            ev.lease_token || undefined
          );
          res.permanentlyFailed++;
        } else {
          res.retryable++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'recovery_error';
        const persisted = await persistRetryableMembershipEvent({
          updateId: ev.update_id,
          eventType: ev.event_type,
          payload: ev.payload,
          walletAddress: ev.wallet_address,
          telegramUserId: ev.telegram_user_id,
          groupId: ev.group_id,
          reason: errMsg,
          leaseToken: ev.lease_token || undefined,
          nowMs,
          retryDelaysMs: options?.retryDelaysMs,
          maxAttempts,
        });
        if (persisted.status === 'permanently_failed') {
          res.permanentlyFailed++;
        } else {
          res.retryable++;
        }
      }
    }

    const pendingMembers = await listMembersNeedingReconciliation(nowMs);
    for (const m of pendingMembers) {
      if (Date.now() - started > budgetMs) break;
      const rec = await reconcileUserAccess(m, undefined, {
        nowMs,
        retryDelaysMs: options?.retryDelaysMs,
        maxAttempts,
      });
      if (rec.outcome !== 'deferred_unknown' && rec.outcome !== 'reconcile_retryable') {
        res.reconciledMembers++;
      }
    }

    return res;
  } finally {
    if (locked) {
      await kvUnlock(lockKey, lockToken).catch(() => false);
    }
  }
}

/**
 * User-driven opportunistic recovery triggered during dashboard polling (`/api/verification/status`)
 * or Telegram `/status`: replays pending retryable membership events once entitlement is known,
 * while throttling un-resolved probes via a 30s cooldown so transient outages never consume cron attempts.
 */
export async function recoverWalletMembershipEventsIfEligible(
  walletAddress: string,
  preResolvedEntitlement?: Awaited<ReturnType<typeof resolveUserEntitlement>>,
  options?: {
    telegramUserId?: number | null;
    nowMs?: number;
    minProbeIntervalMs?: number;
    retryDelaysMs?: readonly number[];
    maxAttempts?: number;
  }
): Promise<{ recovered: number; deferred: boolean }> {
  if (!walletAddress) return { recovered: 0, deferred: false };
  if (preResolvedEntitlement?.tier === 'unknown') {
    return { recovered: 0, deferred: true };
  }

  const nowMs = options?.nowMs ?? Date.now();
  const maxAttempts = options?.maxAttempts ?? MAX_WEBHOOK_ATTEMPTS;
  const minProbeIntervalMs =
    options?.minProbeIntervalMs ?? (preResolvedEntitlement ? 0 : 30_000);

  let recovered = 0;
  let deferred = false;

  for (let i = 0; i < 3; i++) {
    const ev = await claimRetryableEventForWalletInteractive({
      walletAddress,
      telegramUserId: options?.telegramUserId,
      nowMs,
      minProbeIntervalMs,
      maxAttempts,
    });
    if (!ev) break;

    const payload = ev.payload as TelegramChatMemberUpdate | null;
    if (!payload || !payload.chat || payload.chat.id === undefined) {
      await markWebhookUpdatePermanentlyFailed(
        ev.update_id,
        'Invalid or missing chat_member payload',
        ev.lease_token || undefined
      );
      continue;
    }

    const entitlement = preResolvedEntitlement || (await resolveUserEntitlement(walletAddress));
    if (entitlement.tier === 'unknown') {
      await releaseInteractiveWebhookProbe(
        ev.update_id,
        ev.lease_token || '',
        entitlement.reason || 'entitlement_unavailable',
        nowMs
      );
      deferred = true;
      break;
    }

    try {
      const outcome = await handleTelegramChatMemberUpdate(payload, {
        updateId: ev.update_id,
        leaseToken: ev.lease_token || undefined,
        nowMs,
        retryDelaysMs: options?.retryDelaysMs,
        maxAttempts,
      });

      if (outcome.status === 'completed') {
        await markWebhookUpdateCompleted(ev.update_id, ev.lease_token || undefined);
        recovered++;
      } else if (outcome.status === 'permanently_failed') {
        await markWebhookUpdatePermanentlyFailed(
          ev.update_id,
          outcome.reason || outcome.action,
          ev.lease_token || undefined
        );
      } else {
        deferred = true;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'interactive_recovery_error';
      await releaseInteractiveWebhookProbe(ev.update_id, ev.lease_token || '', reason, nowMs);
      deferred = true;
      break;
    }
  }

  if (recovered === 0 && !deferred) {
    const member = await getTelegramMember(walletAddress).catch(() => null);
    if (member && member.reconciliation_required) {
      const elapsedSinceUpdate = nowMs - new Date(member.updated_at).getTime();
      const cooldownOk = minProbeIntervalMs === 0 || elapsedSinceUpdate >= minProbeIntervalMs;
      if (cooldownOk || (member.next_reconciliation_at ?? 0) <= nowMs) {
        const ent = preResolvedEntitlement || (await resolveUserEntitlement(walletAddress));
        if (ent.tier === 'unknown') {
          return { recovered, deferred: true };
        }
        const rec = await reconcileUserAccess(member, ent, {
          nowMs,
          retryDelaysMs: options?.retryDelaysMs,
          maxAttempts,
        });
        if (rec.outcome !== 'deferred_unknown' && rec.outcome !== 'reconcile_retryable') {
          recovered++;
        } else {
          deferred = true;
        }
      }
    }
  }

  return { recovered, deferred };
}

/**
 * Recurring background reconciliation worker:
 * 1. Recovers any pending/retryable `chat_member` webhook events after transient RPC/oracle outages.
 * 2. Reconciles every linked user (including previously `revoked` or `left` users) via `reconcileUserAccess`.
 * 3. Revokes Free-tier restricted notifications independently of group membership while preserving identity/preference.
 * 4. Restores access & issues single-use invites when previously revoked users re-qualify for Member or Pro.
 */
export async function sweepGroupMembers(budgetMs = 50_000): Promise<SweepResult> {
  const result: SweepResult = {
    checked: 0,
    upgradedToPro: 0,
    demotedToMember: 0,
    evicted: 0,
    reconciled: 0,
    recoveredEvents: 0,
    errors: 0,
    truncated: false,
  };
  const lockKey = 'lock:sweep_group_members';
  const lockToken = crypto.randomUUID();
  let locked = false;
  if (kvStoreEnabled()) {
    locked = await kvLock(lockKey, lockToken, 65);
    if (!locked) {
      return result;
    }
  }

  try {
    const started = Date.now();

    try {
      const recovered = await processRetryableMembershipEvents({
        budgetMs: Math.min(10_000, Math.floor(budgetMs / 4)),
      });
      result.recoveredEvents = recovered.completed + recovered.reconciledMembers;
    } catch (recErr) {
      console.warn('[TrenchLabs Sweep] Retryable recovery pass error:', recErr);
    }

    const members = await listTrackedTelegramMembers();
    const BATCH = 10;

    for (let i = 0; i < members.length; i += BATCH) {
      if (Date.now() - started > budgetMs) {
        result.truncated = true;
        break;
      }

      await Promise.all(
        members.slice(i, i + BATCH).map(async (m) => {
          result.checked++;
          try {
            if (isAdminWallet(m.wallet_address)) return;

            const entitlement = await resolveUserEntitlement(m.wallet_address);
            if (entitlement.tier === 'unknown') {
              await recordUnknownEntitlementState(
                m.wallet_address,
                entitlement.reason || 'Temporary entitlement check error during sweep'
              );
              const unknownSinceMs = m.entitlement_unknown_since
                ? Date.parse(m.entitlement_unknown_since)
                : Date.now();
              if (Date.now() - unknownSinceMs <= ENTITLEMENT_UNKNOWN_GRACE_MS) {
                console.warn(
                  `[TrenchLabs Sweep] Skipping ${m.wallet_address} due to RPC/oracle error (within grace window); eviction prevented`
                );
                return;
              }
              console.warn(
                `[TrenchLabs Sweep] Grace window exceeded for ${m.wallet_address}, still keeping safe pending recovery`
              );
              return;
            }

            const rec = await reconcileUserAccess(m, entitlement, { sendDm: true });
            if (rec.outcome === 'upgraded_to_pro') {
              result.upgradedToPro++;
              result.reconciled++;
            } else if (rec.outcome === 'demoted_to_member') {
              result.demotedToMember++;
              result.reconciled++;
            } else if (rec.outcome === 'revoked') {
              result.evicted++;
              result.reconciled++;
            } else if (rec.outcome === 'restored_member') {
              result.reconciled++;
            }
          } catch (err) {
            result.errors++;
            console.error('[TrenchLabs] sweep error for member:', err);
          }
        })
      );
    }

    return result;
  } finally {
    if (locked) {
      await kvUnlock(lockKey, lockToken).catch(() => false);
    }
  }
}

// ---------- linking & private notification subscriptions ----------

export async function createLinkCode(wallet: string): Promise<{ url: string }> {
  const code = crypto.randomBytes(18).toString('base64url');
  const codeHash = hashSecretToken(code);
  await createLinkCodeRow(codeHash, wallet, CODE_TTL_SEC);
  if (kvStoreEnabled()) {
    await kvSetEx(codeKey(codeHash), wallet, CODE_TTL_SEC).catch(() => {});
  }
  return { url: `https://t.me/${getBotUsername()}?start=${code}` };
}

export async function isLinked(wallet: string): Promise<boolean> {
  try {
    const member = await getTelegramMember(wallet);
    if (member) {
      return member.identity_status === 'connected' && member.notification_status === 'enabled';
    }
  } catch {
    // Fall through to KV if DB persistence is disabled cleanly in mocked tests
  }
  if (kvStoreEnabled()) {
    const subs = await kvHGetAll(SUBS_KEY);
    return Boolean(subs[wallet]);
  }
  return false;
}

export async function getLinkedWallet(chatId: string | number): Promise<string | null> {
  try {
    const member = await getTelegramMemberByChatId(chatId);
    if (member) {
      return member.identity_status === 'connected' && member.notification_status === 'enabled'
        ? member.wallet_address
        : null;
    }
  } catch {
    // Ignore DB errors when checking KV fallback
  }
  if (kvStoreEnabled()) {
    return (await kvGet(chatKey(chatId))) || null;
  }
  return null;
}

export async function setPrivateNotificationsEnabled(
  wallet: string,
  enabled: boolean,
  opts?: {
    telegram_user_id?: number;
    telegram_chat_id?: string | number;
    entitlement_tier?: UserTier;
  }
): Promise<{ ok: true; status: 'enabled' | 'disabled' } | { ok: false; reason: string }> {
  const res = await setTelegramNotificationStatus(wallet, enabled ? 'enabled' : 'disabled', opts);
  if (!res.ok) {
    return res;
  }

  if (kvStoreEnabled()) {
    const chatId = res.member.telegram_chat_id;
    if (enabled && chatId) {
      await kvHSet(SUBS_KEY, wallet, String(chatId)).catch(() => {});
      await kvSet(chatKey(chatId), wallet).catch(() => {});
    } else {
      await kvHDel(SUBS_KEY, wallet).catch(() => {});
      if (chatId) await kvDel(chatKey(chatId)).catch(() => {});
    }
  }

  return { ok: true, status: enabled ? 'enabled' : 'disabled' };
}

export async function unlinkWallet(wallet: string): Promise<void> {
  try {
    await setTelegramNotificationStatus(wallet, 'disabled');
  } catch {}
  if (kvStoreEnabled()) {
    const subs = await kvHGetAll(SUBS_KEY).catch(() => ({} as Record<string, string>));
    const chatId = subs[wallet];
    await kvHDel(SUBS_KEY, wallet).catch(() => {});
    if (chatId) await kvDel(chatKey(chatId)).catch(() => {});
  }
}

export async function unlinkChat(chatId: string | number): Promise<boolean> {
  const dbRes = await disableTelegramNotificationsByChatId(chatId, 'disabled').catch(() => ({
    disabled: false,
    wallet: null as string | null,
  }));
  let removed = dbRes.disabled;

  if (kvStoreEnabled()) {
    const wallet = dbRes.wallet || (await kvGet(chatKey(chatId)).catch(() => null));
    if (wallet) {
      await kvHDel(SUBS_KEY, wallet).catch(() => {});
      await kvDel(chatKey(chatId)).catch(() => {});
      removed = true;
    }
  }
  return removed;
}

/**
 * Redeems a one-time notification link code.
 * Preserves identity takeover protection, rechecks entitlement, enables private alerts ONLY,
 * and never grants community group membership (`group_status: 'joined'`).
 */
export async function completeLink(
  code: string,
  chatId: string | number,
  userId?: number
): Promise<string | null> {
  const codeHash = hashSecretToken(code);
  let wallet = await consumeLinkCodeRow(codeHash).catch(() => null);
  if (!wallet && kvStoreEnabled()) {
    wallet =
      (await kvGetDel(codeKey(codeHash)).catch(() => null)) ||
      (await kvGetDel(codeKey(code)).catch(() => null));
  }
  if (!wallet) return null;

  const lockKey = `lock:link:${wallet}`;
  const token = crypto.randomUUID();
  let locked = false;
  if (kvStoreEnabled()) {
    locked = await kvLock(lockKey, token, 15).catch(() => false);
  }
  try {
    const numericUserId =
      typeof userId === 'number' && Number.isFinite(userId) && userId > 0
        ? userId
        : /^\d+$/.test(String(chatId))
        ? Number(chatId)
        : undefined;

    const entitlement = await resolveUserEntitlement(wallet);
    if (entitlement.tier === 'free' || entitlement.tier === 'unknown') {
      return null;
    }

    const updated = await setTelegramNotificationStatus(wallet, 'enabled', {
      telegram_user_id: numericUserId,
      telegram_chat_id: String(chatId),
      entitlement_tier: entitlement.tier,
    });
    if (!updated.ok) {
      return null;
    }

    if (kvStoreEnabled()) {
      const prevWallet = await kvGet(chatKey(chatId)).catch(() => null);
      if (prevWallet && prevWallet !== wallet) await kvHDel(SUBS_KEY, prevWallet).catch(() => {});
      const subs = await kvHGetAll(SUBS_KEY).catch(() => ({} as Record<string, string>));
      const prevChat = subs[wallet];
      if (prevChat && String(prevChat) !== String(chatId)) await kvDel(chatKey(prevChat)).catch(() => {});

      await kvHSet(SUBS_KEY, wallet, String(chatId)).catch(() => {});
      await kvSet(chatKey(chatId), wallet).catch(() => {});
    }
    return wallet;
  } finally {
    if (locked) {
      await kvUnlock(lockKey, token).catch(() => {});
    }
  }
}

/**
 * Resolves the unified notification subscriber map `{ wallet -> chatId }` across durable DB
 * records and legacy Redis `SUBS_KEY`, strictly honoring DB opt-out/blocked states.
 */
export async function getActiveNotificationSubscribers(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  const blockedOrDisabledWallets = new Set<string>();

  try {
    const dbSubscribers = await listNotificationSubscribersFromDb();
    for (const sub of dbSubscribers) {
      merged[sub.wallet] = sub.chatId;
    }
    // Check explicit opt-outs, blocks, and revoked Free entitlements so stale Redis entries never bypass enforcement
    const { loadDb, normalizeTelegramMemberRow } = await import('@/server/db');
    const db = await loadDb();
    for (const rawMember of db.telegram_members || []) {
      const m = normalizeTelegramMemberRow(rawMember);
      if (
        m.notification_status !== 'enabled' ||
        m.notification_preference === 'disabled' ||
        m.notification_entitlement_allowed === false ||
        m.entitlement_tier === 'free' ||
        m.identity_status !== 'connected'
      ) {
        blockedOrDisabledWallets.add(m.wallet_address);
      }
    }
  } catch {
    // Allow KV-only unit simulators to inspect SUBS_KEY cleanly
  }

  if (kvStoreEnabled()) {
    try {
      const kvSubs = await kvHGetAll(SUBS_KEY);
      for (const [wallet, chatId] of Object.entries(kvSubs || {})) {
        if (!wallet || !chatId) continue;
        if (blockedOrDisabledWallets.has(wallet)) continue;
        if (!merged[wallet]) {
          merged[wallet] = String(chatId);
        }
      }
    } catch {
      // ignore if Redis unavailable in local dev
    }
  }

  return merged;
}

/**
 * Authoritative notification subscription check used by fan-out and TP/SL outbox workers
 * to prevent stale Redis entries from overriding DB `/stop` opt-out, block, or disconnect state.
 */
export async function isWalletNotificationSubscriptionActive(wallet: string): Promise<boolean> {
  if (!wallet) return false;
  try {
    const member = await getTelegramMember(wallet);
    if (!member) {
      // Allow legacy / KV-only unit test fixtures with no DB member row
      return true;
    }
    const active =
      member.identity_status === 'connected' &&
      member.notification_preference !== 'disabled' &&
      member.notification_status === 'enabled';
    if (!active && kvStoreEnabled()) {
      await kvHDel(SUBS_KEY, wallet).catch(() => {});
    }
    return active;
  } catch {
    return true;
  }
}

/**
 * Resolves live fan-out eligibility for a wallet, never trusting stale subscriber maps or Redis caches.
 */
async function resolveFanoutEligibility(
  wallet: string
): Promise<{ tier: 'free' | 'member' | 'pro' | 'unknown'; preferenceAllowed: boolean }> {
  const prefActive = await isWalletNotificationSubscriptionActive(wallet);
  if (!prefActive) {
    return { tier: 'free', preferenceAllowed: false };
  }

  const tier = isAdminWallet(wallet) ? 'pro' : await resolveTier(wallet);
  if (tier === 'free') {
    await enforceNotificationEntitlement(wallet, 'free').catch(() => {});
  }
  return { tier, preferenceAllowed: tier === 'pro' || tier === 'member' };
}

// ---------- fan-out ----------

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatCallMessage(r: AlphaRecord): string {
  const tps = (r.takeProfits ?? []).map((t) => esc(t.label)).join(' · ') || '—';
  const now = new Date();
  const dateFormatted =
    now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' · ' +
    now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      hour12: false,
    });

  const lines = [
    '🚨 <b>NEW CALL</b>',
    '',
    `Ticker - <b>${esc(r.ticker)}</b>`,
    `Chain - <b>${esc(r.chain)}</b>`,
    `Entry MC - <b>${esc(r.entryMarketCap)}</b>`,
    '',
    `Risk- <b>${r.risk}/5</b>`,
    '',
    `SL - <b>${esc(r.stopLoss)}</b>`,
    `TP - <b>${tps}</b>`,
    '',
    r.ca ? `CA\n<code>${esc(r.ca)}</code>` : 'CA\n<i>None provided</i>',
    '',
    '<i>Not financial advice.</i>',
    '<i>DYOR.</i>',
    '',
    'Signed',
    '<b>Lab Assistant</b>',
    `<i>${esc(dateFormatted)}</i>`,
  ];
  return lines.join('\n');
}

/**
 * Checks whether an alpha call is strictly reserved for Pro traders ($250 staked).
 * Pro-only calls (including MAX ALPHA or minTier === 'PRO') must never be sent or leaked to $20 Member tier users.
 */
export function isProOnlyCall(r: AlphaRecord): boolean {
  return r.minTier === 'PRO' || Boolean(r.isMaxAlpha);
}

export interface FanoutResult {
  sent: number;
  skipped: number;
  removed: number;
  deferred: number;
}

export const DELAYED_MEMBER_CALLS_KEY = 'telegram:delayed_member_calls_v1';
export const MEMBER_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export interface DelayedMemberCall {
  callId: string;
  call: AlphaRecord;
  deliverAt: number; // timestamp ms
  createdAt: number;
}

const localDelayedQueue = new Map<string, DelayedMemberCall>();

export async function enqueueDelayedMemberCall(r: AlphaRecord): Promise<void> {
  const deliverAt = Date.now() + MEMBER_DELAY_MS;
  const item: DelayedMemberCall = {
    callId: r.id,
    call: r,
    deliverAt,
    createdAt: Date.now(),
  };

  if (kvStoreEnabled()) {
    try {
      await kvHSet(DELAYED_MEMBER_CALLS_KEY, r.id, JSON.stringify(item));
    } catch (err) {
      console.error('[TrenchLabs] Failed to enqueue delayed member call to KV:', err);
      localDelayedQueue.set(r.id, item);
    }
  } else {
    localDelayedQueue.set(r.id, item);
  }

  // Node runtime local fallback timer
  if (typeof setTimeout !== 'undefined') {
    const timer = setTimeout(() => {
      dispatchDelayedMemberCalls().catch((e) =>
        console.error('[TrenchLabs] Timer dispatchDelayedMemberCalls error:', e)
      );
    }, MEMBER_DELAY_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
}

export async function dispatchDelayedMemberCalls(budgetMs = 50_000): Promise<{ dispatched: number; pending: number }> {
  if (!telegramConfigured()) return { dispatched: 0, pending: 0 };
  const siteUrl = getSiteUrl();

  const lockKey = 'lock:dispatch_delayed_member_calls';
  const lockToken = crypto.randomUUID();
  let locked = false;
  if (kvStoreEnabled()) {
    locked = await kvLock(lockKey, lockToken, 65);
    if (!locked) {
      return { dispatched: 0, pending: 0 };
    }
  }

  try {
    const now = Date.now();
    let items: DelayedMemberCall[] = [];
    if (kvStoreEnabled()) {
      const rawMap = await kvHGetAll(DELAYED_MEMBER_CALLS_KEY);
      items = Object.entries(rawMap || {})
        .map(([, rawStr]) => {
          try {
            return JSON.parse(rawStr) as DelayedMemberCall;
          } catch {
            return null;
          }
        })
        .filter((x): x is DelayedMemberCall => x !== null);
    } else {
      items = Array.from(localDelayedQueue.values());
    }

    const due = items.filter((it) => it.deliverAt <= now);
    if (due.length === 0) {
      return { dispatched: 0, pending: items.length };
    }

    const subs = Object.entries(await getActiveNotificationSubscribers());
    const keyboard = { inline_keyboard: [[{ text: 'Open terminal', url: `${siteUrl}/dashboard` }]] };
    const BATCH = 20;
    let dispatchedCount = 0;

    for (const item of due) {
      // Pro-only calls must never be dispatched to $20 Member tier subscribers
      if (isProOnlyCall(item.call)) {
        if (kvStoreEnabled()) await kvHDel(DELAYED_MEMBER_CALLS_KEY, item.callId).catch(() => {});
        localDelayedQueue.delete(item.callId);
        continue;
      }

      const text = formatCallMessage(item.call);
      for (let i = 0; i < subs.length; i += BATCH) {
        await Promise.all(
          subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
            try {
              if (isAdminWallet(wallet)) {
                // Admin already received instant alert
                return;
              }
              const { tier, preferenceAllowed } = await resolveFanoutEligibility(wallet);
              // Only deliver to verified, opted-in Member tier holders ($20+ held); never unknown/free
              if (!preferenceAllowed || tier !== 'member') return;

              const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
              if (res.ok) {
                dispatchedCount++;
              } else if (classifySendFailure(res.status, res.description) === 'blocked') {
                await disableTelegramNotificationsByChatId(chatId, 'blocked').catch(() => {});
                if (kvStoreEnabled()) await kvHDel(SUBS_KEY, wallet).catch(() => {});
              }
            } catch (err) {
              console.error('[TrenchLabs] Delayed member send error:', err);
            }
          })
        );
        if (i + BATCH < subs.length) await sleep(1_100);
      }

      // Remove dispatched call from delayed queue
      if (kvStoreEnabled()) await kvHDel(DELAYED_MEMBER_CALLS_KEY, item.callId).catch(() => {});
      localDelayedQueue.delete(item.callId);
    }

    return { dispatched: dispatchedCount, pending: items.length - due.length };
  } finally {
    if (locked) {
      await kvUnlock(lockKey, lockToken).catch(() => {});
    }
  }
}

/**
 * Sends a new call to subscribed holders independently of community group membership.
 * PRO tier ($250 staked 90d) & Admin get INSTANT delivery.
 * MEMBER tier ($20 held) receives general non-Pro calls after a 5-minute delay.
 * FREE & UNKNOWN tiers never receive calls.
 */
export async function notifyNewCall(r: AlphaRecord, budgetMs = 50_000): Promise<FanoutResult> {
  const result: FanoutResult = { sent: 0, skipped: 0, removed: 0, deferred: 0 };
  if (!telegramConfigured()) return result;

  const siteUrl = getSiteUrl();
  const isProOnly = isProOnlyCall(r);
  const started = Date.now();
  const subs = Object.entries(await getActiveNotificationSubscribers());
  const text = formatCallMessage(r);
  const keyboard = { inline_keyboard: [[{ text: 'Open terminal', url: `${siteUrl}/dashboard` }]] };
  const BATCH = 20;

  let hasMembersToDelay = false;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      console.error(`[TrenchLabs] Fan-out time budget exhausted; ${result.deferred} subscribers not notified.`);
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          const { tier, preferenceAllowed } = await resolveFanoutEligibility(wallet);

          if (!preferenceAllowed || tier === 'free' || tier === 'unknown') {
            result.skipped++;
            return;
          }

          if (tier === 'member') {
            // Pro-only & Max Alpha calls are NEVER delivered to Member tier (neither instant nor delayed)
            if (isProOnly) {
              result.skipped++;
              return;
            }
            // Member tier receives general calls after 5 minutes
            hasMembersToDelay = true;
            return;
          }

          // Strict check: only Pro & Admin reach instant delivery
          if (tier !== 'pro') {
            result.skipped++;
            return;
          }

          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
            await disableTelegramNotificationsByChatId(chatId, 'blocked').catch(() => {});
            await unlinkWallet(wallet);
            result.removed++;
          } else {
            console.error('[TrenchLabs] Alert send failed:', res.status, res.description);
            result.skipped++;
          }
        } catch (err) {
          console.error('[TrenchLabs] Alert fan-out error:', err);
          result.skipped++;
        }
      })
    );
    if (i + BATCH < subs.length) await sleep(1_100);
  }

  // Enqueue 5-minute delayed alert for Member tier ONLY if this call is NOT Pro-only
  if (!isProOnly && (hasMembersToDelay || subs.length > 0)) {
    await enqueueDelayedMemberCall(r);
  }

  return result;
}

export function formatTpTriggeredMessage(
  r: AlphaRecord,
  targetLabel: string,
  currentMcStr: string,
  eventRef?: string
): string {
  const lines = [
    `🎯 <b>TAKE-PROFIT HIT — ${esc(r.ticker)} (${esc(targetLabel)})</b>`,
    `Current MC: <b>${esc(currentMcStr)}</b> (Entry: ${esc(r.entryMarketCap)})`,
    `Chain: ${esc(r.chain)}`,
    r.ca ? `CA: <code>${esc(r.ca)}</code>` : '',
    '<i>Target hit. Protect capital & manage risk.</i>',
    eventRef ? `Ref: <code>#${esc(eventRef)}</code>` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatSlTriggeredMessage(
  r: AlphaRecord,
  currentMcStr: string,
  eventRef?: string
): string {
  const lines = [
    `🛑 <b>STOP-LOSS TRIGGERED — ${esc(r.ticker)}</b>`,
    `Current MC: <b>${esc(currentMcStr)}</b> (Stop-Loss: ${esc(r.stopLoss)})`,
    `Chain: ${esc(r.chain)}`,
    r.ca ? `CA: <code>${esc(r.ca)}</code>` : '',
    '<i>Invalidation condition reached. Position closed.</i>',
    eventRef ? `Ref: <code>#${esc(eventRef)}</code>` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export async function notifyTpTriggered(
  r: AlphaRecord,
  targetLabel: string,
  currentMcStr: string,
  budgetMs = 50_000
): Promise<FanoutResult> {
  const result: FanoutResult = { sent: 0, skipped: 0, removed: 0, deferred: 0 };
  if (!telegramConfigured()) return result;

  const siteUrl = getSiteUrl();
  const isProOnly = isProOnlyCall(r);
  const started = Date.now();
  const subs = Object.entries(await getActiveNotificationSubscribers());
  const text = formatTpTriggeredMessage(r, targetLabel, currentMcStr);
  const keyboard = { inline_keyboard: [[{ text: 'View on Terminal', url: `${siteUrl}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          const { tier, preferenceAllowed } = await resolveFanoutEligibility(wallet);
          if (!preferenceAllowed || tier === 'free' || tier === 'unknown') {
            result.skipped++;
            return;
          }
          // If this call is Pro-only, do not notify Member tier
          if (isProOnly && tier !== 'pro') {
            result.skipped++;
            return;
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
            await disableTelegramNotificationsByChatId(chatId, 'blocked').catch(() => {});
            await unlinkWallet(wallet);
            result.removed++;
          } else {
            console.error('[TrenchLabs] TP alert send failed:', res.status, res.description);
            result.skipped++;
          }
        } catch (err) {
          console.error('[TrenchLabs] TP alert fan-out error:', err);
          result.skipped++;
        }
      })
    );
    if (i + BATCH < subs.length) await sleep(1_100);
  }
  return result;
}

export async function notifySlTriggered(
  r: AlphaRecord,
  currentMcStr: string,
  budgetMs = 50_000
): Promise<FanoutResult> {
  const result: FanoutResult = { sent: 0, skipped: 0, removed: 0, deferred: 0 };
  if (!telegramConfigured()) return result;

  const siteUrl = getSiteUrl();
  const isProOnly = isProOnlyCall(r);
  const started = Date.now();
  const subs = Object.entries(await getActiveNotificationSubscribers());
  const text = formatSlTriggeredMessage(r, currentMcStr);
  const keyboard = { inline_keyboard: [[{ text: 'View on Terminal', url: `${siteUrl}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          const { tier, preferenceAllowed } = await resolveFanoutEligibility(wallet);
          if (!preferenceAllowed || tier === 'free' || tier === 'unknown') {
            result.skipped++;
            return;
          }
          // If this call is Pro-only, do not notify Member tier
          if (isProOnly && tier !== 'pro') {
            result.skipped++;
            return;
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
            await disableTelegramNotificationsByChatId(chatId, 'blocked').catch(() => {});
            await unlinkWallet(wallet);
            result.removed++;
          } else {
            console.error('[TrenchLabs] SL alert send failed:', res.status, res.description);
            result.skipped++;
          }
        } catch (err) {
          console.error('[TrenchLabs] SL alert fan-out error:', err);
          result.skipped++;
        }
      })
    );
    if (i + BATCH < subs.length) await sleep(1_100);
  }
  return result;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
