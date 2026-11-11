import { NextResponse } from 'next/server';
import { getLedgerEntries } from '@/server/db';
import { loadCallsRegistry } from '@/server/alphas-data';
import { computePerformanceStats } from '@/lib/ledger/performance-stats';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { entries } = await getLedgerEntries({ limit: 1000, offset: 0, sort: 'newest' });
    let calls: any[] = [];
    try {
      calls = await loadCallsRegistry();
    } catch {
      calls = [];
    }

    const stats = computePerformanceStats(entries, calls);

    return NextResponse.json(
      {
        ok: true,
        stats,
        lastUpdated: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=15',
        },
      }
    );
  } catch (err) {
    console.error('[API /api/ledger/stats GET] Error calculating stats:', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to calculate performance statistics',
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

