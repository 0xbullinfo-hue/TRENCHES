import { StakePointPool, RawStakePointPool } from './types';

export function normalizePools(raw: unknown): StakePointPool[] {
  const items: RawStakePointPool[] = Array.isArray(raw) ? raw : [];

  return items.map((p) => {
    // APR / APY rate extraction
    const rawRate = p.apr ?? p.apy ?? p.liveRate ?? null;
    const apr =
      rawRate !== null && rawRate !== undefined && !isNaN(Number(rawRate))
        ? Number(Number(rawRate).toFixed(2))
        : null;

    // Lock period extraction
    let lockPeriod: string | number | null = null;
    if (typeof p.lockPeriod === 'number') {
      if (p.lockPeriod > 365) {
        const days = Math.round(p.lockPeriod / 86400);
        lockPeriod = `${days} days`;
      } else {
        lockPeriod = `${p.lockPeriod} days`;
      }
    } else if (typeof p.lockPeriod === 'string' && p.lockPeriod.trim().length > 0) {
      lockPeriod = p.lockPeriod.trim();
    }

    // TVL extraction
    let tvl: number | null = null;
    if (p.tvl !== null && p.tvl !== undefined && !isNaN(Number(p.tvl))) {
      tvl = Number(p.tvl);
    } else if (
      p.totalStaked !== null &&
      p.totalStaked !== undefined &&
      !isNaN(Number(p.totalStaked)) &&
      Number(p.totalStaked) > 0
    ) {
      tvl = Number(p.totalStaked);
    }

    // Status extraction
    let status = 'Active';
    if (typeof p.status === 'string' && p.status.trim().length > 0) {
      status = p.status.trim();
    } else if (p.isPaused) {
      status = 'Ended';
    } else if (p.isInitialized === false) {
      status = 'Pending';
    }

    // Pool identifier & URL
    const poolId = String(p.poolId ?? p.id ?? 'unknown');
    const directId = p.id ?? (p.poolId !== undefined && p.poolId !== null ? String(p.poolId) : '');
    const poolUrl =
      p.poolUrl ??
      (directId ? `https://stakepoint.app/pool/${directId}` : 'https://stakepoint.app/pools');

    const rewardToken = p.rewardToken ?? p.rewardTokenSymbol ?? p.rewards ?? 'GENESIS';

    return {
      poolId,
      apr,
      lockPeriod,
      tvl,
      poolUrl,
      rewardToken,
      status,
    };
  }).sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1));
}

export async function fetchGenesisPools(): Promise<StakePointPool[]> {
  const mint = process.env.NEXT_PUBLIC_GENESIS_MINT;
  if (!mint) {
    throw new Error('GENESIS mint not configured');
  }

  const res = await fetch(`https://stakepoint.app/api/pools/by-token/${mint}`, {
    next: { revalidate: 300 }, // 5-minute cache
  });

  if (!res.ok) {
    throw new Error(`StakePoint API error: ${res.status}`);
  }

  const data = await res.json();
  return normalizePools(data);
}

