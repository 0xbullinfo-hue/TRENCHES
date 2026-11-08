import { NextRequest, NextResponse } from 'next/server';
import { sweepGroupMembers, telegramConfigured, timingSafeEqualStr } from '@/server/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Re-checks every group member's tier qualification:
 * - Evicts/demotes expired Pro stakers, invites them to Member group, and prompts to re-stake.
 * - Evicts members whose token balance dropped below $20.
 *
 * Protected by CRON_SECRET (Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization')?.trim() || '';
  const expected = `Bearer ${secret}`;
  if (!authHeader || !timingSafeEqualStr(authHeader, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (!telegramConfigured()) {
    return NextResponse.json({ ok: false, error: 'telegram not configured' }, { status: 503 });
  }

  try {
    const result = await sweepGroupMembers();
    console.log('[TrenchLabs] member sweep completed:', JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      '[TrenchLabs] member sweep failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return NextResponse.json(
      { ok: false, error: 'Member sweep execution failed' },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;

