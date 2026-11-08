import { NextResponse } from 'next/server';
import { fetchGenesisPools } from '@/lib/stakepoint/fetchPools';
import { GENESIS_MINT } from '@/lib/config';

export const revalidate = 300;

export async function GET() {
  const mint = GENESIS_MINT;
  try {
    const pools = await fetchGenesisPools();
    return NextResponse.json(
      { pools },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch StakePoint pools';
    console.error(`[StakePoint API] Failed to fetch pools for mint ${mint}:`, err);
    return NextResponse.json(
      { error: message, pools: [] },
      {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

