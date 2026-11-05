'use client';

import { PublicKey } from '@solana/web3.js';
import { useStreamflowStake } from './streamflow';

export function useStakeTransaction() {
  const { stake: streamflowStake } = useStreamflowStake();

  return {
    stake: async (params: {
      wallet: PublicKey;
      amountRaw: bigint;
      lockDays: number;
    }): Promise<{ txSignature: string }> => {
      // 1. Execute Streamflow staking transaction via wallet adapter
      const { signature } = await streamflowStake(params.amountRaw, params.lockDays);

      // 2. Confirm and verify on-chain transaction on the server
      const res = await fetch('/api/stake/confirm', {
        method: 'POST',
        body: JSON.stringify({
          amount_raw: params.amountRaw.toString(),
          lock_days: params.lockDays,
          tx_signature: signature,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to verify stake on-chain');
      }

      return { txSignature: signature };
    },
  };
}
