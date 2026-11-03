import { NextResponse } from 'next/server';
import { alphasForTier, samplePortfolio, SYNDICATE_CALLERS } from '@/server/alphas-data';
import { GENESIS_MINT } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    tier: 'LAB_MEMBER',
    tierLabel: 'Lab Member (Fixture)',
    multiplier: 1,
    allocationCap: 15,
    balance: 1_000_000,
    verified: false,
    isAdmin: false,
    genesisMint: GENESIS_MINT,
    items: alphasForTier('LAB_MEMBER'),
    callers: SYNDICATE_CALLERS,
    portfolio: samplePortfolio(),
    serverTime: new Date().toISOString(),
  });
}

