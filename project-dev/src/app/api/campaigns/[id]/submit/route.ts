import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { submitCampaignCompletion } from '@/server/campaigns-data';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { isBase58Address } from '@/lib/config';
import { getAuthSession, verifySolanaSignature, MAX_TIMESTAMP_DRIFT_MS } from '@/server/auth';
import { KV_CONFIGURED, kvLock } from '@/server/kv';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// In-memory mutex and replay set for atomic consumption under concurrency
const seenChallengeSignatures = new Set<string>();
let replayChain = Promise.resolve();

async function consumeChallengeSignature(signature: string): Promise<boolean> {
  // If distributed KV (Upstash Redis) is configured, enforce atomic distributed lock
  if (KV_CONFIGURED) {
    const replayKey = `raid-submit-replay:${crypto.createHash('sha256').update(signature).digest('hex')}`;
    return await kvLock(replayKey, '1', Math.ceil(MAX_TIMESTAMP_DRIFT_MS / 1000));
  }
  // Atomically serialize in-process checks to guarantee concurrent race condition safety
  return new Promise((resolve) => {
    replayChain = replayChain.then(async () => {
      if (seenChallengeSignatures.has(signature)) {
        resolve(false);
      } else {
        seenChallengeSignatures.add(signature);
        setTimeout(() => seenChallengeSignatures.delete(signature), MAX_TIMESTAMP_DRIFT_MS);
        resolve(true);
      }
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Rate limiting per IP: 30 requests per 60s
  const ip = clientIp(req);
  const ipLimit = await rateLimit(`submit-camp:ip:${ip}`, 30, 60);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many submissions. Please slow down.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfter) } }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE }
    );
  }

  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
  const xHandle = typeof body.xHandle === 'string' ? body.xHandle.trim() : '';
  const xRetweetLink = typeof body.xRetweetLink === 'string' ? body.xRetweetLink.trim() : '';

  if (!walletAddress) {
    return NextResponse.json(
      { ok: false, error: 'Solana wallet address is required' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!xHandle) {
    return NextResponse.json(
      { ok: false, error: 'X / Twitter handle is required' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!xRetweetLink) {
    return NextResponse.json(
      { ok: false, error: 'X Retweet or Quote link is required' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!isBase58Address(walletAddress)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Solana wallet address format' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Verify wallet ownership via strict campaign-bound cryptographic challenge signature
  const signature = typeof body.signature === 'string' ? body.signature.trim() : req.headers.get('x-signature')?.trim();
  const timestamp = Number(body.timestamp) || Number(req.headers.get('x-timestamp'));

  if (!signature || !Number.isFinite(timestamp)) {
    return NextResponse.json(
      { ok: false, error: 'Cryptographic challenge signature required to verify wallet ownership.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 1. Clock drift and expiration validation (< 5 minutes, <= 30s future clock skew)
  const now = Date.now();
  if (now - timestamp > MAX_TIMESTAMP_DRIFT_MS || timestamp - now > 30_000) {
    return NextResponse.json(
      { ok: false, error: 'Challenge expired or timestamp drift exceeded.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 2. Strict campaign-bound challenge verification (binds campaign ID and wallet address)
  const challengeMsg = `TrenchLabs Raid Submission|${id}|${walletAddress}|${timestamp}`;
  if (!verifySolanaSignature(walletAddress, signature, challengeMsg)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid challenge signature, campaign mismatch, or wrong wallet.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 3. Atomic consumption / replay prevention (protects against concurrent and sequential replays)
  const consumed = await consumeChallengeSignature(signature);
  if (!consumed) {
    return NextResponse.json(
      { ok: false, error: 'Challenge signature has already been consumed or replayed.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // Rate limit per wallet: 5 submissions per 60s
  const walletLimit = await rateLimit(`submit-camp:wallet:${walletAddress}`, 5, 60);
  if (!walletLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many submissions from this wallet. Please wait.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(walletLimit.retryAfter) } }
    );
  }

  const result = await submitCampaignCompletion({
    campaignId: id,
    walletAddress,
    xHandle,
    xRetweetLink,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || 'Failed to submit campaign proof' },
      { status: 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      message: 'Campaign proof successfully submitted! Awaiting admin airdrop verification.',
      submission: result.submission,
    },
    { status: 201, headers: NO_STORE }
  );
}

