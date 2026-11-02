import { NextRequest, NextResponse } from 'next/server';
import { tierFor, allocationCap, MIN_GENESIS_REQUIRED } from '@/lib/tiers';
import { GENESIS_MINT, MINT_CONFIGURED, SOLANA_RPC, isBase58Address } from '@/lib/config';
import { alphasForTier, samplePortfolio, SYNDICATE_CALLERS } from '@/server/alphas-data';
import type { AlphasErr, AlphasOk } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SERVER_RPC = process.env.SOLANA_RPC || SOLANA_RPC;
const ALLOW_DEMO_BALANCE = process.env.ALLOW_DEMO_BALANCE !== 'false';

const NO_STORE = { 'Cache-Control': 'no-store' };

function err(status: number, error: AlphasErr['error'], message: string) {
  const body: AlphasErr = { ok: false, error, message, items: [] };
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Server-verified $GENESIS balance: sum of all token accounts for the mint EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump. */
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
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? 'RPC error');
  const accounts: Array<{
    account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } };
  }> = json.result?.value ?? [];
  return accounts.reduce(
    (sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    0
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const wallet = searchParams.get('wallet');
  const balanceParam = searchParams.get('balance');

  let balance: number;
  let verified = false;

  if (wallet) {
    if (!isBase58Address(wallet)) {
      return err(400, 'BAD_REQUEST', 'wallet must be a base58 Solana address');
    }
    try {
      balance = await readGenesisBalance(wallet);
      verified = true;
    } catch (e) {
      return err(502, 'RPC_UNAVAILABLE', `Balance lookup failed: ${(e as Error).message}`);
    }
  } else if (balanceParam !== null) {
    if (!ALLOW_DEMO_BALANCE) {
      return err(
        403,
        'DEMO_BALANCE_DISABLED',
        'Client-asserted balances are disabled. Pass ?wallet='
      );
    }
    balance = Number(balanceParam);
    if (!Number.isFinite(balance) || balance < 0) {
      return err(400, 'BAD_REQUEST', 'balance must be a non-negative number');
    }
  } else {
    return err(400, 'BAD_REQUEST', 'Provide ?wallet= or ?balance=');
  }

  if (balance < MIN_GENESIS_REQUIRED) {
    return err(
      403,
      'ACCESS_DENIED_ZERO_BALANCE',
      `Minimum 1,000,000 $GENESIS (${GENESIS_MINT}) required to access the Lab.`
    );
  }

  const tier = tierFor(balance);
  const body: AlphasOk = {
    ok: true,
    tier: tier.id,
    tierLabel: tier.label,
    multiplier: tier.multiplier,
    allocationCap: allocationCap(tier),
    balance,
    verified,
    genesisMint: GENESIS_MINT,
    items: alphasForTier(tier.id),
    callers: SYNDICATE_CALLERS,
    portfolio: samplePortfolio(),
    serverTime: new Date().toISOString(),
  };
  return NextResponse.json(body, { headers: NO_STORE });
}
