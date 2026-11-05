/**
 * TEMPORARY AND REMOVABLE:
 * This route exists only to make the staking UI testable before real Streamflow integration.
 * When the real Streamflow transaction is integrated, this route must be deleted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession } from '@/server/auth';
import { createStake } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Runtime guard: return 404 in production unless ALLOW_MOCK_STAKE === "1"
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_STAKE !== '1') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized', message: 'Session required' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body' }, { status: 400 });
  }

  const { amount_raw, lock_days, tx_signature } = body;

  if (!amount_raw || typeof lock_days !== 'number' || lock_days <= 0) {
    return NextResponse.json({ error: 'bad_request', message: 'Missing or invalid stake parameters' }, { status: 400 });
  }

  try {
    await createStake({
      wallet_address: session.wallet,
      amount_raw: String(amount_raw),
      lock_days: Number(lock_days),
      tx_signature: String(tx_signature || `stub_${crypto.randomUUID()}`),
      staking_provider: 'streamflow_stub',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[TrenchLabs API] Mock stake insertion failed:', err);
    return NextResponse.json({ error: 'internal_error', message: 'Failed to record stake' }, { status: 500 });
  }
}

