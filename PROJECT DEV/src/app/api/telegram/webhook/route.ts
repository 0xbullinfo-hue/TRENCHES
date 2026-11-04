import { NextRequest, NextResponse } from 'next/server';
import {
  WEBHOOK_SECRET,
  completeLink,
  telegramConfigured,
  tgSend,
  timingSafeEqualStr,
  unlinkChat,
} from '@/server/telegram';

export const dynamic = 'force-dynamic';

const START_RE = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{8,64})$/;

/** Telegram -> us. Authenticated with the secret token we registered via setWebhook. */
export async function POST(req: NextRequest) {
  if (!telegramConfigured()) return NextResponse.json({ ok: false }, { status: 503 });

  const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!WEBHOOK_SECRET || !timingSafeEqualStr(given, WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;

  // Telegram retries non-2xx, so always answer 200 once the request is authenticated.
  try {
    if (msg?.chat?.type === 'private' && typeof msg.text === 'string') {
      const chatId = msg.chat.id as number;
      const text = msg.text.trim();
      const start = START_RE.exec(text);

      if (start) {
        const wallet = await completeLink(start[1], chatId);
        await tgSend(
          chatId,
          wallet
            ? `✅ Alerts on for ${wallet.slice(0, 4)}…${wallet.slice(-4)}. New calls will land here. Send /stop to turn off.`
            : 'That link expired or was already used. Tap "Get alerts" on the dashboard again.'
        );
      } else if (/^\/stop(?:@\w+)?$/.test(text)) {
        const removed = await unlinkChat(chatId);
        await tgSend(chatId, removed ? 'Alerts turned off.' : 'No alerts were linked to this chat.');
      } else {
        await tgSend(chatId, 'Open the TrenchLabs dashboard and tap "Get alerts" to link this chat. /stop turns alerts off.');
      }
    }
  } catch (e) {
    console.error('[TrenchLabs] Telegram webhook handling failed:', e);
  }
  return NextResponse.json({ ok: true });
}
