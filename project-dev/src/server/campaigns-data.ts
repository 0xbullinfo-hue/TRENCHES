import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { PublicKey } from '@solana/web3.js';
import {
  KV_CONFIGURED,
  isKvConfigured,
  kvGet,
  kvSet,
  kvDel,
  kvLock,
  kvUnlock,
  kvRenewLock,
  kvSetLocked,
  kvReserveSubmissionChallenge,
  kvAdvanceSubmissionReservation,
  kvScan,
  kvSMembers,
  kvSAdd,
  kvSRem,
} from '@/server/kv';
import { ADMIN_WALLET } from '@/lib/config';
import { acquireFileLock } from '@/server/db';
import type { Campaign, CampaignSubmission, CampaignStatus, SubmissionStatus } from '@/lib/types';

const isKvActive = () => Boolean(KV_CONFIGURED || isKvConfigured());

const CAMPAIGNS_FILE_PATH = path.join(process.cwd(), 'data', 'campaigns.json');
const SUBMISSIONS_FILE_PATH = path.join(process.cwd(), 'data', 'campaign_submissions.json');

const KV_CAMPAIGNS_KEY = 'trench:campaigns:v1';
const KV_SUBMISSIONS_KEY = 'trench:submissions:v1';
const KV_LOCK_KEY = 'trench:campaigns:lock';

const FILE_PERSISTENCE_ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_FILE_PERSISTENCE === 'true';

let campaignsLockChain: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const CAMPAIGNS_FILE_LOCK_PATH = path.join(process.cwd(), 'data', 'campaigns.lock');

export interface CampaignsLockContext {
  token: string;
  fencingGeneration: number;
  lockType: 'file' | 'kv';
  assertOwned: () => void;
  isOwned: () => boolean;
}

export const campaignsLockStorage = new AsyncLocalStorage<CampaignsLockContext>();

export function withCampaignsLock<T>(fn: (ctx?: CampaignsLockContext) => Promise<T> | T): Promise<T> {
  const activeLock = campaignsLockStorage.getStore();
  if (activeLock) {
    return Promise.resolve(fn(activeLock));
  }
  const run = campaignsLockChain.then(async () => {
    if (!isKvActive()) {
      if (!FILE_PERSISTENCE_ALLOWED) {
        throw new Error('Persistence not configured. Set ALLOW_FILE_PERSISTENCE=true or KV credentials.');
      }
      const releaseFileLock = await acquireFileLock(CAMPAIGNS_FILE_LOCK_PATH);
      const ctx: CampaignsLockContext = {
        token: releaseFileLock.token,
        fencingGeneration: releaseFileLock.fencingGeneration,
        lockType: 'file',
        assertOwned: () => releaseFileLock.assertOwned(),
        isOwned: () => releaseFileLock.isOwned(),
      };
      try {
        return await campaignsLockStorage.run(ctx, async () => await fn(ctx));
      } finally {
        releaseFileLock();
      }
    }

    const token = crypto.randomUUID();
    let acquired = false;
    for (let i = 0; i < 20 && !acquired; i++) {
      acquired = await kvLock(KV_LOCK_KEY, token, 30);
      if (!acquired) await sleep(150);
    }
    if (!acquired) throw new Error('Campaigns store busy, retry shortly');

    let renewTimer: NodeJS.Timeout | null = null;
    let renewInFlight = false;
    let lockLost = false;

    renewTimer = setInterval(async () => {
      if (renewInFlight || lockLost) return;
      renewInFlight = true;
      try {
        const renewed = await kvRenewLock(KV_LOCK_KEY, token, 30);
        if (!renewed) {
          lockLost = true;
          if (renewTimer) clearInterval(renewTimer);
        }
      } catch {
        lockLost = true;
        if (renewTimer) clearInterval(renewTimer);
      } finally {
        renewInFlight = false;
      }
    }, 10_000);

    if (typeof renewTimer.unref === 'function') {
      renewTimer.unref();
    }

    const kvCtx: CampaignsLockContext = {
      token,
      fencingGeneration: 1,
      lockType: 'kv',
      assertOwned: () => {
        if (lockLost) {
          throw new Error('Campaigns KV lock lease expired or lost');
        }
      },
      isOwned: () => !lockLost,
    };

    try {
      return await campaignsLockStorage.run(kvCtx, async () => await fn(kvCtx));
    } finally {
      if (renewTimer) clearInterval(renewTimer);
      await kvUnlock(KV_LOCK_KEY, token).catch(() => undefined);
    }
  });
  campaignsLockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const DEFAULT_CAMPAIGNS: Campaign[] = [];

export async function loadCampaigns(): Promise<Campaign[]> {
  if (isKvActive()) {
    const raw = await kvGet(KV_CAMPAIGNS_KEY);
    if (!raw) return DEFAULT_CAMPAIGNS;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Campaign[];
    } catch {
      console.error('[TrenchLabs Campaigns] Corrupt KV campaigns data, using fallback');
    }
    return DEFAULT_CAMPAIGNS;
  }

  if (!fs.existsSync(CAMPAIGNS_FILE_PATH)) {
    return DEFAULT_CAMPAIGNS;
  }

  try {
    const raw = fs.readFileSync(CAMPAIGNS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as Campaign[];
  } catch (err) {
    console.error('[TrenchLabs Campaigns] Corrupt file data:', err);
  }
  return DEFAULT_CAMPAIGNS;
}

export async function saveCampaigns(campaigns: Campaign[]): Promise<{ success: boolean; error?: string }> {
  if (_testFailSaveCampaignsPersistent) {
    return { success: false, error: _testFailSaveCampaignsPersistent.message };
  }
  const activeLock = campaignsLockStorage.getStore();
  if (activeLock) {
    try {
      activeLock.assertOwned();
    } catch (assertErr) {
      return { success: false, error: (assertErr as Error).message };
    }
  }
  try {
    if (isKvActive()) {
      if (activeLock && activeLock.lockType === 'kv') {
        const res = await kvSetLocked(
          KV_LOCK_KEY,
          KV_CAMPAIGNS_KEY,
          activeLock.token,
          JSON.stringify(campaigns),
          activeLock.fencingGeneration
        );
        if (!res.success) {
          return { success: false, error: `Lock ownership lost: ${res.reason || 'not owned'}` };
        }
        return { success: true };
      }
      return { success: false, error: 'Lock required for protected campaign save in KV mode' };
    }
    if (!FILE_PERSISTENCE_ALLOWED) {
      return {
        success: false,
        error: 'Persistence not configured. Set ALLOW_FILE_PERSISTENCE=true or KV credentials.',
      };
    }
    fs.mkdirSync(path.dirname(CAMPAIGNS_FILE_PATH), { recursive: true });
    const tmp = `${CAMPAIGNS_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(campaigns, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, CAMPAIGNS_FILE_PATH);
    } catch {
      fs.writeFileSync(CAMPAIGNS_FILE_PATH, JSON.stringify(campaigns, null, 2), 'utf-8');
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
    return { success: true };
  } catch (err) {
    const msg = (err as Error).message || 'Failed to write campaigns file';
    console.error('[TrenchLabs Campaigns] Save error:', msg);
    return { success: false, error: msg };
  }
}

export async function loadSubmissions(): Promise<CampaignSubmission[]> {
  if (isKvActive()) {
    const raw = await kvGet(KV_SUBMISSIONS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as CampaignSubmission[];
    } catch {
      console.error('[TrenchLabs Campaigns] Corrupt KV submissions data');
    }
    return [];
  }

  if (!fs.existsSync(SUBMISSIONS_FILE_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(SUBMISSIONS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CampaignSubmission[];
  } catch (err) {
    console.error('[TrenchLabs Campaigns] Corrupt submissions file:', err);
  }
  return [];
}

export async function saveSubmissions(submissions: CampaignSubmission[]): Promise<{ success: boolean; error?: string }> {
  const activeLock = campaignsLockStorage.getStore();
  if (activeLock) {
    try {
      activeLock.assertOwned();
    } catch (assertErr) {
      return { success: false, error: (assertErr as Error).message };
    }
  }
  try {
    if (isKvActive()) {
      if (activeLock && activeLock.lockType === 'kv') {
        const res = await kvSetLocked(
          KV_LOCK_KEY,
          KV_SUBMISSIONS_KEY,
          activeLock.token,
          JSON.stringify(submissions),
          activeLock.fencingGeneration
        );
        if (!res.success) {
          return { success: false, error: `Lock ownership lost: ${res.reason || 'not owned'}` };
        }
        return { success: true };
      }
      return { success: false, error: 'Lock required for protected submission save in KV mode' };
    }
    if (!FILE_PERSISTENCE_ALLOWED) {
      return {
        success: false,
        error: 'Persistence not configured. Set ALLOW_FILE_PERSISTENCE=true or KV credentials.',
      };
    }
    fs.mkdirSync(path.dirname(SUBMISSIONS_FILE_PATH), { recursive: true });
    const tmp = `${SUBMISSIONS_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(submissions, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, SUBMISSIONS_FILE_PATH);
    } catch {
      fs.writeFileSync(SUBMISSIONS_FILE_PATH, JSON.stringify(submissions, null, 2), 'utf-8');
      try {
        fs.unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
    return { success: true };
  } catch (err) {
    const msg = (err as Error).message || 'Failed to write submissions file';
    console.error('[TrenchLabs Campaigns] Save submissions error:', msg);
    return { success: false, error: msg };
  }
}

export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function normalizeXHandle(handle: string): string {
  if (!handle) return '';
  let clean = handle.trim();
  if (clean.startsWith('https://x.com/') || clean.startsWith('http://x.com/') ||
      clean.startsWith('https://twitter.com/') || clean.startsWith('http://twitter.com/')) {
    try {
      const parsed = new URL(clean);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0 && segments[0] !== 'intent' && segments[0] !== 'i') {
        clean = segments[0];
      }
    } catch {
      // ignore
    }
  }
  clean = clean.replace(/^@+/, '');
  return `@${clean}`;
}

export function isValidXUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase();
    const isXHost = host === 'x.com' || host === 'www.x.com' || host === 'twitter.com' || host === 'www.twitter.com';
    return isXHost && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export async function createCampaign(data: {
  title: string;
  description: string;
  tweetUrl: string;
  rewardAmount: string;
  rewardToken?: string;
  totalPool?: string;
  targetActions?: string[];
  expiresAt?: string;
  durationHours?: number;
  postedBy: string;
  pinned?: boolean;
  status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
}): Promise<Campaign> {
  return withCampaignsLock(async () => {
    const campaigns = await loadCampaigns();
    const durationHours =
      typeof data.durationHours === 'number' && Number.isFinite(data.durationHours) && data.durationHours > 0
        ? data.durationHours
        : undefined;

    let expiresAt = data.expiresAt;
    if (!expiresAt && durationHours) {
      expiresAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
    }

    const newCampaign: Campaign = {
      id: `camp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      title: data.title.trim(),
      description: data.description.trim(),
      tweetUrl: data.tweetUrl.trim(),
      rewardAmount: data.rewardAmount.trim(),
      rewardToken: data.rewardToken?.trim() || '$GENESIS',
      totalPool: data.totalPool?.trim(),
      targetActions: data.targetActions && data.targetActions.length > 0 ? data.targetActions : ['Like', 'Retweet', 'Comment'],
      status: data.status || 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt,
      durationHours,
      postedBy: data.postedBy,
      submissionsCount: 0,
      airdroppedCount: 0,
      pinned: Boolean(data.pinned),
      pinnedAt: data.pinned ? new Date().toISOString() : null,
    };

    campaigns.unshift(newCampaign);
    await saveCampaigns(campaigns);
    return newCampaign;
  });
}

export async function updateCampaign(
  id: string,
  updates: Partial<Pick<Campaign, 'title' | 'description' | 'tweetUrl' | 'rewardAmount' | 'status' | 'expiresAt' | 'durationHours' | 'pinned' | 'pinnedAt'>>
): Promise<Campaign | null> {
  return withCampaignsLock(async () => {
    const campaigns = await loadCampaigns();
    const index = campaigns.findIndex((c) => c.id === id);
    if (index === -1) return null;

    const updatedPinned = typeof updates.pinned === 'boolean' ? updates.pinned : campaigns[index].pinned;
    const pinnedAt = typeof updates.pinned === 'boolean'
      ? (updates.pinned ? new Date().toISOString() : null)
      : campaigns[index].pinnedAt;

    campaigns[index] = {
      ...campaigns[index],
      ...updates,
      pinned: updatedPinned,
      pinnedAt,
    };

    await saveCampaigns(campaigns);
    return campaigns[index];
  });
}

export async function deleteCampaign(id: string): Promise<boolean> {
  return withCampaignsLock(async () => {
    const campaigns = await loadCampaigns();
    const filtered = campaigns.filter((c) => c.id !== id);
    if (filtered.length === campaigns.length) return false;
    await saveCampaigns(filtered);
    return true;
  });
}

let _testFailNextSaveSubmissions: Error | null = null;
let _testFailNextSaveCampaigns: Error | null = null;
let _testFailSaveCampaignsPersistent: Error | null = null;

export function __setTestFailSaveSubmissions(err: Error | null): void {
  _testFailNextSaveSubmissions = err;
}

export function __setTestFailSaveCampaigns(err: Error | null): void {
  _testFailNextSaveCampaigns = err;
}

export function __setTestFailSaveCampaignsPersistent(err: Error | null): void {
  _testFailSaveCampaignsPersistent = err;
}

export type SubmissionReservationState =
  | 'RESERVED'
  | 'PERSISTED'
  | 'COMPLETED'
  | 'RETRYABLE'
  | 'REJECTED'
  | 'EXPIRED';

export interface SubmissionReservationRecord {
  challengeId: string;
  campaignId: string;
  walletAddress: string;
  submissionId: string;
  idempotencyKey: string;
  state: SubmissionReservationState;
  createdAt: number;
  updatedAt: number;
  attemptId: string;
  fencingGeneration: number;
  recoveryMetadata?: {
    error?: string;
    retries?: number;
    lastAttemptAt?: number;
    counterStatus?: 'RECONCILED' | 'PENDING_RECONCILIATION';
    sideEffectsStatus?: 'DURABLE' | 'PENDING_RECONCILIATION';
    [key: string]: unknown;
  };
  submissionPayload: CampaignSubmission;
}

const SUBMISSIONS_BY_CHALLENGE_DIR = path.join(process.cwd(), 'data', 'submissions_by_challenge');
const SUBMISSION_RESERVATIONS_DIR = path.join(process.cwd(), 'data', 'submission_reservations');

const KV_SUBMISSION_CHALLENGE_PREFIX = 'trench:sub:challenge:';
const KV_SUBMISSION_RESERVATION_PREFIX = 'trench:sub:reservation:';
const KV_SUBMISSION_RESERVATION_SET = 'trench:sub:reservations_set';

export async function getSubmissionReservation(
  challengeId: string
): Promise<SubmissionReservationRecord | null> {
  if (!challengeId) return null;

  if (isKvActive()) {
    try {
      const raw =
        (await kvGet(`${KV_SUBMISSION_RESERVATION_PREFIX}${challengeId}`)) ||
        (await kvGet(`${KV_SUBMISSION_CHALLENGE_PREFIX}${challengeId}`));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state && parsed?.challengeId) {
          return parsed as SubmissionReservationRecord;
        }
        if (parsed?.id && parsed?.walletAddress) {
          return {
            challengeId,
            campaignId: parsed.campaignId,
            walletAddress: parsed.walletAddress,
            submissionId: parsed.id,
            idempotencyKey: parsed.idempotencyKey || `raid-submission:${challengeId}`,
            state: 'COMPLETED',
            createdAt: parsed.submittedAt ? new Date(parsed.submittedAt).getTime() : Date.now(),
            updatedAt: Date.now(),
            attemptId: 'legacy',
            fencingGeneration: 1,
            submissionPayload: parsed as CampaignSubmission,
          };
        }
      }
    } catch {}
    return null;
  }

  const resPath = path.join(SUBMISSION_RESERVATIONS_DIR, `${challengeId}.json`);
  if (fs.existsSync(resPath)) {
    try {
      const raw = fs.readFileSync(resPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.state && parsed?.challengeId) {
        return parsed as SubmissionReservationRecord;
      }
    } catch {}
  }

  const singlePath = path.join(SUBMISSIONS_BY_CHALLENGE_DIR, `${challengeId}.json`);
  if (fs.existsSync(singlePath)) {
    try {
      const raw = fs.readFileSync(singlePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed?.state && parsed?.challengeId) {
        return parsed as SubmissionReservationRecord;
      }
      if (parsed?.id && parsed?.walletAddress) {
        return {
          challengeId,
          campaignId: parsed.campaignId,
          walletAddress: parsed.walletAddress,
          submissionId: parsed.id,
          idempotencyKey: parsed.idempotencyKey || `raid-submission:${challengeId}`,
          state: 'COMPLETED',
          createdAt: parsed.submittedAt ? new Date(parsed.submittedAt).getTime() : Date.now(),
          updatedAt: Date.now(),
          attemptId: 'legacy',
          fencingGeneration: 1,
          submissionPayload: parsed as CampaignSubmission,
        };
      }
    } catch {}
  }

  return null;
}

export async function saveSubmissionReservation(
  reservation: SubmissionReservationRecord
): Promise<{ success: boolean; error?: string }> {
  reservation.updatedAt = reservation.updatedAt || Date.now();
  const challengeId = reservation.challengeId;

  if (isKvActive()) {
    try {
      const resKey = `${KV_SUBMISSION_RESERVATION_PREFIX}${challengeId}`;
      const payload = JSON.stringify(reservation);
      await kvSet(resKey, payload);
      await kvSAdd(KV_SUBMISSION_RESERVATION_SET, challengeId);
      await kvSet(`${KV_SUBMISSION_CHALLENGE_PREFIX}${challengeId}`, payload);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  try {
    fs.mkdirSync(SUBMISSION_RESERVATIONS_DIR, { recursive: true });
    fs.mkdirSync(SUBMISSIONS_BY_CHALLENGE_DIR, { recursive: true });
    const resPath = path.join(SUBMISSION_RESERVATIONS_DIR, `${challengeId}.json`);
    const legacyPath = path.join(SUBMISSIONS_BY_CHALLENGE_DIR, `${challengeId}.json`);
    const payload = JSON.stringify(reservation, null, 2);

    const tmp = `${resPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
      fs.renameSync(tmp, resPath);
    } catch {
      fs.writeFileSync(resPath, payload, 'utf8');
      try { fs.unlinkSync(tmp); } catch {}
    }

    const legTmp = `${legacyPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(legTmp, payload, 'utf8');
    try {
      fs.renameSync(legTmp, legacyPath);
    } catch {
      fs.writeFileSync(legacyPath, payload, 'utf8');
      try { fs.unlinkSync(legTmp); } catch {}
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function updateSubmissionReservationState(
  challengeId: string,
  state: SubmissionReservationState,
  options?: {
    expectedState?: string;
    attemptId?: string;
    submissionId?: string;
    fencingGeneration?: number;
    error?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; reservation?: SubmissionReservationRecord; error?: string }> {
  if (isKvActive()) {
    const key = `${KV_SUBMISSION_RESERVATION_PREFIX}${challengeId}`;
    const advRes = await kvAdvanceSubmissionReservation(
      key,
      options?.expectedState || '*',
      state,
      {
        attemptId: options?.attemptId,
        submissionId: options?.submissionId,
        fencingGeneration: options?.fencingGeneration,
        metadata: {
          ...(options?.metadata || {}),
          ...(options?.error ? { error: options.error } : {}),
        },
      }
    );
    if (!advRes.ok) {
      return { ok: false, error: advRes.reason || 'Failed to advance reservation' };
    }
    return { ok: true, reservation: advRes.reservation as SubmissionReservationRecord };
  }

  return withCampaignsLock(async () => {
    const current = await getSubmissionReservation(challengeId);
    if (!current) {
      return { ok: false, error: 'Reservation not found' };
    }

    if (options?.expectedState && options.expectedState !== '*' && current.state !== options.expectedState) {
      return {
        ok: false,
        error: `STATE_MISMATCH: expected ${options.expectedState}, found ${current.state}`,
      };
    }
    if (options?.attemptId && current.attemptId && current.attemptId !== options.attemptId) {
      return {
        ok: false,
        error: `ATTEMPT_MISMATCH: expected ${options.attemptId}, found ${current.attemptId}`,
      };
    }
    if (options?.submissionId && current.submissionId && current.submissionId !== options.submissionId) {
      return {
        ok: false,
        error: `SUBMISSION_ID_MISMATCH: expected ${options.submissionId}, found ${current.submissionId}`,
      };
    }
    if (options?.fencingGeneration && current.fencingGeneration && current.fencingGeneration > options.fencingGeneration) {
      return {
        ok: false,
        error: `FENCING_VIOLATION: current gen ${current.fencingGeneration} > ${options.fencingGeneration}`,
      };
    }

    current.state = state;
    current.updatedAt = Date.now();
    if (options?.attemptId) current.attemptId = options.attemptId;
    if (options?.fencingGeneration) current.fencingGeneration = options.fencingGeneration;
    if (!current.recoveryMetadata) current.recoveryMetadata = {};
    if (options?.error) current.recoveryMetadata.error = options.error;
    if (options?.metadata) {
      Object.assign(current.recoveryMetadata, options.metadata);
    }

    const saveRes = await saveSubmissionReservation(current);
    if (!saveRes.success) {
      return { ok: false, error: saveRes.error || 'Failed to update reservation' };
    }
    return { ok: true, reservation: current };
  });
}

export async function getSubmissionByIdempotencyKey(
  idempotencyKey: string
): Promise<CampaignSubmission | null> {
  if (!idempotencyKey) return null;
  const submissions = await loadSubmissions();
  return submissions.find((s) => s.idempotencyKey === idempotencyKey) || null;
}

export async function getSubmissionByChallengeId(
  challengeId: string
): Promise<CampaignSubmission | null> {
  if (!challengeId) return null;

  const reservation = await getSubmissionReservation(challengeId);
  const submissions = await loadSubmissions();
  const expectedKey = `raid-submission:${challengeId}`;

  const durableInSubmissions = submissions.find(
    (s) =>
      s.challengeId === challengeId ||
      (s.idempotencyKey && s.idempotencyKey === expectedKey) ||
      (reservation && s.id === reservation.submissionId)
  );

  if (reservation) {
    // If reservation is in RESERVED or RETRYABLE state, it is NOT yet persisted.
    // Never return a successful persisted-submission response solely because a reservation exists!
    if (reservation.state === 'RESERVED' || reservation.state === 'RETRYABLE') {
      return null;
    }

    if (reservation.state === 'PERSISTED' || reservation.state === 'COMPLETED') {
      if (!durableInSubmissions) return null;
      if (reservation.submissionId && durableInSubmissions.id !== reservation.submissionId) {
        return null; // Submission ID mismatch
      }
      if (reservation.campaignId && durableInSubmissions.campaignId !== reservation.campaignId) {
        return null; // Campaign ID mismatch
      }
      if (
        reservation.walletAddress &&
        durableInSubmissions.walletAddress.toLowerCase() !== reservation.walletAddress.toLowerCase()
      ) {
        return null; // Wallet ownership mismatch
      }
      return durableInSubmissions;
    }
  }

  return durableInSubmissions || null;
}

const PENDING_RECONCILE_DIR = path.join(process.cwd(), 'data', 'pending_counter_reconciliations');
const KV_PENDING_RECONCILE_PREFIX = 'trench:camp:pending_reconcile:';
const KV_PENDING_RECONCILE_SET = 'trench:camp:pending_reconcile_set';

export async function markCampaignCounterPendingReconciliation(
  campaignId: string,
  submissionId: string
): Promise<void> {
  if (!campaignId || !submissionId) return;
  const key = `${campaignId}__${submissionId}`;
  if (isKvActive()) {
    try {
      await kvSet(
        `${KV_PENDING_RECONCILE_PREFIX}${key}`,
        JSON.stringify({ campaignId, submissionId, createdAt: Date.now() })
      );
      await kvSAdd(KV_PENDING_RECONCILE_SET, key);
    } catch (err) {
      console.error('[TrenchLabs Campaigns] Failed to mark Redis pending counter reconciliation:', err);
      throw err;
    }
    return;
  }
  try {
    fs.mkdirSync(PENDING_RECONCILE_DIR, { recursive: true });
    const filePath = path.join(PENDING_RECONCILE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ campaignId, submissionId, createdAt: Date.now() }), 'utf8');
  } catch (err) {
    console.error('[TrenchLabs Campaigns] Failed to mark file pending counter reconciliation:', err);
    throw err;
  }
}

export async function clearCampaignCounterPendingReconciliation(
  campaignId: string,
  submissionId: string
): Promise<void> {
  if (!campaignId || !submissionId) return;
  const key = `${campaignId}__${submissionId}`;
  if (isKvActive()) {
    try {
      await kvDel(`${KV_PENDING_RECONCILE_PREFIX}${key}`);
      await kvSRem(KV_PENDING_RECONCILE_SET, key);
    } catch (err) {
      console.error('[TrenchLabs Campaigns] Failed to clear Redis pending counter reconciliation:', err);
      throw err;
    }
    return;
  }
  try {
    const filePath = path.join(PENDING_RECONCILE_DIR, `${key}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('[TrenchLabs Campaigns] Failed to clear file pending counter reconciliation:', err);
    throw err;
  }
}

export async function getPendingCounterReconciliations(
  batchSize = 100
): Promise<Array<{ campaignId: string; submissionId: string; createdAt?: number }>> {
  const safeBatch = Math.max(1, Math.min(batchSize, 500));
  const results: Array<{ campaignId: string; submissionId: string; createdAt?: number }> = [];

  if (isKvActive()) {
    try {
      const members = await kvSMembers(KV_PENDING_RECONCILE_SET);
      const keysToFetch: string[] = [];
      if (Array.isArray(members) && members.length > 0) {
        for (const m of members.slice(0, safeBatch)) {
          keysToFetch.push(`${KV_PENDING_RECONCILE_PREFIX}${m}`);
        }
      }

      if (keysToFetch.length < safeBatch) {
        let cursor = '0';
        do {
          const [nextCursor, scanned] = await kvScan(cursor, `${KV_PENDING_RECONCILE_PREFIX}*`, safeBatch);
          for (const k of scanned) {
            if (!keysToFetch.includes(k)) {
              keysToFetch.push(k);
              if (keysToFetch.length >= safeBatch) break;
            }
          }
          cursor = nextCursor;
        } while (cursor !== '0' && keysToFetch.length < safeBatch);
      }

      for (const k of keysToFetch) {
        try {
          const raw = await kvGet(k);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (
              typeof parsed?.campaignId === 'string' &&
              typeof parsed?.submissionId === 'string' &&
              parsed.campaignId.length > 0 &&
              parsed.submissionId.length > 0
            ) {
              results.push({
                campaignId: parsed.campaignId,
                submissionId: parsed.submissionId,
                createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
              });
            }
          }
        } catch (fetchErr) {
          console.error(`[TrenchLabs Campaigns] Error fetching pending counter record ${k}:`, fetchErr);
        }
      }
      return results;
    } catch (kvErr) {
      console.error('[TrenchLabs Campaigns] Redis error reading pending counter reconciliations:', kvErr);
      throw kvErr;
    }
  }

  if (!fs.existsSync(PENDING_RECONCILE_DIR)) return [];
  try {
    const files = fs.readdirSync(PENDING_RECONCILE_DIR);
    for (const f of files.slice(0, safeBatch)) {
      if (f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(PENDING_RECONCILE_DIR, f), 'utf8');
          const parsed = JSON.parse(raw);
          if (
            typeof parsed?.campaignId === 'string' &&
            typeof parsed?.submissionId === 'string' &&
            parsed.campaignId.length > 0 &&
            parsed.submissionId.length > 0
          ) {
            results.push({
              campaignId: parsed.campaignId,
              submissionId: parsed.submissionId,
              createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
            });
          }
        } catch (readErr) {
          console.error(`[TrenchLabs Campaigns] Corrupt pending counter file ${f}:`, readErr);
        }
      }
    }
    return results;
  } catch (dirErr) {
    console.error('[TrenchLabs Campaigns] Error reading pending counter directory:', dirErr);
    return [];
  }
}

export async function reconcileAllPendingCampaignCounters(batchSize = 100): Promise<{
  attempted: number;
  reconciled: number;
  failed: number;
  errors: Array<{ campaignId: string; submissionId: string; error: string }>;
}> {
  const pending = await getPendingCounterReconciliations(batchSize);
  let reconciled = 0;
  let failed = 0;
  const errors: Array<{ campaignId: string; submissionId: string; error: string }> = [];

  for (const item of pending) {
    try {
      const res = await reconcileCampaignSubmission(item.campaignId, item.submissionId);
      if (res.ok) {
        await clearCampaignCounterPendingReconciliation(item.campaignId, item.submissionId);
        reconciled += 1;
      } else {
        failed += 1;
        const errMsg = res.error || 'Reconciliation failed';
        errors.push({ campaignId: item.campaignId, submissionId: item.submissionId, error: errMsg });
        console.error(
          `[TrenchLabs Counter Recovery] Reconciliation failed for camp=${item.campaignId} sub=${item.submissionId}: ${errMsg}`
        );
      }
    } catch (itemErr) {
      failed += 1;
      const errMsg = (itemErr as Error).message || 'Reconciliation error';
      errors.push({ campaignId: item.campaignId, submissionId: item.submissionId, error: errMsg });
      console.error(
        `[TrenchLabs Counter Recovery] Exception reconciling camp=${item.campaignId} sub=${item.submissionId}:`,
        itemErr
      );
    }
  }

  return { attempted: pending.length, reconciled, failed, errors };
}

export async function getPendingSubmissionReservations(
  batchSize = 50
): Promise<SubmissionReservationRecord[]> {
  const safeBatch = Math.max(1, Math.min(batchSize, 200));
  const results: SubmissionReservationRecord[] = [];

  if (isKvActive()) {
    try {
      const members = await kvSMembers(KV_SUBMISSION_RESERVATION_SET);
      if (Array.isArray(members)) {
        for (const challengeId of members) {
          const res = await getSubmissionReservation(challengeId);
          if (res && res.state !== 'COMPLETED') {
            results.push(res);
            if (results.length >= safeBatch) break;
          }
        }
      }
      return results;
    } catch (kvErr) {
      console.error('[TrenchLabs Campaigns] Redis error reading pending reservations:', kvErr);
      throw kvErr;
    }
  }

  if (!fs.existsSync(SUBMISSION_RESERVATIONS_DIR)) return [];
  try {
    const files = fs.readdirSync(SUBMISSION_RESERVATIONS_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(path.join(SUBMISSION_RESERVATIONS_DIR, f), 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed?.state && parsed?.challengeId && parsed.state !== 'COMPLETED') {
            results.push(parsed as SubmissionReservationRecord);
            if (results.length >= safeBatch) break;
          }
        } catch {}
      }
    }
  } catch {}
  return results;
}

export async function recoverSubmissionReservation(
  challengeId: string
): Promise<{ ok: boolean; submission?: CampaignSubmission; status: string; error?: string }> {
  if (!challengeId) return { ok: false, status: 'INVALID_ARGUMENT', error: 'challengeId is required' };

  return withCampaignsLock(async () => {
    const reservation = await getSubmissionReservation(challengeId);
    if (!reservation) {
      return { ok: false, status: 'NOT_FOUND', error: 'Reservation not found' };
    }

    const submissions = await loadSubmissions();
    const durableSub = submissions.find(
      (s) =>
        s.id === reservation.submissionId ||
        s.challengeId === challengeId ||
        (s.idempotencyKey && s.idempotencyKey === reservation.idempotencyKey)
    );

    // If already in COMPLETED or PERSISTED state:
    if (reservation.state === 'COMPLETED' || reservation.state === 'PERSISTED') {
      if (!durableSub) {
        // Recovery must persist the staged payload to authoritative storage
        const payload = reservation.submissionPayload;
        if (!payload) {
          return { ok: false, status: 'CORRUPTED', error: 'Reservation missing submission payload' };
        }
        submissions.unshift(payload);
        const saveRes = await saveSubmissions(submissions);
        if (!saveRes.success) {
          await updateSubmissionReservationState(challengeId, 'RETRYABLE', {
            expectedState: reservation.state,
            submissionId: reservation.submissionId,
            attemptId: reservation.attemptId,
            fencingGeneration: reservation.fencingGeneration,
            error: saveRes.error,
          });
          return { ok: false, status: 'RETRYABLE', error: saveRes.error };
        }

        // Re-read canonical submissions to verify durable persistence
        const reloaded = await loadSubmissions();
        const verified = reloaded.find((s) => s.id === payload.id);
        if (!verified) {
          return { ok: false, status: 'STORAGE_VERIFICATION_FAILED', error: 'Failed to verify durable submission' };
        }

        await reconcileCampaignSubmission(reservation.campaignId, verified.id);
        await updateSubmissionReservationState(challengeId, 'COMPLETED', {
          submissionId: reservation.submissionId,
          attemptId: reservation.attemptId,
          fencingGeneration: reservation.fencingGeneration,
        });
        return { ok: true, submission: verified, status: 'RECOVERED_AND_PERSISTED' };
      }

      await reconcileCampaignSubmission(reservation.campaignId, durableSub.id);
      if (reservation.state === 'PERSISTED') {
        await updateSubmissionReservationState(challengeId, 'COMPLETED', {
          expectedState: 'PERSISTED',
          submissionId: reservation.submissionId,
          attemptId: reservation.attemptId,
          fencingGeneration: reservation.fencingGeneration,
        });
      }
      return { ok: true, submission: durableSub, status: 'COMPLETED' };
    }

    // Reservation is RESERVED or RETRYABLE:
    if (durableSub) {
      await updateSubmissionReservationState(challengeId, 'COMPLETED', {
        submissionId: reservation.submissionId,
        attemptId: reservation.attemptId,
        fencingGeneration: reservation.fencingGeneration,
      });
      await reconcileCampaignSubmission(reservation.campaignId, durableSub.id);
      return { ok: true, submission: durableSub, status: 'RECOVERED_PERSISTED' };
    }

    // It was NOT persisted yet: resume persistence from payload
    const payload = reservation.submissionPayload;
    if (!payload) {
      return { ok: false, status: 'CORRUPTED', error: 'Reservation missing submission payload' };
    }

    submissions.unshift(payload);
    const saveSubRes = await saveSubmissions(submissions);
    if (!saveSubRes.success) {
      await updateSubmissionReservationState(challengeId, 'RETRYABLE', {
        expectedState: reservation.state,
        submissionId: reservation.submissionId,
        attemptId: reservation.attemptId,
        fencingGeneration: reservation.fencingGeneration,
        error: saveSubRes.error,
      });
      return { ok: false, status: 'RETRYABLE', error: saveSubRes.error };
    }

    // Verify canonical persistence by re-reading
    const reloaded = await loadSubmissions();
    const verified = reloaded.find((s) => s.id === payload.id);
    if (!verified) {
      return { ok: false, status: 'STORAGE_VERIFICATION_FAILED', error: 'Failed to verify durable submission' };
    }

    await updateSubmissionReservationState(challengeId, 'PERSISTED', {
      expectedState: reservation.state,
      submissionId: reservation.submissionId,
      attemptId: reservation.attemptId,
      fencingGeneration: reservation.fencingGeneration,
    });

    const reconRes = await reconcileCampaignSubmission(reservation.campaignId, verified.id);
    if (reconRes.ok) {
      await updateSubmissionReservationState(challengeId, 'COMPLETED', {
        expectedState: 'PERSISTED',
        submissionId: reservation.submissionId,
        attemptId: reservation.attemptId,
        fencingGeneration: reservation.fencingGeneration,
      });
    }

    return { ok: true, submission: verified, status: 'RECOVERED_AND_PERSISTED' };
  });
}

export type ReconcileCampaignResult =
  | { ok: true; status: 'RECONCILED'; campaignId: string; submissionId: string; submissionsCount: number }
  | { ok: true; status: 'ALREADY_RECONCILED'; campaignId: string; submissionId: string; submissionsCount: number }
  | { ok: false; status: 'SUBMISSION_NOT_FOUND'; campaignId: string; submissionId: string; error: string }
  | { ok: false; status: 'CAMPAIGN_NOT_FOUND'; campaignId: string; submissionId: string; error: string }
  | { ok: false; status: 'CAMPAIGN_MISMATCH'; campaignId: string; submissionId: string; error: string }
  | { ok: false; status: 'STORAGE_ERROR'; campaignId: string; submissionId: string; error: string };

export async function reconcileCampaignSubmission(
  campaignId: string,
  submissionId: string
): Promise<ReconcileCampaignResult> {
  if (!campaignId || !submissionId) {
    return {
      ok: false,
      status: 'SUBMISSION_NOT_FOUND',
      campaignId: campaignId || '',
      submissionId: submissionId || '',
      error: 'campaignId and submissionId are required',
    };
  }

  return withCampaignsLock(async () => {
    try {
      const submissions = await loadSubmissions();
      const sub = submissions.find((s) => s.id === submissionId);
      if (!sub) {
        return {
          ok: false,
          status: 'SUBMISSION_NOT_FOUND',
          campaignId,
          submissionId,
          error: `Submission ${submissionId} not found`,
        };
      }

      if (sub.campaignId !== campaignId) {
        return {
          ok: false,
          status: 'CAMPAIGN_MISMATCH',
          campaignId,
          submissionId,
          error: `Submission ${submissionId} belongs to campaign ${sub.campaignId}, not ${campaignId}`,
        };
      }

      const campaigns = await loadCampaigns();
      const campaign = campaigns.find((c) => c.id === campaignId);
      if (!campaign) {
        return {
          ok: false,
          status: 'CAMPAIGN_NOT_FOUND',
          campaignId,
          submissionId,
          error: `Campaign ${campaignId} not found`,
        };
      }

      // Recalculate unique submissions strictly by deduplicating by id, challengeId, and walletAddress
      const matchingSubs = submissions.filter((s) => s.campaignId === campaignId);
      const seenIds = new Set<string>();
      const seenChallenges = new Set<string>();
      const seenWallets = new Set<string>();
      const uniqueSubs: CampaignSubmission[] = [];

      for (const s of matchingSubs) {
        const walletKey = (s.walletAddress || '').toLowerCase();
        if (s.id && seenIds.has(s.id)) continue;
        if (s.challengeId && seenChallenges.has(s.challengeId)) continue;
        if (walletKey && seenWallets.has(walletKey)) continue;

        if (s.id) seenIds.add(s.id);
        if (s.challengeId) seenChallenges.add(s.challengeId);
        if (walletKey) seenWallets.add(walletKey);
        uniqueSubs.push(s);
      }

      const expectedCount = uniqueSubs.length;
      const currentCount = campaign.submissionsCount || 0;

      if (currentCount !== expectedCount) {
        campaign.submissionsCount = expectedCount;
        const saveRes = await saveCampaigns(campaigns);
        if (!saveRes.success) {
          await markCampaignCounterPendingReconciliation(campaignId, submissionId);
          return {
            ok: false,
            status: 'STORAGE_ERROR',
            campaignId,
            submissionId,
            error: saveRes.error || 'Failed to save updated campaign counter',
          };
        }

        // Re-read canonical campaigns to verify counter persistence
        const reloadedCampaigns = await loadCampaigns();
        const reloaded = reloadedCampaigns.find((c) => c.id === campaignId);
        if (!reloaded || reloaded.submissionsCount !== expectedCount) {
          await markCampaignCounterPendingReconciliation(campaignId, submissionId);
          return {
            ok: false,
            status: 'STORAGE_ERROR',
            campaignId,
            submissionId,
            error: 'Failed to verify durable campaign counter update',
          };
        }

        await clearCampaignCounterPendingReconciliation(campaignId, submissionId);
        return {
          ok: true,
          status: 'RECONCILED',
          campaignId,
          submissionId,
          submissionsCount: expectedCount,
        };
      }

      await clearCampaignCounterPendingReconciliation(campaignId, submissionId);
      return {
        ok: true,
        status: 'ALREADY_RECONCILED',
        campaignId,
        submissionId,
        submissionsCount: currentCount,
      };
    } catch (err) {
      await markCampaignCounterPendingReconciliation(campaignId, submissionId);
      return {
        ok: false,
        status: 'STORAGE_ERROR',
        campaignId,
        submissionId,
        error: (err as Error).message || 'Persistence unavailable',
      };
    }
  });
}

export async function submitCampaignCompletion(payload: {
  campaignId: string;
  walletAddress: string;
  xHandle: string;
  xRetweetLink: string;
  challengeId?: string;
  idempotencyKey?: string;
}): Promise<{ ok: boolean; submission?: CampaignSubmission; error?: string; isExisting?: boolean }> {
  return withCampaignsLock(async () => {
    const campaigns = await loadCampaigns();
    const campaign = campaigns.find((c) => c.id === payload.campaignId);
    if (!campaign) {
      return { ok: false, error: 'Campaign not found' };
    }
    if (campaign.status === 'PAUSED') {
      return { ok: false, error: 'This campaign is currently paused' };
    }
    if (campaign.status !== 'ACTIVE') {
      return { ok: false, error: 'This campaign is no longer active' };
    }
    if (campaign.expiresAt && new Date(campaign.expiresAt).getTime() <= Date.now()) {
      return { ok: false, error: 'This campaign has expired' };
    }

    const cleanWallet = payload.walletAddress.trim();
    if (!isValidSolanaAddress(cleanWallet)) {
      return { ok: false, error: 'Invalid Solana wallet address' };
    }

    const cleanHandle = normalizeXHandle(payload.xHandle);
    if (!cleanHandle || cleanHandle.length < 2) {
      return { ok: false, error: 'Invalid X handle' };
    }

    const cleanRetweetUrl = payload.xRetweetLink.trim();
    if (!isValidXUrl(cleanRetweetUrl)) {
      return { ok: false, error: 'Invalid X / Twitter retweet URL. Must be a valid link on x.com or twitter.com.' };
    }

    const submissions = await loadSubmissions();

    // 1. Durable Idempotency Check via Authoritative Submissions & Reservations
    const idempotencyKey =
      payload.idempotencyKey || (payload.challengeId ? `raid-submission:${payload.challengeId}` : undefined);

    let existingReservation: SubmissionReservationRecord | null = null;
    if (payload.challengeId) {
      existingReservation = await getSubmissionReservation(payload.challengeId);
    }

    if (existingReservation) {
      if (existingReservation.state === 'COMPLETED' || existingReservation.state === 'PERSISTED') {
        let authSub = submissions.find((s) => s.id === existingReservation!.submissionId);
        if (!authSub) {
          authSub = existingReservation.submissionPayload;
          submissions.unshift(authSub);
          await saveSubmissions(submissions);
        }
        if (existingReservation.state === 'PERSISTED') {
          await updateSubmissionReservationState(payload.challengeId!, 'COMPLETED');
        }
        await reconcileCampaignSubmission(payload.campaignId, authSub.id);
        return { ok: true, submission: authSub, isExisting: true };
      }

      // Reservation is in RESERVED or RETRYABLE state
      const authSub = submissions.find((s) => s.id === existingReservation!.submissionId);
      if (authSub) {
        await updateSubmissionReservationState(payload.challengeId!, 'COMPLETED');
        await reconcileCampaignSubmission(payload.campaignId, authSub.id);
        return { ok: true, submission: authSub, isExisting: true };
      }
    }

    const existingInSubmissions = submissions.find(
      (s) =>
        (payload.challengeId && s.challengeId === payload.challengeId) ||
        (idempotencyKey && s.idempotencyKey === idempotencyKey)
    );
    if (existingInSubmissions) {
      if (payload.challengeId) {
        await updateSubmissionReservationState(payload.challengeId, 'COMPLETED');
      }
      await reconcileCampaignSubmission(payload.campaignId, existingInSubmissions.id);
      return { ok: true, submission: existingInSubmissions, isExisting: true };
    }

    // 2. Check for duplicate submission by this wallet on this campaign (with a different challenge)
    const existingByWallet = submissions.find(
      (s) => s.campaignId === payload.campaignId && s.walletAddress.toLowerCase() === cleanWallet.toLowerCase()
    );
    if (existingByWallet) {
      return { ok: false, error: 'This wallet has already submitted proof for this campaign' };
    }

    const submissionId = existingReservation
      ? existingReservation.submissionId
      : `sub-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const newSubmission: CampaignSubmission = {
      id: submissionId,
      campaignId: payload.campaignId,
      walletAddress: cleanWallet,
      xHandle: cleanHandle,
      xRetweetLink: cleanRetweetUrl,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
      challengeId: payload.challengeId,
      idempotencyKey,
    };

    // 3. Acquire reservation in RESERVED state
    if (payload.challengeId && !existingReservation) {
      const reservationRecord: SubmissionReservationRecord = {
        challengeId: payload.challengeId,
        campaignId: payload.campaignId,
        walletAddress: cleanWallet,
        submissionId: newSubmission.id,
        idempotencyKey: idempotencyKey || `raid-submission:${payload.challengeId}`,
        state: 'RESERVED',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attemptId: crypto.randomUUID(),
        fencingGeneration: 1,
        submissionPayload: newSubmission,
      };

      if (isKvActive()) {
        const resKey = `${KV_SUBMISSION_RESERVATION_PREFIX}${payload.challengeId}`;
        const reserveRes = await kvReserveSubmissionChallenge(
          resKey,
          JSON.stringify(reservationRecord),
          604800,
          KV_SUBMISSION_RESERVATION_SET,
          payload.challengeId
        );
        if (!reserveRes.created) {
          const winning = await getSubmissionReservation(payload.challengeId);
          if (winning) {
            if (winning.state === 'COMPLETED' || winning.state === 'PERSISTED') {
              let sub = submissions.find((s) => s.id === winning.submissionId);
              if (!sub && winning.submissionPayload) {
                // Perform controlled recovery: save and verify
                submissions.unshift(winning.submissionPayload);
                const recoverySave = await saveSubmissions(submissions);
                if (recoverySave.success) {
                  const reloaded = await loadSubmissions();
                  sub = reloaded.find((s) => s.id === winning.submissionPayload.id);
                }
              }
              if (sub) {
                await reconcileCampaignSubmission(payload.campaignId, sub.id);
                return { ok: true, submission: sub, isExisting: true };
              }
            }
            const sub = submissions.find((s) => s.id === winning.submissionId);
            if (sub) {
              await updateSubmissionReservationState(payload.challengeId, 'COMPLETED');
              await reconcileCampaignSubmission(payload.campaignId, sub.id);
              return { ok: true, submission: sub, isExisting: true };
            }
          }
        }
      } else {
        try {
          fs.mkdirSync(SUBMISSION_RESERVATIONS_DIR, { recursive: true });
          fs.mkdirSync(SUBMISSIONS_BY_CHALLENGE_DIR, { recursive: true });
          const resPath = path.join(SUBMISSION_RESERVATIONS_DIR, `${payload.challengeId}.json`);
          const singleFd = fs.openSync(resPath, 'wx');
          fs.writeSync(singleFd, JSON.stringify(reservationRecord, null, 2), 0, 'utf8');
          fs.fsyncSync(singleFd);
          fs.closeSync(singleFd);

          const legPath = path.join(SUBMISSIONS_BY_CHALLENGE_DIR, `${payload.challengeId}.json`);
          try {
            fs.writeFileSync(legPath, JSON.stringify(reservationRecord, null, 2), 'utf8');
          } catch {}
        } catch (err: unknown) {
          const errCode = (err as NodeJS.ErrnoException).code;
          if (errCode === 'EEXIST' || errCode === 'EPERM' || errCode === 'EACCES') {
            const winning = await getSubmissionReservation(payload.challengeId);
            if (winning) {
              if (winning.state === 'COMPLETED' || winning.state === 'PERSISTED') {
                let sub = submissions.find((s) => s.id === winning.submissionId);
                if (!sub && winning.submissionPayload) {
                  // Perform controlled recovery: save and verify
                  submissions.unshift(winning.submissionPayload);
                  const recoverySave = await saveSubmissions(submissions);
                  if (recoverySave.success) {
                    const reloaded = await loadSubmissions();
                    sub = reloaded.find((s) => s.id === winning.submissionPayload.id);
                  }
                }
                if (sub) {
                  await reconcileCampaignSubmission(payload.campaignId, sub.id);
                  return { ok: true, submission: sub, isExisting: true };
                }
              }
              const sub = submissions.find((s) => s.id === winning.submissionId);
              if (sub) {
                await updateSubmissionReservationState(payload.challengeId, 'COMPLETED');
                await reconcileCampaignSubmission(payload.campaignId, sub.id);
                return { ok: true, submission: sub, isExisting: true };
              }
            }
          }
        }
      }
    }

    // 4. Inject simulated test failure if active
    if (_testFailNextSaveSubmissions) {
      const err = _testFailNextSaveSubmissions;
      _testFailNextSaveSubmissions = null;
      if (payload.challengeId) {
        await updateSubmissionReservationState(payload.challengeId, 'RETRYABLE', { error: err.message });
      }
      throw err;
    }

    // 5. Persist to authoritative submissions collection
    submissions.unshift(newSubmission);
    const saveSubRes = await saveSubmissions(submissions);
    if (!saveSubRes.success) {
      if (payload.challengeId) {
        await updateSubmissionReservationState(payload.challengeId, 'RETRYABLE', { error: saveSubRes.error });
      }
      throw new Error(saveSubRes.error || 'Failed to persist submission');
    }

    // 6. Advance reservation to PERSISTED
    if (payload.challengeId) {
      await updateSubmissionReservationState(payload.challengeId, 'PERSISTED');
    }

    // 7. Inject simulated test failure on campaign counter update if active
    if (_testFailSaveCampaignsPersistent) {
      throw _testFailSaveCampaignsPersistent;
    }
    if (_testFailNextSaveCampaigns) {
      const err = _testFailNextSaveCampaigns;
      _testFailNextSaveCampaigns = null;
      throw err;
    }

    // 8. Update submission count on campaign
    campaign.submissionsCount = (campaign.submissionsCount || 0) + 1;
    const saveCampRes = await saveCampaigns(campaigns);
    if (!saveCampRes.success) {
      console.warn('[TrenchLabs Campaigns] Failed to update campaign counter, submission is durable:', saveCampRes.error);
      if (payload.challengeId) {
        await markCampaignCounterPendingReconciliation(payload.campaignId, newSubmission.id);
        await updateSubmissionReservationState(payload.challengeId, 'PERSISTED', {
          metadata: { counterStatus: 'PENDING_RECONCILIATION' },
        });
      }
    } else {
      if (payload.challengeId) {
        await updateSubmissionReservationState(payload.challengeId, 'COMPLETED');
      }
    }

    return { ok: true, submission: newSubmission, isExisting: false };
  });
}

export async function getSubmissionsForCampaign(campaignId: string): Promise<CampaignSubmission[]> {
  const submissions = await loadSubmissions();
  return submissions.filter((s) => s.campaignId === campaignId);
}

export async function markSubmissionStatus(
  submissionId: string,
  status: SubmissionStatus,
  airdropTx?: string
): Promise<{ ok: boolean; error?: string }> {
  return withCampaignsLock(async () => {
    const submissions = await loadSubmissions();
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return { ok: false, error: 'Submission not found' };

    sub.status = status;
    if (status === 'AIRDROPPED') {
      sub.airdroppedAt = new Date().toISOString();
      if (airdropTx) sub.airdropTx = airdropTx.trim();
    } else {
      sub.airdroppedAt = null;
      sub.airdropTx = null;
    }

    await saveSubmissions(submissions);

    // Recompute counts on campaign
    const campaigns = await loadCampaigns();
    const campaign = campaigns.find((c) => c.id === sub.campaignId);
    if (campaign) {
      const campSubs = submissions.filter((s) => s.campaignId === campaign.id);
      campaign.submissionsCount = campSubs.length;
      campaign.airdroppedCount = campSubs.filter((s) => s.status === 'AIRDROPPED').length;
      await saveCampaigns(campaigns);
    }

    return { ok: true };
  });
}

export async function getCampaignsWithUserStatus(walletAddress?: string | null): Promise<Campaign[]> {
  const campaigns = await loadCampaigns();
  const submissions = await loadSubmissions();

  return campaigns.map((c) => {
    const campSubs = submissions.filter((s) => s.campaignId === c.id);
    const submissionsCount = campSubs.length;
    const airdroppedCount = campSubs.filter((s) => s.status === 'AIRDROPPED').length;

    let userSubmission: CampaignSubmission | null = null;
    if (walletAddress) {
      const found = campSubs.find((s) => s.walletAddress.toLowerCase() === walletAddress.toLowerCase());
      if (found) userSubmission = found;
    }

    return {
      ...c,
      submissionsCount,
      airdroppedCount,
      userSubmission,
    };
  });
}

