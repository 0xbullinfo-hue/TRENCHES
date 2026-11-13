import { Connection } from '@solana/web3.js';
import { GENESIS_MINT, SOLANA_RPC, TOKEN_DECIMALS } from '@/lib/config';
import { createStake, getActiveStakes, loadDb, StakeRow } from '@/server/db';
import { getGenesisPrice } from '@/server/price';
import { PRO_STAKE_MIN_LOCK_DAYS, PRO_STAKE_USD_THRESHOLD } from '@/server/entitlements';
import { KV_CONFIGURED, kvLock } from '@/server/kv';

export type StakePointIntegrationStatus = 'ACTIVE' | 'BLOCKED';

export interface StakePointVerificationParams {
  walletAddress: string;
  txSignature: string;
  lockDays?: number;
  poolId?: string;
}

export interface StakePointVerificationResult {
  success: boolean;
  status: 'VERIFIED' | 'REJECTED' | 'BLOCKED';
  error?: string;
  stake?: StakeRow;
  details?: {
    txSignature: string;
    walletAddress: string;
    amountTokens: number;
    amountUsd: number;
    lockDays: number;
    unlocksAt: string;
    programId: string;
    poolId?: string;
  };
}

export function getStakePointIntegrationStatus(): {
  status: StakePointIntegrationStatus;
  programId: string | null;
  message: string;
} {
  const programId = process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID || process.env.STAKEPOINT_PROGRAM_ID || null;
  if (!programId) {
    return {
      status: 'BLOCKED',
      programId: null,
      message: 'StakePoint on-chain program ID not configured. Set NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID in environment.',
    };
  }
  return {
    status: 'ACTIVE',
    programId,
    message: 'StakePoint on-chain program integration configured.',
  };
}

/**
 * Authoritative on-chain StakePoint staking verification.
 * Verifies Solana transaction signature, signer ownership, token mint, transfer amount delta,
 * lock duration, and live USD valuation.
 */
export async function verifyAndRecordStakePointPosition(
  params: StakePointVerificationParams
): Promise<StakePointVerificationResult> {
  const { walletAddress, txSignature } = params;
  const lockDays = params.lockDays ?? 90;

  // 1. Basic format validation
  if (!txSignature || typeof txSignature !== 'string' || txSignature.trim().length < 64) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'Invalid Solana transaction signature format',
    };
  }

  if (lockDays < PRO_STAKE_MIN_LOCK_DAYS) {
    return {
      success: false,
      status: 'REJECTED',
      error: `Lock period must be at least ${PRO_STAKE_MIN_LOCK_DAYS} days for Pro qualification.`,
    };
  }

  // 2. Prevent duplicate / replay across all accounts in database
  const db = await loadDb();
  const existing = (db.stakes || []).find((s) => s.tx_signature === txSignature.trim());
  if (existing) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'This transaction signature has already been registered for a staking position.',
    };
  }

  // 3. Distributed Lock to prevent concurrent double-submission race conditions
  const lockKey = `stakepoint:tx:${txSignature.trim()}`;
  if (KV_CONFIGURED) {
    const locked = await kvLock(lockKey, walletAddress, 120);
    if (!locked) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'This transaction is currently being processed by another request.',
      };
    }
  }

  // 4. Verify on-chain via Solana RPC
  const rpcUrl = process.env.SOLANA_RPC || SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  try {
    const tx = await connection.getParsedTransaction(txSignature.trim(), {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx || tx.meta?.err) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'Transaction not found or failed on Solana blockchain',
      };
    }

    // 5. Verify Signer matches session wallet
    const accountKeys = tx.transaction.message.accountKeys.map((k) =>
      typeof k === 'string' ? k : k.pubkey.toBase58()
    );
    const primarySigner = accountKeys[0];
    if (primarySigner !== walletAddress) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction signer (${primarySigner}) does not match authenticated wallet (${walletAddress})`,
      };
    }

    // 6. Verify program interaction (fail closed if program ID is not configured)
    const integration = getStakePointIntegrationStatus();
    if (integration.status !== 'ACTIVE' || !integration.programId) {
      return {
        success: false,
        status: 'BLOCKED',
        error: 'StakePoint on-chain verification is BLOCKED: Program ID not configured in server environment (NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID). Set the StakePoint program ID in environment variables.',
      };
    }

    const interacted = accountKeys.includes(integration.programId);
    if (!interacted) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction did not interact with the designated StakePoint program (${integration.programId})`,
      };
    }

    // 7. Verify token balance delta for $H42 mint
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    const preBalance = preBalances.find(
      (b) => b.mint === GENESIS_MINT && (b.owner === walletAddress || accountKeys[b.accountIndex] === walletAddress)
    );
    const postBalance = postBalances.find(
      (b) => b.mint === GENESIS_MINT && (b.owner === walletAddress || accountKeys[b.accountIndex] === walletAddress)
    );

    if (!preBalance || !postBalance) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'Transaction does not involve the authenticated wallet $H42 token account.',
      };
    }

    let amountRaw = BigInt(0);
    if (preBalance?.uiTokenAmount?.amount && postBalance?.uiTokenAmount?.amount) {
      const preRaw = BigInt(preBalance.uiTokenAmount.amount);
      const postRaw = BigInt(postBalance.uiTokenAmount.amount);
      if (preRaw > postRaw) {
        amountRaw = preRaw - postRaw;
      }
    }

    // If token balance delta could not be determined from postTokenBalances, reject
    if (amountRaw <= BigInt(0)) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'No outgoing $H42 token transfer detected in this transaction.',
      };
    }

    // Confirm that an external account/vault received incoming $H42 tokens
    const recipientBalance = postBalances.find(
      (b) => b.mint === GENESIS_MINT && b.owner !== walletAddress && accountKeys[b.accountIndex] !== walletAddress
    );
    if (!recipientBalance) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'No destination or pool vault received $H42 tokens in this transaction.',
      };
    }

    // 8. Server-side USD valuation check using live price oracle
    const priceResult = await getGenesisPrice();
    if (priceResult.priceUsd === null || !Number.isFinite(priceResult.priceUsd) || priceResult.priceUsd <= 0) {
      // Fail closed: without a verified price the stake's USD value is unknowable. Do not accept or
      // reject on a guessed price; the user can safely retry the same transaction later.
      return {
        success: false,
        status: 'REJECTED',
        error: 'Price unavailable: $H42 price oracle is temporarily unreachable. Your transaction was not recorded; please retry shortly.',
      };
    }
    const tokenAmountNumber = Number(amountRaw) / Math.pow(10, TOKEN_DECIMALS);
    const amountUsd = +(tokenAmountNumber * priceResult.priceUsd).toFixed(2);

    // Allow a small 3% tolerance for price fluctuations between lock initiation and verification
    const minAcceptableUsd = PRO_STAKE_USD_THRESHOLD * 0.97;
    if (amountUsd < minAcceptableUsd) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Staked amount ($${amountUsd} USD) is below the required Pro threshold ($${PRO_STAKE_USD_THRESHOLD} USD).`,
      };
    }

    // 9. Persist verified stake record
    const createdStake = await createStake({
      wallet_address: walletAddress,
      amount_raw: amountRaw.toString(),
      lock_days: lockDays,
      tx_signature: txSignature.trim(),
      staking_provider: 'stakepoint',
    });

    const unlockDate = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000).toISOString();

    return {
      success: true,
      status: 'VERIFIED',
      stake: createdStake,
      details: {
        txSignature: txSignature.trim(),
        walletAddress,
        amountTokens: tokenAmountNumber,
        amountUsd,
        lockDays,
        unlocksAt: unlockDate,
        programId: integration.programId || 'solana-token-program',
        poolId: params.poolId,
      },
    };
  } catch (err) {
    console.error('[StakePoint Adapter] Verification exception:', err);
    return {
      success: false,
      status: 'REJECTED',
      error: (err as Error)?.message || 'Failed to verify transaction on Solana cluster.',
    };
  }
}

