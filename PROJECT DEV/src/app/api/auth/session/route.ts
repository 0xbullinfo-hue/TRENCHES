import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  getAuthSession,
  signSession,
  verifySolanaSignature,
  MAX_TIMESTAMP_DRIFT_MS,
} from '@/server/auth';
import { resolveTier } from '@/server/db';
import { KV_CONFIGURED, kvLock } from '@/server/kv';
import { clientIp, rateLimit } from '@/server/ratelimit';

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

  const limit = await rateLimit(`session:${clientIp(req)}`, 20, 60);
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });
  }

  const msg = ['TrenchLabs Access', req.method, new URL(req.url).pathname, ts].join('|');
  const fallbackMsg = `TrenchLabs Access|GET|/api/alphas|${ts}`;
  const valid = verifySolanaSignature(wallet, sig, msg) || verifySolanaSignature(wallet, sig, fallbackMsg);

  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  // A signature may mint a session cookie only once (shared lock across instances)
  if (KV_CONFIGURED) {
    const replayId = crypto.createHash('sha256').update(`session:${sig}`).digest('hex');
    const first = await kvLock(`session-replay:${replayId}`, '1', Math.ceil(MAX_TIMESTAMP_DRIFT_MS / 1000));
    if (!first) {
      return NextResponse.json({ ok: false, error: 'Signature already used' }, { status: 401 });
    }
  }

  let token: string;
  try {
    token = signSession(wallet);
  } catch {
    return NextResponse.json({ ok: false, error: 'Sessions are not configured' }, { status: 503 });
  }
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
    maxAge: SESSION_MAX_AGE_SEC,
  });

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}

