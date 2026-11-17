import { NextRequest, NextResponse } from 'next/server';
import { isAdminWallet, isBase58Address } from '@/lib/config';
import type { FavoritePostKind, FavoritePostRecord } from '@/lib/types';
import { getAuthSession } from '@/server/auth';
import {
  getUserFavorites,
  mergeUserFavorites,
  setUserFavorite,
} from '@/server/db';
import {
  loadCallsRegistry,
  resolveDestinations,
  resolvePublishStatus,
  type AlphaRecord,
} from '@/server/alphas-data';
import { clientIp, rateLimit } from '@/server/ratelimit';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

const VALID_KINDS: FavoritePostKind[] = ['ALPHA', 'MAX_ALPHA', 'RAID'];

function normalizeKind(raw: unknown): FavoritePostKind | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return VALID_KINDS.includes(upper as FavoritePostKind)
    ? (upper as FavoritePostKind)
    : null;
}

function canAccessFavoriteKind(
  kind: FavoritePostKind,
  tier: string,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  if (kind === 'RAID') return true;
  if (kind === 'ALPHA') return tier === 'member' || tier === 'pro';
  if (kind === 'MAX_ALPHA') return tier === 'pro';
  return false;
}

function resolveEffectiveKindForRecord(
  id: string,
  claimedKind: FavoritePostKind,
  callsById: Map<string, AlphaRecord>,
  isAdmin: boolean
): { allowed: boolean; effectiveKind: FavoritePostKind } {
  if (claimedKind === 'RAID') {
    return { allowed: true, effectiveKind: 'RAID' };
  }

  const record = callsById.get(id);
  if (!record) {
    return { allowed: true, effectiveKind: claimedKind };
  }

  if (resolvePublishStatus(record) !== 'PUBLISHED' && !isAdmin) {
    return { allowed: false, effectiveKind: claimedKind };
  }

  const dests = resolveDestinations(record);
  const isProOnly =
    record.callType === 'MAX_ALPHA' ||
    Boolean(record.isMaxAlpha) ||
    record.minTier === 'PRO' ||
    (dests.includes('MAX_ALPHA') && !dests.includes('ALPHA'));

  return {
    allowed: true,
    effectiveKind: isProOnly ? 'MAX_ALPHA' : claimedKind,
  };
}

function filterAccessibleFavorites(
  favorites: FavoritePostRecord[],
  callsById: Map<string, AlphaRecord>,
  tier: string,
  isAdmin: boolean
): FavoritePostRecord[] {
  return favorites.filter((fav) => {
    const check = resolveEffectiveKindForRecord(fav.id, fav.kind, callsById, isAdmin);
    if (!check.allowed) return false;
    return canAccessFavoriteKind(check.effectiveKind, tier, isAdmin);
  });
}

async function buildCallsLookup(): Promise<Map<string, AlphaRecord>> {
  try {
    const registry = await loadCallsRegistry();
    return new Map(registry.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

export async function GET(req: NextRequest) {
  const ipLimit = await rateLimit(`fav-get:ip:${clientIp(req)}`, 60, 60);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'RATE_LIMITED', message: 'Too many requests.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfter) } }
    );
  }

  const session = await getAuthSession(req);
  if (!session || !isBase58Address(session.wallet)) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED', message: 'Authenticated wallet session required.' },
      { status: 401, headers: NO_STORE }
    );
  }

  const isAdmin = isAdminWallet(session.wallet);
  const rawFavorites = await getUserFavorites(session.wallet);
  const callsById = await buildCallsLookup();
  const favorites = filterAccessibleFavorites(rawFavorites, callsById, session.tier, isAdmin);

  return NextResponse.json(
    { ok: true, wallet: session.wallet, favorites },
    { headers: NO_STORE }
  );
}

export async function POST(req: NextRequest) {
  const ipLimit = await rateLimit(`fav-post:ip:${clientIp(req)}`, 60, 60);
  if (!ipLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'RATE_LIMITED', message: 'Too many requests.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfter) } }
    );
  }

  const session = await getAuthSession(req);
  if (!session || !isBase58Address(session.wallet)) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED', message: 'Authenticated wallet session required.' },
      { status: 401, headers: NO_STORE }
    );
  }

  const walletLimit = await rateLimit(`fav-post:wallet:${session.wallet}`, 60, 60);
  if (!walletLimit.ok) {
    return NextResponse.json(
      { ok: false, error: 'RATE_LIMITED', message: 'Too many favorite updates.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(walletLimit.retryAfter) } }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'BAD_REQUEST', message: 'Invalid JSON request body.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const isAdmin = isAdminWallet(session.wallet);
  const callsById = await buildCallsLookup();

  // Batch migration from legacy client storage (idempotent, filters unauthorized entries silently)
  if (Array.isArray((body as { migrate?: unknown }).migrate)) {
    const rawItems = (body as { migrate: unknown[] }).migrate.slice(0, 100);
    const validToMerge: Array<{ id: string; kind: FavoritePostKind; createdAt?: string }> = [];

    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as { id?: unknown; kind?: unknown; createdAt?: unknown };
      const id = typeof e.id === 'string' ? e.id.trim().slice(0, 128) : '';
      const kind = normalizeKind(e.kind);
      if (!id || !kind) continue;

      const resolved = resolveEffectiveKindForRecord(id, kind, callsById, isAdmin);
      if (!resolved.allowed) continue;
      if (!canAccessFavoriteKind(resolved.effectiveKind, session.tier, isAdmin)) continue;

      validToMerge.push({
        id,
        kind: resolved.effectiveKind,
        createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
      });
    }

    const updated = await mergeUserFavorites(session.wallet, validToMerge);
    const favorites = filterAccessibleFavorites(updated, callsById, session.tier, isAdmin);
    return NextResponse.json(
      { ok: true, wallet: session.wallet, favorites },
      { headers: NO_STORE }
    );
  }

  // Single favorite toggle/set
  const id = typeof (body as { id?: unknown }).id === 'string'
    ? (body as { id: string }).id.trim().slice(0, 128)
    : '';
  const kind = normalizeKind((body as { kind?: unknown }).kind);
  const active =
    typeof (body as { active?: unknown }).active === 'boolean'
      ? (body as { active: boolean }).active
      : true;

  if (!id || !kind) {
    return NextResponse.json(
      { ok: false, error: 'BAD_REQUEST', message: 'Valid post id and kind (ALPHA | MAX_ALPHA | RAID) are required.' },
      { status: 400, headers: NO_STORE }
    );
  }

  if (active) {
    const resolved = resolveEffectiveKindForRecord(id, kind, callsById, isAdmin);
    if (!resolved.allowed || !canAccessFavoriteKind(resolved.effectiveKind, session.tier, isAdmin)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'FORBIDDEN',
          message: `Current membership tier does not permit favoriting ${resolved.effectiveKind} content.`,
        },
        { status: 403, headers: NO_STORE }
      );
    }

    const updated = await setUserFavorite(
      session.wallet,
      { id, kind: resolved.effectiveKind },
      true
    );
    const favorites = filterAccessibleFavorites(updated, callsById, session.tier, isAdmin);
    return NextResponse.json(
      { ok: true, wallet: session.wallet, favorites },
      { headers: NO_STORE }
    );
  }

  const updated = await setUserFavorite(session.wallet, { id, kind }, false);
  const favorites = filterAccessibleFavorites(updated, callsById, session.tier, isAdmin);
  return NextResponse.json(
    { ok: true, wallet: session.wallet, favorites },
    { headers: NO_STORE }
  );
}

export async function DELETE(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session || !isBase58Address(session.wallet)) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED', message: 'Authenticated wallet session required.' },
      { status: 401, headers: NO_STORE }
    );
  }

  const id = req.nextUrl.searchParams.get('id')?.trim().slice(0, 128) || '';
  const kind = normalizeKind(req.nextUrl.searchParams.get('kind'));
  if (!id || !kind) {
    return NextResponse.json(
      { ok: false, error: 'BAD_REQUEST', message: 'Query parameters id and kind are required.' },
      { status: 400, headers: NO_STORE }
    );
  }

  const isAdmin = isAdminWallet(session.wallet);
  const updated = await setUserFavorite(session.wallet, { id, kind }, false);
  const callsById = await buildCallsLookup();
  const favorites = filterAccessibleFavorites(updated, callsById, session.tier, isAdmin);

  return NextResponse.json(
    { ok: true, wallet: session.wallet, favorites },
    { headers: NO_STORE }
  );
}
