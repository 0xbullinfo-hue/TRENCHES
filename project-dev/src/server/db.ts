import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { KV_CONFIGURED, kvGet, kvSet, kvLock, kvUnlock, kvRenewLock, kvSetLocked } from '@/server/kv';
import { readGenesisBalanceCached } from '@/server/genesis';
import { ADMIN_WALLET, isAdminWallet, TOKEN_DECIMALS, TOKEN_SYMBOL } from '@/lib/config';
import { resolveStakePointConfig } from '@/lib/stakepoint/config';
import { getGenesisPrice } from '@/server/price';
import { DEFAULT_GENESIS_USD_PRICE } from '@/lib/tiers';
import type { FavoritePostKind, FavoritePostRecord } from '@/lib/types';
import {
  normalizeNotificationPreferences,
  type GroupStatus,
  type NotificationPreferences,
  type NotificationStatus,
  type TelegramIdentityStatus,
  type TelegramMemberRecord,
  type UserTier,
  type VerificationSessionStatus,
  type WebhookEventStatus,
} from '@/lib/telegram-types';

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
  session_id: string; // 24-char (or legacy 12-char) crypto random pk
  token_hash?: string;
  wallet_address: string;
  tier: 'member' | 'pro';
  status?: VerificationSessionStatus;
  attempt_count?: number;
  last_error?: string | null;
  created_at: string; // timestamptz ISO
  expires_at: string; // timestamptz ISO (created_at + 10 min)
  used_at: string | null;
  completed_at?: string | null;
  telegram_user_id: number | null;
  telegram_chat_id?: string | null;
}

export type TelegramMemberRow = TelegramMemberRecord;

export interface TelegramLinkCodeRow {
  code_hash: string;
  wallet_address: string;
  created_at: string;
  expires_at: string;
}

export interface TelegramWebhookEventRow {
  update_id: number;
  status: WebhookEventStatus;
  event_type: string;
  attempt_count: number;
  lease_token: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TelegramMigrationMeta {
  version: number;
  applied_at: string;
  members_normalized: number;
  legacy_subs_migrated: number;
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

export interface TrenchDatabaseSchema {
  tier_thresholds: TierThresholdRow[];
  stakes: StakeRow[];
  verification_sessions: VerificationSessionRow[];
  telegram_members: TelegramMemberRow[];
  telegram_link_codes?: TelegramLinkCodeRow[];
  telegram_webhook_events?: TelegramWebhookEventRow[];
  telegram_migration?: TelegramMigrationMeta;
  ledger_entries: LedgerEntryRow[];
  audit_logs: AuditLogRow[];
  raid_challenges?: RaidChallengeRow[];
  user_favorites?: Record<string, FavoritePostRecord[]>;
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
    telegram_link_codes: [],
    telegram_webhook_events: [],
    ledger_entries: [],
    audit_logs: [],
    raid_challenges: [],
    user_favorites: {},
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

import { AsyncLocalStorage } from 'async_hooks';

export const dbLockStorage = new AsyncLocalStorage<FileLockRelease | {
  token: string;
  fencingGeneration: number;
  assertOwned: () => void;
  isOwned: () => boolean;
}>();

export interface FileLockRelease {
  (): void;
  token: string;
  fencingGeneration: number;
  assertOwned: () => void;
  isOwned: () => boolean;
}

export function getAndIncrementDurableGeneration(lockFilePath: string, minGen = 0): number {
  const genFilePath = `${lockFilePath}.gen`;
  let currentGen = minGen;
  try {
    if (fs.existsSync(genFilePath)) {
      const raw = fs.readFileSync(genFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      currentGen = Math.max(currentGen, Number(parsed?.generation) || 0);
    }
  } catch {}
  const nextGen = currentGen + 1;
  try {
    const tmp = `${genFilePath}.${process.pid}.${Date.now()}.${safeRandomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ generation: nextGen, updatedAt: Date.now() }), 'utf8');
    try {
      fs.renameSync(tmp, genFilePath);
    } catch {
      fs.writeFileSync(genFilePath, JSON.stringify({ generation: nextGen, updatedAt: Date.now() }), 'utf8');
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  } catch {}
  return nextGen;
}

/**
 * Race-safe file lock acquisition with metadata verification, monotonic fencing generations,
 * and atomic OS rename recovery guarded against replacement lock races.
 *
 * Supported deployment model:
 * - Local dev / single-node host: Cross-process mutual exclusion via atomic kernel open ('wx')
 *   with verification and atomic rename-based dead PID recovery.
 * - Multi-instance / serverless production: Backed by shared Upstash Redis distributed lock
 *   (kvLock with token ownership, fencing, and lease renewals).
 */
export async function acquireFileLock(
  lockFilePath: string = DB_FILE_LOCK_PATH,
  options?: { maxWaitMs?: number }
): Promise<FileLockRelease> {
  const maxWaitMs = options?.maxWaitMs ?? 5000;
  const start = Date.now();
  const lockToken = safeRandomUUID();

  const dataDir = path.dirname(lockFilePath);
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch {}
  }

  // Clean up any abandoned reclaim staging files left by dead processes
  try {
    const lockBase = path.basename(lockFilePath);
    const reclaimPrefix = `${lockBase}.reclaim.`;
    const entries = fs.readdirSync(dataDir);
    for (const entry of entries) {
      if (entry.startsWith(reclaimPrefix)) {
        const full = path.join(dataDir, entry);
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw);
          if (typeof parsed?.pid === 'number' && isPidDead(parsed.pid)) {
            fs.unlinkSync(full);
          }
        } catch {
          // If unreadable or corrupted staging file, clean up
          try { fs.unlinkSync(full); } catch {}
        }
      }
    }
  } catch {}

  while (Date.now() - start < maxWaitMs) {
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // 1. 'wx' opens exclusively, failing with EEXIST if path already exists (atomic OS kernel lock)
      const fd = fs.openSync(lockFilePath, 'wx');
      const fencingGeneration = getAndIncrementDurableGeneration(lockFilePath, 0);
      try {
        if (_testFailNextLockMetadataWrite) {
          _testFailNextLockMetadataWrite = false;
          throw new Error('Simulated lock metadata write failure');
        }

        const metadata = JSON.stringify({
          pid: process.pid,
          token: lockToken,
          fencingGeneration,
          createdAt: Date.now(),
        });
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
        const verifyRaw = fs.readFileSync(lockFilePath, 'utf8');
        const verifyData = JSON.parse(verifyRaw);
        if (verifyData?.token !== lockToken) {
          throw new Error('Lock metadata verification failed: token mismatch');
        }
      } catch (metaErr) {
        // Acquisition integrity: never leave partially acquired lock on failure
        try {
          fs.closeSync(fd);
        } catch {}
        try {
          if (fs.existsSync(lockFilePath)) {
            const raw = fs.readFileSync(lockFilePath, 'utf8');
            if (!raw || raw.includes(lockToken)) {
              fs.unlinkSync(lockFilePath);
            }
          }
        } catch {}
        throw metaErr;
      }

      try {
        fs.closeSync(fd);
      } catch {}

      let released = false;
      const releaseFn = () => {
        if (released) return;
        released = true;
        try {
          // Verify ownership before unlinking: never delete another process's lock
          if (fs.existsSync(lockFilePath)) {
            const raw = fs.readFileSync(lockFilePath, 'utf8');
            try {
              const data = JSON.parse(raw);
              if (data?.token === lockToken) {
                fs.unlinkSync(lockFilePath);
              }
            } catch {
              if (raw.includes(lockToken)) {
                fs.unlinkSync(lockFilePath);
              }
            }
          }
        } catch {}
      };

      const handle: FileLockRelease = Object.assign(releaseFn, {
        token: lockToken,
        fencingGeneration,
        isOwned: () => {
          if (released) return false;
          try {
            if (!fs.existsSync(lockFilePath)) return false;
            const cur = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
            return cur?.token === lockToken && Number(cur?.fencingGeneration) === fencingGeneration;
          } catch {
            return false;
          }
        },
        assertOwned: () => {
          if (released) {
            throw new Error('Lock has already been released');
          }
          if (!fs.existsSync(lockFilePath)) {
            throw new Error('Lock file no longer exists');
          }
          const cur = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
          if (cur?.token !== lockToken) {
            throw new Error(
              `Lock ownership lost: current owner token ${cur?.token} does not match worker token ${lockToken}`
            );
          }
          if (Number(cur?.fencingGeneration) !== fencingGeneration) {
            throw new Error(
              `Fencing generation mismatch: current generation ${cur?.fencingGeneration} does not match worker generation ${fencingGeneration}`
            );
          }
        },
      });

      return handle;
    } catch (err: unknown) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === 'EEXIST' || errCode === 'EPERM' || errCode === 'EACCES') {
        // 2. Race-Safe Atomic Stale Lock Recovery:
        // A live process lock MUST NEVER be stolen or deleted.
        try {
          if (fs.existsSync(lockFilePath)) {
            const raw = fs.readFileSync(lockFilePath, 'utf8');
            let data: Record<string, unknown> | null = null;
            try {
              data = JSON.parse(raw);
            } catch {}

            const inspectedPid = typeof data?.pid === 'number' ? data.pid : -1;
            const inspectedToken = typeof data?.token === 'string' ? data.token : '';
            const inspectedGen = Number(data?.fencingGeneration) || 1;

            if (inspectedPid > 0 && isPidDead(inspectedPid)) {
              // The holding process terminated (ESRCH).
              // ATOMIC RECOVERY STEP 1: Rename stale lock file to an isolated unique staging path
              const reclaimPath = `${lockFilePath}.reclaim.${lockToken}.${Date.now()}.${safeRandomUUID()}`;
              let reclaimed = false;
              try {
                fs.renameSync(lockFilePath, reclaimPath);
                reclaimed = true;
              } catch {
                // Another process already renamed or replaced the lock
              }

              if (reclaimed) {
                try {
                  const staleRaw = fs.readFileSync(reclaimPath, 'utf8');
                  let reclaimData: Record<string, unknown> | null = null;
                  try {
                    reclaimData = JSON.parse(staleRaw);
                  } catch {}

                  const reclaimToken = typeof reclaimData?.token === 'string' ? reclaimData.token : '';
                  const reclaimGen = Number(reclaimData?.fencingGeneration) || 1;
                  const reclaimPid = typeof reclaimData?.pid === 'number' ? reclaimData.pid : -1;

                  // MANDATORY GENERATION VERIFICATION:
                  // Confirm the renamed file is the EXACT stale lock generation originally inspected.
                  // If a replacement lock was created between read and rename, the token or generation
                  // will differ or the PID will be alive. If so, RESTORE IT IMMEDIATELY and abort.
                  if (
                    reclaimToken !== inspectedToken ||
                    reclaimGen !== inspectedGen ||
                    reclaimPid !== inspectedPid ||
                    !isPidDead(reclaimPid)
                  ) {
                    // Restoration must never replace a newer lock:
                    if (!fs.existsSync(lockFilePath)) {
                      try {
                        fs.renameSync(reclaimPath, lockFilePath);
                      } catch {}
                    } else {
                      try {
                        if (isPidDead(reclaimPid)) {
                          fs.unlinkSync(reclaimPath);
                        }
                      } catch {}
                    }
                    await sleep(20 + Math.floor(Math.random() * 30));
                    continue;
                  }

                  // Unlink verified stale reclaim staging file
                  try {
                    fs.unlinkSync(reclaimPath);
                  } catch {}

                  // Acquire exclusively with incremented fencing generation
                  const nextGen = getAndIncrementDurableGeneration(lockFilePath, inspectedGen);
                  const recFd = fs.openSync(lockFilePath, 'wx');
                  try {
                    if (_testFailNextLockMetadataWrite) {
                      _testFailNextLockMetadataWrite = false;
                      throw new Error('Simulated lock metadata write failure during recovery');
                    }

                    const recMeta = JSON.stringify({
                      pid: process.pid,
                      token: lockToken,
                      fencingGeneration: nextGen,
                      createdAt: Date.now(),
                    });
                    fs.writeSync(recFd, recMeta);
                    fs.fsyncSync(recFd);

                    if (_testFailNextLockMetadataVerify) {
                      _testFailNextLockMetadataVerify = false;
                      throw new Error('Simulated lock metadata verification failure during recovery');
                    }

                    // Verify write
                    const verifyCheck = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
                    if (verifyCheck?.token !== lockToken) {
                      throw new Error('Lock metadata verification failed: token mismatch on recovery');
                    }
                  } catch (recMetaErr) {
                    try { fs.closeSync(recFd); } catch {}
                    try {
                      if (fs.existsSync(lockFilePath)) {
                        const raw = fs.readFileSync(lockFilePath, 'utf8');
                        if (!raw || raw.includes(lockToken)) {
                          fs.unlinkSync(lockFilePath);
                        }
                      }
                    } catch {}
                    throw recMetaErr;
                  }

                  try { fs.closeSync(recFd); } catch {}

                  let recReleased = false;
                  const recReleaseFn = () => {
                    if (recReleased) return;
                    recReleased = true;
                    try {
                      if (fs.existsSync(lockFilePath)) {
                        const cur = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
                        if (cur?.token === lockToken) {
                          fs.unlinkSync(lockFilePath);
                        }
                      }
                    } catch {}
                  };

                  const recHandle: FileLockRelease = Object.assign(recReleaseFn, {
                    token: lockToken,
                    fencingGeneration: nextGen,
                    isOwned: () => {
                      if (recReleased) return false;
                      try {
                        if (!fs.existsSync(lockFilePath)) return false;
                        const cur = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
                        return cur?.token === lockToken && Number(cur?.fencingGeneration) === nextGen;
                      } catch {
                        return false;
                      }
                    },
                    assertOwned: () => {
                      if (recReleased) {
                        throw new Error('Lock has already been released');
                      }
                      if (!fs.existsSync(lockFilePath)) {
                        throw new Error('Lock file no longer exists');
                      }
                      const cur = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));
                      if (cur?.token !== lockToken) {
                        throw new Error(
                          `Lock ownership lost: current owner token ${cur?.token} does not match worker token ${lockToken}`
                        );
                      }
                      if (Number(cur?.fencingGeneration) !== nextGen) {
                        throw new Error(
                          `Fencing generation mismatch: current generation ${cur?.fencingGeneration} does not match worker generation ${nextGen}`
                        );
                      }
                    },
                  });

                  return recHandle;
                } catch {
                  // Fall through to retry loop
                }
              }
            }
          }
        } catch {
          // If race occurred or file was transiently inaccessible, continue loop
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
  const activeLock = dbLockStorage.getStore();
  if (activeLock) {
    return Promise.resolve(fn());
  }
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

      let renewTimer: NodeJS.Timeout | null = null;
      let renewInFlight = false;
      let lockLost = false;

      renewTimer = setInterval(async () => {
        if (renewInFlight || lockLost) return;
        renewInFlight = true;
        try {
          const renewed = await kvRenewLock(DB_LOCK_KEY, token, 30);
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

      const kvCtx = {
        token,
        fencingGeneration: 1,
        assertOwned: () => {
          if (lockLost) {
            throw new Error('Database KV lock ownership lost or expired');
          }
        },
        isOwned: () => !lockLost,
      };

      try {
        return await dbLockStorage.run(kvCtx, async () => await fn());
      } finally {
        if (renewTimer) clearInterval(renewTimer);
        await kvUnlock(DB_LOCK_KEY, token).catch(() => undefined);
      }
    }

    // Cross-process OS file lock when Redis is not configured
    const releaseFileLock = await acquireFileLock();
    try {
      return await dbLockStorage.run(releaseFileLock, async () => await fn());
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

const TELEGRAM_SCHEMA_VERSION = 2;

export function hashSecretToken(rawToken: string): string {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Normalizes a legacy or v2 TelegramMemberRow non-destructively into the full canonical record.
 * Never invents `group_status = 'joined'` unless legacy `in_group === true` on a pre-v2 row.
 */
export function normalizeTelegramMemberRow(
  raw: Partial<TelegramMemberRow> & { wallet_address: string }
): TelegramMemberRow {
  const now = new Date().toISOString();
  const wallet = String(raw.wallet || raw.wallet_address).trim();
  const rawUserId = raw.telegram_user_id !== undefined && raw.telegram_user_id !== null && Number.isFinite(Number(raw.telegram_user_id))
    ? Number(raw.telegram_user_id)
    : null;
  const legacyInGroup = Boolean(raw.in_group);
  const groupStatus: GroupStatus =
    raw.group_status ||
    (legacyInGroup && rawUserId !== null ? 'joined' : 'not_joined');
  const effectiveInGroup = groupStatus === 'joined';
  const identityStatus: TelegramMemberRow['identity_status'] =
    raw.identity_status ||
    (rawUserId !== null || raw.telegram_chat_id ? 'connected' : 'pending');
  const legacyTier: 'member' | 'pro' = raw.tier === 'pro' ? 'pro' : 'member';
  const entitlementTier: UserTier =
    raw.entitlement_tier ||
    (rawUserId !== null || legacyInGroup ? legacyTier : 'free');
  const notificationStatus: NotificationStatus = raw.notification_status || 'disabled';
  const lastSynced = raw.last_synced_at || now;
  const createdAt = raw.created_at || lastSynced;

  return {
    id: raw.id || safeRandomUUID(),
    wallet,
    wallet_address: wallet,
    telegram_user_id: rawUserId,
    telegram_chat_id:
      raw.telegram_chat_id !== undefined
        ? raw.telegram_chat_id
        : rawUserId !== null
        ? String(rawUserId)
        : null,
    entitlement_tier: entitlementTier,
    tier: legacyTier,
    identity_status: identityStatus,
    group_status: groupStatus,
    group_id: raw.group_id ?? null,
    in_group: effectiveInGroup,
    notification_status: notificationStatus,
    notification_preferences: normalizeNotificationPreferences(raw.notification_preferences),
    verified_at:
      raw.verified_at !== undefined
        ? raw.verified_at
        : identityStatus === 'connected'
        ? lastSynced
        : null,
    invite_created_at: raw.invite_created_at ?? null,
    invite_expires_at: raw.invite_expires_at ?? null,
    invite_link_hash: raw.invite_link_hash ?? null,
    pending_invite_link: raw.pending_invite_link ?? null,
    joined_at:
      raw.joined_at !== undefined
        ? raw.joined_at
        : effectiveInGroup
        ? lastSynced
        : null,
    revoked_at: raw.revoked_at ?? null,
    revoked_reason: raw.revoked_reason ?? null,
    entitlement_unknown_since: raw.entitlement_unknown_since ?? null,
    last_error: raw.last_error ?? null,
    last_synced_at: lastSynced,
    created_at: createdAt,
    updated_at: raw.updated_at || lastSynced,
  };
}

function hydrateSchema(parsed: TrenchDatabaseSchema): TrenchDatabaseSchema {
  if (!Array.isArray(parsed.ledger_entries)) parsed.ledger_entries = [];
  if (!Array.isArray(parsed.tier_thresholds)) parsed.tier_thresholds = [];
  if (!Array.isArray(parsed.stakes)) parsed.stakes = [];
  if (!Array.isArray(parsed.verification_sessions)) parsed.verification_sessions = [];
  if (!Array.isArray(parsed.telegram_members)) parsed.telegram_members = [];
  if (!Array.isArray(parsed.telegram_link_codes)) parsed.telegram_link_codes = [];
  if (!Array.isArray(parsed.telegram_webhook_events)) parsed.telegram_webhook_events = [];
  if (!Array.isArray(parsed.audit_logs)) parsed.audit_logs = [];
  if (!Array.isArray(parsed.raid_challenges)) parsed.raid_challenges = [];
  if (!parsed.user_favorites || typeof parsed.user_favorites !== 'object') parsed.user_favorites = {};

  parsed.telegram_members = parsed.telegram_members
    .filter((m) => m && typeof m.wallet_address === 'string' && m.wallet_address.trim().length > 0)
    .map((m) => normalizeTelegramMemberRow(m));

  return parsed;
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
      return hydrateSchema(parsed);
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
          inMemoryDb = hydrateSchema(parsed as TrenchDatabaseSchema);
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

function assertTelegramMemberConstraints(members: TelegramMemberRow[]): void {
  const seenWallets = new Set<string>();
  const seenUserIds = new Map<number, string>();
  for (const m of members) {
    const w = m.wallet_address;
    if (!w) throw new Error('Telegram member record missing wallet_address');
    if (seenWallets.has(w)) {
      throw new Error(`Duplicate telegram_members wallet constraint violation: ${w}`);
    }
    seenWallets.add(w);
    if (m.telegram_user_id !== null && m.identity_status !== 'disconnected') {
      const uid = Number(m.telegram_user_id);
      const existingOwner = seenUserIds.get(uid);
      if (existingOwner && existingOwner !== w) {
        throw new Error(`Duplicate telegram_members telegram_user_id constraint violation: ${uid}`);
      }
      seenUserIds.set(uid, w);
    }
  }
}

export async function saveDb(db: TrenchDatabaseSchema): Promise<void> {
  assertPersistence();
  const activeLock = dbLockStorage.getStore();
  if (activeLock) {
    activeLock.assertOwned();
  }
  assertTelegramMemberConstraints(db.telegram_members || []);
  inMemoryDb = db;
  if (KV_CONFIGURED) {
    if (activeLock) {
      const res = await kvSetLocked(
        DB_LOCK_KEY,
        DB_KV_KEY,
        activeLock.token,
        JSON.stringify(db),
        activeLock.fencingGeneration
      );
      if (!res.success) {
        throw new Error(`Database write rejected: ${res.reason || 'Lock ownership lost'}`);
      }
      return;
    }
    throw new Error('Database write rejected: lock required for protected write in KV mode');
  }
  try {
    fs.mkdirSync(path.dirname(DATA_FILE_PATH), { recursive: true });
    const tmp = `${DATA_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, DATA_FILE_PATH);
    } catch {
      fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(db, null, 2), 'utf-8');
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
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
  const stakePointStatus = resolveStakePointConfig();

  return {
    wallet: walletAddress,
    current_tier,
    stake: stakeData,
    stakepoint: {
      configured: stakePointStatus.configured,
      program_configured: stakePointStatus.programConfigured,
      pool_configured: stakePointStatus.poolConfigured,
    },
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

export async function createStakeIfAbsent(params: {
  wallet_address: string;
  amount_raw: string;
  lock_days: number;
  tx_signature: string;
  staking_provider?: string;
}): Promise<{ created: boolean; stake: StakeRow }> {
  return withDbLock(async () => {
    const db = await loadDb();
    const existing = (db.stakes || []).find((s) => s.tx_signature === params.tx_signature);
    if (existing) {
      return { created: false, stake: existing };
    }

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
    return { created: true, stake: newStake };
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
  const incomingHash = hashSecretToken(sessionId);
  return (
    db.verification_sessions.find(
      (s) =>
        s.session_id === sessionId ||
        (s.token_hash ? timingSafeHexEqual(s.token_hash, incomingHash) : false)
    ) || null
  );
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

    // 2. Reuse check: unused, unexpired pending/retryable session for this wallet + tier in the last 10 min
    const existing = db.verification_sessions.find(
      (s) =>
        s.wallet_address === walletAddress &&
        s.tier === tier &&
        s.used_at === null &&
        (!s.status || s.status === 'pending' || s.status === 'retryable_failed') &&
        new Date(s.expires_at).getTime() > nowMs
    );

    if (existing) {
      return { session: existing, reused: true };
    }

    // 3. Create fresh 24-char cryptographically random base62 session and store token_hash
    const sessionId = generateBase62Id(24);
    const expiresAt = new Date(nowMs + 10 * 60 * 1000).toISOString();

    const newSession: VerificationSessionRow = {
      session_id: sessionId,
      token_hash: hashSecretToken(sessionId),
      wallet_address: walletAddress,
      tier,
      status: 'pending',
      attempt_count: 0,
      last_error: null,
      created_at: now.toISOString(),
      expires_at: expiresAt,
      used_at: null,
      completed_at: null,
      telegram_user_id: null,
      telegram_chat_id: null,
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
      const nowIso = new Date().toISOString();
      session.used_at = nowIso;
      session.completed_at = nowIso;
      session.status = 'completed';
      session.telegram_user_id = telegramUserId;
      await saveDb(db);
    }
  });
}

export type ClaimResult =
  | { status: 'ok'; session: VerificationSessionRow }
  | { status: 'not_found' | 'used' | 'expired' };

/**
 * Atomically claims a verification session (check + mark processing under lock) so a double-tap or
 * Telegram retry cannot redeem it twice.
 * Transitions:
 * - completeVerificationSession(): marks permanently 'completed'
 * - markVerificationSessionRetryable() / releaseVerificationSession(): frees for retry on transient errors
 * - markVerificationSessionFailed(): permanently rejects invalid/takeover attempts
 */
export async function claimVerificationSession(
  sessionId: string,
  telegramUserId: number | null,
  telegramChatId?: string | number | null
): Promise<ClaimResult> {
  return withDbLock(async () => {
    const db = await loadDb();
    const incomingHash = hashSecretToken(sessionId);
    const session = db.verification_sessions.find(
      (s) =>
        s.session_id === sessionId ||
        (s.token_hash ? timingSafeHexEqual(s.token_hash, incomingHash) : false)
    );
    if (!session) return { status: 'not_found' as const };
    if (session.token_hash && !timingSafeHexEqual(session.token_hash, incomingHash)) {
      return { status: 'not_found' as const };
    }
    if (session.status === 'completed' || session.status === 'failed') {
      return { status: 'used' as const };
    }
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      session.status = 'expired';
      await saveDb(db);
      return { status: 'expired' as const };
    }
    if (session.used_at) {
      return { status: 'used' as const };
    }
    session.status = 'processing';
    session.used_at = new Date().toISOString();
    session.attempt_count = (session.attempt_count ?? 0) + 1;
    session.telegram_user_id = telegramUserId;
    if (telegramChatId !== undefined && telegramChatId !== null) {
      session.telegram_chat_id = String(telegramChatId);
    }
    await saveDb(db);
    return { status: 'ok' as const, session: { ...session } };
  });
}

export async function completeVerificationSession(
  sessionId: string,
  telegramUserId: number | null,
  telegramChatId?: string | number | null
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session) {
      const nowIso = new Date().toISOString();
      session.status = 'completed';
      session.used_at = session.used_at || nowIso;
      session.completed_at = nowIso;
      session.last_error = null;
      session.telegram_user_id = telegramUserId;
      if (telegramChatId !== undefined && telegramChatId !== null) {
        session.telegram_chat_id = String(telegramChatId);
      }
      await saveDb(db);
    }
  });
}

export async function markVerificationSessionRetryable(
  sessionId: string,
  reason?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session && session.status !== 'completed' && session.status !== 'failed') {
      session.status = new Date(session.expires_at).getTime() <= Date.now() ? 'expired' : 'retryable_failed';
      session.used_at = null;
      session.telegram_user_id = null;
      session.telegram_chat_id = null;
      session.last_error = reason ?? null;
      await saveDb(db);
    }
  });
}

export async function markVerificationSessionFailed(
  sessionId: string,
  reason?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session && session.status !== 'completed') {
      session.status = 'failed';
      session.used_at = session.used_at || new Date().toISOString();
      session.last_error = reason ?? null;
      await saveDb(db);
    }
  });
}

export async function releaseVerificationSession(sessionId: string): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const session = db.verification_sessions.find((s) => s.session_id === sessionId);
    if (session) {
      session.used_at = null;
      session.telegram_user_id = null;
      session.telegram_chat_id = null;
      session.status = 'pending';
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

export type DbChallengeReconcileResult = {
  success: boolean;
  status?: 'COMPLETED' | 'ALREADY_COMPLETED';
  reason?: string;
  submissionId?: string;
  existingSubmissionId?: string;
};

export async function reconcileRaidChallengeCompletedRow(
  challengeId: string,
  submissionId: string,
  options?: {
    attemptId?: string;
    fencingToken?: number;
    campaignId?: string;
    walletAddress?: string;
    nowMs?: number;
    detailed?: boolean;
  }
): Promise<any> {
  const result = await withDbLock<DbChallengeReconcileResult>(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.raid_challenges)) return { success: false, reason: 'NOT_FOUND' };
    const row = db.raid_challenges.find((c) => c.challenge_id === challengeId);
    if (!row) return { success: false, reason: 'NOT_FOUND' };

    // 1. Campaign binding check
    if (options?.campaignId && row.campaign_id !== options.campaignId) {
      return { success: false, reason: 'CAMPAIGN_MISMATCH' };
    }

    // 2. Wallet binding check
    if (options?.walletAddress && row.wallet_address.toLowerCase() !== options.walletAddress.toLowerCase()) {
      return { success: false, reason: 'WALLET_MISMATCH' };
    }

    // 3. Immutability check: if already completed
    if (row.status === 'COMPLETED' || row.consumed_at) {
      if (row.submission_id === submissionId) {
        return { success: true, status: 'ALREADY_COMPLETED', submissionId: row.submission_id };
      }
      return {
        success: false,
        reason: 'COMPLETED_DIFFERENT_SUBMISSION',
        submissionId,
        existingSubmissionId: row.submission_id || undefined,
      };
    }

    const nowMs = options?.nowMs || Date.now();

    // 4. Expiry check if inactive
    if (new Date(row.expires_at).getTime() <= nowMs && (!row.status || row.status === 'ACTIVE')) {
      return { success: false, reason: 'EXPIRED' };
    }

    // 5. Ownership & fencing token checks if PROCESSING
    if (row.status === 'PROCESSING') {
      const callerFencingToken = options?.fencingToken || 0;
      const currentFencingToken = row.fencing_token || 0;
      if (callerFencingToken > 0 && currentFencingToken > callerFencingToken) {
        return { success: false, reason: 'STALE_FENCING_TOKEN' };
      }

      if (options?.attemptId && row.attempt_id && row.attempt_id !== options.attemptId) {
        const leaseExp = row.processing_lease_expires_at
          ? new Date(row.processing_lease_expires_at).getTime()
          : 0;
        if (nowMs <= leaseExp) {
          return { success: false, reason: 'STALE_ATTEMPT' };
        }
      }
    }

    row.status = 'COMPLETED';
    row.consumed_at = new Date(nowMs).toISOString();
    row.submission_id = submissionId;
    row.idempotency_key = `raid-submission:${challengeId}`;
    await saveDb(db);
    return { success: true, status: 'COMPLETED', submissionId };
  });

  if (options?.detailed) {
    return result;
  }
  return result.success;
}

// -------------------------------------------------------------
// Database Operations: Telegram Members
// -------------------------------------------------------------

export async function getTelegramMember(walletAddress: string): Promise<TelegramMemberRow | null> {
  const db = await loadDb();
  const m = db.telegram_members.find((row) => row.wallet_address === walletAddress);
  return m ? normalizeTelegramMemberRow(m) : null;
}

export async function getTelegramMemberByTelegramUserId(
  telegramUserId: number | string
): Promise<TelegramMemberRow | null> {
  const uid = Number(telegramUserId);
  if (!Number.isFinite(uid)) return null;
  const db = await loadDb();
  const m = db.telegram_members.find(
    (row) => row.telegram_user_id === uid && row.identity_status !== 'disconnected'
  );
  return m ? normalizeTelegramMemberRow(m) : null;
}

export async function getTelegramMemberByChatId(
  chatId: string | number
): Promise<TelegramMemberRow | null> {
  const target = String(chatId).trim();
  if (!target) return null;
  const db = await loadDb();
  const m = db.telegram_members.find(
    (row) =>
      row.identity_status !== 'disconnected' &&
      (row.telegram_chat_id === target ||
        (row.telegram_user_id !== null && String(row.telegram_user_id) === target))
  );
  return m ? normalizeTelegramMemberRow(m) : null;
}

export async function getActivePendingVerificationSessionForWallet(
  walletAddress: string
): Promise<VerificationSessionRow | null> {
  const db = await loadDb();
  const nowMs = Date.now();
  return (
    db.verification_sessions.find(
      (s) =>
        s.wallet_address === walletAddress &&
        s.used_at === null &&
        (!s.status || s.status === 'pending' || s.status === 'retryable_failed') &&
        new Date(s.expires_at).getTime() > nowMs
    ) || null
  );
}

export async function listGroupMembers(): Promise<TelegramMemberRow[]> {
  const db = await loadDb();
  return db.telegram_members
    .filter((m) => m.in_group && m.telegram_user_id !== null)
    .map((m) => normalizeTelegramMemberRow(m));
}

export async function listTrackedTelegramMembers(): Promise<TelegramMemberRow[]> {
  const db = await loadDb();
  return db.telegram_members
    .filter(
      (m) =>
        m.telegram_user_id !== null &&
        m.identity_status !== 'disconnected' &&
        (m.in_group ||
          m.group_status === 'joined' ||
          m.group_status === 'invite_pending' ||
          m.tier === 'pro' ||
          m.entitlement_tier === 'pro' ||
          m.entitlement_tier === 'member')
    )
    .map((m) => normalizeTelegramMemberRow(m));
}

export async function listNotificationSubscribersFromDb(): Promise<Array<{ wallet: string; chatId: string }>> {
  const db = await loadDb();
  return db.telegram_members
    .filter(
      (m) =>
        m.identity_status === 'connected' &&
        m.notification_status === 'enabled' &&
        Boolean(m.telegram_chat_id)
    )
    .map((m) => ({
      wallet: m.wallet_address,
      chatId: String(m.telegram_chat_id),
    }));
}

export async function countVerifiedUsers(): Promise<number> {
  const db = await loadDb();
  const verifiedWallets = new Set<string>();

  for (const m of db.telegram_members || []) {
    if (m.in_group || m.identity_status === 'connected' || m.telegram_user_id !== null) {
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

export async function setMemberInGroup(
  walletAddress: string,
  inGroup: boolean,
  revokedReason?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const m = db.telegram_members.find((x) => x.wallet_address === walletAddress);
    if (m) {
      const now = new Date().toISOString();
      m.in_group = inGroup;
      m.group_status = inGroup ? 'joined' : 'revoked';
      if (inGroup) {
        m.joined_at = m.joined_at || now;
        m.revoked_at = null;
        m.revoked_reason = null;
      } else {
        m.revoked_at = now;
        m.revoked_reason = revokedReason ?? m.revoked_reason ?? 'Access revoked';
      }
      m.last_synced_at = now;
      m.updated_at = now;
      await saveDb(db);
    }
  });
}

export async function upsertTelegramMember(params: {
  wallet_address: string;
  telegram_user_id: number | null;
  tier: 'member' | 'pro';
  in_group: boolean;
  entitlement_tier?: UserTier;
  group_status?: GroupStatus;
  group_id?: string | null;
  telegram_chat_id?: string | null;
}): Promise<TelegramMemberRow> {
  return withDbLock(async () => {
    const db = await loadDb();
    const now = new Date().toISOString();

    if (params.telegram_user_id !== null) {
      const conflict = db.telegram_members.find(
        (m) =>
          m.telegram_user_id === params.telegram_user_id &&
          m.wallet_address !== params.wallet_address &&
          m.identity_status !== 'disconnected'
      );
      if (conflict) {
        throw new Error(`Telegram user ${params.telegram_user_id} is already linked to another wallet.`);
      }
    }

    const existing = db.telegram_members.find((m) => m.wallet_address === params.wallet_address);
    const groupStatus: GroupStatus =
      params.group_status || (params.in_group ? 'joined' : 'not_joined');
    const isJoined = groupStatus === 'joined';

    if (existing) {
      existing.telegram_user_id = params.telegram_user_id ?? existing.telegram_user_id;
      existing.telegram_chat_id =
        params.telegram_chat_id !== undefined
          ? params.telegram_chat_id
          : existing.telegram_chat_id ??
            (existing.telegram_user_id !== null ? String(existing.telegram_user_id) : null);
      existing.tier = params.tier;
      existing.entitlement_tier = params.entitlement_tier ?? params.tier;
      existing.group_status = groupStatus;
      existing.in_group = isJoined;
      if (params.group_id !== undefined) existing.group_id = params.group_id;
      if (isJoined) existing.joined_at = existing.joined_at || now;
      if (existing.telegram_user_id !== null && existing.identity_status !== 'blocked') {
        existing.identity_status = 'connected';
        existing.verified_at = existing.verified_at || now;
      }
      existing.last_synced_at = now;
      existing.updated_at = now;
      await saveDb(db);
      return normalizeTelegramMemberRow(existing);
    }

    const newMember = normalizeTelegramMemberRow({
      wallet: params.wallet_address,
      wallet_address: params.wallet_address,
      telegram_user_id: params.telegram_user_id,
      telegram_chat_id:
        params.telegram_chat_id ??
        (params.telegram_user_id !== null ? String(params.telegram_user_id) : null),
      tier: params.tier,
      entitlement_tier: params.entitlement_tier ?? params.tier,
      identity_status: params.telegram_user_id !== null ? 'connected' : 'pending',
      group_status: groupStatus,
      group_id: params.group_id ?? null,
      in_group: isJoined,
      notification_status: 'disabled',
      verified_at: params.telegram_user_id !== null ? now : null,
      joined_at: isJoined ? now : null,
      last_synced_at: now,
      created_at: now,
      updated_at: now,
    });

    db.telegram_members.push(newMember);
    await saveDb(db);
    return newMember;
  });
}

export type IdentityBindResult =
  | { ok: true; member: TelegramMemberRow }
  | {
      ok: false;
      reason: 'telegram_identity_already_linked' | 'wallet_already_linked_to_other_telegram';
      conflictWallet?: string;
    };

/**
 * Atomically binds a Telegram numeric user ID and private chat ID to an authenticated wallet
 * and records a pending single-use invite WITHOUT falsely marking `in_group` / `joined`.
 */
export async function bindTelegramIdentityAndPendingInvite(params: {
  wallet_address: string;
  telegram_user_id: number;
  telegram_chat_id: string | number;
  entitlement_tier: UserTier;
  target_tier: 'member' | 'pro';
  group_id: string;
  invite_link_hash: string;
  invite_expires_at: string;
  pending_invite_link?: string | null;
}): Promise<IdentityBindResult> {
  return withDbLock(async () => {
    const db = await loadDb();
    const now = new Date().toISOString();

    const otherWalletOwner = db.telegram_members.find(
      (m) =>
        m.telegram_user_id === params.telegram_user_id &&
        m.wallet_address !== params.wallet_address &&
        m.identity_status !== 'disconnected'
    );
    if (otherWalletOwner) {
      return {
        ok: false,
        reason: 'telegram_identity_already_linked',
        conflictWallet: otherWalletOwner.wallet_address,
      };
    }

    const existing = db.telegram_members.find((m) => m.wallet_address === params.wallet_address);
    if (
      existing &&
      existing.telegram_user_id !== null &&
      existing.telegram_user_id !== params.telegram_user_id &&
      existing.identity_status === 'connected'
    ) {
      return {
        ok: false,
        reason: 'wallet_already_linked_to_other_telegram',
      };
    }

    const alreadyJoinedSameGroup =
      existing &&
      existing.group_status === 'joined' &&
      existing.group_id === params.group_id;

    if (existing) {
      existing.telegram_user_id = params.telegram_user_id;
      existing.telegram_chat_id = String(params.telegram_chat_id);
      existing.identity_status = 'connected';
      existing.verified_at = existing.verified_at || now;
      existing.entitlement_tier = params.entitlement_tier;
      existing.tier = params.target_tier;
      existing.group_id = params.group_id;
      existing.group_status = alreadyJoinedSameGroup ? 'joined' : 'invite_pending';
      existing.in_group = Boolean(alreadyJoinedSameGroup);
      existing.invite_created_at = now;
      existing.invite_expires_at = params.invite_expires_at;
      existing.invite_link_hash = params.invite_link_hash;
      if (params.pending_invite_link !== undefined) {
        existing.pending_invite_link = params.pending_invite_link;
      }
      existing.revoked_at = null;
      existing.revoked_reason = null;
      existing.entitlement_unknown_since = null;
      existing.last_error = null;
      existing.last_synced_at = now;
      existing.updated_at = now;
      // Preserve existing notification_status (e.g., if user ran /stop -> keep 'disabled')
      await saveDb(db);
      return { ok: true, member: normalizeTelegramMemberRow(existing) };
    }

    const created = normalizeTelegramMemberRow({
      wallet: params.wallet_address,
      wallet_address: params.wallet_address,
      telegram_user_id: params.telegram_user_id,
      telegram_chat_id: String(params.telegram_chat_id),
      entitlement_tier: params.entitlement_tier,
      tier: params.target_tier,
      identity_status: 'connected',
      group_status: 'invite_pending',
      group_id: params.group_id,
      in_group: false,
      notification_status: 'disabled',
      verified_at: now,
      invite_created_at: now,
      invite_expires_at: params.invite_expires_at,
      invite_link_hash: params.invite_link_hash,
      pending_invite_link: params.pending_invite_link ?? null,
      joined_at: null,
      revoked_at: null,
      revoked_reason: null,
      entitlement_unknown_since: null,
      last_error: null,
      last_synced_at: now,
      created_at: now,
      updated_at: now,
    });

    db.telegram_members.push(created);
    await saveDb(db);
    return { ok: true, member: created };
  });
}

/**
 * Updates confirmed group membership status independently from identity & notifications.
 */
export async function updateTelegramGroupMembership(
  walletAddress: string,
  updates: {
    group_status: GroupStatus;
    group_id?: string | null;
    tier?: 'member' | 'pro';
    entitlement_tier?: UserTier;
    invite_created_at?: string | null;
    invite_expires_at?: string | null;
    invite_link_hash?: string | null;
    pending_invite_link?: string | null;
    revoked_reason?: string | null;
    disable_notifications?: boolean;
  }
): Promise<TelegramMemberRow | null> {
  return withDbLock(async () => {
    const db = await loadDb();
    const existing = db.telegram_members.find((m) => m.wallet_address === walletAddress);
    if (!existing) return null;

    const now = new Date().toISOString();
    existing.group_status = updates.group_status;
    existing.in_group = updates.group_status === 'joined';
    if (updates.group_id !== undefined) existing.group_id = updates.group_id;
    if (updates.tier !== undefined) existing.tier = updates.tier;
    if (updates.entitlement_tier !== undefined) existing.entitlement_tier = updates.entitlement_tier;
    if (updates.invite_created_at !== undefined) existing.invite_created_at = updates.invite_created_at;
    if (updates.invite_expires_at !== undefined) existing.invite_expires_at = updates.invite_expires_at;
    if (updates.invite_link_hash !== undefined) existing.invite_link_hash = updates.invite_link_hash;
    if (updates.pending_invite_link !== undefined) existing.pending_invite_link = updates.pending_invite_link;

    if (updates.group_status === 'joined') {
      existing.joined_at = existing.joined_at || now;
      existing.revoked_at = null;
      existing.revoked_reason = null;
      existing.pending_invite_link = null;
    } else if (updates.group_status === 'revoked') {
      existing.revoked_at = now;
      existing.revoked_reason = updates.revoked_reason ?? existing.revoked_reason ?? 'Entitlement revoked';
      existing.pending_invite_link = null;
    } else if (updates.group_status === 'left' || updates.group_status === 'kicked') {
      existing.pending_invite_link = null;
    }

    if (updates.disable_notifications && existing.notification_status === 'enabled') {
      existing.notification_status = 'disabled';
    }

    existing.entitlement_unknown_since = null;
    existing.last_synced_at = now;
    existing.updated_at = now;
    await saveDb(db);
    return normalizeTelegramMemberRow(existing);
  });
}

export async function recordUnknownEntitlementState(
  walletAddress: string,
  errorReason?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const existing = db.telegram_members.find((m) => m.wallet_address === walletAddress);
    if (!existing) return;
    const now = new Date().toISOString();
    existing.entitlement_tier = 'unknown';
    existing.entitlement_unknown_since = existing.entitlement_unknown_since || now;
    existing.last_error = errorReason ?? 'Entitlement verification temporarily unavailable';
    existing.last_synced_at = now;
    existing.updated_at = now;
    await saveDb(db);
  });
}

/**
 * Sets private notification subscription status without altering community group membership.
 */
export async function setTelegramNotificationStatus(
  walletAddress: string,
  status: NotificationStatus,
  opts?: {
    telegram_user_id?: number;
    telegram_chat_id?: string | number;
    entitlement_tier?: UserTier;
  }
): Promise<{ ok: true; member: TelegramMemberRow } | { ok: false; reason: string }> {
  return withDbLock(async () => {
    const db = await loadDb();
    const now = new Date().toISOString();

    if (opts?.telegram_user_id !== undefined) {
      const otherOwner = db.telegram_members.find(
        (m) =>
          m.telegram_user_id === opts.telegram_user_id &&
          m.wallet_address !== walletAddress &&
          m.identity_status !== 'disconnected'
      );
      if (otherOwner) {
        return { ok: false, reason: 'telegram_identity_already_linked' };
      }
    }

    const existing = db.telegram_members.find((m) => m.wallet_address === walletAddress);
    if (existing) {
      if (
        opts?.telegram_user_id !== undefined &&
        existing.telegram_user_id !== null &&
        existing.telegram_user_id !== opts.telegram_user_id &&
        existing.identity_status === 'connected'
      ) {
        return { ok: false, reason: 'wallet_already_linked_to_other_telegram' };
      }
      if (opts?.telegram_user_id !== undefined) existing.telegram_user_id = opts.telegram_user_id;
      if (opts?.telegram_chat_id !== undefined) existing.telegram_chat_id = String(opts.telegram_chat_id);
      if (opts?.entitlement_tier !== undefined) {
        existing.entitlement_tier = opts.entitlement_tier;
        if (opts.entitlement_tier === 'pro' || opts.entitlement_tier === 'admin') existing.tier = 'pro';
        else if (opts.entitlement_tier === 'member') existing.tier = 'member';
      }
      if (existing.telegram_chat_id && existing.identity_status !== 'blocked') {
        existing.identity_status = 'connected';
        existing.verified_at = existing.verified_at || now;
      }
      if (status === 'blocked') {
        existing.identity_status = 'blocked';
      } else if (existing.identity_status === 'blocked' && status === 'enabled') {
        existing.identity_status = 'connected';
      }
      existing.notification_status = status;
      existing.last_synced_at = now;
      existing.updated_at = now;
      await saveDb(db);
      return { ok: true, member: normalizeTelegramMemberRow(existing) };
    }

    if (!opts?.telegram_chat_id) {
      return { ok: false, reason: 'telegram_not_connected' };
    }

    const legacyTier: 'member' | 'pro' =
      opts?.entitlement_tier === 'pro' || opts?.entitlement_tier === 'admin' ? 'pro' : 'member';
    const created = normalizeTelegramMemberRow({
      wallet: walletAddress,
      wallet_address: walletAddress,
      telegram_user_id: opts?.telegram_user_id ?? null,
      telegram_chat_id: opts?.telegram_chat_id !== undefined ? String(opts.telegram_chat_id) : null,
      entitlement_tier: opts?.entitlement_tier ?? legacyTier,
      tier: legacyTier,
      identity_status: status === 'blocked' ? 'blocked' : 'connected',
      group_status: 'not_joined',
      group_id: null,
      in_group: false,
      notification_status: status,
      verified_at: now,
      last_synced_at: now,
      created_at: now,
      updated_at: now,
    });
    db.telegram_members.push(created);
    await saveDb(db);
    return { ok: true, member: created };
  });
}

export async function disableTelegramNotificationsByChatId(
  chatId: string | number,
  nextStatus: 'disabled' | 'blocked' = 'disabled'
): Promise<{ disabled: boolean; wallet: string | null }> {
  return withDbLock(async () => {
    const db = await loadDb();
    const target = String(chatId).trim();
    const existing = db.telegram_members.find(
      (m) =>
        m.identity_status !== 'disconnected' &&
        (m.telegram_chat_id === target ||
          (m.telegram_user_id !== null && String(m.telegram_user_id) === target))
    );
    if (!existing) {
      return { disabled: false, wallet: null };
    }
    const wasEnabled = existing.notification_status === 'enabled';
    const now = new Date().toISOString();
    existing.notification_status = nextStatus;
    if (nextStatus === 'blocked') {
      existing.identity_status = 'blocked';
    }
    // Preserve wallet link and group_status / in_group completely intact
    existing.last_synced_at = now;
    existing.updated_at = now;
    await saveDb(db);
    return { disabled: wasEnabled, wallet: existing.wallet_address };
  });
}

export async function setTelegramNotificationPreferences(
  walletAddress: string,
  patch: Partial<NotificationPreferences>
): Promise<
  | { ok: true; member: TelegramMemberRow; preferences: NotificationPreferences }
  | { ok: false; reason: string }
> {
  return withDbLock(async () => {
    const db = await loadDb();
    const existing = db.telegram_members.find(
      (m) => m.wallet_address === walletAddress && m.identity_status !== 'disconnected'
    );
    if (!existing) {
      return { ok: false, reason: 'telegram_not_connected' };
    }
    const current = normalizeNotificationPreferences(existing.notification_preferences);
    const next = normalizeNotificationPreferences({
      new_calls: patch.new_calls ?? current.new_calls,
      tp_alerts: patch.tp_alerts ?? current.tp_alerts,
      sl_alerts: patch.sl_alerts ?? current.sl_alerts,
      chains: patch.chains !== undefined ? patch.chains : current.chains,
    });
    const now = new Date().toISOString();
    existing.notification_preferences = next;
    existing.last_synced_at = now;
    existing.updated_at = now;
    await saveDb(db);
    return {
      ok: true,
      member: normalizeTelegramMemberRow(existing),
      preferences: next,
    };
  });
}

// -------------------------------------------------------------
// Database Operations: Hashed Telegram Link Codes & Durable Webhook Idempotency
// -------------------------------------------------------------

export async function createLinkCodeRow(
  codeHash: string,
  walletAddress: string,
  ttlSec = 600
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.telegram_link_codes)) db.telegram_link_codes = [];
    const nowMs = Date.now();
    db.telegram_link_codes = db.telegram_link_codes.filter(
      (c) => new Date(c.expires_at).getTime() > nowMs
    );
    db.telegram_link_codes.push({
      code_hash: codeHash,
      wallet_address: walletAddress,
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + ttlSec * 1000).toISOString(),
    });
    await saveDb(db);
  });
}

export async function consumeLinkCodeRow(codeHash: string): Promise<string | null> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.telegram_link_codes)) return null;
    const nowMs = Date.now();
    const idx = db.telegram_link_codes.findIndex(
      (c) => timingSafeHexEqual(c.code_hash, codeHash) && new Date(c.expires_at).getTime() > nowMs
    );
    if (idx === -1) return null;
    const [found] = db.telegram_link_codes.splice(idx, 1);
    await saveDb(db);
    return found.wallet_address;
  });
}

export type WebhookClaimResult =
  | { claimed: true; leaseToken: string; attemptCount: number }
  | { claimed: false; duplicate: true; status: WebhookEventStatus };

const MAX_WEBHOOK_ATTEMPTS = 5;

export async function claimWebhookUpdate(
  updateId: number,
  eventType = 'unknown',
  leaseMs = 30_000
): Promise<WebhookClaimResult> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.telegram_webhook_events)) db.telegram_webhook_events = [];

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Retain recent events (48h for completed/failed, bounded list)
    const pruneBefore = nowMs - 48 * 60 * 60 * 1000;
    db.telegram_webhook_events = db.telegram_webhook_events.filter(
      (e) =>
        e.update_id === updateId ||
        e.status === 'processing' ||
        e.status === 'retryable_failed' ||
        new Date(e.updated_at).getTime() > pruneBefore
    );
    if (db.telegram_webhook_events.length > 5000) {
      db.telegram_webhook_events = db.telegram_webhook_events.slice(-4000);
    }

    const existing = db.telegram_webhook_events.find((e) => e.update_id === updateId);
    const leaseToken = safeRandomUUID();

    if (!existing) {
      db.telegram_webhook_events.push({
        update_id: updateId,
        status: 'processing',
        event_type: eventType,
        attempt_count: 1,
        lease_token: leaseToken,
        lease_expires_at: nowMs + leaseMs,
        last_error: null,
        created_at: nowIso,
        updated_at: nowIso,
        completed_at: null,
      });
      await saveDb(db);
      return { claimed: true, leaseToken, attemptCount: 1 };
    }

    if (existing.status === 'completed' || existing.status === 'permanently_failed') {
      return { claimed: false, duplicate: true, status: existing.status };
    }

    if (
      existing.status === 'processing' &&
      existing.lease_expires_at !== null &&
      existing.lease_expires_at > nowMs
    ) {
      return { claimed: false, duplicate: true, status: 'processing' };
    }

    if (existing.attempt_count >= MAX_WEBHOOK_ATTEMPTS) {
      existing.status = 'permanently_failed';
      existing.lease_token = null;
      existing.lease_expires_at = null;
      existing.updated_at = nowIso;
      await saveDb(db);
      return { claimed: false, duplicate: true, status: 'permanently_failed' };
    }

    existing.status = 'processing';
    existing.attempt_count += 1;
    existing.lease_token = leaseToken;
    existing.lease_expires_at = nowMs + leaseMs;
    existing.updated_at = nowIso;
    await saveDb(db);
    return { claimed: true, leaseToken, attemptCount: existing.attempt_count };
  });
}

export async function markWebhookUpdateCompleted(
  updateId: number,
  leaseToken?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const ev = (db.telegram_webhook_events || []).find((e) => e.update_id === updateId);
    if (!ev) return;
    if (leaseToken && ev.lease_token && ev.lease_token !== leaseToken && ev.status === 'completed') return;
    const nowIso = new Date().toISOString();
    ev.status = 'completed';
    ev.lease_token = null;
    ev.lease_expires_at = null;
    ev.last_error = null;
    ev.completed_at = nowIso;
    ev.updated_at = nowIso;
    await saveDb(db);
  });
}

export async function markWebhookUpdateRetryable(
  updateId: number,
  errorMessage: string,
  leaseToken?: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const ev = (db.telegram_webhook_events || []).find((e) => e.update_id === updateId);
    if (!ev || ev.status === 'completed') return;
    if (leaseToken && ev.lease_token && ev.lease_token !== leaseToken) return;
    const nowIso = new Date().toISOString();
    ev.status = ev.attempt_count >= MAX_WEBHOOK_ATTEMPTS ? 'permanently_failed' : 'retryable_failed';
    ev.lease_token = null;
    ev.lease_expires_at = null;
    ev.last_error = errorMessage;
    ev.updated_at = nowIso;
    await saveDb(db);
  });
}

export async function markWebhookUpdatePermanentlyFailed(
  updateId: number,
  errorMessage: string
): Promise<void> {
  await withDbLock(async () => {
    const db = await loadDb();
    const ev = (db.telegram_webhook_events || []).find((e) => e.update_id === updateId);
    if (!ev || ev.status === 'completed') return;
    const nowIso = new Date().toISOString();
    ev.status = 'permanently_failed';
    ev.lease_token = null;
    ev.lease_expires_at = null;
    ev.last_error = errorMessage;
    ev.updated_at = nowIso;
    await saveDb(db);
  });
}

// -------------------------------------------------------------
// Idempotent Schema & Legacy Subscriber Migration (v2)
// -------------------------------------------------------------

const TELEGRAM_V2_BACKUP_FILE = path.join(process.cwd(), 'data', 'telegram_v2_migration_backup.json');
const TELEGRAM_V2_BACKUP_KV_KEY = 'trench:db:telegram_v2_backup';

export async function migrateTelegramSchemaAndSubscribers(options?: {
  legacySubscribers?: Record<string, string>;
}): Promise<{
  alreadyApplied: boolean;
  version: number;
  membersNormalized: number;
  legacySubsMigrated: number;
}> {
  return withDbLock(async () => {
    const db = await loadDb();
    const legacySubs = options?.legacySubscribers || {};
    const now = new Date().toISOString();

    // Persist an idempotent backup snapshot before modifying any records (for rollback safety)
    const rawBackupExists = KV_CONFIGURED
      ? Boolean(await kvGet(TELEGRAM_V2_BACKUP_KV_KEY).catch(() => null))
      : fs.existsSync(TELEGRAM_V2_BACKUP_FILE);

    if (!rawBackupExists) {
      const snapshot = JSON.stringify({
        backed_up_at: now,
        telegram_members: db.telegram_members || [],
        legacy_subscribers: legacySubs,
      });
      if (KV_CONFIGURED) {
        await kvSet(TELEGRAM_V2_BACKUP_KV_KEY, snapshot);
      } else {
        try {
          fs.mkdirSync(path.dirname(TELEGRAM_V2_BACKUP_FILE), { recursive: true });
          fs.writeFileSync(TELEGRAM_V2_BACKUP_FILE, snapshot, 'utf8');
        } catch {}
      }
    }

    const membersNormalized = (db.telegram_members || []).length;
    db.telegram_members = (db.telegram_members || []).map((m) => normalizeTelegramMemberRow(m));

    let legacySubsMigrated = 0;
    for (const [walletRaw, chatIdRaw] of Object.entries(legacySubs)) {
      const wallet = String(walletRaw || '').trim();
      const chatId = String(chatIdRaw || '').trim();
      if (!wallet || !chatId) continue;

      const numericChatId = /^-?\d+$/.test(chatId) ? Number(chatId) : null;
      const existingByWallet = db.telegram_members.find((m) => m.wallet_address === wallet);

      if (existingByWallet) {
        if (!existingByWallet.telegram_chat_id) {
          existingByWallet.telegram_chat_id = chatId;
          legacySubsMigrated++;
        }
        if (existingByWallet.telegram_user_id === null && numericChatId !== null && numericChatId > 0) {
          const conflictingOwner = db.telegram_members.find(
            (m) => m.telegram_user_id === numericChatId && m.wallet_address !== wallet && m.identity_status !== 'disconnected'
          );
          if (!conflictingOwner) {
            existingByWallet.telegram_user_id = numericChatId;
          }
        }
        if (existingByWallet.identity_status !== 'blocked') {
          existingByWallet.identity_status = 'connected';
          existingByWallet.verified_at = existingByWallet.verified_at || now;
        }
        // Only promote disabled -> enabled during initial migration if untouched by explicit /stop after v2
        if (!db.telegram_migration && existingByWallet.notification_status === 'disabled') {
          existingByWallet.notification_status = 'enabled';
          legacySubsMigrated++;
        }
        existingByWallet.updated_at = now;
      } else {
        const conflictingOwner =
          numericChatId !== null && numericChatId > 0
            ? db.telegram_members.find(
                (m) => m.telegram_user_id === numericChatId && m.identity_status !== 'disconnected'
              )
            : null;
        if (conflictingOwner) continue;

        db.telegram_members.push(
          normalizeTelegramMemberRow({
            wallet,
            wallet_address: wallet,
            telegram_user_id: numericChatId && numericChatId > 0 ? numericChatId : null,
            telegram_chat_id: chatId,
            entitlement_tier: 'member',
            tier: 'member',
            identity_status: 'connected',
            // Never assume community group membership from legacy alert subscription alone
            group_status: 'not_joined',
            in_group: false,
            notification_status: 'enabled',
            verified_at: now,
            last_synced_at: now,
            created_at: now,
            updated_at: now,
          })
        );
        legacySubsMigrated++;
      }
    }

    const alreadyApplied = db.telegram_migration?.version === TELEGRAM_SCHEMA_VERSION;
    if (!alreadyApplied || legacySubsMigrated > 0) {
      db.telegram_migration = {
        version: TELEGRAM_SCHEMA_VERSION,
        applied_at: now,
        members_normalized: membersNormalized,
        legacy_subs_migrated: (db.telegram_migration?.legacy_subs_migrated || 0) + legacySubsMigrated,
      };
    }

    await saveDb(db);
    return {
      alreadyApplied,
      version: TELEGRAM_SCHEMA_VERSION,
      membersNormalized,
      legacySubsMigrated,
    };
  });
}

export async function rollbackTelegramMigration(): Promise<{ restored: boolean; memberCount: number }> {
  return withDbLock(async () => {
    const raw = KV_CONFIGURED
      ? await kvGet(TELEGRAM_V2_BACKUP_KV_KEY)
      : fs.existsSync(TELEGRAM_V2_BACKUP_FILE)
      ? fs.readFileSync(TELEGRAM_V2_BACKUP_FILE, 'utf8')
      : null;

    if (!raw) return { restored: false, memberCount: 0 };
    const parsed = JSON.parse(raw) as { telegram_members?: TelegramMemberRow[] };
    const db = await loadDb();
    if (Array.isArray(parsed.telegram_members)) {
      db.telegram_members = parsed.telegram_members.map((m) => normalizeTelegramMemberRow(m));
    }
    delete db.telegram_migration;
    await saveDb(db);
    return { restored: true, memberCount: db.telegram_members.length };
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

// -------------------------------------------------------------
// Database Operations: User Favorites / Pinned Posts
// -------------------------------------------------------------

function favoriteIdentityKey(item: Pick<FavoritePostRecord, 'id' | 'kind'>): string {
  return `${item.kind === 'RAID' ? 'RAID' : 'CALL'}:${item.id}`;
}

export async function getUserFavorites(walletAddress: string): Promise<FavoritePostRecord[]> {
  return withDbLock(async () => {
    const db = await loadDb();
    const list = db.user_favorites?.[walletAddress];
    return Array.isArray(list) ? [...list] : [];
  });
}

export async function setUserFavorite(
  walletAddress: string,
  item: { id: string; kind: FavoritePostKind },
  active: boolean
): Promise<FavoritePostRecord[]> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!db.user_favorites || typeof db.user_favorites !== 'object') {
      db.user_favorites = {};
    }
    const existing = Array.isArray(db.user_favorites[walletAddress])
      ? db.user_favorites[walletAddress]
      : [];
    const targetKey = favoriteIdentityKey(item);
    const filtered = existing.filter((entry) => favoriteIdentityKey(entry) !== targetKey);

    const next = active
      ? [{ id: item.id, kind: item.kind, createdAt: new Date().toISOString() }, ...filtered].slice(0, 200)
      : filtered;

    db.user_favorites[walletAddress] = next;
    await saveDb(db);
    return [...next];
  });
}

export async function mergeUserFavorites(
  walletAddress: string,
  items: Array<{ id: string; kind: FavoritePostKind; createdAt?: string }>
): Promise<FavoritePostRecord[]> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!db.user_favorites || typeof db.user_favorites !== 'object') {
      db.user_favorites = {};
    }
    const existing = Array.isArray(db.user_favorites[walletAddress])
      ? db.user_favorites[walletAddress]
      : [];

    const mergedMap = new Map<string, FavoritePostRecord>();
    for (const entry of existing) {
      mergedMap.set(favoriteIdentityKey(entry), entry);
    }
    for (const incoming of items) {
      const key = favoriteIdentityKey(incoming);
      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          id: incoming.id,
          kind: incoming.kind,
          createdAt: incoming.createdAt || new Date().toISOString(),
        });
      }
    }

    const next = Array.from(mergedMap.values()).slice(0, 200);
    db.user_favorites[walletAddress] = next;
    await saveDb(db);
    return [...next];
  });
}


