import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { resolveUserEntitlement } from '@/server/entitlements';
import {
  getActivePendingVerificationSessionForWallet,
  getTelegramMember,
} from '@/server/db';
import type {
  GroupStatus,
  NotificationStatus,
  TelegramIdentityStatus,
  VerificationStatusResponse,
} from '@/lib/telegram-types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const wallet = session.wallet;
  const requestedWallet = req.nextUrl.searchParams.get('wallet')?.trim();
  if (requestedWallet && requestedWallet !== wallet) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Cannot access another wallet Telegram status.' },
      { status: 403 }
    );
  }

  try {
    const entitlement = await resolveUserEntitlement(wallet);
    const member = await getTelegramMember(wallet);
    const pendingSession = !member ? await getActivePendingVerificationSessionForWallet(wallet) : null;

    const isQualified = entitlement.tier !== 'free' && entitlement.tier !== 'unknown';
    const isProOrAdmin = entitlement.isAdmin || entitlement.baseTier === 'pro';

    // 1. Identity status (independent of group join & alerts)
    let identityStatus: TelegramIdentityStatus = 'not_connected';
    if (member) {
      identityStatus = member.identity_status;
    } else if (pendingSession) {
      identityStatus = 'pending';
    }

    // 2. Community access status (confirmed strictly via chat_member / authoritative tracking)
    const groupStatus: GroupStatus = member ? member.group_status : 'not_joined';
    let communityTier: 'member' | 'pro' | null = null;
    if (member && (groupStatus === 'joined' || groupStatus === 'invite_pending')) {
      communityTier = member.tier === 'pro' ? 'pro' : 'member';
      // Never expose a Pro community tier to a Member-only or Free wallet
      if (communityTier === 'pro' && !isProOrAdmin && entitlement.tier !== 'unknown') {
        communityTier = entitlement.baseTier === 'member' ? 'member' : null;
      }
    } else if (isQualified) {
      communityTier = isProOrAdmin ? 'pro' : 'member';
    }

    // 3. Private notification subscription status (independent of community group membership)
    const notificationStatus: NotificationStatus = member
      ? member.notification_status
      : 'disabled';

    // 4. Target & Action eligibility
    const expectedCommunityTier: 'member' | 'pro' | null =
      !isQualified ? null : isProOrAdmin ? 'pro' : 'member';

    const joinedExpectedGroup =
      Boolean(member) &&
      groupStatus === 'joined' &&
      expectedCommunityTier !== null &&
      (member!.tier === expectedCommunityTier ||
        (expectedCommunityTier === 'member' && member!.tier === 'pro'));

    const targetTier: 'member' | 'pro' | null =
      !isQualified || joinedExpectedGroup ? null : expectedCommunityTier;

    const actions = {
      canConnect: isQualified && (identityStatus !== 'connected' || !joinedExpectedGroup),
      canJoinCommunity: isQualified && !joinedExpectedGroup,
      canEnableNotifications: isQualified && identityStatus === 'connected',
    };

    const legacyConnected = identityStatus === 'connected' && groupStatus === 'joined';
    const legacyConnectedTier = legacyConnected ? communityTier : null;
    const legacyConnectedAt = legacyConnected ? (member?.joined_at ?? member?.last_synced_at ?? null) : null;

    const payload: VerificationStatusResponse = {
      ok: true,
      entitlement: {
        tier: entitlement.tier,
        verified: isQualified,
        checkedAt: entitlement.verifiedAt,
        ...(entitlement.reason ? { reason: entitlement.reason } : {}),
      },
      telegram: {
        identity: {
          status: identityStatus,
        },
        community: {
          tier: communityTier,
          status: groupStatus,
          joinedAt: member?.joined_at ?? null,
        },
        notifications: {
          status: notificationStatus,
        },
        connected: legacyConnected,
        connected_tier: legacyConnectedTier,
        connected_at: legacyConnectedAt,
      },
      actions,
      wallet,
      tier: entitlement.baseTier,
      can_connect: isQualified,
      target_tier: targetTier,
    };

    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[TrenchLabs Verification Status] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'store_unavailable', message: 'Could not retrieve verification status.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
