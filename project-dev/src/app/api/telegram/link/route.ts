import { NextRequest, NextResponse } from 'next/server';
import { isAdminWallet, isBase58Address } from '@/lib/config';
import { resolveTier } from '@/server/db';
import { getAuthSession, verifyWalletAuth } from '@/server/auth';
import { readGenesisBalanceCached } from '@/server/genesis';
import { rateLimit } from '@/server/ratelimit';
import { createLinkCode, isLinked, telegramConfigured, unlinkWallet } from '@/server/telegram';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string, message: string) =>
  NextResponse.json({ ok: false, error, message }, { status, headers: NO_STORE });

/** Every call must be authorized by session or signed wallet headers. */
async function authed(req: NextRequest): Promise<{ wallet: string } | NextResponse> {
  if (!telegramConfigured()) return fail(503, 'NOT_CONFIGURED', 'Telegram alerts are not enabled.');
  const session = await getAuthSession(req);
  if (session?.wallet && isBase58Address(session.wallet)) {
    return { wallet: session.wallet };
  }
  const auth = verifyWalletAuth(req);
  if (!auth.ok || !auth.wallet || !isBase58Address(auth.wallet)) {
    return fail(401, 'UNAUTHORIZED', auth.error || 'Invalid wallet.');
  }
  const limit = await rateLimit(`tg:${auth.wallet}`, 30, 60);
  if (!limit.ok) return fail(429, 'RATE_LIMITED', 'Too many requests.');
  return { wallet: auth.wallet };
}

/** GET — is this wallet linked? Authoritative server check. */
export async function GET(req: NextRequest) {
  if (!telegramConfigured()) return fail(503, 'NOT_CONFIGURED', 'Telegram alerts are not enabled.');
  const queryWallet = req.nextUrl.searchParams.get('wallet')?.trim();
  if (queryWallet && isBase58Address(queryWallet)) {
    try {
      return NextResponse.json({ ok: true, linked: await isLinked(queryWallet) }, { headers: NO_STORE });
    } catch {
      return fail(502, 'STORE_UNAVAILABLE', 'Store unavailable.');
    }
  }
  const a = await authed(req);
  if (a instanceof NextResponse) return a;
  try {
    return NextResponse.json({ ok: true, linked: await isLinked(a.wallet) }, { headers: NO_STORE });
  } catch {
    return fail(502, 'STORE_UNAVAILABLE', 'Store unavailable.');
  }
}

/** POST — start linking: returns a one-time t.me deep link (holders only). */
export async function POST(req: NextRequest) {
  const a = await authed(req);
  if (a instanceof NextResponse) return a;
  try {
    if (!isAdminWallet(a.wallet)) {
      const userTier = await resolveTier(a.wallet);
      if (userTier === 'free') {
        return fail(403, 'ACCESS_DENIED_ZERO_BALANCE', 'Holding at least $20 worth of $GENESIS or staking $250 on StakePoint is required for alerts.');
      }
    }
    const { url } = await createLinkCode(a.wallet);
    return NextResponse.json({ ok: true, url }, { headers: NO_STORE });
  } catch {
    return fail(502, 'UPSTREAM_UNAVAILABLE', 'Could not start linking. Retry shortly.');
  }
}

/** DELETE — turn alerts off. */
export async function DELETE(req: NextRequest) {
  const a = await authed(req);
  if (a instanceof NextResponse) return a;
  try {
    await unlinkWallet(a.wallet);
    return NextResponse.json({ ok: true, linked: false }, { headers: NO_STORE });
  } catch {
    return fail(502, 'STORE_UNAVAILABLE', 'Store unavailable.');
  }
}
