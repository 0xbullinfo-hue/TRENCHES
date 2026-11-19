import { GENESIS_MINT, isBase58Address } from '@/lib/config';

export type StakePointIntegrationState = 'ACTIVE' | 'BLOCKED';

export interface StakePointConfigStatus {
  status: StakePointIntegrationState;
  configured: boolean;
  programId: string | null;
  poolId: string | null;
  vaultAddress: string | null;
  programConfigured: boolean;
  poolConfigured: boolean;
  message: string;
}

/**
 * Resolves authoritative server-side StakePoint configuration.
 * Both the StakePoint program ID (NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID or STAKEPOINT_PROGRAM_ID)
 * and official pool address (NEXT_PUBLIC_STAKEPOINT_POOL_ID) must be configured as valid Solana addresses.
 */
export function resolveStakePointConfig(env: NodeJS.ProcessEnv = process.env): StakePointConfigStatus {
  const rawProgramId =
    env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID?.trim() ||
    env.STAKEPOINT_PROGRAM_ID?.trim() ||
    '';
  const rawPoolId = env.NEXT_PUBLIC_STAKEPOINT_POOL_ID?.trim() || '';
  const rawVaultAddress =
    env.STAKEPOINT_VAULT_ADDRESS?.trim() ||
    env.NEXT_PUBLIC_STAKEPOINT_VAULT_ADDRESS?.trim() ||
    '';

  const programId = rawProgramId && isBase58Address(rawProgramId) ? rawProgramId : null;
  const poolId = rawPoolId && isBase58Address(rawPoolId) ? rawPoolId : null;
  const vaultAddress = rawVaultAddress && isBase58Address(rawVaultAddress) ? rawVaultAddress : null;

  const programConfigured = Boolean(programId);
  const poolConfigured = Boolean(poolId);

  if (!programConfigured && !poolConfigured) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId: null,
      vaultAddress: null,
      programConfigured: false,
      poolConfigured: false,
      message:
        rawProgramId || rawPoolId
          ? 'StakePoint program ID or pool ID format is invalid; verification is BLOCKED.'
          : 'StakePoint integration is not configured. Set NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID (or STAKEPOINT_PROGRAM_ID) and NEXT_PUBLIC_STAKEPOINT_POOL_ID in server environment.',
    };
  }

  if (!programConfigured) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId,
      vaultAddress: null,
      programConfigured: false,
      poolConfigured: true,
      message: rawProgramId
        ? 'StakePoint on-chain program ID format is invalid; verification is BLOCKED.'
        : 'StakePoint on-chain program ID not configured. Set NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID (or STAKEPOINT_PROGRAM_ID) in server environment.',
    };
  }

  if (!poolConfigured) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId,
      poolId: null,
      vaultAddress: null,
      programConfigured: true,
      poolConfigured: false,
      message: rawPoolId
        ? 'StakePoint pool ID format is invalid; verification is BLOCKED.'
        : 'StakePoint pool ID not configured. Set NEXT_PUBLIC_STAKEPOINT_POOL_ID in server environment.',
    };
  }

  if (rawVaultAddress && !vaultAddress) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId: null,
      vaultAddress: null,
      programConfigured: false,
      poolConfigured: false,
      message: 'StakePoint vault address format is invalid; verification is BLOCKED.',
    };
  }

  if (
    poolId === programId ||
    poolId === GENESIS_MINT ||
    programId === GENESIS_MINT ||
    (vaultAddress !== null && (vaultAddress === poolId || vaultAddress === programId))
  ) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId: null,
      vaultAddress: null,
      programConfigured: false,
      poolConfigured: false,
      message: 'StakePoint configuration contains conflicting addresses; verification is BLOCKED.',
    };
  }

  return {
    status: 'ACTIVE',
    configured: true,
    programId,
    poolId,
    vaultAddress,
    programConfigured: true,
    poolConfigured: true,
    message: 'StakePoint on-chain program and pool configuration active.',
  };
}
