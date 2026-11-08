import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { verifyAndRecordStakePointPosition } from '@/server/stakepoint';
import { resolveWalletEntitlement } from '@/server/entitlements';

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
  const lockDays = typeof body.lock_days === 'number' ? body.lock_days : parseInt(String(body.lock_days || 90), 10);
  const poolId = typeof body.pool_id === 'string' ? body.pool_id.trim() : undefined;

  if (!txSignature || !Number.isFinite(lockDays) || lockDays < 90) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Missing or invalid parameters. Minimum lock duration is 90 days.' },
      { status: 400 }
    );
  }

  const result = await verifyAndRecordStakePointPosition({
    walletAddress: session.wallet,
    txSignature,
    lockDays,
    poolId,
  });

  if (!result.success) {
    return NextResponse.json(
      { error: 'verification_failed', message: result.error || 'Transaction verification failed' },
      { status: 400 }
    );
  }

  // Authoritatively re-evaluate wallet entitlement
  const entitlement = await resolveWalletEntitlement(session.wallet);

  return NextResponse.json({
    ok: true,
    tier: entitlement.tier,
    entitlement,
    stake: result.stake,
    details: result.details,
  });
}
