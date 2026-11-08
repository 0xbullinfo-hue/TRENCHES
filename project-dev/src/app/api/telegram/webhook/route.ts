import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  SITE_URL,
  WEBHOOK_SECRET,
  completeLink,
  getLinkedWallet,
  handleTelegramVerification,
  telegramConfigured,
  tgSend,
  timingSafeEqualStr,
  unlinkChat,
} from '@/server/telegram';
import { kvLock } from '@/server/kv';

export const dynamic = 'force-dynamic';

const START_VS_RE = /^\/start(?:@\w+)?\s+vs_([A-Za-z0-9_-]+)$/;
const START_LEGACY_RE = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/;
const DEDUP_TTL_SEC = 24 * 3600;

const HELP_TEXT =
  `<b>TrenchLabsHQ Bot</b>\n\n` +
  `Connect your wallet at ${SITE_URL}/dashboard to verify access.\n\n` +
  `• <b>Member Tier ($20 held):</b> Terminal dashboard & Member community\n` +
  `• <b>Pro Tier ($250 staked):</b> Real-time alpha alerts & Pro group\n\n` +
  `<b>Commands:</b>\n` +
  `/status - Check your current alert status\n` +
  `/stop - Disconnect alert notifications\n` +
  `/help - View this help message`;

/** Telegram -> us. Authenticated with the secret token registered via setWebhook. */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ ok: false }, { status: 503 });

  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!WEBHOOK_SECRET || !timingSafeEqualStr(given, WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update || typeof update.update_id !== 'number') return NextResponse.json({ ok: true });

  // Telegram retries on slow responses; process each update_id at most once
  const first = await kvLock(`tg:update:${update.update_id}`, '1', DEDUP_TTL_SEC).catch(() => true);
  if (!first) return NextResponse.json({ ok: true, duplicate: true });

  // Always answer 200 once authenticated so Telegram does not retry endlessly
  try {
    // User blocked or left the bot -> drop alert subscription
    const mcm = update.my_chat_member;
    if (mcm?.chat?.type === 'private' && ['kicked', 'left'].includes(mcm?.new_chat_member?.status)) {
      await unlinkChat(mcm.chat.id);
      return NextResponse.json({ ok: true });
    }

    const msg = update.message;
    const chatId = msg?.chat?.id;
    const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
    if (!chatId || !text || msg.chat?.type !== 'private') return NextResponse.json({ ok: true });

    // 1. Verification deep link: /start vs_<session_id>
    const vs = START_VS_RE.exec(text);
    if (vs) {
      const { replyText } = await handleTelegramVerification(vs[1], chatId, msg.from?.id);
      await tgSend(chatId, replyText, { parse_mode: 'HTML' });
      return NextResponse.json({ ok: true });
    }

    // 2. Alert connection link: /start <one_time_code>
    const legacy = START_LEGACY_RE.exec(text);
    if (legacy) {
      const wallet = await completeLink(legacy[1], chatId);
      await tgSend(
        chatId,
        wallet
          ? `✅ <b>Alerts Connected</b> (${wallet.slice(0, 4)}...${wallet.slice(-4)})\n\n` +
            `You will receive real-time call notifications here while qualified. Send /stop anytime to turn off.`
          : `That link is invalid or expired. Open ${SITE_URL}/dashboard and tap the Telegram button again.`,
        { parse_mode: 'HTML' }
      );
      return NextResponse.json({ ok: true });
    }

    const cmd = text.split(/\s+/)[0].replace(/@\w+$/, '').toLowerCase();
    if (cmd === '/stop') {
      const removed = await unlinkChat(chatId);
      await tgSend(chatId, removed ? 'Alerts turned off. Reconnect anytime from your dashboard.' : 'No alerts were connected to this chat.');
    } else if (cmd === '/status') {
      const wallet = await getLinkedWallet(chatId);
      await tgSend(
        chatId,
        wallet
          ? `Alerts are <b>ON</b> for wallet ${wallet.slice(0, 4)}...${wallet.slice(-4)}.`
          : `Alerts are <b>OFF</b>. Connect your wallet at ${SITE_URL}/dashboard.`,
        { parse_mode: 'HTML' }
      );
    } else {
      // /start (bare), /help, and anything else
      await tgSend(chatId, HELP_TEXT, { parse_mode: 'HTML' });
    }
  } catch (err) {
    const errId = crypto.randomBytes(4).toString('hex');
    console.error(`[TrenchLabs Telegram] webhook handler error ${errId}:`, err);
  }

  return NextResponse.json({ ok: true });
}
