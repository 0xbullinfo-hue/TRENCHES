import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { resolveUserEntitlement } from '@/server/entitlements';
import { getTelegramMember } from '@/server/db';
import { setPrivateNotificationsEnabled } from '@/server/telegram';

export const dynamic = 'force-dynamic';

/**
 * Authenticated toggle for private Telegram call notifications, completely independent of group membership.
 */
export async function POST(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== 'boolean') {
    return NextResponse.json(
      { error: 'bad_request', message: 'enabled boolean is required' },
      { status: 400 }
    );
  }

  const entitlement = await resolveUserEntitlement(session.wallet);
  if (entitlement.tier === 'unknown') {
    return NextResponse.json(
      {
        error: 'entitlement_unavailable',
        retryable: true,
        message: 'On-chain eligibility check is temporarily unavailable. Retry shortly.',
      },
      { status: 503 }
    );
  }

  if (body.enabled && entitlement.tier === 'free') {
    return NextResponse.json(
      {
        error: 'not_eligible',
        message: 'Member ($20 in $H42) or Pro ($250 staked 90 days) qualification is required for alerts.',
      },
      { status: 403 }
    );
  }

  const member = await getTelegramMember(session.wallet);
  if (!member || member.identity_status === 'disconnected' || !member.telegram_chat_id) {
    return NextResponse.json(
      {
        error: 'telegram_not_connected',
        message: 'Verify and connect your Telegram account via @Trenchlabs_bot first.',
      },
      { status: 400 }
    );
  }

  if (body.enabled && member.identity_status === 'blocked') {
    return NextResponse.json(
      {
        error: 'bot_blocked',
        message: 'Unblock @Trenchlabs_bot in Telegram before re-enabling private alerts.',
      },
      { status: 403 }
    );
  }

  const res = await setPrivateNotificationsEnabled(session.wallet, body.enabled, {
    entitlement_tier: entitlement.tier,
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.reason, message: 'Could not update private notification state.' },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { ok: true, status: res.status },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}
