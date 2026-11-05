export type StakePointPool = {
  poolId: string;
  apr: number | null;
  lockPeriod: string | number | null;
  tvl: number | null;
  poolUrl: string;
  rewardToken: string;
  status: string;
};

export type RawStakePointPool = {
  id?: string;
  poolId?: string | number;
  tokenMint?: string;
  name?: string;
  symbol?: string;
  apr?: number | null;
  apy?: number | null;
  liveRate?: number | null;
  liveRateType?: string | null;
  type?: string;
  lockPeriod?: number | string | null;
  poolDurationSeconds?: number | null;
  totalStaked?: number | string | null;
  tvl?: number | string | null;
  rewards?: string | null;
  rewardTokenSymbol?: string | null;
  rewardToken?: string | null;
  poolAddress?: string | null;
  poolUrl?: string | null;
  isPaused?: boolean;
  isInitialized?: boolean;
  status?: string;
  [key: string]: unknown;
};

