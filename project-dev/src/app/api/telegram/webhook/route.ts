import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  claimWebhookUpdate,
  markWebhookUpdateCompleted,
  markWebhookUpdateRetryable,
} from '@/server/db';
import {
  completeLink,
  getSiteUrl,
  getWebhookSecret,
  handleBotMembershipUpdate,
  handleCallbackQuery,
  handleHelpCommand,
  handleStartCommand,
  handleStatusCommand,
  handleStopCommand,
  handleTelegramChatMemberUpdate,
  handleTelegramVerification,
  telegramConfigured,
  tgSend,
  timingSafeEqualStr,
  type TelegramCallbackQueryUpdate,
  type TelegramChatMemberUpdate,
} from '@/server/telegram';

export const dynamic = 'force-dynamic';

const START_VS_RE = /^\/start(?:@\w+)?\s+vs_([A-Za-z0-9_-]+)$/;
const START_LEGACY_RE = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/;

function detectEventType(update: Record<string, unknown>): string {
  if (update.chat_member) return 'chat_member';
  if (update.my_chat_member) return 'my_chat_member';
  if (update.callback_query) return 'callback_query';
  if (update.message) return 'message';
  return 'other';
}

/** Telegram -> us. Authenticated with the secret token registered via setWebhook. */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'telegram_not_configured' }, { status: 503 });
  }

  const secret = getWebhookSecret();
  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!secret || !timingSafeEqualStr(given, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!update || typeof update.update_id !== 'number') {
    return NextResponse.json({ ok: false, error: 'invalid_update' }, { status: 400 });
  }

  const updateId = update.update_id;
  const eventType = detectEventType(update);

  // Fail-closed durable claim: if persistence/lock fails, return 503 so Telegram retries.
  let claim;
  try {
    claim = await claimWebhookUpdate(updateId, eventType);
  } catch (claimErr) {
    console.error('[TrenchLabs Telegram] Webhook claim failed (fail-closed):', claimErr);
    return NextResponse.json({ ok: false, error: 'store_unavailable' }, { status: 503 });
  }

  if (!claim.claimed) {
    return NextResponse.json({ ok: true, duplicate: true, status: claim.status });
  }

  try {
    // 1. Group member updates (joins, exits, kicks, restrictions)
    if (update.chat_member) {
      await handleTelegramChatMemberUpdate(update.chat_member as TelegramChatMemberUpdate);
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    // 2. Bot membership updates (user blocks/unblocks private bot, or bot promoted/removed in groups)
    if (update.my_chat_member) {
      await handleBotMembershipUpdate(update.my_chat_member as TelegramChatMemberUpdate);
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    // 3. Inline button callback queries (notification opt-in / opt-out / status refresh)
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query as TelegramCallbackQueryUpdate);
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    // 4. Private chat text commands
    const msg = update.message as
      | {
          chat?: { id?: number | string; type?: string };
          from?: { id?: number; is_bot?: boolean };
          text?: string;
        }
      | undefined;
    const chatId = msg?.chat?.id;
    const text = typeof msg?.text === 'string' ? msg.text.trim() : '';

    if (!chatId || !text || msg?.chat?.type !== 'private') {
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    const userId = msg.from?.id;
    const siteUrl = getSiteUrl();

    // 4a. Verification deep link: /start vs_<session_id>
    const vs = START_VS_RE.exec(text);
    if (vs) {
      const result = await handleTelegramVerification(vs[1], chatId, userId);
      await tgSend(chatId, result.replyText, {
        parse_mode: 'HTML',
        ...(result.replyMarkup ? { reply_markup: result.replyMarkup } : {}),
      });
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    // 4b. Legacy one-time private notification link code: /start <code>
    const legacy = START_LEGACY_RE.exec(text);
    if (legacy) {
      const wallet = await completeLink(legacy[1], chatId, userId);
      await tgSend(
        chatId,
        wallet
          ? `✅ <b>Private Notifications Enabled</b> (${wallet.slice(0, 6)}...${wallet.slice(-4)})\n\n` +
              `You will receive eligible call alerts here while your wallet qualifies. Send /stop anytime to disable alerts without affecting group membership.`
          : `That link is invalid, expired, or your wallet is not currently qualified. Open ${siteUrl}/dashboard to verify and retry.`,
        { parse_mode: 'HTML' }
      );
      await markWebhookUpdateCompleted(updateId, claim.leaseToken);
      return NextResponse.json({ ok: true });
    }

    // 4c. Slash commands
    const cmd = text.split(/\s+/)[0].replace(/@\w+$/, '').toLowerCase();
    if (cmd === '/stop') {
      const res = await handleStopCommand(chatId);
      await tgSend(chatId, res.text, { parse_mode: 'HTML' });
    } else if (cmd === '/status') {
      const res = await handleStatusCommand(chatId, userId);
      await tgSend(chatId, res.text, {
        parse_mode: 'HTML',
        ...(res.replyMarkup ? { reply_markup: res.replyMarkup } : {}),
      });
    } else if (cmd === '/start') {
      const res = await handleStartCommand(chatId, userId);
      await tgSend(chatId, res.text, {
        parse_mode: 'HTML',
        ...(res.replyMarkup ? { reply_markup: res.replyMarkup } : {}),
      });
    } else {
      const res = handleHelpCommand();
      await tgSend(chatId, res.text, { parse_mode: 'HTML' });
    }

    await markWebhookUpdateCompleted(updateId, claim.leaseToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const errId = crypto.randomBytes(4).toString('hex');
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[TrenchLabs Telegram] webhook handler error ${errId}:`, err);
    await markWebhookUpdateRetryable(updateId, errMsg, claim.leaseToken).catch(() => {});
    return NextResponse.json({ ok: false, error: 'webhook_processing_failed', errId }, { status: 500 });
  }
}
