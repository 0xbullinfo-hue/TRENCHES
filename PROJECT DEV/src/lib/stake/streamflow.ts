'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { SolanaStakingClient } from '@streamflow/staking';
import BN from 'bn.js';

export function useStreamflowStake() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, signTransaction } = wallet;

  const stake = async (amountRaw: bigint, lockDays: number): Promise<{ signature: string }> => {
    if (!publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    const poolAddrStr = process.env.NEXT_PUBLIC_STREAMFLOW_POOL_ADDRESS?.trim();
    if (!poolAddrStr) {
      throw new Error('NEXT_PUBLIC_STREAMFLOW_POOL_ADDRESS is not configured by operator');
    }

    const endpoint =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() ||
      connection.rpcEndpoint ||
      'https://api.mainnet-beta.solana.com';

    const client = new SolanaStakingClient({
      clusterUrl: endpoint,
      commitment: 'confirmed',
    });

    const poolAddress = new PublicKey(poolAddrStr);
    const durationInSeconds = lockDays * 24 * 60 * 60; // 90d = 7,776,000

    // Retrieve pool account details
    const pool = (await client.getStakePool(poolAddress)) as any;
    const poolMint = pool.mint || pool.poolMint;
    const poolNonce = typeof pool.nonce === 'number' ? pool.nonce : 0;
    const tokenProgramId = pool.tokenProgram || pool.tokenProgramId;

    const adapter = (wallet.wallet?.adapter || wallet) as any;

    const { ixs } = await client.prepareStakeInstructions(
      {
        stakePool: poolAddress,
        stakePoolMint: poolMint,
        nonce: poolNonce,
        amount: new BN(amountRaw.toString()),
        duration: new BN(durationInSeconds),
        tokenProgramId,
      },
      {
        invoker: adapter,
      }
    );

    const tx = new Transaction().add(...ixs);
    tx.feePayer = publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const signed = await signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });

    await connection.confirmTransaction(signature, 'confirmed');
    return { signature: signature.toString() };
  };

  return { stake };
}
