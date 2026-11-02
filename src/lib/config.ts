/**
 * Runtime configuration. See MEMORY.md §1 for the env contract.
 */

/** Official $GENESIS SPL Token Mint on Solana (Pump.fun / Mainnet-Beta) */
export const DEFAULT_GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

export const GENESIS_MINT =
  process.env.NEXT_PUBLIC_GENESIS_MINT || DEFAULT_GENESIS_MINT;

export const GENESIS_MINT_SHORT = `${GENESIS_MINT.slice(0, 6)}...${GENESIS_MINT.slice(-4)}`;

export const MINT_CONFIGURED = Boolean(GENESIS_MINT && GENESIS_MINT.length >= 32);

export const SOLSCAN = {
  account: (a: string) => `https://solscan.io/account/${a}`,
  tx: (sig: string) => `https://solscan.io/tx/${sig}`,
  token: (m: string) => `https://solscan.io/token/${m}`,
};

export const BUY_LINKS = {
  pump: `https://pump.fun/coin/${GENESIS_MINT}`,
  jupiter: `https://jup.ag/swap/SOL-${GENESIS_MINT}`,
  raydium: `https://raydium.io/swap/?inputMint=sol&outputMint=${GENESIS_MINT}`,
  dexscreener: `https://dexscreener.com/solana/${GENESIS_MINT}`,
};

/** Loose base58 public-key shape check (server-safe, no web3.js). */
export function isBase58Address(v: string | null | undefined): v is string {
  return !!v && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}
