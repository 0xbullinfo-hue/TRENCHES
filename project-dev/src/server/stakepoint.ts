import { Connection } from '@solana/web3.js';
import { GENESIS_MINT, SOLANA_RPC, TOKEN_DECIMALS, isBase58Address } from '@/lib/config';
import { resolveStakePointConfig, type StakePointIntegrationState } from '@/lib/stakepoint/config';
import { fetchGenesisPools, findConfiguredPool } from '@/lib/stakepoint/fetchPools';
import type { StakePointPool } from '@/lib/stakepoint/types';
import { createStakeIfAbsent, getActiveStakes, loadDb, StakeRow } from '@/server/db';
import { getGenesisPrice } from '@/server/price';
import { PRO_STAKE_MIN_LOCK_DAYS, PRO_STAKE_USD_THRESHOLD } from '@/server/entitlements';
import { KV_CONFIGURED, kvLock, kvUnlock } from '@/server/kv';

export type StakePointIntegrationStatus = StakePointIntegrationState;

const SPL_TOKEN_PROGRAM_IDS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
]);

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
    poolId: string;
    poolAddress?: string;
  };
}

export interface ParsedTxAccountKey {
  pubkey: string | { toBase58(): string };
  signer?: boolean;
  writable?: boolean;
}

export interface ParsedTxInstruction {
  programId?: string | { toBase58(): string };
  program?: string;
  accounts?: Array<string | { toBase58(): string }>;
  parsed?: {
    type?: string;
    info?: Record<string, unknown>;
  };
}

export interface ParsedTxTokenBalance {
  accountIndex: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
  };
}

export interface MinimalParsedTransaction {
  transaction: {
    message: {
      accountKeys: Array<string | ParsedTxAccountKey>;
      instructions?: ParsedTxInstruction[];
    };
  };
  meta: {
    err: unknown;
    preTokenBalances?: ParsedTxTokenBalance[] | null;
    postTokenBalances?: ParsedTxTokenBalance[] | null;
    innerInstructions?: Array<{
      index?: number;
      instructions: ParsedTxInstruction[];
    }> | null;
    loadedAddresses?: {
      writable?: Array<string | { toBase58(): string }>;
      readonly?: Array<string | { toBase58(): string }>;
    };
  } | null;
}

export interface StakePointVerificationDeps {
  fetchTransaction?: (signature: string) => Promise<MinimalParsedTransaction | null>;
  fetchPools?: () => Promise<StakePointPool[]>;
  getPrice?: typeof getGenesisPrice;
  loadDb?: typeof loadDb;
  createStakeIfAbsent?: typeof createStakeIfAbsent;
  kvLock?: typeof kvLock;
  kvUnlock?: typeof kvUnlock;
  kvConfigured?: boolean;
  env?: NodeJS.ProcessEnv;
}

export function getStakePointIntegrationStatus(
  env: NodeJS.ProcessEnv = process.env
): {
  status: StakePointIntegrationStatus;
  configured: boolean;
  programId: string | null;
  poolId: string | null;
  programConfigured: boolean;
  poolConfigured: boolean;
  message: string;
} {
  return resolveStakePointConfig(env);
}

function keyToBase58(k: string | { toBase58(): string } | undefined | null): string {
  if (!k) return '';
  return typeof k === 'string' ? k : k.toBase58();
}

function collectAllInstructions(tx: MinimalParsedTransaction): ParsedTxInstruction[] {
  const top = Array.isArray(tx.transaction?.message?.instructions)
    ? tx.transaction.message.instructions
    : [];
  const innerGroups = Array.isArray(tx.meta?.innerInstructions)
    ? tx.meta.innerInstructions
    : [];
  const inner = innerGroups.flatMap((g) => (Array.isArray(g?.instructions) ? g.instructions : []));
  return [...top, ...inner];
}

function parseSplTransferAmount(ix: ParsedTxInstruction): string | null {
  const parsedType = ix.parsed?.type;
  if (parsedType !== 'transfer' && parsedType !== 'transferChecked') return null;
  const info = ix.parsed?.info;
  if (!info) return null;
  const tokenAmount = info.tokenAmount as { amount?: unknown } | undefined;
  const raw = tokenAmount?.amount ?? info.amount;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return String(Math.floor(raw));
  return null;
}

/**
 * Authoritative on-chain StakePoint staking verification.
 * Enforces server-configured program ID and pool ID, authenticated wallet signer ownership,
 * on-chain instruction participation, $H42 mint deposit into the configured pool/vault,
 * live USD valuation, and idempotent replay protection.
 */
export async function verifyAndRecordStakePointPosition(
  params: StakePointVerificationParams,
  deps: StakePointVerificationDeps = {}
): Promise<StakePointVerificationResult> {
  const { walletAddress } = params;
  const txSignature = typeof params.txSignature === 'string' ? params.txSignature.trim() : '';
  const lockDays = params.lockDays ?? 90;
  const clientPoolId = typeof params.poolId === 'string' ? params.poolId.trim() : '';

  const readDb = deps.loadDb ?? loadDb;
  const insertStakeIfAbsent = deps.createStakeIfAbsent ?? createStakeIfAbsent;
  const getPrice = deps.getPrice ?? getGenesisPrice;
  const acquireLock = deps.kvLock ?? kvLock;
  const releaseLock = deps.kvUnlock ?? kvUnlock;
  const useKvLock = deps.kvConfigured ?? KV_CONFIGURED;
  const env = deps.env ?? process.env;

  // 1. Basic input and format validation
  if (!txSignature || txSignature.length < 64) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'Invalid Solana transaction signature format',
    };
  }

  if (!Number.isFinite(lockDays) || lockDays < PRO_STAKE_MIN_LOCK_DAYS) {
    return {
      success: false,
      status: 'REJECTED',
      error: `Lock period must be at least ${PRO_STAKE_MIN_LOCK_DAYS} days for Pro qualification.`,
    };
  }

  // 2. Prevent duplicate / replay across all accounts before network/RPC calls
  const db = await readDb();
  const existing = (db.stakes || []).find((s) => s.tx_signature === txSignature);
  if (existing) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'This transaction signature has already been registered for a staking position.',
    };
  }

  // 3. Enforce BOTH server-side StakePoint configurations (program ID + pool ID)
  const integration = getStakePointIntegrationStatus(env);
  if (integration.status !== 'ACTIVE' || !integration.programId || !integration.poolId) {
    return {
      success: false,
      status: 'BLOCKED',
      error: `StakePoint on-chain verification is BLOCKED: ${integration.message}`,
    };
  }

  if (!walletAddress || !isBase58Address(walletAddress)) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'Invalid authenticated Solana wallet address',
    };
  }

  // Never trust client-supplied poolId; if provided, it must match server configuration exactly
  if (clientPoolId && clientPoolId !== integration.poolId) {
    return {
      success: false,
      status: 'REJECTED',
      error: 'Submitted pool ID does not match the configured StakePoint pool.',
    };
  }

  // 4. Resolve authoritative on-chain pool & vault addresses for configured poolId
  const expectedPoolAddresses = new Set<string>();
  const verifiedVaultAddresses = new Set<string>();
  if (isBase58Address(integration.poolId)) {
    expectedPoolAddresses.add(integration.poolId);
  }

  const getPools = deps.fetchPools ?? fetchGenesisPools;
  if (expectedPoolAddresses.size === 0 || deps.fetchPools) {
    try {
      const pools = await getPools();
      const matched = findConfiguredPool(pools, integration.poolId, GENESIS_MINT);
      if (matched) {
        if (matched.poolAddress && isBase58Address(matched.poolAddress)) {
          expectedPoolAddresses.add(matched.poolAddress);
        }
        if (matched.vaultAddress && isBase58Address(matched.vaultAddress)) {
          verifiedVaultAddresses.add(matched.vaultAddress);
        }
      }
    } catch {
      // Handled below by fail-closed size check if configured poolId wasn't already a base58 pubkey
    }
  }

  if (expectedPoolAddresses.size === 0 && verifiedVaultAddresses.size === 0) {
    return {
      success: false,
      status: 'BLOCKED',
      error:
        'StakePoint on-chain verification is BLOCKED: Unable to resolve an authoritative on-chain pool address for the configured NEXT_PUBLIC_STAKEPOINT_POOL_ID.',
    };
  }

  // 5. Distributed Lock to prevent concurrent double-submission race conditions
  const lockKey = `stakepoint:tx:${txSignature}`;
  let lockHeld = false;
  if (useKvLock) {
    lockHeld = await acquireLock(lockKey, walletAddress, 120);
    if (!lockHeld) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'This transaction is currently being processed by another request.',
      };
    }
  }

  const fetchTx: (sig: string) => Promise<MinimalParsedTransaction | null> =
    deps.fetchTransaction ??
    (async (sig: string) => {
      const rpcUrl = env.SOLANA_RPC || SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      return (await connection.getParsedTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })) as unknown as MinimalParsedTransaction | null;
    });

  try {
    const tx = await fetchTx(txSignature);

    if (!tx || !tx.meta || tx.meta.err) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'Transaction not found or failed on Solana blockchain',
      };
    }

    // 6. Verify primary signer matches authenticated wallet
    const rawAccountKeys = tx.transaction?.message?.accountKeys || [];
    const staticKeys = rawAccountKeys.map((k) =>
      typeof k === 'string' ? k : keyToBase58(k.pubkey)
    );
    const loadedWritable = (tx.meta.loadedAddresses?.writable || []).map(keyToBase58);
    const loadedReadonly = (tx.meta.loadedAddresses?.readonly || []).map(keyToBase58);
    const accountKeys = [...staticKeys, ...loadedWritable, ...loadedReadonly];

    const firstKeyEntry = rawAccountKeys[0];
    const primarySigner = staticKeys[0];
    const primaryIsSigner =
      typeof firstKeyEntry === 'string'
        ? Boolean(primarySigner)
        : firstKeyEntry?.signer !== false;

    const walletIsSigner = rawAccountKeys.some((k, idx) =>
      typeof k === 'string'
        ? idx === 0 && k === walletAddress
        : keyToBase58(k.pubkey) === walletAddress && k.signer === true
    );

    if (!primarySigner || primarySigner !== walletAddress || !primaryIsSigner || !walletIsSigner) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction signer (${primarySigner || 'unknown'}) does not match authenticated wallet (${walletAddress})`,
      };
    }

    // 7. Verify BOTH StakePoint program interaction AND configured pool account participation at instruction level
    if (!accountKeys.includes(integration.programId)) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction did not interact with the designated StakePoint program (${integration.programId})`,
      };
    }

    const txPoolPresentInAccounts = [...expectedPoolAddresses].some((addr) =>
      accountKeys.includes(addr)
    );
    if (!txPoolPresentInAccounts && ![...verifiedVaultAddresses].some((v) => accountKeys.includes(v))) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction did not reference the configured StakePoint pool (${integration.poolId}).`,
      };
    }

    const allInstructions = collectAllInstructions(tx);
    const programInstructions = allInstructions.filter(
      (ix) => keyToBase58(ix.programId) === integration.programId
    );
    if (programInstructions.length === 0) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Transaction did not invoke the designated StakePoint program (${integration.programId}).`,
      };
    }

    const programTargetsConfiguredPool = programInstructions.some((ix) => {
      if (!Array.isArray(ix.accounts) || ix.accounts.length === 0) return false;
      const ixAccounts = ix.accounts.map(keyToBase58);
      return (
        ixAccounts.some((a) => expectedPoolAddresses.has(a)) ||
        ixAccounts.some((a) => verifiedVaultAddresses.has(a))
      );
    });

    if (!programTargetsConfiguredPool) {
      return {
        success: false,
        status: 'REJECTED',
        error: `StakePoint program instruction did not target the configured StakePoint pool (${integration.poolId}).`,
      };
    }

    // 8. Verify $H42 (GENESIS_MINT) outgoing delta from authenticated wallet AND incoming deposit into configured pool vault
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];

    const preByIndex = new Map<number, ParsedTxTokenBalance>();
    for (const pre of preBalances) {
      if (pre.mint === GENESIS_MINT) {
        preByIndex.set(pre.accountIndex, pre);
      }
    }

    const postByIndex = new Map<number, ParsedTxTokenBalance>();
    for (const post of postBalances) {
      if (post.mint === GENESIS_MINT) {
        postByIndex.set(post.accountIndex, post);
      }
    }

    const walletPreExists = preBalances.some(
      (b) =>
        b.mint === GENESIS_MINT &&
        (b.owner === walletAddress || accountKeys[b.accountIndex] === walletAddress)
    );
    const walletPostExists = postBalances.some(
      (b) =>
        b.mint === GENESIS_MINT &&
        (b.owner === walletAddress || accountKeys[b.accountIndex] === walletAddress)
    );

    if (!walletPreExists || !walletPostExists) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'Transaction does not involve the authenticated wallet $H42 token account.',
      };
    }

    let senderSentRaw = BigInt(0);
    const walletTokenAccounts = new Set<string>();
    for (const pre of preBalances) {
      if (
        pre.mint === GENESIS_MINT &&
        (pre.owner === walletAddress || accountKeys[pre.accountIndex] === walletAddress)
      ) {
        const post = postByIndex.get(pre.accountIndex);
        if (pre.uiTokenAmount?.amount && post?.uiTokenAmount?.amount) {
          const preRaw = BigInt(pre.uiTokenAmount.amount);
          const postRaw = BigInt(post.uiTokenAmount.amount);
          if (preRaw > postRaw) {
            senderSentRaw += preRaw - postRaw;
            const acct = accountKeys[pre.accountIndex];
            if (acct) walletTokenAccounts.add(acct);
          }
        }
      }
    }

    if (senderSentRaw <= BigInt(0)) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'No outgoing $H42 token transfer detected in this transaction.',
      };
    }

    // Verify incoming $H42 tokens landed specifically in a vault belonging to the configured pool
    let poolVaultReceivedRaw = BigInt(0);
    const verifiedVaultTokenAccounts = new Set<string>();
    let matchedPoolAddress: string | undefined;

    for (const post of postBalances) {
      if (post.mint !== GENESIS_MINT) continue;
      if (post.owner === walletAddress) continue;
      const vaultTokenAccount = accountKeys[post.accountIndex] || '';
      if (vaultTokenAccount === walletAddress) continue;

      const belongsToConfiguredPool =
        (post.owner ? expectedPoolAddresses.has(post.owner) : false) ||
        (vaultTokenAccount ? expectedPoolAddresses.has(vaultTokenAccount) : false) ||
        (vaultTokenAccount ? verifiedVaultAddresses.has(vaultTokenAccount) : false);

      if (!belongsToConfiguredPool) continue;

      const preMatch = preByIndex.get(post.accountIndex);
      const preRaw = preMatch?.uiTokenAmount?.amount ? BigInt(preMatch.uiTokenAmount.amount) : BigInt(0);
      const postRaw = post.uiTokenAmount?.amount ? BigInt(post.uiTokenAmount.amount) : BigInt(0);

      if (postRaw > preRaw) {
        poolVaultReceivedRaw += postRaw - preRaw;
        if (vaultTokenAccount) verifiedVaultTokenAccounts.add(vaultTokenAccount);
        if (!matchedPoolAddress && post.owner && expectedPoolAddresses.has(post.owner)) {
          matchedPoolAddress = post.owner;
        }
      }
    }

    if (poolVaultReceivedRaw <= BigInt(0)) {
      return {
        success: false,
        status: 'REJECTED',
        error: `No $H42 token deposit into the configured StakePoint pool vault (${integration.poolId}) was detected in this transaction.`,
      };
    }

    // If parsed SPL token transfer instructions are present in the tx, verify at least one directs tokens into a verified pool vault
    const splTransfers = allInstructions.filter(
      (ix) =>
        (ix.program === 'spl-token' || SPL_TOKEN_PROGRAM_IDS.has(keyToBase58(ix.programId))) &&
        parseSplTransferAmount(ix) !== null
    );
    if (splTransfers.length > 0) {
      let verifiedSplTransferRaw = BigInt(0);
      for (const ix of splTransfers) {
        const info = ix.parsed?.info;
        const dest = typeof info?.destination === 'string' ? info.destination : '';
        const mint = typeof info?.mint === 'string' ? info.mint : null;
        if (mint && mint !== GENESIS_MINT) continue;
        if (verifiedVaultTokenAccounts.has(dest)) {
          const amt = parseSplTransferAmount(ix);
          if (amt) verifiedSplTransferRaw += BigInt(amt);
        }
      }
      if (verifiedSplTransferRaw <= BigInt(0)) {
        return {
          success: false,
          status: 'REJECTED',
          error: `SPL token transfer destination did not match the configured StakePoint pool vault (${integration.poolId}).`,
        };
      }
    }

    const amountRaw = poolVaultReceivedRaw < senderSentRaw ? poolVaultReceivedRaw : senderSentRaw;

    // 9. Server-side USD valuation check using live price oracle
    const priceResult = await getPrice();
    if (priceResult.priceUsd === null || !Number.isFinite(priceResult.priceUsd) || priceResult.priceUsd <= 0) {
      return {
        success: false,
        status: 'REJECTED',
        error:
          'Price unavailable: $H42 price oracle is temporarily unreachable. Your transaction was not recorded; please retry shortly.',
      };
    }

    const tokenAmountNumber = Number(amountRaw) / Math.pow(10, TOKEN_DECIMALS);
    const amountUsd = +(tokenAmountNumber * priceResult.priceUsd).toFixed(2);

    const minAcceptableUsd = PRO_STAKE_USD_THRESHOLD * 0.97;
    if (amountUsd < minAcceptableUsd) {
      return {
        success: false,
        status: 'REJECTED',
        error: `Staked amount ($${amountUsd} USD) is below the required Pro threshold ($${PRO_STAKE_USD_THRESHOLD} USD).`,
      };
    }

    // 10. Persist verified stake record atomically (guards against concurrent duplicate inserts)
    const { created, stake: createdStake } = await insertStakeIfAbsent({
      wallet_address: walletAddress,
      amount_raw: amountRaw.toString(),
      lock_days: lockDays,
      tx_signature: txSignature,
      staking_provider: 'stakepoint',
    });

    if (!created) {
      return {
        success: false,
        status: 'REJECTED',
        error: 'This transaction signature has already been registered for a staking position.',
      };
    }

    const unlockDate = new Date(Date.now() + lockDays * 24 * 60 * 60 * 1000).toISOString();

    return {
      success: true,
      status: 'VERIFIED',
      stake: createdStake,
      details: {
        txSignature,
        walletAddress,
        amountTokens: tokenAmountNumber,
        amountUsd,
        lockDays,
        unlocksAt: unlockDate,
        programId: integration.programId,
        poolId: integration.poolId,
        ...(matchedPoolAddress ? { poolAddress: matchedPoolAddress } : {}),
      },
    };
  } catch (err) {
    console.error('[StakePoint Adapter] Verification exception:', err);
    return {
      success: false,
      status: 'REJECTED',
      error: (err as Error)?.message || 'Failed to verify transaction on Solana cluster.',
    };
  } finally {
    if (useKvLock && lockHeld) {
      await releaseLock(lockKey, walletAddress).catch(() => {});
    }
  }
}

export async function hasActiveStakePointEligibility(walletAddress: string): Promise<boolean> {
  const stakes = await getActiveStakes(walletAddress);
  return stakes.length > 0;
}
