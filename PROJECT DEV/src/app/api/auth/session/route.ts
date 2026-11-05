import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  getAuthSession,
  signSession,
  verifySolanaSignature,
  MAX_TIMESTAMP_DRIFT_MS,
} from '@/server/auth';
import { resolveTier } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    wallet: session.wallet,
    tier: session.tier,
  });
}

export async function POST(req: NextRequest) {
  // Can be called with cryptographic headers or body
  let wallet = req.headers.get('x-wallet')?.trim();
  let sig = req.headers.get('x-signature')?.trim();
  let ts = Number(req.headers.get('x-timestamp'));

  if (!wallet || !sig || !Number.isFinite(ts)) {
    const body = await req.json().catch(() => null);
    if (body) {
      wallet = body.wallet;
      sig = body.signature;
      ts = Number(body.timestamp);
    }
  }

  if (!wallet || !sig || !Number.isFinite(ts)) {
    return NextResponse.json({ ok: false, error: 'Missing wallet authentication' }, { status: 400 });
  }

  if (Math.abs(Date.now() - ts) > MAX_TIMESTAMP_DRIFT_MS) {
    return NextResponse.json({ ok: false, error: 'Signature expired' }, { status: 400 });
  }

  const msg = ['TrenchLabs Access', req.method, new URL(req.url).pathname, ts].join('|');
  const fallbackMsg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
  const valid = verifySolanaSignature(wallet, sig, msg) || verifySolanaSignature(wallet, sig, fallbackMsg);

  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  const token = signSession(wallet);
  const tier = await resolveTier(wallet);

  const res = NextResponse.json({
    ok: true,
    wallet,
    tier,
  });

  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600,
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

