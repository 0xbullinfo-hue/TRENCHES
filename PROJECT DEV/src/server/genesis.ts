import { GENESIS_MINT, MINT_CONFIGURED, SOLANA_RPC } from '@/lib/config';

const SERVER_RPC = process.env.SOLANA_RPC || SOLANA_RPC;

// In-memory 30s cache for on-chain balances to prevent RPC hammering and DoS (shared by API + Telegram fan-out)
const balanceCache = new Map<string, { v: number; t: number }>();
const BALANCE_TTL_MS = 30_000;

async function readGenesisBalance(owner: string, signal?: AbortSignal): Promise<number> {
  if (!MINT_CONFIGURED) return 0;
  const res = await fetch(SERVER_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal,
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

export async function readGenesisBalanceCached(owner: string): Promise<number> {
  const hit = balanceCache.get(owner);
  if (hit && Date.now() - hit.t < BALANCE_TTL_MS) return hit.v;
  if (balanceCache.size > 5_000) balanceCache.clear();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const v = await readGenesisBalance(owner, ctrl.signal);
    balanceCache.set(owner, { v, t: Date.now() });
    return v;
  } finally {
    clearTimeout(timer);
  }
}

