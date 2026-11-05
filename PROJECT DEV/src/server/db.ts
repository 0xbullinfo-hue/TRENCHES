import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { KV_CONFIGURED, kvGet, kvSet, kvLock, kvUnlock } from '@/server/kv';
import { readGenesisBalanceCached } from '@/server/genesis';
import { ADMIN_WALLET, isAdminWallet, TOKEN_DECIMALS, TOKEN_SYMBOL } from '@/lib/config';

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
  staking_provider: string; // default 'streamflow_stub'
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

export interface LedgerEntryRow {
  id: string; // uuid primary key
  ticker: string; // text not null
  chain: string; // text not null ('solana' | 'ethereum' | 'base' | 'bsc' | 'other')
  contract_address: string; // text not null
  multiplier: string; // numeric(10,4) string, e.g. "3.4000"
  entry_price?: string | null;
  exit_price?: string | null;
  proof_url?: string | null;
  notes?: string | null;
  closed_at: string; // timestamptz ISO
  posted_by: string; // admin wallet address
  posted_at: string; // timestamptz ISO default now()
  updated_at?: string | null; // timestamptz
}

export interface LedgerEntryWithEdited extends LedgerEntryRow {
  edited: boolean;
}

interface TrenchDatabaseSchema {
  tier_thresholds: TierThresholdRow[];
  stakes: StakeRow[];
  verification_sessions: VerificationSessionRow[];
  telegram_members: TelegramMemberRow[];
  ledger_entries: LedgerEntryRow[];
}

const DATA_FILE_PATH = path.join(process.cwd(), 'data', 'db.json');
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
  };
}

let inMemoryDb: TrenchDatabaseSchema = buildInitialSeed();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dbLockChain = Promise.resolve();

async function withDbLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = dbLockChain.then(async () => {
    if (!KV_CONFIGURED) return fn();
    const token = safeRandomUUID();
    let acquired = false;
    for (let i = 0; i < 20 && !acquired; i++) {
      acquired = await kvLock(DB_LOCK_KEY, token, 10);
      if (!acquired) await sleep(100);
    }
    if (!acquired) throw new Error('Database busy, retry shortly');
    try {
      return await fn();
    } finally {
      await kvUnlock(DB_LOCK_KEY, token).catch(() => undefined);
    }
  });
  dbLockChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function loadDb(): Promise<TrenchDatabaseSchema> {
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
      return parsed;
    } catch {
      return buildInitialSeed();
    }
  }

  if (fs.existsSync(DATA_FILE_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE_PATH, 'utf-8'));
      if (parsed && Array.isArray(parsed.tier_thresholds)) {
        if (!Array.isArray(parsed.ledger_entries)) parsed.ledger_entries = [];
        inMemoryDb = parsed;
        return inMemoryDb;
      }
    } catch {
      // ignore
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
  }
}

// -------------------------------------------------------------
// Database Operations: Tier Thresholds
// -------------------------------------------------------------

export async function getTierThresholds(): Promise<{
  member: TierThresholdRow;
  pro: TierThresholdRow;
  stale: boolean;
}> {
  const db = await loadDb();
  let member = db.tier_thresholds.find((t) => t.tier === 'member');
  let pro = db.tier_thresholds.find((t) => t.tier === 'pro');

  if (!member || !pro) {
    const seeded = buildInitialSeed();
    await withDbLock(async () => {
      const current = await loadDb();
      if (!current.tier_thresholds.some((t) => t.tier === 'member')) {
        current.tier_thresholds.push(seeded.tier_thresholds[0]);
      }
      if (!current.tier_thresholds.some((t) => t.tier === 'pro')) {
        current.tier_thresholds.push(seeded.tier_thresholds[1]);
      }
      await saveDb(current);
    });
    member = member || seeded.tier_thresholds[0];
    pro = pro || seeded.tier_thresholds[1];
  }

  const now = new Date().toISOString();
  const stale = member.valid_until < now || pro.valid_until < now;

  return { member, pro, stale };
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
  const { member, pro, stale } = await getTierThresholds();
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
      twap_source: 'placeholder',
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
      staking_provider: params.staking_provider || 'streamflow_stub',
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
  const bytes = crypto.randomBytes(length);
  let res = '';
  for (let i = 0; i < length; i++) {
    res += BASE62_CHARS[bytes[i] % BASE62_CHARS.length];
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

// -------------------------------------------------------------
// Database Operations: Telegram Members
// -------------------------------------------------------------

export async function getTelegramMember(walletAddress: string): Promise<TelegramMemberRow | null> {
  const db = await loadDb();
  return db.telegram_members.find((m) => m.wallet_address === walletAddress) || null;
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

export async function resolveTier(walletAddress: string): Promise<'free' | 'member' | 'pro'> {
  if (isAdminWallet(walletAddress)) {
    return 'pro';
  }

  // 1. Check for active Pro stakes >= $250
  const activeStakes = await getActiveStakes(walletAddress);
  const totalStakedRaw = activeStakes.reduce((acc, s) => acc + BigInt(s.amount_raw), BigInt(0));
  const { pro, member } = await getTierThresholds();
  const proThresholdRaw = BigInt(pro.token_amount);

  if (totalStakedRaw >= proThresholdRaw) {
    return 'pro';
  }

  // 2. Check on-chain balance for Member tier
  try {
    const balance = await readGenesisBalanceCached(walletAddress);
    const memberThresholdTokens = Number(member.token_amount) / Math.pow(10, TOKEN_DECIMALS);
    if (balance >= memberThresholdTokens || balance >= 1_000_000) {
      return 'member';
    }
  } catch (err) {
    console.error('[TrenchLabs DB] Balance lookup failed during tier resolution:', err);
  }

  return 'free';
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
  notes?: string | null;
  closed_at: string;
  posted_by: string;
}): Promise<LedgerEntryRow> {
  return withDbLock(async () => {
    const db = await loadDb();
    if (!Array.isArray(db.ledger_entries)) db.ledger_entries = [];

    const now = new Date().toISOString();
    const entry: LedgerEntryRow = {
      id: safeRandomUUID(),
      ticker: params.ticker.toUpperCase().replace(/^\$/, ''),
      chain: params.chain.toLowerCase(),
      contract_address: params.contract_address.trim(),
      multiplier: Number(params.multiplier).toFixed(4),
      entry_price: params.entry_price?.trim() || null,
      exit_price: params.exit_price?.trim() || null,
      proof_url: params.proof_url?.trim() || null,
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
      edited: !!found.updated_at && new Date(found.updated_at).getTime() > new Date(found.posted_at).getTime(),
    };
  });
}

export async function updateLedgerEntry(
  id: string,
  updates: Partial<Pick<LedgerEntryRow, 'ticker' | 'chain' | 'contract_address' | 'multiplier' | 'entry_price' | 'exit_price' | 'proof_url' | 'notes' | 'closed_at'>>
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
    if (updates.notes !== undefined) entry.notes = updates.notes?.trim() || null;
    if (updates.closed_at !== undefined) entry.closed_at = new Date(updates.closed_at).toISOString();

    entry.updated_at = new Date().toISOString();
    await saveDb(db);

    return {
      ...entry,
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


