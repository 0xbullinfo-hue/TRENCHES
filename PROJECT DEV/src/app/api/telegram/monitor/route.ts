import { NextRequest, NextResponse } from 'next/server';
import { runAutomatedAlertsMonitor } from '@/server/alerts-monitor';
import { timingSafeEqualStr } from '@/server/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max serverless execution time for worker

/**
 * Scheduled worker endpoint for automated Take-Profit & Stop-Loss triggers.
 * Triggered automatically by Vercel cron or admin monitoring service.
 * Protected by CRON_SECRET authorization header.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization')?.trim() || '';

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
    }
    const expected = `Bearer ${cronSecret}`;
    if (!authHeader || !timingSafeEqualStr(authHeader, expected)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const result = await runAutomatedAlertsMonitor();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error('[TrenchLabs API] /api/telegram/monitor error:', err);
    return NextResponse.json(
      { ok: false, error: (err as Error)?.message || 'Alert monitor failed' },
      { status: 500 }
    );
  }
}
