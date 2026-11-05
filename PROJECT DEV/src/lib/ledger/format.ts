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
  const num = typeof multiplier === 'number' ? multiplier : Number(multiplier);
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

