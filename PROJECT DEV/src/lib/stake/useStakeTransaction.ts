import { PublicKey } from '@solana/web3.js';

export function useStakeTransaction() {
  return {
    stake: async (params: {
      wallet: PublicKey;
      amountRaw: bigint;
      lockDays: number;
    }): Promise<{ txSignature: string }> => {
      // TODO(streamflow): replace this function body with the real
      // Streamflow SDK call. The call site and signature must remain
      // identical.
      await new Promise((r) => setTimeout(r, 2000));
      const fakeSig = 'stub_' + crypto.randomUUID();
      const res = await fetch('/api/stake/mock', {
        method: 'POST',
        body: JSON.stringify({
          amount_raw: params.amountRaw.toString(),
          lock_days: params.lockDays,
          tx_signature: fakeSig,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to submit stake');
      }

      return { txSignature: fakeSig };
    },
  };
}

