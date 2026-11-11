import { NextRequest, NextResponse } from 'next/server';
import { submitCampaignCompletion } from '@/server/campaigns-data';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { isBase58Address } from '@/lib/config';
import { getAuthSession, verifySolanaSignature, MAX_TIMESTAMP_DRIFT_MS } from '@/server/auth';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

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

  // Verify wallet ownership: require active session or cryptographic challenge signature
  const session = await getAuthSession(req);
  const isSessionAuthed = Boolean(session && session.wallet === walletAddress);

  let isSigAuthed = false;
  const signature = typeof body.signature === 'string' ? body.signature.trim() : req.headers.get('x-signature')?.trim();
  const timestamp = Number(body.timestamp) || Number(req.headers.get('x-timestamp'));

  if (signature && Number.isFinite(timestamp)) {
    if (Math.abs(Date.now() - timestamp) <= MAX_TIMESTAMP_DRIFT_MS) {
      const challengeMsg = `TrenchLabs Raid Submission|${id}|${walletAddress}|${timestamp}`;
      const fallbackMsg = ['TrenchLabs Access', req.method, new URL(req.url).pathname, timestamp].join('|');
      if (
        verifySolanaSignature(walletAddress, signature, challengeMsg) ||
        verifySolanaSignature(walletAddress, signature, fallbackMsg)
      ) {
        isSigAuthed = true;
      }
    }
  }

  if (!isSessionAuthed && !isSigAuthed) {
    return NextResponse.json(
      { ok: false, error: 'Cryptographic wallet signature verification required to prove wallet ownership.' },
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

