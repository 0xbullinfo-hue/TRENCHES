import { NextRequest, NextResponse } from 'next/server';
import {
  submitCampaignCompletion,
  loadCampaigns,
  loadSubmissions,
  isValidXUrl,
} from '@/server/campaigns-data';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { isBase58Address } from '@/lib/config';
import { verifySolanaSignature } from '@/server/auth';
import {
  getRaidChallengeState,
  consumeRaidChallengeOutcome,
  finalizeRaidChallengeTombstone,
  rollbackRaidChallenge,
} from '@/server/raid-challenges';

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

  const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
  const xHandle = typeof body.xHandle === 'string' ? body.xHandle.trim() : '';
  const xRetweetLink = typeof body.xRetweetLink === 'string' ? body.xRetweetLink.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';

  // Mandatory server-generated challenge requirement: reject timestamp-only legacy signatures
  if (!challengeId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Server-issued challenge required. Legacy timestamp-only signatures are rejected.',
      },
      { status: 401, headers: NO_STORE }
    );
  }

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

  if (!isValidXUrl(xRetweetLink)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid X / Twitter retweet URL. Must be a valid link on x.com or twitter.com.' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!isBase58Address(walletAddress)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid Solana wallet address format' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: 'Cryptographic challenge signature is required' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 1. Verify campaign exists and is active
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

  // 2. Load the challenge state from authoritative server storage
  let challengeState;
  try {
    challengeState = await getRaidChallengeState(challengeId);
  } catch (err) {
    console.error('[API /api/campaigns/[id]/submit POST] Challenge storage lookup error:', err);
    return NextResponse.json(
      { ok: false, error: 'Authoritative storage unavailable. Retry shortly.' },
      { status: 503, headers: NO_STORE }
    );
  }

  // 3. Inspect authoritative lifecycle state
  if (challengeState.status === 'CONSUMED') {
    return NextResponse.json(
      { ok: false, error: 'Challenge has already been consumed or replayed.' },
      { status: 409, headers: NO_STORE }
    );
  }

  if (challengeState.status === 'NOT_FOUND') {
    return NextResponse.json(
      { ok: false, error: 'Unknown challenge ID or challenge expired.' },
      { status: 401, headers: NO_STORE }
    );
  }

  if (challengeState.status === 'EXPIRED') {
    return NextResponse.json(
      { ok: false, error: 'Challenge expired. Please request a fresh challenge.' },
      { status: 401, headers: NO_STORE }
    );
  }

  const challenge = challengeState.challenge;

  // 4. Verify server-side expiration (never trust client-supplied expiry)
  const now = Date.now();
  if (now > challenge.expiresAt) {
    return NextResponse.json(
      { ok: false, error: 'Challenge expired. Please request a fresh challenge.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 5. Verify campaign binding (403 Forbidden on mismatch)
  if (challenge.campaignId !== id) {
    return NextResponse.json(
      { ok: false, error: 'Challenge was not issued for this campaign.' },
      { status: 403, headers: NO_STORE }
    );
  }

  // 6. Verify wallet binding (403 Forbidden on mismatch)
  if (challenge.walletAddress !== walletAddress) {
    return NextResponse.json(
      { ok: false, error: 'Challenge was not issued for this wallet.' },
      { status: 403, headers: NO_STORE }
    );
  }

  // 7. Verify Ed25519 signature over exact server-issued challenge message
  if (!verifySolanaSignature(challenge.walletAddress, signature, challenge.message)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid challenge signature.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // Preliminary check: Wallet rate limit (check before consumption to prevent burning challenge)
  const walletLimit = await rateLimit(`submit-camp:wallet:${walletAddress}`, 5, 60);
  if (!walletLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many submissions from this wallet. Please wait.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(walletLimit.retryAfter) } }
    );
  }

  // Preliminary check: Duplicate campaign submission check (check before consumption to prevent burning challenge)
  const allSubmissions = await loadSubmissions();
  const alreadySubmitted = allSubmissions.some(
    (s) => s.campaignId === id && s.walletAddress.toLowerCase() === walletAddress.toLowerCase()
  );
  if (alreadySubmitted) {
    return NextResponse.json(
      { ok: false, error: 'This wallet has already submitted proof for this campaign' },
      { status: 400, headers: NO_STORE }
    );
  }

  // 8. Atomically consume the challenge in authoritative store (single-use replay protection)
  let consumeOutcome;
  try {
    consumeOutcome = await consumeRaidChallengeOutcome(challengeId);
  } catch (err) {
    console.error('[API /api/campaigns/[id]/submit POST] Atomic consume error:', err);
    return NextResponse.json(
      { ok: false, error: 'Authoritative storage unavailable during consumption. Retry shortly.' },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!consumeOutcome.success) {
    if (consumeOutcome.status === 'ALREADY_CONSUMED') {
      return NextResponse.json(
        { ok: false, error: 'Challenge has already been consumed or replayed.' },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Unknown challenge ID or challenge expired.' },
      { status: 401, headers: NO_STORE }
    );
  }

  // 9. Persist the submission completion
  let result;
  try {
    result = await submitCampaignCompletion({
      campaignId: id,
      walletAddress,
      xHandle,
      xRetweetLink,
    });
  } catch (err) {
    console.error('[API /api/campaigns/[id]/submit POST] Submission persistence error, rolling back challenge:', err);
    await rollbackRaidChallenge(challengeId, challenge);
    return NextResponse.json(
      { ok: false, error: 'Storage failure during submission persistence. Challenge restored, please retry.' },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!result.ok || !result.submission) {
    console.error('[API /api/campaigns/[id]/submit POST] submitCampaignCompletion returned error, rolling back challenge:', result.error);
    await rollbackRaidChallenge(challengeId, challenge);
    return NextResponse.json(
      { ok: false, error: result.error || 'Failed to submit campaign proof' },
      { status: 400, headers: NO_STORE }
    );
  }

  // 10. Finalize tombstone with persisted submissionId for idempotent retries
  try {
    await finalizeRaidChallengeTombstone(challengeId, result.submission.id);
  } catch (tombstoneErr) {
    console.warn('[API /api/campaigns/[id]/submit POST] Failed to finalize tombstone with submissionId:', tombstoneErr);
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
