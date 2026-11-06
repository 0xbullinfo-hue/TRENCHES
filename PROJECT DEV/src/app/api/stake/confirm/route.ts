import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { createStake, getTierThresholds, loadDb, resolveTier, TOKEN_DECIMALS } from '@/server/db';
import { Connection } from '@solana/web3.js';
import { GENESIS_MINT, SOLANA_RPC } from '@/lib/config';
import { KV_CONFIGURED, kvLock } from '@/server/kv';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body' }, { status: 400 });
  }

  const txSignature = typeof body.tx_signature === 'string' ? body.tx_signature.trim() : '';
  const amountRaw = typeof body.amount_raw === 'string' ? body.amount_raw.trim() : '';
  const lockDays = typeof body.lock_days === 'number' ? body.lock_days : parseInt(String(body.lock_days || 90), 10);

  // Validate parameters
  if (
    !txSignature ||
    !amountRaw ||
    !/^\d+$/.test(amountRaw) ||
    BigInt(amountRaw) <= BigInt(0) ||
    !Number.isFinite(lockDays) ||
    lockDays < 90
  ) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Missing or invalid parameters. Minimum lock is 90 days.' },
      { status: 400 }
    );
  }

  // Prevent duplicate signature submission across all accounts
  const db = await loadDb();
  const existingStake = db.stakes.find((s) => s.tx_signature === txSignature);
  if (existingStake) {
    return NextResponse.json(
      { error: 'verification_failed', message: 'Transaction signature already used for a stake' },
      { status: 400 }
    );
  }

  // Distributed lock to prevent concurrent double-submission
  if (KV_CONFIGURED) {
    const locked = await kvLock(`stake-tx:${txSignature}`, '1', 120);
    if (!locked) {
      return NextResponse.json(
        { error: 'verification_failed', message: 'Transaction is currently being processed' },
        { status: 400 }
      );
    }
  }

  const stakepointProgramId = process.env.NEXT_PUBLIC_STAKEPOINT_PROGRAM_ID;
  const rpcUrl =
    process.env.SOLANA_RPC ||
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    SOLANA_RPC;

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx || tx.meta?.err) {
      return NextResponse.json(
        { error: 'verification_failed', message: 'Transaction not found or failed on-chain' },
        { status: 400 }
      );
    }

    const accountKeys = tx.transaction.message.accountKeys.map((k) =>
      typeof k === 'string' ? k : k.pubkey.toBase58()
    );
    const signer = accountKeys[0];
    if (signer !== session.wallet) {
      return NextResponse.json(
        { error: 'verification_failed', message: 'Transaction signer does not match session wallet' },
        { status: 400 }
      );
    }

    if (stakepointProgramId && !accountKeys.includes(stakepointProgramId)) {
      return NextResponse.json(
        { error: 'verification_failed', message: 'Transaction did not interact with StakePoint staking program' },
        { status: 400 }
      );
    }

    // Verify token balance delta for GENESIS_MINT on user's account
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    const preBalance = preBalances.find(
      (b) => b.mint === GENESIS_MINT && (b.owner === session.wallet || accountKeys[b.accountIndex] === session.wallet)
    );
    const postBalance = postBalances.find(
      (b) => b.mint === GENESIS_MINT && (b.owner === session.wallet || accountKeys[b.accountIndex] === session.wallet)
    );

    if (preBalance?.uiTokenAmount?.amount && postBalance?.uiTokenAmount?.amount) {
      const preRaw = BigInt(preBalance.uiTokenAmount.amount);
      const postRaw = BigInt(postBalance.uiTokenAmount.amount);
      const transferred = preRaw - postRaw;
      if (transferred < BigInt(amountRaw)) {
        return NextResponse.json(
          { error: 'verification_failed', message: 'On-chain transferred token amount is less than claimed stake' },
          { status: 400 }
        );
      }
    }

    // Verify token value satisfies the $250 USD target
    const { pro } = await getTierThresholds();
    const tokenAmountNumber = Number(BigInt(amountRaw)) / Math.pow(10, TOKEN_DECIMALS);
    const usdValue = tokenAmountNumber * pro.twap_price_usd;

    if (usdValue < 240) { // allow a minor margin of rounding error vs 250
      return NextResponse.json(
        { error: 'verification_failed', message: 'Staked amount does not meet the $250 USD Pro minimum requirement' },
        { status: 400 }
      );
    }

    await createStake({
      wallet_address: session.wallet,
      amount_raw: amountRaw,
      lock_days: lockDays,
      tx_signature: txSignature,
      staking_provider: 'stakepoint',
    });

    const newTier = await resolveTier(session.wallet);
    return NextResponse.json({ ok: true, tier: newTier });
  } catch (err) {
    console.error('[TrenchLabs API] Stake verification error:', err);
    return NextResponse.json(
      { error: 'verification_failed', message: 'Failed to verify transaction on-chain' },
      { status: 400 }
    );
  }
}
