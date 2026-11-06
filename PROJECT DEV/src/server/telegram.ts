import crypto from 'crypto';
import { isAdminWallet } from '@/lib/config';
import {
  KV_CONFIGURED,
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
import { readGenesisBalanceCached } from '@/server/genesis';
import type { AlphaRecord } from '@/server/alphas-data';
import {
  claimVerificationSession,
  getVerificationSession,
  listGroupMembers,
  releaseVerificationSession,
  resolveTier,
  setMemberInGroup,
  upsertTelegramMember,
} from '@/server/db';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
export const SITE_URL = (process.env.SITE_URL || 'https://trenchlabshq.com').replace(/\/$/, '');

// Group Invite Links (Configured strictly via environment variables, never hardcoded)
export const MEMBER_INVITE_URL = process.env.TELEGRAM_MEMBER_INVITE_URL || '';
export const PRO_INVITE_URL = process.env.TELEGRAM_PRO_INVITE_URL || '';

export const TELEGRAM_GROUPS = {
  member: process.env.TELEGRAM_MEMBER_GROUP_ID,
  pro: process.env.TELEGRAM_PRO_GROUP_ID,
};

const SUBS_KEY = 'tg:subs'; // hash: wallet -> chatId
const chatKey = (chatId: string | number) => `tg:chat:${chatId}`; // chatId -> wallet
const codeKey = (code: string) => `tg:code:${code}`;
const CODE_TTL_SEC = 600;

/** Alerts need the bot credentials AND the shared store (subscribers must survive restarts). */
export const telegramConfigured = () =>
  Boolean(BOT_TOKEN && BOT_USERNAME && WEBHOOK_SECRET && KV_CONFIGURED);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TgCallResult {
  ok: boolean;
  status: number;
  description?: string;
  retryAfter?: number;
  result?: unknown;
}

const normChat = (chatId: string | number) => (/^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId);

/** Low-level Bot API call with timeout. Never throws. */
export async function tgCall(method: string, body: Record<string, unknown>): Promise<TgCallResult> {
  if (!BOT_TOKEN) return { ok: false, status: 0, description: 'bot token not configured' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/${method}`, {
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

/**
 * Issues an invite link for the designated tier ('member' | 'pro').
 * If group ID is configured and bot has admin rights, attempts single-use dynamic invite.
 * Otherwise falls back cleanly to the official group invite URL.
 */
export async function createTelegramInvite(
  tier: 'member' | 'pro',
  userId?: number
): Promise<string> {
  const fallbackUrl = tier === 'pro' ? PRO_INVITE_URL : MEMBER_INVITE_URL;
  const rawGroupId = tier === 'pro' ? TELEGRAM_GROUPS.pro : TELEGRAM_GROUPS.member;

  if (BOT_TOKEN && rawGroupId) {
    try {
      const res = await tgCall('createChatInviteLink', {
        chat_id: normChat(rawGroupId),
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 3600, // 60 minutes
        name: `Invite for ${userId || 'user'} (${tier})`,
      });
      const link = (res.result as { invite_link?: string } | undefined)?.invite_link;
      if (res.ok && link) {
        return link;
      }
    } catch (e) {
      console.error('[TrenchLabs] createChatInviteLink error:', e);
    }
  }

  if (fallbackUrl && fallbackUrl.trim().length > 0) {
    return fallbackUrl;
  }

  throw new Error(`Unable to generate invite link for ${tier} group: Bot credentials or group ID not configured`);
}

/**
 * Consumes `vs_<session_id>` verification deep link.
 * Atomically claims session, re-verifies on-chain, issues tier invite, and updates records.
 */
export async function handleTelegramVerification(
  sessionId: string,
  chatId: number | string,
  userId?: number
): Promise<{ replyText: string; success: boolean }> {
  const effectiveUserId = userId || (typeof chatId === 'number' ? chatId : Number(chatId)) || null;
  const dashboard = `${SITE_URL}/dashboard`;

  const claim = await claimVerificationSession(sessionId, effectiveUserId);
  if (claim.status !== 'ok') {
    const replies = {
      not_found: `This link is invalid. Get a new one from your dashboard: ${dashboard}`,
      used: 'This link was already used. Get a new one from your dashboard if you still need access.',
      expired: `This link expired. Get a new one from your dashboard: ${dashboard}`,
    } as const;
    return { replyText: replies[claim.status], success: false };
  }

  const wallet = claim.session.wallet_address;
  const targetTier = claim.session.tier;
  const shortWallet = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;

  try {
    const resultTier = await resolveTier(wallet);

    // Free: does not meet requirements
    if (resultTier === 'free') {
      await releaseVerificationSession(sessionId);
      return {
        replyText:
          `Your wallet ${shortWallet} doesn't currently qualify.\n\n` +
          `• Member access: Hold at least $20 in $GENESIS\n` +
          `• Pro access: Stake $250 for 90 days\n\n` +
          `Top up on the dashboard: ${dashboard}`,
        success: false,
      };
    }

    // User qualifies as Pro
    if (resultTier === 'pro') {
      try {
        const invite = await createTelegramInvite('pro', effectiveUserId ?? undefined);
        await upsertTelegramMember({
          wallet_address: wallet,
          telegram_user_id: effectiveUserId,
          tier: 'pro',
          in_group: true,
        });

        return {
          replyText:
            `✅ <b>Verified as PRO</b>\n\n` +
            `Welcome to TrenchLabs Pro. Join the private Pro group below:\n` +
            `👉 ${invite}\n\n` +
            `You will receive real-time calls and priority alpha notifications.`,
          success: true,
        };
      } catch (inviteErr) {
        console.error('[TrenchLabs] Pro invite generation failed:', inviteErr);
        return {
          replyText:
            `✅ <b>Verified as PRO</b>\n\n` +
            `Your wallet is qualified for Pro, but dynamic group invite links are currently unavailable.\n\n` +
            `Please contact an administrator or check back on the dashboard shortly:\n` +
            `🔗 ${dashboard}`,
          success: false,
        };
      }
    }

    // User qualifies as Member ($20 held, but not active Pro stake)
    if (resultTier === 'member') {
      try {
        const invite = await createTelegramInvite('member', effectiveUserId ?? undefined);
        await upsertTelegramMember({
          wallet_address: wallet,
          telegram_user_id: effectiveUserId,
          tier: 'member',
          in_group: true,
        });

        if (targetTier === 'pro') {
          return {
            replyText:
              `⚠️ <b>Verified as Member</b>\n\n` +
              `Your wallet holds $20+ in $GENESIS, but you do not currently have an active $250 stake for Pro.\n\n` +
              `👉 <b>Join Member Group:</b> ${invite}\n\n` +
              `To unlock the Pro group and high-conviction calls, stake $250 on your dashboard:\n` +
              `🔗 ${SITE_URL}/dashboard/stake`,
            success: true,
          };
        }

        return {
          replyText:
            `✅ <b>Verified as Member</b>\n\n` +
            `Welcome to TrenchLabsHQ. Join the Member group below:\n` +
            `👉 ${invite}\n\n` +
            `Want Pro signals? Stake $250 in $GENESIS for 90 days on your dashboard:\n` +
            `🔗 ${SITE_URL}/dashboard/stake`,
          success: true,
        };
      } catch (inviteErr) {
        console.error('[TrenchLabs] Member invite generation failed:', inviteErr);
        return {
          replyText:
            `✅ <b>Verified as Member</b>\n\n` +
            `Your wallet is qualified for Member access, but dynamic group invite links are currently unavailable.\n\n` +
            `Please contact an administrator or check back on the dashboard shortly:\n` +
            `🔗 ${dashboard}`,
          success: false,
        };
      }
    }

    return {
      replyText: `Could not determine qualification. Please try again from ${dashboard}`,
      success: false,
    };
  } catch (err) {
    console.error('[TrenchLabs] Telegram verification error:', err);
    await releaseVerificationSession(sessionId).catch(() => {});
    return {
      replyText: 'Network error verifying your wallet. Your link is still valid — tap Start again in a minute.',
      success: false,
    };
  }
}

export interface SweepResult {
  checked: number;
  demotedToMember: number;
  evicted: number;
  errors: number;
  truncated: boolean;
}

/**
 * Recurring background worker:
 * 1. Checks Pro members whose 90-day stake expired (unlocks_at <= now).
 *    -> Evicts from Pro group, demotes to Member (if holding $20+), invites to Member group, and prompts to re-stake $250.
 * 2. Checks Member holders whose balance dropped below $20.
 *    -> Evicts from Member group.
 */
export async function sweepGroupMembers(budgetMs = 50_000): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, demotedToMember: 0, evicted: 0, errors: 0, truncated: false };
  const started = Date.now();
  const members = await listGroupMembers();
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

          const currentTier = await resolveTier(m.wallet_address);
          if (currentTier === 'unknown') {
            console.warn(`[TrenchLabs Sweep] Skipping ${m.wallet_address} due to RPC/balance error; eviction prevented`);
            return;
          }
          const userId = m.telegram_user_id as number;

          // Case A: Was registered as PRO, but stake is now expired/unqualified
          if (m.tier === 'pro' && currentTier !== 'pro') {
            // Kick from Pro group
            if (TELEGRAM_GROUPS.pro) {
              await tgCall('banChatMember', { chat_id: normChat(TELEGRAM_GROUPS.pro), user_id: userId });
              await tgCall('unbanChatMember', { chat_id: normChat(TELEGRAM_GROUPS.pro), user_id: userId, only_if_banned: true });
            }

            if (currentTier === 'member') {
              // Downgrade to Member
              await upsertTelegramMember({
                wallet_address: m.wallet_address,
                telegram_user_id: userId,
                tier: 'member',
                in_group: true,
              });
              result.demotedToMember++;

              const memberInviteLine = MEMBER_INVITE_URL
                ? `👉 <b>Join the Member Group:</b> ${MEMBER_INVITE_URL}\n\n`
                : '';

              await tgSend(
                userId,
                `⚠️ <b>Your Pro Access Has Ended</b>\n\n` +
                `Your 90-day stake has completed. Because your wallet still holds $20+ in $GENESIS, you remain a <b>Member</b>.\n\n` +
                memberInviteLine +
                `To regain full Pro access and priority signals, re-stake at least $250 in $GENESIS:\n` +
                `🔗 ${SITE_URL}/dashboard/stake`
              );
            } else {
              // Less than $20 held too -> completely out
              await setMemberInGroup(m.wallet_address, false);
              result.evicted++;

              await tgSend(
                userId,
                `⚠️ <b>Access Expired</b>\n\n` +
                `Your Pro stake has ended and your wallet no longer holds the minimum $20 in $GENESIS.\n\n` +
                `Top up or re-stake on the dashboard to regain access:\n` +
                `🔗 ${SITE_URL}/dashboard`
              );
            }
          }

          // Case B: Was registered as MEMBER, but balance fell below $20
          else if (m.tier === 'member' && currentTier === 'free') {
            if (TELEGRAM_GROUPS.member) {
              await tgCall('banChatMember', { chat_id: normChat(TELEGRAM_GROUPS.member), user_id: userId });
              await tgCall('unbanChatMember', { chat_id: normChat(TELEGRAM_GROUPS.member), user_id: userId, only_if_banned: true });
            }
            await setMemberInGroup(m.wallet_address, false);
            result.evicted++;

            await tgSend(
              userId,
              `⚠️ Your wallet no longer holds the minimum $20 in $GENESIS required for Member access. You have been removed from the Member group.\n\n` +
              `Top up at ${SITE_URL}/dashboard to get a new invite.`
            );
          }
        } catch (err) {
          result.errors++;
          console.error('[TrenchLabs] sweep error for member:', err);
        }
      })
    );
  }

  return result;
}

// ---------- linking ----------

export async function createLinkCode(wallet: string): Promise<{ url: string }> {
  const code = crypto.randomBytes(18).toString('base64url');
  await kvSetEx(codeKey(code), wallet, CODE_TTL_SEC);
  return { url: `https://t.me/${BOT_USERNAME}?start=${code}` };
}

export async function isLinked(wallet: string): Promise<boolean> {
  const subs = await kvHGetAll(SUBS_KEY);
  return Boolean(subs[wallet]);
}

export async function getLinkedWallet(chatId: string | number): Promise<string | null> {
  return (await kvGet(chatKey(chatId))) || null;
}

export async function unlinkWallet(wallet: string): Promise<void> {
  const subs = await kvHGetAll(SUBS_KEY);
  const chatId = subs[wallet];
  await kvHDel(SUBS_KEY, wallet);
  if (chatId) await kvDel(chatKey(chatId));
}

export async function unlinkChat(chatId: string | number): Promise<boolean> {
  const wallet = await kvGet(chatKey(chatId));
  if (!wallet) return false;
  await kvHDel(SUBS_KEY, wallet);
  await kvDel(chatKey(chatId));
  return true;
}

/** Redeems a one-time code. Returns the linked wallet, or null if the code is invalid/expired. */
export async function completeLink(code: string, chatId: string | number): Promise<string | null> {
  const wallet = await kvGetDel(codeKey(code));
  if (!wallet) return null;

  const lockKey = `lock:link:${wallet}`;
  const token = Math.random().toString(36).slice(2);
  let locked = false;
  if (KV_CONFIGURED) {
    locked = await kvLock(lockKey, token, 10);
  }
  try {
    const prevWallet = await kvGet(chatKey(chatId));
    if (prevWallet && prevWallet !== wallet) await kvHDel(SUBS_KEY, prevWallet);
    const subs = await kvHGetAll(SUBS_KEY);
    const prevChat = subs[wallet];
    if (prevChat && String(prevChat) !== String(chatId)) await kvDel(chatKey(prevChat));

    await kvHSet(SUBS_KEY, wallet, String(chatId));
    await kvSet(chatKey(chatId), wallet);
    return wallet;
  } finally {
    if (locked) {
      await kvUnlock(lockKey, token).catch(() => {});
    }
  }
}

// ---------- fan-out ----------

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatCallMessage(r: AlphaRecord): string {
  const tps = (r.takeProfits ?? []).map((t) => esc(t.label)).join(' · ') || '—';
  const lines = [
    `🚨 <b>NEW CALL — ${esc(r.ticker)}</b> · ${esc(r.chain)}`,
    `Entry MC ${esc(r.entryMarketCap)} · Risk ${r.risk}/5`,
    `${esc(r.stopLoss)} · ${esc(r.riskRewardRatio)}`,
    `TP ${tps}`,
    r.ca ? `CA <code>${esc(r.ca)}</code>` : '',
    '<i>Not financial advice. DYOR.</i>',
  ];
  return lines.filter(Boolean).join('\n');
}

export interface FanoutResult {
  sent: number;
  skipped: number;
  removed: number;
  deferred: number;
}

/**
 * Sends a new call to every linked holder. Re-checks the tier for each recipient at send time,
 * so holders who sold or dropped below Member stop receiving calls. Telegram allows ~30 msgs/sec, so we batch.
 */
export async function notifyNewCall(r: AlphaRecord, budgetMs = 50_000): Promise<FanoutResult> {
  const result: FanoutResult = { sent: 0, skipped: 0, removed: 0, deferred: 0 };
  if (!telegramConfigured()) return result;

  const started = Date.now();
  const subs = Object.entries(await kvHGetAll(SUBS_KEY));
  const text = formatCallMessage(r);
  const keyboard = { inline_keyboard: [[{ text: 'Open terminal', url: `${SITE_URL}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      console.error(`[TrenchLabs] Fan-out time budget exhausted; ${result.deferred} subscribers not notified.`);
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          if (!isAdminWallet(wallet)) {
            const tier = await resolveTier(wallet);
            if (tier === 'free') {
              result.skipped++;
              return;
            }
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
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
  return result;
}

export function formatTpTriggeredMessage(r: AlphaRecord, targetLabel: string, currentMcStr: string): string {
  const lines = [
    `🎯 <b>TAKE-PROFIT HIT — ${esc(r.ticker)} (${targetLabel})</b>`,
    `Current MC: <b>${esc(currentMcStr)}</b> (Entry: ${esc(r.entryMarketCap)})`,
    `Chain: ${esc(r.chain)}`,
    r.ca ? `CA: <code>${esc(r.ca)}</code>` : '',
    '<i>Target hit. Protect capital & manage risk.</i>',
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatSlTriggeredMessage(r: AlphaRecord, currentMcStr: string): string {
  const lines = [
    `🛑 <b>STOP-LOSS TRIGGERED — ${esc(r.ticker)}</b>`,
    `Current MC: <b>${esc(currentMcStr)}</b> (Stop-Loss: ${esc(r.stopLoss)})`,
    `Chain: ${esc(r.chain)}`,
    r.ca ? `CA: <code>${esc(r.ca)}</code>` : '',
    '<i>Invalidation condition reached. Position closed.</i>',
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

  const started = Date.now();
  const subs = Object.entries(await kvHGetAll(SUBS_KEY));
  const text = formatTpTriggeredMessage(r, targetLabel, currentMcStr);
  const keyboard = { inline_keyboard: [[{ text: 'View on Terminal', url: `${SITE_URL}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          if (!isAdminWallet(wallet)) {
            const tier = await resolveTier(wallet);
            if (tier === 'free') {
              result.skipped++;
              return;
            }
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
            await unlinkWallet(wallet);
            result.removed++;
          } else {
            result.skipped++;
          }
        } catch {
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

  const started = Date.now();
  const subs = Object.entries(await kvHGetAll(SUBS_KEY));
  const text = formatSlTriggeredMessage(r, currentMcStr);
  const keyboard = { inline_keyboard: [[{ text: 'View on Terminal', url: `${SITE_URL}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    if (Date.now() - started > budgetMs) {
      result.deferred = subs.length - i;
      break;
    }
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          if (!isAdminWallet(wallet)) {
            const tier = await resolveTier(wallet);
            if (tier === 'free') {
              result.skipped++;
              return;
            }
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) {
            result.sent++;
          } else if (classifySendFailure(res.status, res.description) === 'blocked') {
            await unlinkWallet(wallet);
            result.removed++;
          } else {
            result.skipped++;
          }
        } catch {
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
