import { NextResponse } from 'next/server';
import { alphasForTier, buildCallers, loadCallsRegistry, samplePortfolio } from '@/server/alphas-data';
import { hydrateAlphaItems } from '@/server/market-view';
import { GENESIS_MINT } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 });
  }

  const registry = await loadCallsRegistry();
  const baseItems = await alphasForTier('LAB_MEMBER', Date.now(), registry);
  const items = await hydrateAlphaItems(baseItems);

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
    items,
    callers: buildCallers(registry),
    portfolio: samplePortfolio(),
    serverTime: new Date().toISOString(),
  });
}
