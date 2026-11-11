import { NextRequest, NextResponse } from 'next/server';
import { getAuthSession, verifyWalletAuth } from '@/server/auth';
import { getStakeStatusForWallet } from '@/server/db';
import { isBase58Address } from '@/lib/config';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  // 1. Authenticate caller (session cookie or signed ed25519 headers)
  const session = await getAuthSession(req);
  let authWallet = session?.wallet;

  if (!authWallet) {
    const auth = verifyWalletAuth(req);
    if (auth.ok && auth.wallet) {
      authWallet = auth.wallet;
    }
  }

  // Reject unauthenticated requests or expired sessions
  if (!authWallet || !isBase58Address(authWallet)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', message: 'Authentication required. Connect and verify your wallet.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 2. Validate wallet parameter if provided
  const queryWallet = req.nextUrl.searchParams.get('wallet')?.trim();
  if (queryWallet) {
    if (!isBase58Address(queryWallet)) {
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: 'Invalid Solana wallet address format' },
        { status: 400, headers: NO_STORE }
      );
    }
    // Reject mismatched wallet
    if (queryWallet !== authWallet) {
      return NextResponse.json(
        { ok: false, error: 'forbidden', message: 'Authenticated wallet does not match requested wallet' },
        { status: 403, headers: NO_STORE }
      );
    }
  }

  const targetWallet = queryWallet || authWallet;
  const data = await getStakeStatusForWallet(targetWallet);
  return NextResponse.json(data, { headers: NO_STORE });
}

