import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { isBase58Address } from '@/lib/config';
import { loadCampaigns } from '@/server/campaigns-data';
import { issueRaidChallenge } from '@/server/raid-challenges';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Rate limit per IP: 30 challenge requests per 60s
  const ip = clientIp(req);
  const ipLimit = await rateLimit(`challenge-ip:${ip}`, 30, 60);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many challenge requests. Please slow down.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfter) } }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const walletAddress = typeof body.walletAddress === 'string'
    ? body.walletAddress.trim()
    : req.nextUrl.searchParams.get('wallet')?.trim() || '';

  if (!walletAddress) {
    return NextResponse.json(
      { ok: false, error: 'Wallet address is required to generate a challenge' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!isBase58Address(walletAddress)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Solana wallet address format' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Rate limit per wallet: 10 challenges per 60s
  const walletLimit = await rateLimit(`challenge-wallet:${walletAddress}`, 10, 60);
  if (!walletLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many challenge requests for this wallet. Please wait.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(walletLimit.retryAfter) } }
    );
  }

  try {
    const campaigns = await loadCampaigns();
    const campaign = campaigns.find((c) => c.id === id);
    if (!campaign) {
      return NextResponse.json(
        { ok: false, error: 'Campaign not found' },
        { status: 404, headers: NO_STORE }
      );
    }

    if (campaign.status === 'PAUSED' || campaign.status === 'COMPLETED') {
      return NextResponse.json(
        { ok: false, error: `Campaign is currently ${campaign.status.toLowerCase()}` },
        { status: 400, headers: NO_STORE }
      );
    }

    if (campaign.expiresAt && new Date(campaign.expiresAt).getTime() <= Date.now()) {
      return NextResponse.json(
        { ok: false, error: 'Campaign has expired' },
        { status: 400, headers: NO_STORE }
      );
    }

    const challenge = await issueRaidChallenge({
      campaignId: id,
      walletAddress,
    });

    return NextResponse.json(
      {
        ok: true,
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        campaignId: challenge.campaignId,
        walletAddress: challenge.walletAddress,
        createdAt: challenge.createdAt,
        expiresAt: challenge.expiresAt,
        message: challenge.message,
        challenge,
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (err) {
    console.error('[API /api/campaigns/[id]/challenge POST] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Challenge storage unavailable. Retry shortly.' },
      { status: 502, headers: NO_STORE }
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return POST(req, context);
}

