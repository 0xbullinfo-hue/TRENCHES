import crypto from 'crypto';
import { isAdminWallet } from '@/lib/config';
import { MIN_GENESIS_REQUIRED } from '@/lib/tiers';
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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const SITE_URL = (process.env.SITE_URL || 'https://trenchlabshq.com').replace(/\/$/, '');

const SUBS_KEY = 'tg:subs'; // hash: wallet -> chatId
const chatKey = (chatId: string | number) => `tg:chat:${chatId}`; // chatId -> wallet
const codeKey = (code: string) => `tg:code:${code}`;
const CODE_TTL_SEC = 600;

/** Alerts need the bot credentials AND the shared store (subscribers must survive restarts). */
export const telegramConfigured = () =>
  Boolean(BOT_TOKEN && BOT_USERNAME && WEBHOOK_SECRET && KV_CONFIGURED);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tgSend(
  chatId: string | number,
  text: string,
  extra: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${API_BASE}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: /^-?\d+$/.test(String(chatId)) ? Number(chatId) : chatId, text, disable_web_page_preview: true, ...extra }),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
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

  // Use a distributed lock on the wallet during mapping assignment to avoid races
  const lockKey = `lock:link:${wallet}`;
  const token = Math.random().toString(36).slice(2);
  let locked = false;
  if (KV_CONFIGURED) {
    locked = await kvLock(lockKey, token, 10);
  }
  try {
    // One chat <-> one wallet, in both directions (no stale mappings).
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
}

/**
 * Sends a new call to every linked holder. Re-checks the $GENESIS balance for each recipient at send
 * time, so holders who sold stop receiving calls. Telegram allows ~30 msgs/sec, so we batch.
 */
export async function notifyNewCall(r: AlphaRecord): Promise<FanoutResult> {
  const result: FanoutResult = { sent: 0, skipped: 0, removed: 0 };
  if (!telegramConfigured()) return result;

  const subs = Object.entries(await kvHGetAll(SUBS_KEY));
  const text = formatCallMessage(r);
  const keyboard = { inline_keyboard: [[{ text: 'Open terminal', url: `${SITE_URL}/dashboard` }]] };
  const BATCH = 20;

  for (let i = 0; i < subs.length; i += BATCH) {
    await Promise.all(
      subs.slice(i, i + BATCH).map(async ([wallet, chatId]) => {
        try {
          if (!isAdminWallet(wallet)) {
            const bal = await readGenesisBalanceCached(wallet);
            if (bal < MIN_GENESIS_REQUIRED) {
              result.skipped++;
              return;
            }
          }
          const res = await tgSend(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
          if (res.ok) result.sent++;
          else if (res.status === 403 || res.status === 400) {
            // user blocked the bot / chat gone -> drop the subscription
            await unlinkWallet(wallet);
            result.removed++;
          } else result.skipped++;
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
