import { isBase58Address } from '@/lib/config';

export type StakePointIntegrationState = 'ACTIVE' | 'BLOCKED';

export interface StakePointConfigStatus {
  status: StakePointIntegrationState;
  configured: boolean;
  programId: string | null;
  poolId: string | null;
  programConfigured: boolean;
  poolConfigured: boolean;
  message: string;
}

/**
 * Resolves authoritative server-side StakePoint configuration.
 * Both the StakePoint program ID (NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID or STAKEPOINT_PROGRAM_ID)
 * and official pool ID (NEXT_PUBLIC_STAKEPOINT_POOL_ID) are required.
 */
export function resolveStakePointConfig(env: NodeJS.ProcessEnv = process.env): StakePointConfigStatus {
  const rawProgramId =
    env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID?.trim() ||
    env.STAKEPOINT_PROGRAM_ID?.trim() ||
    '';
  const rawPoolId = env.NEXT_PUBLIC_STAKEPOINT_POOL_ID?.trim() || '';

  const programId = rawProgramId && isBase58Address(rawProgramId) ? rawProgramId : null;
  const poolId = rawPoolId || null;

  const programConfigured = Boolean(programId);
  const poolConfigured = Boolean(poolId);

  if (!programConfigured && !poolConfigured) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId: null,
      programConfigured: false,
      poolConfigured: false,
      message:
        'StakePoint integration is not configured. Set NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID (or STAKEPOINT_PROGRAM_ID) and NEXT_PUBLIC_STAKEPOINT_POOL_ID in server environment.',
    };
  }

  if (!programConfigured) {
    return {
      status: 'BLOCKED',
      configured: false,
      programId: null,
      poolId,
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
      programConfigured: true,
      poolConfigured: false,
      message:
        'StakePoint pool ID not configured. Set NEXT_PUBLIC_STAKEPOINT_POOL_ID in server environment.',
    };
  }

  return {
    status: 'ACTIVE',
    configured: true,
    programId,
    poolId,
    programConfigured: true,
    poolConfigured: true,
    message: 'StakePoint on-chain program and pool configuration active.',
  };
}
