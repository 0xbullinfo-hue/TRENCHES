import bs58 from 'bs58';

export type SupportedLedgerChain = 'solana' | 'ethereum' | 'base' | 'bsc' | 'other';

export const LEDGER_CHAINS: { value: SupportedLedgerChain; label: string }[] = [
  { value: 'solana', label: 'Solana' },
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'base', label: 'Base' },
  { value: 'bsc', label: 'BSC' },
  { value: 'other', label: 'Other' },
];

export function validateContractAddress(chain: string, ca: string): { valid: boolean; error?: string } {
  const trimmed = ca.trim();
  const c = chain.toLowerCase();

  if (c === 'solana') {
    if (trimmed.length < 32 || trimmed.length > 44) {
      return { valid: false, error: 'Solana address must be 32 to 44 base58 characters' };
    }
    try {
      const decoded = bs58.decode(trimmed);
      if (decoded.length !== 32) {
        return { valid: false, error: 'Invalid Solana base58 public key length' };
      }
    } catch {
      return { valid: false, error: 'Invalid Solana base58 characters' };
    }
    return { valid: true };
  }

  if (c === 'ethereum' || c === 'base' || c === 'bsc') {
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      return { valid: false, error: 'EVM address must be 0x followed by exactly 40 hex characters' };
    }
    return { valid: true };
  }

  // Other
  if (trimmed.length < 20 || trimmed.length > 100 || /\s/.test(trimmed)) {
    return { valid: false, error: 'Contract address must be 20 to 100 characters with no spaces' };
  }

  return { valid: true };
}

export function validateMultiplier(m: string | number): { valid: boolean; error?: string; value?: number } {
  const num = typeof m === 'number' ? m : Number(m);
  if (!Number.isFinite(num) || num <= 0 || num > 1000) {
    return { valid: false, error: 'Multiplier must be greater than 0 and at most 1000' };
  }
  return { valid: true, value: num };
}

export function formatTicker(ticker: string): string {
  const clean = ticker.toUpperCase().replace(/^\$/, '');
  return `$${clean}`;
}

export function formatMultiplier(multiplier: string | number): string {
  const raw = typeof multiplier === 'string' ? multiplier.trim().replace(/x$/i, '') : multiplier;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return '1.0x';
  // If integer or 1 decimal place, keep clean, e.g. 3.4x, 10x
  if (Number.isInteger(num)) return `${num}x`;
  const fixed = num.toFixed(2);
  return `${parseFloat(fixed)}x`;
}

export function formatChainLabel(chain: string): string {
  const found = LEDGER_CHAINS.find((c) => c.value === chain.toLowerCase());
  if (found) return found.label;
  return chain.charAt(0).toUpperCase() + chain.slice(1);
}

export function truncateAddress(address: string): string {
  if (!address || address.length <= 11) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatLedgerDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatMarketCap(value?: string | null): string {
  if (!value || !value.trim()) return '—';
  const raw = value.trim();

  // If already formatted like $100K, 150k, $2.5M, 1.2M, $500B
  if (/[kmb]/i.test(raw)) {
    const clean = raw.replace(/^\$/, '').trim();
    return `$${clean.toUpperCase()}`;
  }

  // Parse pure number (e.g. 0.0001, 150000, $0.0001)
  const num = parseFloat(raw.replace(/[^0-9.-]+/g, ''));
  if (!Number.isFinite(num) || num <= 0) {
    return raw;
  }

  // If it's a huge number >= 1,000,000,000
  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(2).replace(/\.00$/, '')}B`;
  }
  // If >= 1,000,000
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  // If >= 1,000
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }

  // If entered as token unit price (e.g. 0.0001, 0.045, etc.), convert to standard 1B meme token supply Market Cap
  const standardMc = num * 1_000_000_000;
  if (standardMc >= 1_000_000_000) {
    return `$${(standardMc / 1_000_000_000).toFixed(2).replace(/\.00$/, '')}B`;
  }
  if (standardMc >= 1_000_000) {
    return `$${(standardMc / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  }
  if (standardMc >= 1_000) {
    return `$${(standardMc / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }

  return `$${standardMc.toFixed(0)}`;
}

export const SUPPORTED_DEXSCREENER_CHAINS: Record<string, string> = {
  solana: 'solana',
  sol: 'solana',
  ethereum: 'ethereum',
  eth: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  binance: 'bsc',
};

export function getDexScreenerUrl(
  chain?: string | null,
  contractAddress?: string | null
): string | null {
  if (!chain || !contractAddress) return null;
  const cleanCa = contractAddress.trim();
  if (!cleanCa) return null;
  const mapped = SUPPORTED_DEXSCREENER_CHAINS[chain.toLowerCase().trim()];
  if (!mapped) return null;
  return `https://dexscreener.com/${mapped}/${encodeURIComponent(cleanCa)}`;
}

export interface PnLResult {
  formatted: string;
  sign: 'positive' | 'negative' | 'zero' | 'invalid';
  value: number | null;
}

export function calculatePnL(multiplier: string | number | null | undefined): PnLResult {
  if (multiplier === null || multiplier === undefined) {
    return { formatted: '—', sign: 'invalid', value: null };
  }
  const raw = typeof multiplier === 'string' ? multiplier.trim().replace(/x$/i, '') : multiplier;
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return { formatted: '—', sign: 'invalid', value: null };
  }
  const pnl = (num - 1) * 100;
  if (Math.abs(pnl) < 0.0001) {
    return { formatted: '0%', sign: 'zero', value: 0 };
  }
  const sign = pnl > 0 ? 'positive' : 'negative';
  const absPnl = Math.abs(pnl);
  const formattedNum = Number.isInteger(absPnl)
    ? `${absPnl}`
    : `${parseFloat(absPnl.toFixed(2))}`;
  const prefix = pnl > 0 ? '+' : '-';
  return { formatted: `${prefix}${formattedNum}%`, sign, value: pnl };
}



