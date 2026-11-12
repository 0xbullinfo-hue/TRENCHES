import { NextRequest, NextResponse } from 'next/server';
import { runCampaignRecoveryWorker } from '@/server/campaign-side-effects';
import { timingSafeEqualStr } from '@/server/telegram';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Production Background Recovery & Notification Outbox Worker Endpoint.
 *
 * Operations executed per cycle:
 * 1. Stalled & pending submission reservation recovery.
 * 2. Idempotent campaign counter reconciliation (Redis & filesystem queues).
 * 3. Auditing and backfilling missing reward and notification outbox events.
 * 4. Recovery of expired dispatch leases (worker crash or network timeout).
 * 5. Bounded batch dispatch of eligible notification events with exponential backoff.
 *
 * Security:
 * Protected by CRON_SECRET (Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET`).
 * Rejects unauthorized or unauthenticated requests with HTTP 401 using constant-time string comparison.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET not configured' },
      { status: 503, headers: NO_STORE }
    );
  }

  const authHeader = req.headers.get('authorization')?.trim() || '';
  const expected = `Bearer ${secret}`;
  if (!authHeader || !timingSafeEqualStr(authHeader, expected)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }

  let batchSize = 50;
  const url = new URL(req.url);
  const qBatch = url.searchParams.get('batchSize');
  if (qBatch && Number(qBatch) > 0) {
    batchSize = Math.min(Number(qBatch), 200);
  }

  try {
    const result = await runCampaignRecoveryWorker({ batchSize });
    console.log('[TrenchLabs Worker] Campaign recovery cycle completed:', JSON.stringify(result));
    const httpStatus = result.status === 'FAILED' ? 503 : 200;
    return NextResponse.json(result, { status: httpStatus, headers: NO_STORE });
  } catch (err) {
    console.error('[TrenchLabs Worker] Campaign recovery cycle failed:', err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message || 'Recovery worker execution failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export const GET = handle;
export const POST = handle;
