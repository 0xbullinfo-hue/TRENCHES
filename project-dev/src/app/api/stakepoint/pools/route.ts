import { NextResponse } from 'next/server';
import { fetchGenesisPools, findConfiguredPool } from '@/lib/stakepoint/fetchPools';
import { GENESIS_MINT } from '@/lib/config';
import { getStakePointIntegrationStatus } from '@/server/stakepoint';

export const revalidate = 300;

export async function GET() {
  const mint = GENESIS_MINT;
  const integration = getStakePointIntegrationStatus();

  if (integration.status === 'BLOCKED' || !integration.configured || !integration.poolId) {
    return NextResponse.json(
      {
        pools: [],
        status: 'BLOCKED',
        configured: false,
        programConfigured: integration.programConfigured,
        poolConfigured: integration.poolConfigured,
        message: integration.message,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  }

  try {
    const allPools = await fetchGenesisPools();
    const configuredPool = findConfiguredPool(allPools, integration.poolId, mint);
    const pools = configuredPool ? [configuredPool] : [];

    return NextResponse.json(
      {
        pools,
        status: 'ACTIVE',
        configured: true,
        programConfigured: true,
        poolConfigured: true,
      },
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
      {
        error: message,
        pools: [],
        status: integration.status,
        configured: integration.configured,
        programConfigured: integration.programConfigured,
        poolConfigured: integration.poolConfigured,
      },
      {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
