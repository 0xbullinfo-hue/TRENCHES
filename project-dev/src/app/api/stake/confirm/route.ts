import { NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { verifyAndRecordStakePointPosition } from '@/server/stakepoint';
import { resolveWalletEntitlement } from '@/server/entitlements';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  const rl = await rateLimit(`stake-confirm:ip:${clientIp(req)}`, 20, 60);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests', retryAfter: rl.retryAfter },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json(
      { error: 'unauthorized', message: 'Session required' },
      { status: 401, headers: NO_STORE }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'bad_request', message: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE }
    );
  }

  const txSignature = typeof body.tx_signature === 'string' ? body.tx_signature.trim() : '';
  const lockDays =
    typeof body.lock_days === 'number' ? body.lock_days : parseInt(String(body.lock_days || 90), 10);
  const poolId = typeof body.pool_id === 'string' ? body.pool_id.trim() : undefined;

  if (!txSignature || !Number.isFinite(lockDays) || lockDays < 90) {
    return NextResponse.json(
      { error: 'bad_request', message: 'Missing or invalid parameters. Minimum lock duration is 90 days.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await verifyAndRecordStakePointPosition({
    walletAddress: session.wallet,
    txSignature,
    lockDays,
    poolId,
  });

  if (!result.success) {
    if (result.status === 'BLOCKED') {
      return NextResponse.json(
        {
          error: 'stakepoint_not_configured',
          status: 'BLOCKED',
          message: result.error || 'StakePoint verification is not configured on the server.',
        },
        { status: 503, headers: NO_STORE }
      );
    }

    return NextResponse.json(
      {
        error: 'verification_failed',
        status: result.status,
        message: result.error || 'Transaction verification failed',
      },
      { status: 400, headers: NO_STORE }
    );
  }

  // Authoritatively re-evaluate wallet entitlement
  const entitlement = await resolveWalletEntitlement(session.wallet);

  return NextResponse.json(
    {
      ok: true,
      tier: entitlement.tier,
      entitlement,
      stake: result.stake,
      details: result.details,
    },
    { headers: NO_STORE }
  );
}
