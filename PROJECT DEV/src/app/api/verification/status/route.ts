import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { getTelegramMember } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const wallet = session.wallet;
  const tier = session.tier;

  const member = await getTelegramMember(wallet);
  const isInGroup = Boolean(member?.in_group);
  const connectedTier = isInGroup ? member?.tier ?? null : null;
  const connectedAt = isInGroup ? member?.last_synced_at ?? null : null;

  let can_connect = false;
  let target_tier: 'member' | 'pro' | null = null;
  let connected = false;

  if (tier === 'free') {
    can_connect = false;
    target_tier = null;
    connected = false;
  } else if (tier === 'pro') {
    if (isInGroup && connectedTier === 'pro') {
      connected = true;
      can_connect = true;
      target_tier = null;
    } else {
      connected = false;
      can_connect = true;
      target_tier = 'pro';
    }
  } else if (tier === 'member') {
    if (isInGroup && (connectedTier === 'member' || connectedTier === 'pro')) {
      connected = true;
      can_connect = true;
      target_tier = null;
    } else {
      connected = false;
      can_connect = true;
      target_tier = 'member';
    }
  }

  return NextResponse.json({
    wallet,
    tier,
    telegram: {
      connected,
      connected_tier: connectedTier,
      connected_at: connectedAt,
    },
    can_connect,
    target_tier,
  });
}

