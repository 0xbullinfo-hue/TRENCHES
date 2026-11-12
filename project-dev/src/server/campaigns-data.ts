import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { KV_CONFIGURED, isKvConfigured, kvGet, kvSet, kvLock, kvUnlock } from '@/server/kv';
import { ADMIN_WALLET } from '@/lib/config';
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

export function withCampaignsLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = campaignsLockChain.then(async () => {
    if (!isKvActive()) {
      if (!FILE_PERSISTENCE_ALLOWED) {
        throw new Error('Persistence not configured. Set ALLOW_FILE_PERSISTENCE=true or KV credentials.');
      }
      return fn();
    }
    const token = crypto.randomUUID();
    let acquired = false;
    for (let i = 0; i < 20 && !acquired; i++) {
      acquired = await kvLock(KV_LOCK_KEY, token, 30);
      if (!acquired) await sleep(150);
    }
    if (!acquired) throw new Error('Campaigns store busy, retry shortly');
    try {
      return await fn();
    } finally {
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
  try {
    if (isKvActive()) {
      await kvSet(KV_CAMPAIGNS_KEY, JSON.stringify(campaigns));
      return { success: true };
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
  try {
    if (isKvActive()) {
      await kvSet(KV_SUBMISSIONS_KEY, JSON.stringify(submissions));
      return { success: true };
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

export async function submitCampaignCompletion(payload: {
  campaignId: string;
  walletAddress: string;
  xHandle: string;
  xRetweetLink: string;
}): Promise<{ ok: boolean; submission?: CampaignSubmission; error?: string }> {
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

    // Check for duplicate submission by this wallet on this campaign
    const existing = submissions.find(
      (s) => s.campaignId === payload.campaignId && s.walletAddress.toLowerCase() === cleanWallet.toLowerCase()
    );
    if (existing) {
      return { ok: false, error: 'This wallet has already submitted proof for this campaign' };
    }

    const newSubmission: CampaignSubmission = {
      id: `sub-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      campaignId: payload.campaignId,
      walletAddress: cleanWallet,
      xHandle: cleanHandle,
      xRetweetLink: cleanRetweetUrl,
      status: 'PENDING',
      submittedAt: new Date().toISOString(),
    };

    submissions.unshift(newSubmission);
    await saveSubmissions(submissions);

    // Update submission count on campaign
    campaign.submissionsCount = (campaign.submissionsCount || 0) + 1;
    await saveCampaigns(campaigns);

    return { ok: true, submission: newSubmission };
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

