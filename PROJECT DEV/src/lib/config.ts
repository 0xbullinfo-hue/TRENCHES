/**
 * Runtime configuration. See MEMORY.md §1 for the env contract.
 */

/** Official $GENESIS SPL Token Mint on Solana (Pump.fun / Mainnet-Beta) */
export const DEFAULT_GENESIS_MINT = 'EM9M8RaxSjSf2UT2e2xndaBjjC1ijkT2nH5U3j6epump';

/** Official Master Admin Wallet with full post/edit/delete/pin privileges & gate bypass */
export const ADMIN_WALLET = 'FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e';
export const ADMIN_WALLET_SHORT = `${ADMIN_WALLET.slice(0, 6)}...${ADMIN_WALLET.slice(-4)}`;

export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

export const GENESIS_MINT =
  process.env.NEXT_PUBLIC_GENESIS_MINT || DEFAULT_GENESIS_MINT;

export const GENESIS_MINT_SHORT = `${GENESIS_MINT.slice(0, 6)}...${GENESIS_MINT.slice(-4)}`;

export const MINT_CONFIGURED = Boolean(GENESIS_MINT && GENESIS_MINT.length >= 32);

export const TOKEN_DECIMALS = 9;
export const TOKEN_SYMBOL = 'GENESIS';

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

/** Official Social & Community Links */
export const SOCIAL_LINKS = {
  telegram: 'https://t.me/TrenchLabsHQ',
  x: 'https://x.com/Trenchlabshq',
};

/**
 * Maintenance Mode Configuration
 * Toggle via NEXT_PUBLIC_MAINTENANCE_MODE="true" in .env.local,
 * or change MAINTENANCE_MODE to true directly here anytime.
 */
export const MAINTENANCE_MODE =
  process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true' || false;

export const MAINTENANCE_CONFIG = {
  enabled: MAINTENANCE_MODE,
  title: 'LAB TELEMETRY MAINTENANCE',
  headline: 'THE LAB IS UNDER SCHEDULED UPGRADE',
  message:
    'TrenchLabsHQ is undergoing routine infrastructure maintenance, node synchronization, and multi-chain telemetry upgrades. Normal access will be restored shortly.',
  estimatedDuration: 'Back shortly',
};

export const CHAIN_METADATA = {
  SOL: {
    id: 'SOL',
    label: 'Solana',
    short: 'SOL',
    dexscreenerSlug: 'solana',
    explorerName: 'Solscan',
    explorerTokenUrl: (ca: string) => `https://solscan.io/token/${ca}`,
  },
  BSC: {
    id: 'BSC',
    label: 'BNB Chain',
    short: 'BSC',
    dexscreenerSlug: 'bsc',
    explorerName: 'BscScan',
    explorerTokenUrl: (ca: string) => `https://bscscan.com/token/${ca}`,
  },
  ETH: {
    id: 'ETH',
    label: 'Ethereum',
    short: 'ETH',
    dexscreenerSlug: 'ethereum',
    explorerName: 'Etherscan',
    explorerTokenUrl: (ca: string) => `https://etherscan.io/token/${ca}`,
  },
  BASE: {
    id: 'BASE',
    label: 'Base',
    short: 'BASE',
    dexscreenerSlug: 'base',
    explorerName: 'BaseScan',
    explorerTokenUrl: (ca: string) => `https://basescan.org/token/${ca}`,
  },
  ROBIN: {
    id: 'ROBIN',
    label: 'Robinhood Chain',
    short: 'ROBIN',
    dexscreenerSlug: 'robinhood',
    explorerName: 'Robinhood Explorer',
    explorerTokenUrl: (ca: string) => `https://dexscreener.com/search?q=${encodeURIComponent(ca)}`,
  },
  AVAX: {
    id: 'AVAX',
    label: 'Avalanche',
    short: 'AVAX',
    dexscreenerSlug: 'avalanche',
    explorerName: 'Snowtrace',
    explorerTokenUrl: (ca: string) => `https://snowtrace.io/token/${ca}`,
  },
} as const;

export function isAdminWallet(wallet: string | null | undefined): boolean {
  return !!wallet && wallet.trim() === ADMIN_WALLET;
}

/** Loose base58 public-key shape check (server-safe, no web3.js). */
export function isBase58Address(v: string | null | undefined): v is string {
  return !!v && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

