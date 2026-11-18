import { NextResponse } from 'next/server';
import { fetchGenesisPools } from '@/lib/stakepoint/fetchPools';
import { GENESIS_MINT } from '@/lib/config';

export const revalidate = 300;

export async function GET() {
  const mint = GENESIS_MINT;
  const programConfigured = Boolean(
    process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID?.trim() ||
      process.env.STAKEPOINT_PROGRAM_ID?.trim()
  );
  const poolConfigured = Boolean(process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID?.trim());
  const configured = programConfigured && poolConfigured;

  try {
    const pools = await fetchGenesisPools();
    return NextResponse.json(
      { pools, configured, programConfigured, poolConfigured },
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
      { error: message, pools: [], configured, programConfigured, poolConfigured },
      {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

