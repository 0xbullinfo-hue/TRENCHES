import { GENESIS_MINT } from '@/lib/config';
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
    const rawId = typeof p.id === 'string' && p.id.trim().length > 0 ? p.id.trim() : undefined;
    const poolAddress =
      typeof p.poolAddress === 'string' && p.poolAddress.trim().length > 0
        ? p.poolAddress.trim()
        : null;
    const vaultRaw = p.vaultAddress ?? p.tokenVault;
    const vaultAddress =
      typeof vaultRaw === 'string' && vaultRaw.trim().length > 0 ? vaultRaw.trim() : null;
    const tokenMint =
      typeof p.tokenMint === 'string' && p.tokenMint.trim().length > 0 ? p.tokenMint.trim() : null;

    return {
      ...(rawId ? { id: rawId } : {}),
      poolId,
      apr,
      lockPeriod,
      tvl,
      poolUrl,
      rewardToken,
      status,
      ...(poolAddress ? { poolAddress } : {}),
      ...(vaultAddress ? { vaultAddress } : {}),
      ...(tokenMint ? { tokenMint } : {}),
    };
  }).sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1));
}

export function findConfiguredPool(
  pools: StakePointPool[],
  configuredPoolId: string,
  expectedMint: string
): StakePointPool | null {
  const target = configuredPoolId.trim();
  if (!target) return null;
  for (const pool of pools) {
    if (pool.tokenMint && pool.tokenMint !== expectedMint) continue;
    if (
      pool.poolId === target ||
      pool.id === target ||
      pool.poolAddress === target
    ) {
      return pool;
    }
  }
  return null;
}

export async function fetchGenesisPools(): Promise<StakePointPool[]> {
  const mint = GENESIS_MINT;
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

