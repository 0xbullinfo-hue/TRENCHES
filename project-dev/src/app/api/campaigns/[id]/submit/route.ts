import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  submitCampaignCompletion,
  loadCampaigns,
  loadSubmissions,
  isValidXUrl,
  getSubmissionByChallengeId,
  reconcileCampaignSubmission,
} from '@/server/campaigns-data';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { isBase58Address } from '@/lib/config';
import { verifySolanaSignature } from '@/server/auth';
import {
  getRaidChallengeState,
  claimRaidChallengeProcessing,
  finalizeRaidChallengeProcessing,
  rollbackRaidChallengeProcessing,
  reconcileRaidChallengeCompleted,
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
  const explicitAttemptId = typeof body.attemptId === 'string' ? body.attemptId.trim() : '';
  const headerAttemptId = req.headers.get('x-attempt-id')?.trim() || '';
  const attemptId = explicitAttemptId || headerAttemptId || crypto.randomUUID();
  const isRetry =
    body.isRetry === true ||
    req.headers.get('x-retry') === 'true' ||
    Boolean(explicitAttemptId || headerAttemptId);

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

  // 3. Inspect authoritative lifecycle state:
  // COMPLETED/CONSUMED:
  if (challengeState.status === 'COMPLETED' || challengeState.status === 'CONSUMED') {
    const existingSubmission = await getSubmissionByChallengeId(challengeId);
    if (
      existingSubmission &&
      existingSubmission.campaignId === id &&
      existingSubmission.walletAddress.toLowerCase() === walletAddress.toLowerCase()
    ) {
      if (isRetry || challengeState.attemptId === attemptId) {
        await reconcileCampaignSubmission(id, existingSubmission.id).catch(() => {});
        return NextResponse.json(
          {
            ok: true,
            message: 'Campaign proof successfully submitted! (Idempotent recovery)',
            submission: existingSubmission,
          },
          { status: 200, headers: NO_STORE }
        );
      }
      return NextResponse.json(
        { ok: false, error: 'Challenge has already been consumed or replayed.' },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Challenge has already been consumed or replayed.' },
      { status: 409, headers: NO_STORE }
    );
  }

  // PROCESSING:
  if (challengeState.status === 'PROCESSING') {
    if (!challengeState.isLeaseExpired && challengeState.attemptId !== attemptId) {
      return NextResponse.json(
        { ok: false, error: 'Another valid attempt is currently processing this challenge. Retry shortly.' },
        { status: 409, headers: NO_STORE }
      );
    }
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

  // Preliminary check: Wallet rate limit (check before processing claim)
  const walletLimit = await rateLimit(`submit-camp:wallet:${walletAddress}`, 5, 60);
  if (!walletLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'Too many submissions from this wallet. Please wait.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(walletLimit.retryAfter) } }
    );
  }

  // Preliminary check: Duplicate campaign submission check
  const allSubmissions = await loadSubmissions();
  const existingForWallet = allSubmissions.find(
    (s) => s.campaignId === id && s.walletAddress.toLowerCase() === walletAddress.toLowerCase()
  );
  const matchesAttempt = 'attemptId' in challengeState && challengeState.attemptId === attemptId;

  if (existingForWallet) {
    // If it's for this exact challenge, it's an idempotent retry
    if (existingForWallet.challengeId === challengeId) {
      await reconcileRaidChallengeCompleted(challengeId, existingForWallet.id).catch(() => {});
      await reconcileCampaignSubmission(id, existingForWallet.id).catch(() => {});
      if (isRetry || matchesAttempt) {
        return NextResponse.json(
          {
            ok: true,
            message: 'Campaign proof successfully submitted! (Idempotent recovery)',
            submission: existingForWallet,
          },
          { status: 200, headers: NO_STORE }
        );
      }
      return NextResponse.json(
        { ok: false, error: 'Challenge has already been consumed or replayed.' },
        { status: 409, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'This wallet has already submitted proof for this campaign' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Check if durable submission already exists for this challengeId
  const existingDurable = await getSubmissionByChallengeId(challengeId);
  if (existingDurable) {
    await reconcileRaidChallengeCompleted(challengeId, existingDurable.id).catch(() => {});
    await reconcileCampaignSubmission(id, existingDurable.id).catch(() => {});
    if (isRetry || matchesAttempt) {
      return NextResponse.json(
        {
          ok: true,
          message: 'Campaign proof successfully submitted! (Idempotent recovery)',
          submission: existingDurable,
        },
        { status: 200, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Challenge has already been completed with conflicting operation.' },
      { status: 409, headers: NO_STORE }
    );
  }

  // 8. Atomically claim PROCESSING ownership in authoritative store
  let claim;
  try {
    claim = await claimRaidChallengeProcessing(challengeId, attemptId, 30_000);
  } catch (err) {
    console.error('[API /api/campaigns/[id]/submit POST] Atomic claim error:', err);
    return NextResponse.json(
      { ok: false, error: 'Authoritative storage unavailable during claim. Retry shortly.' },
      { status: 503, headers: NO_STORE }
    );
  }

  if (claim.status === 'BUSY') {
    return NextResponse.json(
      { ok: false, error: 'Another valid attempt is currently processing this challenge. Retry shortly.' },
      { status: 409, headers: NO_STORE }
    );
  }

  if (claim.status === 'COMPLETED') {
    const existing = await getSubmissionByChallengeId(challengeId);
    if (existing && (isRetry || claim.attemptId === attemptId)) {
      await reconcileCampaignSubmission(id, existing.id).catch(() => {});
      return NextResponse.json(
        {
          ok: true,
          message: 'Campaign proof successfully submitted! (Idempotent recovery)',
          submission: existing,
        },
        { status: 200, headers: NO_STORE }
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Challenge has already been completed with conflicting operation.' },
      { status: 409, headers: NO_STORE }
    );
  }

  if (claim.status === 'EXPIRED') {
    return NextResponse.json(
      { ok: false, error: 'Challenge expired. Please request a fresh challenge.' },
      { status: 401, headers: NO_STORE }
    );
  }

  if (claim.status === 'NOT_FOUND') {
    return NextResponse.json(
      { ok: false, error: 'Unknown challenge ID or challenge expired.' },
      { status: 401, headers: NO_STORE }
    );
  }

  if (claim.status === 'CONFLICT') {
    return NextResponse.json(
      { ok: false, error: 'Conflicting processing claim. Retry shortly.' },
      { status: 409, headers: NO_STORE }
    );
  }

  const fencingToken = claim.fencingToken || 1;

  // 9. Persist the submission completion with durable idempotency key
  let result;
  try {
    result = await submitCampaignCompletion({
      campaignId: id,
      walletAddress,
      xHandle,
      xRetweetLink,
      challengeId,
    });
  } catch (err) {
    console.error('[API submit POST] Submission persistence error, checking durable state:', err);
    // FIRST: Check if the submission was actually saved before rolling back
    const durableCheck = await getSubmissionByChallengeId(challengeId);
    if (durableCheck) {
      // The submission was durably saved! Finalize challenge, repair counter and return success:
      finalizeRaidChallengeProcessing(challengeId, attemptId, fencingToken, durableCheck.id).catch(() => {});
      await reconcileCampaignSubmission(id, durableCheck.id).catch(() => {});
      return NextResponse.json(
        {
          ok: true,
          message: 'Campaign proof successfully submitted! Awaiting admin airdrop verification.',
          submission: durableCheck,
        },
        { status: 201, headers: NO_STORE }
      );
    }

    // Definitively NO durable submission exists: Safe ownership-protected rollback
    await rollbackRaidChallengeProcessing(challengeId, attemptId, fencingToken, challenge);
    return NextResponse.json(
      { ok: false, error: 'Storage failure during submission persistence. Challenge restored, please retry.' },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!result.ok || !result.submission) {
    const durableCheck = await getSubmissionByChallengeId(challengeId);
    if (durableCheck) {
      finalizeRaidChallengeProcessing(challengeId, attemptId, fencingToken, durableCheck.id).catch(() => {});
      await reconcileCampaignSubmission(id, durableCheck.id).catch(() => {});
      return NextResponse.json(
        {
          ok: true,
          message: 'Campaign proof successfully submitted! (Idempotent recovery)',
          submission: durableCheck,
        },
        { status: 200, headers: NO_STORE }
      );
    }
    await rollbackRaidChallengeProcessing(challengeId, attemptId, fencingToken, challenge);
    return NextResponse.json(
      { ok: false, error: result.error || 'Failed to submit campaign proof' },
      { status: 400, headers: NO_STORE }
    );
  }

  // 10. Finalize challenge processing in authoritative store
  try {
    await finalizeRaidChallengeProcessing(challengeId, attemptId, fencingToken, result.submission.id);
  } catch (finalizeErr) {
    console.warn('[API submit POST] Redis finalization error (submission remains durable):', finalizeErr);
    // MANDATORY REQUIREMENT 7:
    // If Redis finalization fails after the submission has been persisted:
    // - Do not roll back the durable submission!
    // - Do not report that the submission was never recorded!
    // - Return a response reflecting the durable result (201).
  }

  if (result.isExisting) {
    await reconcileCampaignSubmission(id, result.submission.id).catch(() => {});
  }

  const responseStatus = result.isExisting ? 200 : 201;
  return NextResponse.json(
    {
      ok: true,
      message: result.isExisting
        ? 'Campaign proof successfully submitted! (Idempotent recovery)'
        : 'Campaign proof successfully submitted! Awaiting admin airdrop verification.',
      submission: result.submission,
    },
    { status: responseStatus, headers: NO_STORE }
  );
}
