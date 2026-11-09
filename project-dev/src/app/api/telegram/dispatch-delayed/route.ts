import { NextRequest, NextResponse } from 'next/server';
import { dispatchDelayedMemberCalls, timingSafeEqualStr } from '@/server/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Delivers queued Member-tier calls whose 5-minute delay has elapsed.
 * Protected by CRON_SECRET (same Bearer scheme as /api/telegram/monitor): it spends function time and
 * Telegram API quota, so it must never be callable anonymously or from a browser.
 * Scheduled by .github/workflows/tp-sl-monitor.yml every 5 minutes.
 */
async function handle(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[Delayed Dispatch] CRON_SECRET is not configured');
    return NextResponse.json({ ok: false, error: 'Cron authentication is not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization')?.trim() || '';
  if (!authHeader || !timingSafeEqualStr(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await dispatchDelayedMemberCalls();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Delayed Dispatch] Execution failed:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ ok: false, error: 'Delayed dispatch execution failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
