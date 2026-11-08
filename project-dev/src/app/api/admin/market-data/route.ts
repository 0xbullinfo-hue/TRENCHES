import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { isAdminWallet } from '@/lib/config';
import { getMarketDiagnostics } from '@/server/market-data';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/market-data — provider health for the market-data service.
 * Admin-session protected (404 for everyone else, same as the other admin routes).
 * The payload contains configuration state, counters and latencies only: never keys or headers.
 * A missing CoinStats key is reported as "DISABLED / NOT CONFIGURED", which is a normal state.
 */
export async function GET(req: Request) {
  const session = await getAuthSession(req);
  if (!session || !isAdminWallet(session.wallet)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(
    { ok: true, diagnostics: getMarketDiagnostics() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

