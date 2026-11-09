import { NextRequest, NextResponse } from 'next/server';
import {
  createCampaign,
  getCampaignsWithUserStatus,
  isValidXUrl,
} from '@/server/campaigns-data';
import { getAuthSession, verifyAdminAuth } from '@/server/auth';
import { ADMIN_WALLET, isAdminWallet } from '@/lib/config';
import { clientIp, rateLimit } from '@/server/ratelimit';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const queryWallet = url.searchParams.get('wallet')?.trim() || req.headers.get('x-wallet')?.trim();

  try {
    const campaigns = await getCampaignsWithUserStatus(queryWallet);
    return NextResponse.json({ ok: true, campaigns }, { headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/campaigns GET] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to retrieve campaigns' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Admin authentication check (via cryptographic headers or session)
  const adminAuth = await verifyAdminAuth(req, rawBody);
  if (!adminAuth.authorized) {
    const session = await getAuthSession(req);
    if (!session || !isAdminWallet(session.wallet)) {
      return NextResponse.json(
        { ok: false, error: adminAuth.error || 'Unauthorized: Admin access required.' },
        { status: 401, headers: NO_STORE }
      );
    }
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const tweetUrl = typeof body.tweetUrl === 'string' ? body.tweetUrl.trim() : '';
  const rewardAmount = typeof body.rewardAmount === 'string' ? body.rewardAmount.trim() : '';
  const totalPool = typeof body.totalPool === 'string' ? body.totalPool.trim() : undefined;
  const expiresAt = typeof body.expiresAt === 'string' && body.expiresAt.trim() ? body.expiresAt.trim() : undefined;
  const pinned = Boolean(body.pinned);
  const targetActions = Array.isArray(body.targetActions)
    ? (body.targetActions.filter((a) => typeof a === 'string') as string[])
    : undefined;

  if (!title) {
    return NextResponse.json(
      { ok: false, error: 'Campaign title is required' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!tweetUrl || !isValidXUrl(tweetUrl)) {
    return NextResponse.json(
      { ok: false, error: 'Valid X / Twitter tweet URL is required' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!rewardAmount) {
    return NextResponse.json(
      { ok: false, error: 'Reward amount is required (e.g. 50,000 $GENESIS)' },
      { status: 400, headers: NO_STORE }
    );
  }

  try {
    const campaign = await createCampaign({
      title,
      description: description || 'Complete the X raid instructions and submit your proof below for a verified airdrop.',
      tweetUrl,
      rewardAmount,
      totalPool,
      targetActions,
      postedBy: ADMIN_WALLET,
      pinned,
      expiresAt,
    });

    const allCampaigns = await getCampaignsWithUserStatus();
    return NextResponse.json({ ok: true, campaign, campaigns: allCampaigns }, { status: 201, headers: NO_STORE });
  } catch (err) {
    console.error('[API /api/campaigns POST] Error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to create campaign' },
      { status: 500, headers: NO_STORE }
    );
  }
}

