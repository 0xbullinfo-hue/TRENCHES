import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { KV_CONFIGURED, kvGet, kvSet, kvLock, kvUnlock } from '@/server/kv';
import { readGenesisBalanceCached } from '@/server/genesis';
import { ADMIN_WALLET, isAdminWallet, TOKEN_DECIMALS, TOKEN_SYMBOL } from '@/lib/config';
import { getGenesisPrice } from '@/server/price';
import { DEFAULT_GENESIS_USD_PRICE } from '@/lib/tiers';

export { TOKEN_DECIMALS, TOKEN_SYMBOL };

export interface TierThresholdRow {
  id: string; // uuid pk
  tier: 'member' | 'pro';
  usd_target: number;
  token_amount: string; // raw u64 as decimal string
  twap_price_usd: number;
  valid_from: string; // timestamptz ISO
  valid_until: string; // timestamptz ISO
  created_at: string; // timestamptz ISO
}

export interface StakeRow {
  id: string; // uuid pk
  wallet_address: string;
  amount_raw: string; // raw u64 as decimal string
  staked_at: string; // timestamptz ISO
  unlocks_at: string; // timestamptz ISO
  status: 'active' | 'expired' | 'withdrawn';
  tx_signature: string | null; // unique
  staking_provider: string; // default 'stakepoint'
}

export interface VerificationSessionRow {
  session_id: string; // 12-char base62 random pk
  wallet_address: string;
  tier: 'member' | 'pro';
  created_at: string; // timestamptz ISO
  expires_at: string; // timestamptz ISO (created_at + 10 min)
  used_at: string | null;
  telegram_user_id: number | null;
}

export interface TelegramMemberRow {
  wallet_address: string; // pk
  telegram_user_id: number | null;
  tier: 'member' | 'pro';
  in_group: boolean;
  last_synced_at: string; // timestamptz ISO
}

export type LedgerVerificationStatus = 'REPORTED' | 'EVIDENCE_SUPPLIED' | 'ONCHAIN_VERIFIED';

export interface LedgerEntryRow {
  id: string; // uuid primary key
  ticker: string; // text not null
  chain: string; // text not null ('solana' | 'ethereum' | 'base' | 'bsc' | 'other')
  contract_address: string; // text not null
  multiplier: string; // numeric(10,4) string, e.g. "3.4000"
  entry_price?: string | null;
  exit_price?: string | null;
  proof_url?: string | null;
  verification_status?: LedgerVerificationStatus;
  notes?: string | null;
  closed_at: string; // timestamptz ISO
  posted_by: string; // admin wallet address
  posted_at: string; // timestamptz ISO default now()
  updated_at?: string | null; // timestamptz
}

export interface LedgerEntryWithEdited extends LedgerEntryRow {
  edited: boolean;
  verification_status: LedgerVerificationStatus;
}

export interface AuditLogRow {
  id: string;
  action: string;
  wallet_address?: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface RaidChallengeRow {
  challenge_id: string;
  nonce: string;
  campaign_id: string;
  wallet_address: string;
  created_at: string;
  expires_at: string;
  message: string;
  consumed_at: string | null;
  authority?: 'redis' | 'db';
  status?: 'ACTIVE' | 'PROCESSING' | 'COMPLETED';
  attempt_id?: string | null;
  fencing_token?: number | null;
  processing_started_at?: string | null;
  processing_lease_expires_at?: string | null;
  submission_id?: string | null;
  idempotency_key?: string | null;
}

interface TrenchDatabaseSchema {
  tier_thresholds: TierThresholdRow[];
  stakes: StakeRow[];
  verification_sessions: VerificationSessionRow[];
  telegram_members: TelegramMemberRow[];
  ledger_entries: LedgerEntryRow[];
  audit_logs: AuditLogRow[];
  raid_challenges?: RaidChallengeRow[];
}

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'db.json');

/** Local-file persistence is only safe in dev or on a single persistent server (ALLOW_FILE_PERSISTENCE=true). */
const FILE_PERSISTENCE_ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.ALLOW_FILE_PERSISTENCE === 'true';

function assertPersistence(): void {
  if (!KV_CONFIGURED && !FILE_PERSISTENCE_ALLOWED) {
    throw new Error(
      'Persistence not configured. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN (or ALLOW_FILE_PERSISTENCE=true on a single persistent server).'
    );
  }
}

const DB_KV_KEY = 'trench:db:tables';
const DB_LOCK_KEY = 'trench:lock:db';

function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Placeholder TWAP price until weekly TWAP cron is integrated */
export const PLACEHOLDER_TWAP_PRICE = 0.0000164;

export function getNextMondayUtc(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 is Sunday, 1 is Monday
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilNextMonday);
  return d.toISOString();
}

export function computeRawTokenAmount(usdTarget: number, twapPrice: number, decimals = TOKEN_DECIMALS): string {
  const tokens = usdTarget / twapPrice;
  const rawBigInt = BigInt(Math.floor(tokens * Math.pow(10, decimals)));
  return rawBigInt.toString();
}

function buildInitialSeed(): TrenchDatabaseSchema {
  const now = new Date().toISOString();
  const validUntil = getNextMondayUtc();

  const memberRaw = computeRawTokenAmount(20, PLACEHOLDER_TWAP_PRICE, TOKEN_DECIMALS);
  const proRaw = computeRawTokenAmount(250, PLACEHOLDER_TWAP_PRICE, TOKEN_DECIMALS);

  return {
    tier_thresholds: [
      {
        id: safeRandomUUID(),
        tier: 'member',
        usd_target: 20,
        token_amount: memberRaw,
        twap_price_usd: PLACEHOLDER_TWAP_PRICE,
        valid_from: now,
        valid_until: validUntil,
        created_at: now,
      },
      {
        id: safeRandomUUID(),
        tier: 'pro',
        usd_target: 250,
        token_amount: proRaw,
        twap_price_usd: PLACEHOLDER_TWAP_PRICE,
        valid_from: now,
        valid_until: validUntil,
        created_at: now,
      },
    ],
    stakes: [],
    verification_sessions: [],
    telegram_members: [],
    ledger_entries: [],
    audit_logs: [],
    raid_challenges: [],
  };
}

let inMemoryDb: TrenchDatabaseSchema = buildInitialSeed();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dbLockChain = Promise.resolve();

export const DB_FILE_LOCK_PATH = path.join(process.cwd(), 'data', 'db.lock');

let _testFailNextLockMetadataWrite = false;
let _testFailNextLockMetadataVerify = false;

export function __setTestFailLockMetadataWrite(val: boolean) {
  _testFailNextLockMetadataWrite = val;
}

export function __setTestFailLockMetadataVerify(val: boolean) {
  _testFailNextLockMetadataVerify = val;
}

export function isPidDead(pid: number): boolean {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return false; // Process exists in OS process table
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH'; // Definitively dead / terminated
  }
}

/**
 * Hardened file lock acquisition with metadata integrity and race-safe recovery.
 *
 * Supported deployment model:
 * - Local dev / single-node host: Cross-process mutual exclusion via atomic kernel open ('wx')
 *   with verification and race-safe dead PID recovery.
 * - Multi-instance / serverless production: Backed by shared Upstash Redis distributed lock
 *   (withRegistryLock / kvAcquireLock with token ownership and lease renewals).
 */
export async function acquireFileLock(): Promise<() => void> {
  const maxWaitMs = 5000;
  const start = Date.now();
  const lockToken = safeRandomUUID();

  while (Date.now() - start < maxWaitMs) {
    try {
      const dataDir = path.dirname(DB_FILE_LOCK_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 1. 'wx' opens for writing exclusively, failing if path already exists (atomic OS kernel lock)
      const fd = fs.openSync(DB_FILE_LOCK_PATH, 'wx');
      try {
        if (_testFailNextLockMetadataWrite) {
          _testFailNextLockMetadataWrite = false;
          throw new Error('Simulated lock metadata write failure');
        }

        const metadata = JSON.stringify({ pid: process.pid, token: lockToken, createdAt: Date.now() });
        const bytes = fs.writeSync(fd, metadata);
        if (bytes === 0) {
          throw new Error('Lock metadata write failed: 0 bytes written');
        }
        fs.fsyncSync(fd);

        if (_testFailNextLockMetadataVerify) {
          _testFailNextLockMetadataVerify = false;
          throw new Error('Simulated lock metadata verification failure');
        }

        // Verify metadata immediately by reading back from disk
        const verifyRaw = fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8');
        const verifyData = JSON.parse(verifyRaw);
        if (verifyData?.token !== lockToken) {
          throw new Error('Lock metadata verification failed: token mismatch');
        }
      } catch (metaErr) {
        // Acquisition integrity: never silently swallow metadata failures
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          if (fs.existsSync(DB_FILE_LOCK_PATH)) {
            const raw = fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8');
            if (raw.includes(lockToken)) {
              fs.unlinkSync(DB_FILE_LOCK_PATH);
            }
          }
        } catch {}
        throw metaErr;
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          // Verify ownership before unlinking: never delete another process's lock
          if (fs.existsSync(DB_FILE_LOCK_PATH)) {
            const raw = fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8');
            try {
              const data = JSON.parse(raw);
              if (data?.token === lockToken) {
                fs.unlinkSync(DB_FILE_LOCK_PATH);
              }
            } catch {
              if (raw.includes(lockToken)) {
                fs.unlinkSync(DB_FILE_LOCK_PATH);
              }
            }
          }
        } catch {}
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // 2. Race-Safe Stale Lock Recovery:
        // Do NOT blindly read PID and unlink: another process might acquire immediately after,
        // which would cause an unsafe deletion of a replacement lock.
        // Instead, open with 'r+', check that the PID is dead, and atomically overwrite with new metadata!
        let recoveryFd: number | null = null;
        try {
          if (fs.existsSync(DB_FILE_LOCK_PATH)) {
            recoveryFd = fs.openSync(DB_FILE_LOCK_PATH, 'r+');
            const raw = fs.readFileSync(recoveryFd, 'utf8');
            let data: Record<string, unknown> | null = null;
            try {
              data = JSON.parse(raw);
            } catch {}

            if (data && typeof data.pid === 'number' && isPidDead(data.pid)) {
              // The holding process crashed or terminated (ESRCH).
              // Atomically overwrite using the open file descriptor to take over ownership safely.
              const recoveryToken = safeRandomUUID();
              const recMeta = JSON.stringify({ pid: process.pid, token: recoveryToken, createdAt: Date.now() });
              fs.ftruncateSync(recoveryFd, 0);
              fs.writeSync(recoveryFd, recMeta, 0, 'utf8');
              fs.fsyncSync(recoveryFd);

              // Verify the recovery write succeeded and token matches
              const checkRaw = fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8');
              const checkData = JSON.parse(checkRaw);
              if (checkData?.token === recoveryToken) {
                let recReleased = false;
                const finalFd = recoveryFd;
                recoveryFd = null; // Hand over to release callback
                return () => {
                  if (recReleased) return;
                  recReleased = true;
                  try {
                    fs.closeSync(finalFd);
                  } catch {}
                  try {
                    if (fs.existsSync(DB_FILE_LOCK_PATH)) {
                      const cur = JSON.parse(fs.readFileSync(DB_FILE_LOCK_PATH, 'utf8'));
                      if (cur?.token === recoveryToken) {
                        fs.unlinkSync(DB_FILE_LOCK_PATH);
                      }
                    }
                  } catch {}
                };
              }
            }
          }
        } catch {
          // If race occurred or file was deleted by owner, continue loop
        } finally {
          if (recoveryFd !== null) {
            try {
              fs.closeSync(recoveryFd);
            } catch {}
          }
        }

        // Active lock held by a live process: wait cooperatively.
        // MANDATORY RULE: Never delete a live process's lock.
        await sleep(20 + Math.floor(Math.random() * 30));
      } else {
        throw err;
      }
    }
  }
  throw new Error('Database file lock acquisition timeout');
}

async function withDbLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = dbLockChain.then(async () => {
    assertPersistence();

    if (KV_CONFIGURED) {
      const token = safeRandomUUID();
      let acquired = false;
      for (let i = 0; i < 20 && !acquired; i++) {
        acquired = await kvLock(DB_LOCK_KEY, token, 30);
        if (!acquired) await sleep(100);
      }
      if (!acquired) throw new Error('Database busy, retry shortly');
      try {
        return await fn();
      } finally {
        await kvUnlock(DB_LOCK_KEY, token).catch(() => undefined);
      }
    }

    // Cross-process OS file lock when Redis is not configured
    const releaseFileLock = await acquireFileLock();
    try {
      return await fn();
    } finally {
      releaseFileLock();
    }
  });

  dbLockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function loadDb(): Promise<TrenchDatabaseSchema> {
  assertPersistence();
  if (KV_CONFIGURED) {
    const raw = await kvGet(DB_KV_KEY);
    if (!raw) {
      const initial = buildInitialSeed();
      await kvSet(DB_KV_KEY, JSON.stringify(initial));
      return initial;
    }
    try {
      const parsed = JSON.parse(raw) as TrenchDatabaseSchema;
      if (!Array.isArray(parsed.ledger_entries)) parsed.ledger_entries = [];
      if (!Array.isArray(parsed.tier_thresholds)) parsed.tier_thresholds = [];
      if (!Array.isArray(parsed.stakes)) parsed.stakes = [];
      if (!Array.isArray(parsed.verification_sessions)) parsed.verification_sessions = [];
      if (!Array.isArray(parsed.telegram_members)) parsed.telegram_members = [];
      if (!Array.isArray(parsed.audit_logs)) parsed.audit_logs = [];
      if (!Array.isArray(parsed.raid_challenges)) parsed.raid_challenges = [];
      return parsed;
    } catch (err) {
      console.error('[TrenchLabs DB] Stored database is unreadable:', err);
      throw new Error('Database unreadable');
    }
  }

  if (fs.existsSync(DATA_FILE_PATH)) {
    const rawContent = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
    if (rawContent && rawContent.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object') {
          if (!Array.isArray(parsed.ledger_entries)) parsed.ledger_entries = [];
          if (!Array.isArray(parsed.tier_thresholds)) parsed.tier_thresholds = [];
          if (!Array.isArray(parsed.stakes)) parsed.stakes = [];
          if (!Array.isArray(parsed.verification_sessions)) parsed.verification_sessions = [];
          if (!Array.isArray(parsed.telegram_members)) parsed.telegram_members = [];
          if (!Array.isArray(parsed.audit_logs)) parsed.audit_logs = [];
          if (!Array.isArray(parsed.raid_challenges)) parsed.raid_challenges = [];
          inMemoryDb = parsed;
          return inMemoryDb;
        }
      } catch (parseErr) {
        console.error('[TrenchLabs DB] Local db.json corrupted or unreadable. Preserving backup:', parseErr);
        const backupPath = `${DATA_FILE_PATH}.corrupted.${Date.now()}`;
        try {
          fs.copyFileSync(DATA_FILE_PATH, backupPath);
          console.error(`[TrenchLabs DB] Preserved corrupted db copy at ${backupPath}`);
        } catch {}
        throw new Error(`Database file is corrupted. Corrupted copy saved to ${backupPath}. Reseed aborted to prevent data loss.`);
      }
    }
  }

  // Seed file
  try {
    fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(inMemoryDb, null, 2), 'utf-8');
  } catch {
    // ignore
  }
  return inMemoryDb;
}

export async function saveDb(db: TrenchDatabaseSchema): Promise<void> {
  assertPersistence();
  inMemoryDb = db;
  if (KV_CONFIGURED) {
    await kvSet(DB_KV_KEY, JSON.stringify(db));
    return;
  }
  try {
    fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
    const tmp = `${DATA_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE_PATH);
  } catch (err) {
    console.error('[TrenchLabs DB] Local save error:', err);
    throw err;
  }
}

// -------------------------------------------------------------
// Database Operations: Tier Thresholds
// -------------------------------------------------------------

export async function getTierThresholds(): Promise<{
  member: TierThresholdRow;
  pro: TierThresholdRow;
  stale: boolean;
  priceSource: string;
}> {
  const priceResult = await getGenesisPrice();
  // DISPLAY ONLY: when every oracle fails we still render the landing/stake pages using the static
  // default, but flag it (stale + priceSource 'unavailable'). Nothing that grants access or accepts a
  // stake may rely on this value (entitlements.ts / stakepoint.ts fail closed on a null price).
  const livePrice =
    priceResult.priceUsd !== null && priceResult.priceUsd > 0
      ? priceResult.priceUsd
      : DEFAULT_GENESIS_USD_PRICE;
  const now = new Date().toISOString();
  const validUntil = getNextMondayUtc();

  const memberRaw = computeRawTokenAmount(20, livePrice, TOKEN_DECIMALS);
  const proRaw = computeRawTokenAmount(250, livePrice, TOKEN_DECIMALS);

  const member: TierThresholdRow = {
    id: 'threshold-member',
    tier: 'member',
    usd_target: 20,
    token_amount: memberRaw,
    twap_price_usd: livePrice,
    valid_from: now,
    valid_until: validUntil,
    created_at: now,
  };

  const pro: TierThresholdRow = {
    id: 'threshold-pro',
    tier: 'pro',
    usd_target: 250,
    token_amount: proRaw,
    twap_price_usd: livePrice,
    valid_from: now,
    valid_until: validUntil,
    created_at: now,
  };

  return { member, pro, stale: !priceResult.isFresh, priceSource: priceResult.source };
}

// -------------------------------------------------------------
// Database Operations: Stakes
// -------------------------------------------------------------

export async function getActiveStakes(walletAddress: string): Promise<StakeRow[]> {
  const db = await loadDb();
  const now = new Date().toISOString();
  return db.stakes.filter(
    (s) => s.wallet_address === walletAddress && s.status === 'active' && s.unlocks_at > now
  );
}

export async function getStakeStatusForWallet(walletAddress: string) {
  const { member, pro, stale, priceSource } = await getTierThresholds();
  const activeStakes = await getActiveStakes(walletAddress);
  const now = Date.now();

  let stakeData: {
    amount_raw: string;
    amount_genesis: number;
    amount_usd: number;
    staked_at: string | null;
    unlocks_at: string | null;
    days_remaining: number;
    status: 'active' | 'expired' | 'none';
  };

  if (activeStakes.length === 0) {
    stakeData = {
      amount_raw: '0',
      amount_genesis: 0,
      amount_usd: 0,
      staked_at: null,
      unlocks_at: null,
      days_remaining: 0,
      status: 'none',
    };
  } else {
    const totalRaw = activeStakes.reduce((acc, s) => acc + BigInt(s.amount_raw), BigInt(0));
    const amountGenesis = Number(totalRaw) / Math.pow(10, TOKEN_DECIMALS);
    const amountUsd = +(amountGenesis * pro.twap_price_usd).toFixed(2);
    const earliestStaked = activeStakes.reduce(
      (min, s) => (s.staked_at < min ? s.staked_at : min),
      activeStakes[0].staked_at
    );
    const latestUnlock = activeStakes.reduce(
      (max, s) => (s.unlocks_at > max ? s.unlocks_at : max),
      activeStakes[0].unlocks_at
    );
    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(latestUnlock).getTime() - now) / (24 * 3600 * 1000))
    );

    stakeData = {
      amount_raw: totalRaw.toString(),
      amount_genesis: +amountGenesis.toFixed(2),
      amount_usd: amountUsd,
      staked_at: earliestStaked,
      unlocks_at: latestUnlock,
      days_remaining: daysRemaining,
      status: 'active',
    };
  }

  const current_tier = await resolveTier(walletAddress);
  const eligible_for_pro = current_tier === 'pro' || stakeData.amount_usd >= 250;
  const gap_to_pro_usd = Math.max(0, +(250 - stakeData.amount_usd).toFixed(2));

  return {
    wallet: walletAddress,
    current_tier,
    stake: stakeData,
    thresholds: {
      member: {
        usd_target: member.usd_target,
        token_amount: member.token_amount,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: member.twap_price_usd,
        valid_until: member.valid_until,
      },
      pro: {
        usd_target: pro.usd_target,
        token_amount: pro.token_amount,
        token_symbol: TOKEN_SYMBOL,
        token_decimals: TOKEN_DECIMALS,
        genesis_usd_price: pro.twap_price_usd,
        lock_days: 90,
        valid_until: pro.valid_until,
      },
      twap_source: priceSource,
      recalculated_at: member.valid_from,
      stale,
    },
    eligible_for_pro,
    gap_to_pro_usd,
  };
}

export async function createStake(params: {
  wallet_address: string;
  amount_raw: string;
  lock_days: number;
  tx_signature: string;
  staking_provider?: string;
}): Promise<StakeRow> {
  return withDbLock(async () => {
    const db = await loadDb();
    const now = new Date();
    const unlock = new Date(now.getTime() + params.lock_days * 24 * 60 * 60 * 1000);

    const newStake: StakeRow = {
      id: safeRandomUUID(),
      wallet_address: params.wallet_address,
      amount_raw: params.amount_raw,
      staked_at: now.toISOString(),
      unlocks_at: unlock.toISOString(),
      status: 'active',
      tx_signature: params.tx_signature,
      staking_provider: params.staking_provider || 'stakepoint',
    };

    db.stakes.push(newStake);
    await saveDb(db);
    return newStake;
  });
}

// -------------------------------------------------------------
// Database Operations: Verification Sessions
// -------------------------------------------------------------

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function generateBase62Id(length = 12): string {
  let res = '';
  for (let i = 0; i < length; i++) {
    res += BASE62_CHARS[crypto.randomInt(BASE62_CHARS.length)];
  }
  return res;
}

export async function getVerificationSession(
  sessionId: string
): Promise<VerificationSessionRow | null> {
  const db = await loadDb();
  return db.verification_sessions.find((s) => s.session_id === sessionId) || null;
}

export async function createOrReuseVerificationSession(
  walletAddress: string,
  tier: 'member' | 'pro'
): Promise<{ session: VerificationSessionRow; reused: boolean } | { rateLimited: true }> {
  return withDbLock(async () => {
    const db = await loadDb();
    const now = new Date();
    const nowMs = now.getTime();

    // Prune sessions that expired more than a day ago so the stored blob cannot grow without bound.
    const pruneBefore = nowMs - 24 * 60 * 60 * 1000;
    db.verification_sessions = db.verification_sessions.filter(
      (s) => new Date(s.expires_at).getTime() > pruneBefore
    );

    // 1. Rate limit: max 3 sessions per wallet per 5 min
    const fiveMinutesAgo = nowMs - 5 * 60 * 1000;
    const recentCount = db.verification_sessions.filter(
      (s) => s.wallet_address === walletAddress && new Date(s.created_at).getTime() > fiveMinutesAgo
    ).length;

    if (recentCount >= 3) {
      return { rateLimited: true };
    }

    // 2. Reuse check: unused, unexpired session for this wallet + tier in the last 10 min
    const existing = db.verification_sessions.find(
      (s) =>
        s.wallet_address === walletAddress &&
        s.tier === tier &&
        s.used_at === null &&
        new Date(s.expires_at).getTime() > nowMs
    );

    if (existing) {
      return { session: existing, reused: true };
    }

    // 3. Create fresh 12-char base62 session
    const sessionId = generateBase62Id(12);
    const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString();

    const newSession: VerificationSessionRow = {
      session_id: sessionId,
      wallet_address: walletAddress,
      tier,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      used_at: null,
      telegram_user_id: null,
    };

    db.verification_sessions.push(newSession);
    await saveDb(db);
    return { session: newSession, reused: false };
  });
}

export async function markSessionUsed(
  sessionId: string,
  telegramUserId: number | null
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session) {
      session.used_at = new Date().toISOString();
      session.telegram_user_id = telegramUserId;
      await saveDb(db);
    }
  });
}

export type ClaimResult =
  | { status: 'ok'; session: VerificationSessionRow }
  | { status: 'not_found' | 'used' | 'expired' };

/**
 * Atomically claims a verification session (check + mark used under one lock) so a double-tap or
 * Telegram retry cannot redeem it twice. Call releaseVerificationSession() if the follow-up work fails.
 */
export async function claimVerificationSession(
  sessionId: string,
  telegramUserId: number | null
): Promise<ClaimResult> {
  return withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (!session) return { status: 'not_found' as const };
    if (session.used_at) return { status: 'used' as const };
    if (new Date(session.expires_at).getTime() <= Date.now()) return { status: 'expired' as const };
    session.used_at = new Date().toISOString();
    session.telegram_user_id = telegramUserId;
    await saveDb(db);
    return { status: 'ok' as const, session: { ...session } };
  });
}

export async function releaseVerificationSession(sessionId: string): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session) {
      session.used_at = null;
      session.telegram_user_id = null;
      await saveDb(db);
    }
  });
}

// -------------------------------------------------------------
// Database Operations: Raid Nonce Challenges
// -------------------------------------------------------------

let _testFailNextCreateRaidChallengeRow: Error | null = null;

export function __setTestFailCreateRaidChallengeRow(err: Error | null): void {
  _testFailNextCreateRaidChallengeRow = err;
}

export async function createRaidChallengeRow(
  challenge: Omit<RaidChallengeRow, 'consumed_at'>
): Promise<RaidChallengeRow> {
  if (_testFailNextCreateRaidChallengeRow) {
    const injectedErr = _testFailNextCreateRaidChallengeRow;
    _testFailNextCreateRaidChallengeRow = null;
    throw injectedErr;
  }
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) db.raid_challenges = [];
    const nowMs = Date.now();
    // Prune expired challenges older than 1 hour to prevent unbounded growth
    const pruneBefore = nowMs - 60 * 60 * 1000;
    db.raid_challenges = db.raid_challenges.filter(
      (c) => new Date(c.expires_at).getTime() > pruneBefore
    );

    const row: RaidChallengeRow = {
      ...challenge,
      authority: challenge.authority || 'db',
      consumed_at: null,
    };
    db.raid_challenges.push(row);
    await saveDb(db);
    return row;
  });
}

export async function getRaidChallengeRow(
  challengeId: string
): Promise<RaidChallengeRow | null> {
  const db = await loadDb();
  if (!Array.isArray(db.raid_challenges)) return null;
  return db.raid_challenges.find((c) => c.challenge_id === challengeId) || null;
}

export async function consumeRaidChallengeRow(
  challengeId: string
): Promise<boolean> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return false;
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return false;
    if (row.consumed_at) return false;
    if (new Date(row.expires_at).getTime() <= Date.now()) return false;
    row.consumed_at = new Date().toISOString();
    await saveDb(db);
    return true;
  });
}

export async function rollbackRaidChallengeRow(
  challengeId: string
): Promise<boolean> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return false;
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row || !row.consumed_at) return false;
    if (new Date(row.expires_at).getTime() <= Date.now()) return false;
    row.consumed_at = null;
    await saveDb(db);
    return true;
  });
}

export type DbChallengeClaimResult =
  | { status: 'CLAIMED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'RESUMED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'RECOVERED'; attemptId: string; fencingToken: number; leaseExpiresAt: number }
  | { status: 'BUSY'; attemptId?: string; fencingToken?: number; leaseExpiresAt?: number }
  | { status: 'CONFLICT'; attemptId?: string; fencingToken?: number; leaseExpiresAt?: number }
  | { status: 'COMPLETED'; submissionId?: string; attemptId?: string; fencingToken?: number }
  | { status: 'EXPIRED' }
  | { status: 'NOT_FOUND' };

export async function claimRaidChallengeProcessingRow(
  challengeId: string,
  attemptId: string,
  leaseDurationMs = 30000,
  nowMs = Date.now()
): Promise<DbChallengeClaimResult> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return { status: 'NOT_FOUND' };
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return { status: 'NOT_FOUND' };

    if (new Date(row.expires_at).getTime() <= nowMs) {
      return { status: 'EXPIRED' };
    }

    if (row.status === 'COMPLETED' || row.consumed_at) {
      return {
        status: 'COMPLETED',
        submissionId: row.submission_id || undefined,
        attemptId: row.attempt_id || undefined,
        fencingToken: row.fencing_token || undefined,
      };
    }

    if (!row.status || row.status === 'ACTIVE') {
      row.status = 'PROCESSING';
      row.attempt_id = attemptId;
      row.fencing_token = 1;
      row.processing_started_at = new Date(nowMs).toISOString();
      const leaseExp = nowMs + leaseDurationMs;
      row.processing_lease_expires_at = new Date(leaseExp).toISOString();
      await saveDb(db);
      return {
        status: 'CLAIMED',
        attemptId,
        fencingToken: 1,
        leaseExpiresAt: leaseExp,
      };
    }

    if (row.status === 'PROCESSING') {
      if (row.attempt_id === attemptId) {
        const leaseExp = nowMs + leaseDurationMs;
        row.processing_lease_expires_at = new Date(leaseExp).toISOString();
        await saveDb(db);
        return {
          status: 'RESUMED',
          attemptId,
          fencingToken: row.fencing_token || 1,
          leaseExpiresAt: leaseExp,
        };
      }

      const currentLeaseExp = row.processing_lease_expires_at
        ? new Date(row.processing_lease_expires_at).getTime()
        : 0;

      if (nowMs > currentLeaseExp) {
        const nextToken = (row.fencing_token || 0) + 1;
        row.attempt_id = attemptId;
        row.fencing_token = nextToken;
        row.processing_started_at = new Date(nowMs).toISOString();
        const leaseExp = nowMs + leaseDurationMs;
        row.processing_lease_expires_at = new Date(leaseExp).toISOString();
        await saveDb(db);
        return {
          status: 'RECOVERED',
          attemptId,
          fencingToken: nextToken,
          leaseExpiresAt: leaseExp,
        };
      }

      return {
        status: 'CONFLICT',
        attemptId: row.attempt_id || undefined,
        fencingToken: row.fencing_token || undefined,
        leaseExpiresAt: currentLeaseExp,
      };
    }

    return { status: 'NOT_FOUND' };
  });
}

export async function finalizeRaidChallengeProcessingRow(
  challengeId: string,
  attemptId: string,
  fencingToken: number,
  submissionId: string
): Promise<{ success: boolean; reason?: string }> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return { success: false, reason: 'NOT_FOUND' };
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return { success: false, reason: 'NOT_FOUND' };

    if (row.status === 'COMPLETED' || row.consumed_at) {
      if (row.submission_id === submissionId) {
        return { success: true };
      }
      return { success: false, reason: 'COMPLETED_DIFFERENT_SUBMISSION' };
    }

    if (row.status !== 'PROCESSING') {
      return { success: false, reason: 'NOT_PROCESSING' };
    }

    if (row.attempt_id !== attemptId) {
      return { success: false, reason: 'STALE_ATTEMPT' };
    }

    if (Number(row.fencing_token) !== Number(fencingToken)) {
      return { success: false, reason: 'STALE_FENCING_TOKEN' };
    }

    const nowIso = new Date().toISOString();
    row.status = 'COMPLETED';
    row.consumed_at = nowIso;
    row.submission_id = submissionId;
    row.idempotency_key = `raid-submission:${challengeId}`;
    await saveDb(db);
    return { success: true };
  });
}

export async function rollbackRaidChallengeProcessingRow(
  challengeId: string,
  attemptId: string,
  fencingToken: number
): Promise<{ success: boolean; reason?: string }> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return { success: false, reason: 'NOT_FOUND' };
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return { success: false, reason: 'NOT_FOUND' };

    if (row.status === 'COMPLETED' || row.consumed_at) {
      return { success: false, reason: 'ALREADY_COMPLETED' };
    }

    if (row.status !== 'PROCESSING') {
      return { success: false, reason: 'NOT_PROCESSING' };
    }

    if (row.attempt_id !== attemptId) {
      return { success: false, reason: 'STALE_ATTEMPT' };
    }

    if (Number(row.fencing_token) !== Number(fencingToken)) {
      return { success: false, reason: 'STALE_FENCING_TOKEN' };
    }

    row.status = 'ACTIVE';
    row.attempt_id = null;
    row.fencing_token = null;
    row.processing_started_at = null;
    row.processing_lease_expires_at = null;
    await saveDb(db);
    return { success: true };
  });
}

export async function reconcileRaidChallengeCompletedRow(
  challengeId: string,
  submissionId: string
): Promise<boolean> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return false;
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return false;
    row.status = 'COMPLETED';
    row.consumed_at = new Date().toISOString();
    row.submission_id = submissionId;
    row.idempotency_key = `raid-submission:${challengeId}`;
    await saveDb(db);
    return true;
  });
}

// -------------------------------------------------------------
// Database Operations: Telegram Members
// -------------------------------------------------------------

export async function getTelegramMember(walletAddress: string): Promise<TelegramMemberRow | null> {
  const db = await loadDb();
  return db.telegram_members.find((m) => m.wallet_address === walletAddress) || null;
}

export async function listGroupMembers(): Promise<TelegramMemberRow[]> {
  const db = await loadDb();
  return db.telegram_members.filter((m) => m.in_group && m.telegram_user_id !== null);
}

export async function countVerifiedUsers(): Promise<number> {
  const db = await loadDb();
  const verifiedWallets = new Set<string>();

  for (const m of db.telegram_members || []) {
    if (m.in_group || m.telegram_user_id !== null) {
      if (m.wallet_address) verifiedWallets.add(m.wallet_address);
    }
  }

  for (const s of db.verification_sessions || []) {
    if (s.used_at !== null || s.telegram_user_id !== null) {
      if (s.wallet_address) verifiedWallets.add(s.wallet_address);
    }
  }

  return verifiedWallets.size;
}

export async function setMemberInGroup(walletAddress: string, inGroup: boolean): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const m = db.telegram_members.find((x) => x.wallet_address === walletAddress);
    if (m) {
      m.in_group = inGroup;
      m.last_synced_at = new Date().toISOString();
      await saveDb(db);
    }
  });
}

export async function upsertTelegramMember(params: {
  wallet_address: string;
  telegram_user_id: number | null;
  tier: 'member' | 'pro';
  in_group: boolean;
}): Promise<TelegramMemberRow> {
  return withDbLock(async () => {
    const db = await loadDb();
    const existing = db.telegram_members.find((m) => m.wallet_address === params.wallet_address);
    const now = new Date().toISOString();

    if (existing) {
      existing.telegram_user_id = params.telegram_user_id ?? existing.telegram_user_id;
      existing.tier = params.tier;
      existing.in_group = params.in_group;
      existing.last_synced_at = now;
      await saveDb(db);
      return existing;
    }

    const newMember: TelegramMemberRow = {
      wallet_address: params.wallet_address,
      telegram_user_id: params.telegram_user_id,
      tier: params.tier,
      in_group: params.in_group,
      last_synced_at: now,
    };

    db.telegram_members.push(newMember);
    await saveDb(db);
    return newMember;
  });
}

// -------------------------------------------------------------
// Tier Resolution (§8, §4)
// -------------------------------------------------------------

export async function resolveTier(walletAddress: string): Promise<'free' | 'member' | 'pro' | 'unknown'> {
  if (isAdminWallet(walletAddress)) {
    return 'pro';
  }

  try {
    const { resolveWalletEntitlement } = await import('@/server/entitlements');
    const ent = await resolveWalletEntitlement(walletAddress);
    return ent.tier;
  } catch (err) {
    console.error('[TrenchLabs DB] resolveTier error:', err);
    return 'unknown';
  }
}

// -------------------------------------------------------------
// Database Operations: Ledger Entries (§1, §2, §3)
// -------------------------------------------------------------

export async function createLedgerEntry(params: {
  ticker: string;
  chain: string;
  contract_address: string;
  multiplier: string;
  entry_price?: string | null;
  exit_price?: string | null;
  proof_url?: string | null;
  verification_status?: LedgerVerificationStatus;
  notes?: string | null;
  closed_at: string;
  posted_by: string;
}): Promise<LedgerEntryRow> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.ledger_entries)) db.ledger_entries = [];

    const now = new Date().toISOString();
    const verificationStatus: LedgerVerificationStatus =
      params.verification_status || (params.proof_url?.trim() ? 'EVIDENCE_SUPPLIED' : 'REPORTED');

    const entry: LedgerEntryRow = {
      id: safeRandomUUID(),
      ticker: params.ticker.toUpperCase().replace(/^\$/, ''),
      chain: params.chain.toLowerCase(),
      contract_address: params.contract_address.trim(),
      multiplier: Number(params.multiplier).toFixed(4),
      entry_price: params.entry_price?.trim() || null,
      exit_price: params.exit_price?.trim() || null,
      proof_url: params.proof_url?.trim() || null,
      verification_status: verificationStatus,
      notes: params.notes?.trim() || null,
      closed_at: new Date(params.closed_at).toISOString(),
      posted_by: params.posted_by,
      posted_at: now,
      updated_at: null,
    };

    db.ledger_entries.unshift(entry);
    await saveDb(db);
    return entry;
  });
}

export async function getLedgerEntries(options?: {
  chain?: string;
  sort?: 'newest' | 'multi';
  limit?: number;
  offset?: number;
}): Promise<{ entries: LedgerEntryWithEdited[]; total: number; has_more: boolean }> {
  return withDbLock(async () => {
    const db = await loadDb();
    let list = [...(db.ledger_entries || [])];

    if (options?.chain && options.chain.toLowerCase() !== 'all') {
      const c = options.chain.toLowerCase();
      list = list.filter((e) => e.chain.toLowerCase() === c);
    }

    if (options?.sort === 'multi') {
      list.sort((a, b) => Number(b.multiplier) - Number(a.multiplier));
    } else {
      list.sort((a, b) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime());
    }

    const total = list.length;
    const offset = Math.max(0, options?.offset ?? 0);
    const limit = Math.max(1, options?.limit ?? 12);
    const slice = list.slice(offset, offset + limit);
    const has_more = offset + limit < total;

    const entries: LedgerEntryWithEdited[] = slice.map((e) => ({
      ...e,
      verification_status:
        e.verification_status || (e.proof_url?.trim() ? 'EVIDENCE_SUPPLIED' : 'REPORTED'),
      edited: !!e.updated_at && new Date(e.updated_at).getTime() > new Date(e.posted_at).getTime(),
    }));

    return { entries, total, has_more };
  });
}

export async function getLedgerEntryById(id: string): Promise<LedgerEntryWithEdited | null> {
  return withDbLock(async () => {
    const db = await loadDb();
    const found = (db.ledger_entries || []).find((e) => e.id === id);
    if (!found) return null;
    return {
      ...found,
      verification_status:
        found.verification_status || (found.proof_url?.trim() ? 'EVIDENCE_SUPPLIED' : 'REPORTED'),
      edited: !!found.updated_at && new Date(found.updated_at).getTime() > new Date(found.posted_at).getTime(),
    };
  });
}

export async function updateLedgerEntry(
  id: string,
  updates: Partial<Pick<LedgerEntryRow, 'ticker' | 'chain' | 'contract_address' | 'multiplier' | 'entry_price' | 'exit_price' | 'proof_url' | 'verification_status' | 'notes' | 'closed_at'>>
): Promise<LedgerEntryWithEdited | null> {
  return withDbLock(async () => {
    const db = await loadDb();
    const entry = (db.ledger_entries || []).find((e) => e.id === id);
    if (!entry) return null;

    if (updates.ticker !== undefined) entry.ticker = updates.ticker.toUpperCase().replace(/^\$/, '');
    if (updates.chain !== undefined) entry.chain = updates.chain.toLowerCase();
    if (updates.contract_address !== undefined) entry.contract_address = updates.contract_address.trim();
    if (updates.multiplier !== undefined) entry.multiplier = Number(updates.multiplier).toFixed(4);
    if (updates.entry_price !== undefined) entry.entry_price = updates.entry_price?.trim() || null;
    if (updates.exit_price !== undefined) entry.exit_price = updates.exit_price?.trim() || null;
    if (updates.proof_url !== undefined) entry.proof_url = updates.proof_url?.trim() || null;
    if (updates.verification_status !== undefined) entry.verification_status = updates.verification_status;
    if (updates.notes !== undefined) entry.notes = updates.notes?.trim() || null;
    if (updates.closed_at !== undefined) entry.closed_at = new Date(updates.closed_at).toISOString();

    entry.updated_at = new Date().toISOString();
    await saveDb(db);

    return {
      ...entry,
      verification_status:
        entry.verification_status || (entry.proof_url?.trim() ? 'EVIDENCE_SUPPLIED' : 'REPORTED'),
      edited: true,
    };
  });
}

export async function deleteLedgerEntry(id: string): Promise<boolean> {
  return withDbLock(async () => {
    const db = await loadDb();
    const initialLen = (db.ledger_entries || []).length;
    db.ledger_entries = (db.ledger_entries || []).filter((e) => e.id !== id);
    if (db.ledger_entries.length < initialLen) {
      await saveDb(db);
      return true;
    }
    return false;
  });
}

// -------------------------------------------------------------
// Database Operations: Audit Logs
// -------------------------------------------------------------

export async function recordAuditLog(
  action: string,
  walletAddress: string | null,
  details: Record<string, unknown>
): Promise<void> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.audit_logs)) db.audit_logs = [];
    db.audit_logs.unshift({
      id: safeRandomUUID(),
      action,
      wallet_address: walletAddress,
      details,
      timestamp: new Date().toISOString(),
    });
    if (db.audit_logs.length > 1000) {
      db.audit_logs = db.audit_logs.slice(0, 1000);
    }
    await saveDb(db);
  });
}


