import { NextRequest, NextResponse } from 'next/server';
import { runAutomatedAlertsMonitor } from '@/server/alerts-monitor';
import { timingSafeEqualStr } from '@/server/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('[TP/SL Monitor] CRON_SECRET is not configured');

    return NextResponse.json(
      { ok: false, error: 'Cron authentication is not configured' },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get('authorization')?.trim() || '';
  const expected = `Bearer ${cronSecret}`;

  if (!authHeader || !timingSafeEqualStr(authHeader, expected)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const startedAt = Date.now();

    const result = await runAutomatedAlertsMonitor();
    const executedAt = new Date().toISOString();
    const durationMs = Date.now() - startedAt;

    if (!result.ok || result.operationalFailure) {
      return NextResponse.json(
        {
          ok: false,
          incomplete: result.incomplete,
          error: result.failureReason || 'TP/SL monitoring operational failure',
          executedAt,
          durationMs,
          result,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      incomplete: result.incomplete,
      executedAt,
      durationMs,
      result,
    });
  } catch (error) {
    console.error(
      '[TP/SL Monitor] Execution failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );

    return NextResponse.json(
      {
        ok: false,
        error: 'TP/SL monitoring execution failed',
      },
      { status: 500 }
    );
  }
}
