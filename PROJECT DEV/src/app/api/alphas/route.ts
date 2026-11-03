import { NextRequest, NextResponse } from 'next/server';
import { tierFor, allocationCap, MIN_GENESIS_REQUIRED } from '@/lib/tiers';
import {
  ADMIN_WALLET,
  GENESIS_MINT,
  MINT_CONFIGURED,
  SOLANA_RPC,
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
  SYNDICATE_CALLERS,
} from '@/server/alphas-data';
import { verifyAdminAuth } from '@/server/auth';
import type {
  AlphasErr,
  AlphasOk,
  ArtMotif,
  Chain,
  QuoteToken,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const SERVER_RPC = process.env.SOLANA_RPC || SOLANA_RPC;

// Security Policy: Never allow client-asserted demo balances in production
const IS_PROD = process.env.NODE_ENV === 'production';
const ALLOW_DEMO_BALANCE = !IS_PROD && process.env.ALLOW_DEMO_BALANCE === 'true';

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

function err(status: number, error: AlphasErr['error'], message: string) {
  const body: AlphasErr = { ok: false, error, message, items: [] };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Server-verified $GENESIS balance: sum of all token accounts for the mint EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump.
 */
async function readGenesisBalance(owner: string): Promise<number> {
  if (!MINT_CONFIGURED) return 0;
  const res = await fetch(SERVER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTokenAccountsByOwner',
      params: [
        owner,
        { mint: GENESIS_MINT },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    }),
  });
  if (!res.ok) throw new Error(`RPC returned ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'Solana RPC error');
  const accounts: Array<{
    account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } };
  }> = json.result?.value ?? [];
  return accounts.reduce(
    (sum, a) => sum + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0),
    0
  );
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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const wallet = searchParams.get('wallet')?.trim();
  const balanceParam = searchParams.get('balance');

  const isAdmin = isAdminWallet(wallet);
  let balance = 0;
  let verified = false;

  if (isAdmin) {
    // Master admin wallet FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e has full access
    try {
      balance = await readGenesisBalance(ADMIN_WALLET);
      verified = true;
    } catch {
      balance = MIN_GENESIS_REQUIRED;
    }
    if (balance < MIN_GENESIS_REQUIRED) {
      balance = MIN_GENESIS_REQUIRED;
    }
  } else if (wallet) {
    if (!isBase58Address(wallet)) {
      return err(400, 'BAD_REQUEST', 'wallet must be a valid base58 Solana address');
    }
    // Handle simulated demo wallets safely without making invalid RPC calls
    if (
      ALLOW_DEMO_BALANCE &&
      (wallet === '11111111111111111111111111111111' ||
        wallet.includes('1M') ||
        wallet.includes('Member'))
    ) {
      balance = MIN_GENESIS_REQUIRED;
      verified = false;
    } else if (
      ALLOW_DEMO_BALANCE &&
      (wallet === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
        wallet.includes('Zero'))
    ) {
      balance = 0;
      verified = false;
    } else {
      try {
        balance = await readGenesisBalance(wallet);
        verified = true;
      } catch {
        if (ALLOW_DEMO_BALANCE) {
          balance = MIN_GENESIS_REQUIRED;
          verified = false;
        } else {
          return err(
            502,
            'RPC_UNAVAILABLE',
            'Solana RPC network unavailable. Retrying balance check...'
          );
        }
      }
    }
  } else if (balanceParam !== null) {
    // Reject client-supplied balance in production
    if (!ALLOW_DEMO_BALANCE) {
      return err(
        403,
        'DEMO_BALANCE_DISABLED',
        'Client-asserted demo balances are disabled. Connect a Solana wallet passing ?wallet='
      );
    }
    balance = Number(balanceParam);
    if (!Number.isFinite(balance) || balance < 0) {
      return err(400, 'BAD_REQUEST', 'balance must be a non-negative number');
    }
  } else {
    return err(400, 'BAD_REQUEST', 'Authentication required. Provide ?wallet=<solana_address>');
  }

  if (!isAdmin && balance < MIN_GENESIS_REQUIRED) {
    return err(
      403,
      'ACCESS_DENIED_ZERO_BALANCE',
      `Access restricted. Holding at least 1,000,000 $GENESIS (${GENESIS_MINT}) is required.`
    );
  }

  const tier = tierFor(Math.max(balance, isAdmin ? MIN_GENESIS_REQUIRED : 0));
  const body: AlphasOk = {
    ok: true,
    tier: tier.id,
    tierLabel: isAdmin ? 'Master Admin' : tier.label,
    multiplier: tier.multiplier,
    allocationCap: allocationCap(tier),
    balance,
    verified,
    isAdmin,
    genesisMint: GENESIS_MINT,
    items: alphasForTier(tier.id),
    callers: SYNDICATE_CALLERS,
    portfolio: samplePortfolio(),
    serverTime: new Date().toISOString(),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}

/** POST /api/alphas — Admin creates a new trade call (Cryptographically Verified) */
export async function POST(req: NextRequest) {
  try {
    const auth = verifyAdminAuth(req.headers);
    if (!auth.authorized) {
      return err(
        403,
        'UNAUTHORIZED_ADMIN',
        auth.error || `Only Master Admin (${ADMIN_WALLET}) with valid cryptographic signature is authorized.`
      );
    }

    const payload = await req.json();
    const name = String(payload.name || '').trim();
    const rawTicker = String(payload.ticker || '').trim();
    const ticker = rawTicker.startsWith('$') ? rawTicker : `$${rawTicker}`;
    const ca = String(payload.ca || '').trim();
    const chain = (payload.chain as Chain) || 'SOL';

    if (!name || !rawTicker || !ca) {
      return err(400, 'BAD_REQUEST', 'Token Name, Ticker, and Contract Address (CA) are required.');
    }

    const currentMcStr = String(payload.marketCap || '$100K').trim();
    const currentMcUsd =
      Number(payload.marketCapUsd) > 0
        ? Number(payload.marketCapUsd)
        : parseShorthandUsd(currentMcStr) || 100_000;

    const entryMcStr = String(payload.entryMarketCap || currentMcStr).trim();
    const entryMcUsd =
      Number(payload.entryMarketCapUsd) > 0
        ? Number(payload.entryMarketCapUsd)
        : parseShorthandUsd(entryMcStr) || currentMcUsd;

    const risk = Math.min(5, Math.max(1, Number(payload.risk) || 3));
    const riskRewardRatio = String(payload.riskRewardRatio || '1:4 R:R').trim();
    const stopLoss = String(payload.stopLoss || '-25% SL').trim();

    const rawMultipliers: number[] = Array.isArray(payload.multipliers)
      ? payload.multipliers.map((m: unknown) => Number(m)).filter((n: number) => n > 0)
      : String(payload.takeProfitInput || '2x, 5x, 10x')
          .split(/[,\s/]+/)
          .map((s) => parseFloat(s.replace(/x/i, '')))
          .filter((n) => Number.isFinite(n) && n > 0);

    const multipliers = rawMultipliers.length > 0 ? rawMultipliers : [2, 5, 10];
    const takeProfits = buildTakeProfits(entryMcUsd, currentMcUsd, multipliers);

    const pinned = Boolean(payload.pinned);
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
      entryMarketCap: formatCompactUsd(entryMcUsd),
      entryMarketCapUsd: entryMcUsd,
      minTier: 'LAB_MEMBER',
      ca,
      links,
      summary:
        String(payload.summary || '').trim() ||
        `Admin trade call on ${chain}. Entry MC ${formatCompactUsd(entryMcUsd)} targeting ${multipliers
          .map((m) => `${m}x`)
          .join(' / ')}. Trade at your own risk.`,
      marketCap: formatCompactUsd(currentMcUsd),
      marketCapUsd: currentMcUsd,
      holderRewardsUsd: formatCompactUsd(Math.round(currentMcUsd * 0.18)),
      holderRewardsRaw: Math.round(currentMcUsd * 0.18),
      holderRewardsQuote: `${quoteToken} Pool`,
      holdersPaid: Math.max(120, Math.round(currentMcUsd / 85)),
      volume24h: String(payload.volume24h || formatCompactUsd(currentMcUsd * 1.4)),
      netInflow24h: `+${formatCompactUsd(currentMcUsd * 0.12)}`,
      change24hPct: Number(payload.change24hPct) || 125.0,
      age: 'Just now',
      ageMinutes: 1,
      caller: String(payload.caller || '@TrenchLabsAdmin'),
      callerWinRate: '86.4% win',
      deployedVia: 'https://trenchlabshq.com',
      spotlightRank: pinned ? 1 : undefined,
      serialTag:
        payload.serialTag ||
        `EXP${String(loadCallsRegistry().length + 1).padStart(2, '0')}`,
      sparkline: [20, 25, 28, 35, 42, 48, 55, 62, 68, 75, 82, 88, 94, 98],
      art: {
        bgFrom: '#161C24',
        bgTo: '#0A0E13',
        accent: '#34D399',
        secondary: '#6EE7B7',
        motif,
        badgeText: pinned ? 'PINNED CALL' : chain,
      },
    };

    const current = loadCallsRegistry();
    const updated = [newRecord, ...current];
    const saveRes = saveCallsRegistry(updated);
    if (!saveRes.success) {
      return err(500, 'BAD_REQUEST', `Persistence failed: ${saveRes.error}`);
    }

    return NextResponse.json(
      { ok: true, items: alphasForTier('LAB_MEMBER') },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Invalid request body');
  }
}

/** PATCH /api/alphas — Admin pins/unpins or updates a trade call (Cryptographically Verified) */
export async function PATCH(req: NextRequest) {
  try {
    const auth = verifyAdminAuth(req.headers);
    if (!auth.authorized) {
      return err(
        403,
        'UNAUTHORIZED_ADMIN',
        auth.error || `Only Master Admin (${ADMIN_WALLET}) with valid cryptographic signature is authorized.`
      );
    }

    const payload = await req.json();
    const id = String(payload.id || '');
    if (!id) return err(400, 'BAD_REQUEST', 'Call id is required');

    const registry = loadCallsRegistry();
    const idx = registry.findIndex((r) => r.id === id);
    if (idx === -1) return err(400, 'BAD_REQUEST', 'Call not found');

    const target = { ...registry[idx] };

    if (typeof payload.pinned === 'boolean') {
      target.pinned = payload.pinned;
      target.pinnedAt = payload.pinned ? new Date().toISOString() : null;
      target.statusLabel = payload.pinned ? 'PRIORITY CALL' : 'LIVE CALL';
    }

    if (payload.marketCap) {
      const mcUsd = parseShorthandUsd(String(payload.marketCap));
      if (mcUsd > 0) {
        target.marketCapUsd = mcUsd;
        target.marketCap = formatCompactUsd(mcUsd);
        target.takeProfits = target.takeProfits.map((tp) => ({
          ...tp,
          hit:
            tp.hit ||
            (target.entryMarketCapUsd > 0 &&
              mcUsd >= target.entryMarketCapUsd * tp.multiple),
        }));
      }
    }

    if (typeof payload.toggleTpIndex === 'number') {
      const tpIdx = payload.toggleTpIndex;
      if (target.takeProfits[tpIdx]) {
        target.takeProfits = target.takeProfits.map((tp, i) =>
          i === tpIdx ? { ...tp, hit: !tp.hit } : tp
        );
      }
    }

    registry[idx] = target;
    const saveRes = saveCallsRegistry(registry);
    if (!saveRes.success) {
      return err(500, 'BAD_REQUEST', `Persistence failed: ${saveRes.error}`);
    }

    return NextResponse.json(
      { ok: true, items: alphasForTier('LAB_MEMBER') },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Invalid PATCH payload');
  }
}

/** DELETE /api/alphas — Admin deletes a trade call (Cryptographically Verified) */
export async function DELETE(req: NextRequest) {
  try {
    const auth = verifyAdminAuth(req.headers);
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

    const registry = loadCallsRegistry();
    const filtered = registry.filter((r) => r.id !== id);
    const saveRes = saveCallsRegistry(filtered);
    if (!saveRes.success) {
      return err(500, 'BAD_REQUEST', `Persistence failed: ${saveRes.error}`);
    }

    return NextResponse.json(
      { ok: true, items: alphasForTier('LAB_MEMBER') },
      { headers: NO_STORE }
    );
  } catch (e) {
    return err(400, 'BAD_REQUEST', (e as Error).message || 'Delete failed');
  }
}
