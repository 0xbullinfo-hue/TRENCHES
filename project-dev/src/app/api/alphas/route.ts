import { NextRequest, NextResponse, after } from 'next/server';
import { tierFor, allocationCap, calculateRequiredTokens, MEMBER_USD_TARGET, PRO_USD_TARGET, DEFAULT_GENESIS_USD_PRICE, TIERS } from '@/lib/tiers';
import { resolveTier } from '@/server/db';
import {
  ADMIN_WALLET,
  GENESIS_MINT,
  isAdminWallet,
  isBase58Address,
} from '@/lib/config';
import {
  AlphaRecord,
  alphasForTier,
  buildTakeProfits,
  formatCompactUsd,
  loadCallsRegistry,
  samplePortfolio,
  saveCallsRegistry,
  withRegistryLock,
  buildCallers,
} from '@/server/alphas-data';
import { verifyAdminAuth, verifyWalletAuth } from '@/server/auth';
import { clientIp, rateLimit } from '@/server/ratelimit';
import { readGenesisBalanceCached } from '@/server/genesis';
import { notifyNewCall, dispatchDelayedMemberCalls } from '@/server/telegram';
import { getMarketTelemetry } from '@/server/market-data';
import type {
  AlphasErr,
  AlphasOk,
  ArtMotif,
  Chain,
  QuoteToken,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // lets the post-response Telegram fan-out finish on serverless hosts

const NO_STORE = { 'Cache-Control': 'no-store' };

const MOTIFS: ArtMotif[] = [
  'pill',
  'baton',
  'bull',
  'swordcat',
  'jubjub',
  'catdog',
  'anteater',
  'stealth',
  'babypump',
  'barron',
  'ape',
  'otcity',
];

const VALID_CHAINS: Chain[] = ['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

function err(status: number, error: AlphasErr['error'], message: string) {
  const body: AlphasErr = { ok: false, error, message, items: [] };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function parseShorthandUsd(str: string): number {
  if (!str) return 0;
  const clean = str.replace(/[$,\s]/g, '').toUpperCase();
  const num = parseFloat(clean);
  if (!Number.isFinite(num)) return 0;
  if (clean.endsWith('B')) return num * 1_000_000_000;
  if (clean.endsWith('M')) return num * 1_000_000;
  if (clean.endsWith('K')) return num * 1_000;
  return num;
}

function tooMany(retryAfter: number) {
  const body: AlphasErr = { ok: false, error: 'RATE_LIMITED', message: 'Too many requests. Slow down.', items: [] };
  return NextResponse.json(body, { status: 429, headers: { ...NO_STORE, 'Retry-After': String(retryAfter) } });
}

const storeDown = () => err(502, 'STORE_UNAVAILABLE', 'Calls store unavailable. Retry shortly.');

export async function GET(req: NextRequest) {
  const ipLimit = await rateLimit(`get:ip:${clientIp(req)}`, 60, 60);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfter);

  const auth = verifyWalletAuth(req);
  if (!auth.ok) {
    return err(401, 'UNAUTHORIZED', auth.error || 'Cryptographic wallet signature authentication required.');
  }

  const wallet = auth.wallet!;
  if (!isBase58Address(wallet)) {
    return err(400, 'BAD_REQUEST', 'Invalid base58 Solana wallet address');
  }

  const walletLimit = await rateLimit(`get:wallet:${wallet}`, 20, 60);
  if (!walletLimit.ok) return tooMany(walletLimit.retryAfter);

  const isAdmin = isAdminWallet(wallet);
  let balance = 0;
  try {
    balance = await readGenesisBalanceCached(wallet);
  } catch {
    // Fail CLOSED for everyone, admin included
    return err(502, 'RPC_UNAVAILABLE', 'Solana RPC unavailable. Retry shortly.');
  }

  const userTier = await resolveTier(wallet);
  if (!isAdmin && userTier === 'free') {
    return NextResponse.json(
      {
        ok: false,
        error: 'ACCESS_DENIED_ZERO_BALANCE',
        message: `Access restricted. Holding at least $20 worth of $GENESIS (${GENESIS_MINT}) or staking $250 on StakePoint is required.`,
        balance,
        items: [],
      },
      { status: 403, headers: NO_STORE }
    );
  }

  const effectiveBalance = Math.max(
    balance,
    isAdmin ? calculateRequiredTokens(PRO_USD_TARGET, DEFAULT_GENESIS_USD_PRICE) : 0
  );
  const tier = isAdmin ? TIERS.PRO : tierFor(effectiveBalance);
  let registry;
  try {
    registry = await loadCallsRegistry();
  } catch {
    return storeDown();
  }
  const baseItems = await alphasForTier(tier.id, Date.now(), registry, isAdmin);

  // Wire live market telemetry into calls with CA
  const items = await Promise.all(
    baseItems.map(async (it) => {
      if (!it.ca) return it;
      try {
        const t = await getMarketTelemetry(it.ca, it.marketCapUsd, it.change24hPct, it.chain);
        const mc = t.marketCapUsd ?? it.marketCapUsd;
        return {
          ...it,
          marketCapUsd: mc,
          marketCap: formatCompactUsd(mc),
          change24hPct: t.change24hPct ?? it.change24hPct,
          dataFreshness: t.freshness,
          marketDataSource: t.source,
        };
      } catch {
        return it;
      }
    })
  );

  let verifiedUsersCount = 0;
  try {
    const { countVerifiedUsers } = await import('@/server/db');
    verifiedUsersCount = await countVerifiedUsers();
  } catch {
    verifiedUsersCount = 0;
  }

  const body: AlphasOk = {
    ok: true,
    tier: tier.id,
    tierLabel: isAdmin ? 'Master Admin' : tier.label,
    multiplier: tier.multiplier,
    allocationCap: allocationCap(tier),
    balance,
    verified: true,
    isAdmin,
    genesisMint: GENESIS_MINT,
    items,
    callers: buildCallers(registry),
    portfolio: samplePortfolio(),
    serverTime: new Date().toISOString(),
    verifiedUsersCount,
  };

  after(() => {
    dispatchDelayedMemberCalls().catch((e) =>
      console.error('[TrenchLabs API] Background delayed member dispatch error:', e)
    );
  });

  return NextResponse.json(body, { headers: NO_STORE });
}

/** POST /api/alphas — Admin creates a new trade call (Cryptographically Verified, Request-Bound) */
export async function POST(req: NextRequest) {
  try {
    const adminLimit = await rateLimit(`admin:${clientIp(req)}`, 30, 60);
    if (!adminLimit.ok) return tooMany(adminLimit.retryAfter);
    const raw = await req.text();
    const auth = await verifyAdminAuth(req, raw);
    if (!auth.authorized) {
      return err(
        403,
        'UNAUTHORIZED_ADMIN',
        auth.error || `Only Master Admin (${ADMIN_WALLET}) with valid cryptographic signature is authorized.`
      );
    }

    const payload = JSON.parse(raw || '{}');
    const name = String(payload.name || '').trim().slice(0, 64);
    const rawTicker = String(payload.ticker || '').trim().slice(0, 16);
    const ticker = rawTicker.startsWith('$') ? rawTicker : `$${rawTicker}`;
    const ca = String(payload.ca || '').trim();
    const chainRaw = String(payload.chain || '').toUpperCase() as Chain;
    if (!VALID_CHAINS.includes(chainRaw)) {
      return err(400, 'BAD_REQUEST', `Unsupported chain: ${payload.chain || 'unspecified'}. Supported chains: ${VALID_CHAINS.join(', ')}`);
    }
    const chain = chainRaw;

    if (!name || !rawTicker || !ca) {
      return err(400, 'BAD_REQUEST', 'Token Name, Ticker, and Contract Address (CA) are required.');
    }

    // P2-2 Contract address format validation
    if (chain === 'SOL') {
      if (!isBase58Address(ca) || ca.length < 32 || ca.length > 44) {
        return err(400, 'BAD_REQUEST', 'Invalid Solana token contract address format');
      }
    } else if (chain === 'ETH' || chain === 'BASE' || chain === 'BSC' || chain === 'AVAX') {
      if (!/^0x[a-fA-F0-9]{40}$/.test(ca)) {
        return err(400, 'BAD_REQUEST', `Invalid EVM token contract address for chain ${chain}`);
      }
    } else if (ca.length < 4 || ca.length > 128) {
      return err(400, 'BAD_REQUEST', 'Invalid contract address length');
    }

    // Automatically fetch live market telemetry from DexScreener when call is posted
    let liveMcUsd = 0;
    let liveChange24h = 0;
    let liveVolumeUsd = 0;
    let liveLogoUrl = '';
    try {
      const telemetry = await getMarketTelemetry(ca, 0, 0, chain);
      if (telemetry?.imageUrl) {
        liveLogoUrl = telemetry.imageUrl;
      }
      if (telemetry?.marketCapUsd && telemetry.marketCapUsd > 0) {
        liveMcUsd = telemetry.marketCapUsd;
        liveChange24h = telemetry.change24hPct || 0;
        liveVolumeUsd = telemetry.volume24hUsd || 0;
      }
    } catch (e) {
      console.warn('[Alphas POST] Failed to fetch live DexScreener market cap:', e);
    }

    const currentMcStr = String(payload.marketCap || '').trim();
    const explicitCurrentMcUsd =
      Number(payload.marketCapUsd) > 0
        ? Number(payload.marketCapUsd)
        : parseShorthandUsd(currentMcStr);

    const currentMcUsd = liveMcUsd > 0 ? liveMcUsd : (explicitCurrentMcUsd || 100_000);

    const entryMcStr = String(payload.entryMarketCap || '').trim();
    const explicitEntryMcUsd =
      Number(payload.entryMarketCapUsd) > 0
        ? Number(payload.entryMarketCapUsd)
        : parseShorthandUsd(entryMcStr);

    const entryMcUsd = explicitEntryMcUsd > 0 ? explicitEntryMcUsd : currentMcUsd;

    if (currentMcUsd <= 0 || entryMcUsd <= 0) {
      return err(400, 'BAD_REQUEST', 'Market Cap and Entry Market Cap must be positive numbers');
    }

    const risk = Math.min(5, Math.max(1, Number(payload.risk) || 3));
    const riskRewardRatio = String(payload.riskRewardRatio || '').trim().slice(0, 32) || `Risk Lvl ${risk}/5`;
    const stopLoss = String(payload.stopLoss || '-25% SL').trim().slice(0, 32);

    if (stopLoss.startsWith('+') || /^\+?\d+%\s*TP/i.test(stopLoss)) {
      return err(400, 'BAD_REQUEST', 'Stop loss cannot be a positive percentage target');
    }

    const rawMultipliers: number[] = Array.isArray(payload.multipliers)
      ? payload.multipliers.map((m: unknown) => Number(m)).filter((n: number) => n > 0)
      : String(payload.takeProfitInput || '2x, 5x, 10x')
        .split(/[,\s/]+/)
        .map((s) => parseFloat(s.replace(/x/i, '')))
        .filter((n) => Number.isFinite(n) && n > 0);

    const multipliers = rawMultipliers.length > 0 ? rawMultipliers : [2, 5, 10];
    const takeProfits = buildTakeProfits(entryMcUsd, currentMcUsd, multipliers);

    const pinned = Boolean(payload.pinned);
    const isMaxAlpha = Boolean(payload.isMaxAlpha);
    const quoteMap: Record<Chain, QuoteToken> = {
      SOL: 'SOL',
      BSC: 'BNB',
      ETH: 'ETH',
      BASE: 'ETH',
      ROBIN: 'ROBIN',
      AVAX: 'AVAX',
    };
    const quoteToken: QuoteToken = payload.quoteToken || quoteMap[chain] || 'SOL';
    const motif = MOTIFS[Math.floor(Math.random() * MOTIFS.length)];

    const links =
      chain === 'SOL'
        ? [
          { label: 'DexScreener', href: `https://dexscreener.com/solana/${ca}` },
          { label: 'Pump.fun', href: `https://pump.fun/coin/${ca}` },
          { label: 'Photon', href: `https://photon-sol.tinyastro.io/` },
        ]
        : chain === 'BSC'
          ? [
            { label: 'DexScreener', href: `https://dexscreener.com/bsc/${ca}` },
            { label: 'BscScan', href: `https://bscscan.com/token/${ca}` },
          ]
          : chain === 'ETH'
            ? [
              { label: 'DexScreener', href: `https://dexscreener.com/ethereum/${ca}` },
              { label: 'Etherscan', href: `https://etherscan.io/token/${ca}` },
            ]
            : chain === 'BASE'
              ? [
                { label: 'DexScreener', href: `https://dexscreener.com/base/${ca}` },
                { label: 'BaseScan', href: `https://basescan.org/token/${ca}` },
              ]
              : chain === 'AVAX'
                ? [
                  { label: 'DexScreener', href: `https://dexscreener.com/avalanche/${ca}` },
                  { label: 'Snowtrace', href: `https://snowtrace.io/token/${ca}` },
                ]
                : [
                  {
                    label: 'DexScreener',
                    href: `https://dexscreener.com/search?q=${encodeURIComponent(ca)}`,
                  },
                ];

    const newRecord: AlphaRecord = {
      id: `${rawTicker.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now().toString(36)}`,
      name,
      ticker,
      chain,
      quoteToken,
      status: 'LIVE',
      statusLabel: pinned ? 'PRIORITY CALL' : 'LIVE CALL',
      category: 'NEW',
      allocationLabel: 'Allocation',
      allocation: '15.0 SOL',
      timer: { cycleMin: 90, phaseMin: 0 },
      risk,
      riskRewardRatio,
      stopLoss,
      takeProfits,
      pinned,
      pinnedAt: pinned ? new Date().toISOString() : null,
      isMaxAlpha,
      logoUrl:
        typeof payload.logoUrl === 'string' && payload.logoUrl.trim().startsWith('http')
          ? payload.logoUrl.trim()
          : liveLogoUrl || undefined,
      entryMarketCap: formatCompactUsd(entryMcUsd),
      entryMarketCapUsd: entryMcUsd,
      minTier: 'LAB_MEMBER',
      ca,
      links,
      summary:
        String(payload.summary || '').trim().slice(0, 500) ||
        `Admin trade call on ${chain}. Entry MC ${formatCompactUsd(entryMcUsd)} targeting ${multipliers
          .map((m) => `${m}x`)
          .join(' / ')}. Trade at your own risk.`,
      marketCap: formatCompactUsd(currentMcUsd),
      marketCapUsd: currentMcUsd,
      holderRewardsUsd: '—',
      holderRewardsRaw: 0,
      holderRewardsQuote: '—',
      holdersPaid: 0,
      volume24h: liveVolumeUsd > 0 ? formatCompactUsd(liveVolumeUsd) : String(payload.volume24h || '—'),
      netInflow24h: '—',
      change24hPct: liveChange24h !== 0 ? liveChange24h : (Number(payload.change24hPct) || 0),
      age: 'Just now',
      ageMinutes: 1,
      caller: String(payload.caller || '@TrenchLabsAdmin').trim().slice(0, 40),
      callerWinRate: '—',
      deployedVia: 'https://trenchlabshq.xyz',
      spotlightRank: pinned ? 1 : undefined,
      serialTag:
        payload.serialTag ||
        `EXP${String((await loadCallsRegistry()).length + 1).padStart(2, '0')}`,
      sparkline: [],
      art: {
        bgFrom: '#161C24',
        bgTo: '#0A0E13',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif,
        badgeText: pinned ? 'PINNED CALL' : chain,
      },
    };

    const saveRes = await withRegistryLock(async () => {
      const current = await loadCallsRegistry();
      const updated = [newRecord, ...current];
      return await saveCallsRegistry(updated);
    });

    if (!saveRes.success) {
      return err(500, 'STORE_UNAVAILABLE', `Persistence failed: ${saveRes.error}`);
    }

    // Push to Telegram subscribers AFTER the response is sent; never blocks or fails the admin action.
    after(() => notifyNewCall(newRecord).catch((e) => console.error('[TrenchLabs] Telegram fan-out failed:', e)));

    return NextResponse.json(
      { ok: true, items: await alphasForTier('PRO', Date.now(), undefined, true) },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Invalid request body');
  }
}

/** PATCH /api/alphas — Admin pins/unpins or updates a trade call (Cryptographically Verified, Request-Bound) */
export async function PATCH(req: NextRequest) {
  try {
    const adminLimit = await rateLimit(`admin:${clientIp(req)}`, 30, 60);
    if (!adminLimit.ok) return tooMany(adminLimit.retryAfter);
    const raw = await req.text();
    const auth = await verifyAdminAuth(req, raw);
    if (!auth.authorized) {
      return err(
        403,
        'UNAUTHORIZED_ADMIN',
        auth.error || `Only Master Admin (${ADMIN_WALLET}) with valid cryptographic signature is authorized.`
      );
    }

    const payload = JSON.parse(raw || '{}');
    const id = String(payload.id || '');
    if (!id) return err(400, 'BAD_REQUEST', 'Call id is required');

    const saveRes = await withRegistryLock(async () => {
      const registry = await loadCallsRegistry();
      const idx = registry.findIndex((r) => r.id === id);
      if (idx === -1) {
        throw new Error('Call not found');
      }

      const target = { ...registry[idx] };

      if (typeof payload.name === 'string' && payload.name.trim()) {
        target.name = payload.name.trim().slice(0, 64);
      }

      if (typeof payload.ticker === 'string' && payload.ticker.trim()) {
        target.ticker = payload.ticker.trim().startsWith('$')
          ? payload.ticker.trim().slice(0, 16)
          : `$${payload.ticker.trim().slice(0, 15)}`;
      }

      if (typeof payload.chain === 'string') {
        const c = payload.chain.toUpperCase() as Chain;
        if (VALID_CHAINS.includes(c)) {
          target.chain = c;
        }
      }

      if (typeof payload.ca === 'string' && payload.ca.trim()) {
        const newCa = payload.ca.trim();
        target.ca = newCa;
        // Regenerate default DEX links for new CA
        if (target.chain === 'SOL') {
          target.links = [
            { label: 'DexScreener', href: `https://dexscreener.com/solana/${newCa}` },
            { label: 'Pump.fun', href: `https://pump.fun/coin/${newCa}` },
            { label: 'Photon', href: 'https://photon-sol.tinyastro.io/' },
          ];
        } else if (target.chain === 'BSC') {
          target.links = [
            { label: 'DexScreener', href: `https://dexscreener.com/bsc/${newCa}` },
            { label: 'BscScan', href: `https://bscscan.com/token/${newCa}` },
          ];
        } else if (target.chain === 'ETH') {
          target.links = [
            { label: 'DexScreener', href: `https://dexscreener.com/ethereum/${newCa}` },
            { label: 'Etherscan', href: `https://etherscan.io/token/${newCa}` },
          ];
        } else if (target.chain === 'BASE') {
          target.links = [
            { label: 'DexScreener', href: `https://dexscreener.com/base/${newCa}` },
            { label: 'BaseScan', href: `https://basescan.org/token/${newCa}` },
          ];
        } else if (target.chain === 'AVAX') {
          target.links = [
            { label: 'DexScreener', href: `https://dexscreener.com/avalanche/${newCa}` },
            { label: 'Snowtrace', href: `https://snowtrace.io/token/${newCa}` },
          ];
        }
      }

      if (typeof payload.summary === 'string') {
        target.summary = payload.summary.trim().slice(0, 500);
      }

      if (typeof payload.logoUrl === 'string') {
        target.logoUrl = payload.logoUrl.trim() || undefined;
      }

      if (typeof payload.risk === 'number') {
        target.risk = Math.min(5, Math.max(1, payload.risk));
        target.riskRewardRatio = `Risk Lvl ${target.risk}/5`;
      }

      if (typeof payload.stopLoss === 'string' && payload.stopLoss.trim()) {
        target.stopLoss = payload.stopLoss.trim().slice(0, 32);
      }

      if (typeof payload.status === 'string') {
        const s = payload.status.toUpperCase();
        if (s === 'LIVE' || s === 'CLOSED') {
          target.status = s;
        }
      }

      if (typeof payload.statusLabel === 'string') {
        target.statusLabel = payload.statusLabel.trim().slice(0, 32);
      }

      if (typeof payload.allocation === 'string' && payload.allocation.trim()) {
        target.allocation = payload.allocation.trim().slice(0, 32);
      }

      if (typeof payload.pinned === 'boolean') {
        target.pinned = payload.pinned;
        target.pinnedAt = payload.pinned ? (target.pinnedAt || new Date().toISOString()) : null;
        target.statusLabel = payload.pinned ? 'PRIORITY CALL' : 'LIVE CALL';
      }

      if (payload.entryMarketCap || payload.entryMarketCapUsd) {
        const entryUsd = Number(payload.entryMarketCapUsd) > 0
          ? Number(payload.entryMarketCapUsd)
          : parseShorthandUsd(String(payload.entryMarketCap));
        if (entryUsd > 0) {
          target.entryMarketCapUsd = entryUsd;
          target.entryMarketCap = formatCompactUsd(entryUsd);
        }
      }

      if (payload.marketCap || payload.marketCapUsd) {
        const mcUsd = Number(payload.marketCapUsd) > 0
          ? Number(payload.marketCapUsd)
          : parseShorthandUsd(String(payload.marketCap));
        if (mcUsd > 0) {
          target.marketCapUsd = mcUsd;
          target.marketCap = formatCompactUsd(mcUsd);
        }
      }

      if (payload.takeProfitInput || Array.isArray(payload.multipliers)) {
        const rawMultipliers: number[] = Array.isArray(payload.multipliers)
          ? payload.multipliers.map((m: unknown) => Number(m)).filter((n: number) => n > 0)
          : String(payload.takeProfitInput || '')
            .split(/[,\s/]+/)
            .map((s) => parseFloat(s.replace(/x/i, '')))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (rawMultipliers.length > 0) {
          target.takeProfits = buildTakeProfits(target.entryMarketCapUsd, target.marketCapUsd, rawMultipliers);
        }
      } else if (target.marketCapUsd > 0 && target.takeProfits) {
        target.takeProfits = target.takeProfits.map((tp) => ({
          ...tp,
          hit:
            tp.hit ||
            (target.entryMarketCapUsd > 0 &&
              target.marketCapUsd >= target.entryMarketCapUsd * tp.multiple),
        }));
      }

      if (typeof payload.toggleTpIndex === 'number') {
        const tpIdx = payload.toggleTpIndex;
        if (target.takeProfits[tpIdx]) {
          target.takeProfits = target.takeProfits.map((tp, i) =>
            i === tpIdx ? { ...tp, hit: !tp.hit } : tp
          );
        }
      }

      if (typeof payload.isMaxAlpha === 'boolean') {
        target.isMaxAlpha = payload.isMaxAlpha;
      }

      if (
        payload.outcome === 'PROFIT' ||
        payload.outcome === 'LOSS' ||
        payload.outcome === 'PENDING'
      ) {
        target.outcome = payload.outcome;
      }

      registry[idx] = target;
      return await saveCallsRegistry(registry);
    });

    if (!saveRes.success) {
      return err(500, 'STORE_UNAVAILABLE', `Persistence failed: ${saveRes.error}`);
    }

    return NextResponse.json(
      { ok: true, items: await alphasForTier('PRO', Date.now(), undefined, true) },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Invalid PATCH payload');
  }
}

/** DELETE /api/alphas — Admin deletes a trade call (Cryptographically Verified, Request-Bound) */
export async function DELETE(req: NextRequest) {
  try {
    const adminLimit = await rateLimit(`admin:${clientIp(req)}`, 30, 60);
    if (!adminLimit.ok) return tooMany(adminLimit.retryAfter);
    const raw = await req.text();
    const auth = await verifyAdminAuth(req, raw);
    if (!auth.authorized) {
      return err(
        403,
        'UNAUTHORIZED_ADMIN',
        auth.error || `Only Master Admin (${ADMIN_WALLET}) with valid cryptographic signature is authorized.`
      );
    }

    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');
    if (!id) return err(400, 'BAD_REQUEST', 'Provide ?id=');

    const saveRes = await withRegistryLock(async () => {
      const registry = await loadCallsRegistry();
      const filtered = registry.filter((r) => r.id !== id);
      return await saveCallsRegistry(filtered);
    });

    if (!saveRes.success) {
      return err(500, 'STORE_UNAVAILABLE', `Persistence failed: ${saveRes.error}`);
    }

    return NextResponse.json(
      { ok: true, items: await alphasForTier('PRO', Date.now(), undefined, true) },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Delete failed');
  }
}
