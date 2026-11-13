import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import {
  createOrReuseVerificationSession,
  getTelegramMember,
} from '@/server/db';

export const dynamic = 'force-dynamic';

const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || 'Trenchlabs_bot').replace(/^@/, '');

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

  // 2. Validate target_tier:
  // - "member" requires session.tier in {"member", "pro"}
  // - "pro" requires session.tier == "pro"
  // Otherwise 403 { error: "not_eligible", reason }
  const userTier = session.tier;
  if (target_tier === 'pro' && userTier !== 'pro') {
    return NextResponse.json(
      {
        error: 'not_eligible',
        reason: 'Pro Telegram group requires an active $250 stake.',
      },
      { status: 403 }
    );
  }

  if (target_tier === 'member' && userTier !== 'member' && userTier !== 'pro') {
    return NextResponse.json(
      {
        error: 'not_eligible',
        reason: 'Member Telegram group requires holding at least $20 in $H42.',
      },
      { status: 403 }
    );
  }

  // 3. If wallet already in target group -> 200 { already_in_group: true }
  const memberRecord = await getTelegramMember(session.wallet);
  if (memberRecord?.in_group && memberRecord.tier === target_tier) {
    return NextResponse.json({ already_in_group: true }, { status: 200 });
  }

  // 4 & 5. Create or reuse verification session
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
  const deep_link = `https://t.me/${BOT_USERNAME}?start=vs_${vSession.session_id}`;

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
