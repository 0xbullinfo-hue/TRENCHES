import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { resolveUserEntitlement } from '@/server/entitlements';
import {
  createOrReuseVerificationSession,
  getTelegramMember,
} from '@/server/db';
import { getBotUsername } from '@/server/telegram';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const target_tier = body?.target_tier;

  if (target_tier !== 'member' && target_tier !== 'pro') {
    return NextResponse.json(
      { error: 'bad_request', message: 'target_tier must be "member" or "pro"' },
      { status: 400 }
    );
  }

  // Authoritatively re-verify entitlement server-side (never trust client assertions).
  const entitlement = await resolveUserEntitlement(session.wallet);
  if (entitlement.tier === 'unknown') {
    return NextResponse.json(
      {
        error: 'entitlement_unavailable',
        retryable: true,
        message: 'On-chain eligibility check is temporarily unavailable. Please retry shortly.',
      },
      { status: 503 }
    );
  }

  const isProOrAdmin = entitlement.isAdmin || entitlement.baseTier === 'pro';
  const isMemberOrHigher = isProOrAdmin || entitlement.baseTier === 'member';

  if (target_tier === 'pro' && !isProOrAdmin) {
    return NextResponse.json(
      {
        error: 'not_eligible',
        reason: 'Pro Telegram group requires an active $250 90-day stake in $H42.',
      },
      { status: 403 }
    );
  }

  if (target_tier === 'member' && !isMemberOrHigher) {
    return NextResponse.json(
      {
        error: 'not_eligible',
        reason: 'Member Telegram group requires holding at least $20 in $H42.',
      },
      { status: 403 }
    );
  }

  // Only short-circuit as already_in_group when Telegram chat_member actually confirmed joined!
  const memberRecord = await getTelegramMember(session.wallet);
  const actuallyJoined =
    Boolean(memberRecord) &&
    memberRecord!.group_status === 'joined' &&
    memberRecord!.in_group &&
    (memberRecord!.tier === target_tier || (target_tier === 'member' && memberRecord!.tier === 'pro'));

  if (actuallyJoined) {
    return NextResponse.json({ already_in_group: true }, { status: 200 });
  }

  const result = await createOrReuseVerificationSession(session.wallet, target_tier);

  if ('rateLimited' in result) {
    return NextResponse.json(
      {
        error: 'too_many_requests',
        message: 'Too many attempts — wait a minute.',
      },
      { status: 429 }
    );
  }

  const vSession = result.session;
  const botUsername = getBotUsername() || 'Trenchlabs_bot';
  const deep_link = `https://t.me/${botUsername}?start=vs_${vSession.session_id}`;

  return NextResponse.json(
    {
      session_id: vSession.session_id,
      deep_link,
      expires_at: vSession.expires_at,
      already_in_group: false,
    },
    { status: 200 }
  );
}
