import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRouteAuth } from '@/lib/auth/withAuth';
import { normalizeNotificationPreferences } from '@/lib/telegram-types';
import { resolveUserEntitlement } from '@/server/entitlements';
import { getTelegramMember, setTelegramNotificationPreferences } from '@/server/db';
import { setPrivateNotificationsEnabled } from '@/server/telegram';

export const dynamic = 'force-dynamic';

const preferencesPatchSchema = z.object({
  new_calls: z.boolean().optional(),
  tp_alerts: z.boolean().optional(),
  sl_alerts: z.boolean().optional(),
  chains: z.array(z.string().trim().min(1).max(16)).max(12).optional(),
});

const notificationToggleSchema = z
  .object({
    enabled: z.boolean().optional(),
    preferences: preferencesPatchSchema.optional(),
  })
  .refine((v) => v.enabled !== undefined || v.preferences !== undefined, {
    message: 'enabled boolean or preferences object is required',
  });

/**
 * Authenticated toggle & preferences update for private Telegram call notifications.
 */
export const POST = withRouteAuth<NextRequest, typeof notificationToggleSchema>(
  async ({ session, input }) => {
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

    const requiresQualification =
      input.enabled === true || input.preferences !== undefined;
    if (requiresQualification && entitlement.tier === 'free') {
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

    if (input.enabled === true && member.identity_status === 'blocked') {
      return NextResponse.json(
        {
          error: 'bot_blocked',
          message: 'Unblock @Trenchlabs_bot in Telegram before re-enabling private alerts.',
        },
        { status: 403 }
      );
    }

    let finalStatus = member.notification_status;
    let finalPreferences = normalizeNotificationPreferences(member.notification_preferences);

    if (typeof input.enabled === 'boolean') {
      const res = await setPrivateNotificationsEnabled(session.wallet, input.enabled, {
        entitlement_tier: entitlement.tier,
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.reason, message: 'Could not update private notification state.' },
          { status: 400 }
        );
      }
      finalStatus = res.status;
    }

    if (input.preferences) {
      const prefRes = await setTelegramNotificationPreferences(session.wallet, input.preferences);
      if (!prefRes.ok) {
        return NextResponse.json(
          { error: prefRes.reason, message: 'Could not update notification preferences.' },
          { status: 400 }
        );
      }
      finalPreferences = prefRes.preferences;
    }

    return NextResponse.json(
      { ok: true, status: finalStatus, preferences: finalPreferences },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  },
  {
    schema: notificationToggleSchema,
    invalidBodyMessage: 'enabled boolean or preferences object is required',
    rateLimit: { prefix: 'verif-notif', limit: 30, windowSec: 60 },
  }
);
