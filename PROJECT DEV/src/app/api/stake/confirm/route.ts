import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { createStake, resolveTier } from '@/server/db';
import { Connection } from '@solana/web3.js';
import { SOLANA_RPC } from '@/lib/config';

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

  if (!txSignature || !amountRaw || !Number.isFinite(lockDays) || lockDays <= 0) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Missing or invalid parameters' },
      { status: 400 }
    );
  }

  const streamflowProgramId =
    process.env.NEXT_PUBLIC_STREAMFLOW_PROGRAM_ID || 'STAKEvGqQTtzJZH6BWDcbpzXXn2BBerPAgQ3EGLN2GH';
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    process.env.SOLANA_RPC ||
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

    const interactedWithProgram = accountKeys.includes(streamflowProgramId);
    if (!interactedWithProgram) {
      return NextResponse.json(
        { error: 'verification_failed', message: 'Transaction did not interact with Streamflow staking program' },
        { status: 400 }
      );
    }

    await createStake({
      wallet_address: session.wallet,
      amount_raw: amountRaw,
      lock_days: lockDays,
      tx_signature: txSignature,
      staking_provider: 'streamflow',
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
