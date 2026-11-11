export interface PerformanceCalculationResult {
  totalRecordedCalls: number;
  profitableCalls: number;
  losses: number;
  openCalls: number;
  resolvedCalls: number;
  winRate: number | null;
  winRateFormatted: string;
}

export interface LedgerRecordLike {
  id?: string;
  ticker?: string;
  multiplier?: string | number | null;
  entry_price?: string | null;
  exit_price?: string | null;
  verification_status?: string | null;
  closed_at?: string | null;
  outcome?: string | null;
  status?: string | null;
}

export interface CallRecordLike {
  id?: string;
  ticker?: string;
  status?: string | null;
  outcome?: 'PROFIT' | 'LOSS' | 'PENDING' | string | null;
  takeProfits?: Array<{ hit?: boolean; multiple?: number }> | null;
}

/**
 * Computes authoritative performance statistics from valid ledger entries and open calls.
 * 
 * Rules (§3.2):
 * - Total Recorded Calls: valid historical records in the performance ledger
 * - Profitable Calls: authoritative profitable/TP outcome (multiplier >= 1.0 or outcome === 'PROFIT')
 * - Losses: authoritative loss/SL outcome (multiplier < 1.0 or outcome === 'LOSS')
 * - Open Calls: calls still active or awaiting a final outcome (status === 'LIVE' or outcome === 'PENDING')
 * - Win Rate: profitableCalls / (profitableCalls + losses) * 100
 * - Pending/active calls are strictly EXCLUDED from resolved win rate denominator
 * - Cancelled or invalid records are strictly excluded
 * - If resolvedCalls is zero, winRate is null and formatted as "—"
 */
export function computePerformanceStats(
  ledgerEntries: LedgerRecordLike[] = [],
  callRecords: CallRecordLike[] = []
): PerformanceCalculationResult {
  let totalRecordedCalls = 0;
  let profitableCalls = 0;
  let losses = 0;
  let openCalls = 0;

  // 1. Process authoritative ledger entries
  if (Array.isArray(ledgerEntries)) {
    for (const entry of ledgerEntries) {
      if (!entry || typeof entry !== 'object') continue;
      // Must have valid ticker and multiplier or outcome
      if (!entry.ticker || typeof entry.ticker !== 'string') continue;
      if (entry.status === 'CANCELLED') continue;

      const rawMult = entry.multiplier;
      const numMult = typeof rawMult === 'number' ? rawMult : parseFloat(String(rawMult || ''));

      // If explicit outcome is provided
      if (entry.outcome === 'PROFIT') {
        totalRecordedCalls++;
        profitableCalls++;
      } else if (entry.outcome === 'LOSS') {
        totalRecordedCalls++;
        losses++;
      } else if (entry.outcome === 'PENDING' || entry.status === 'LIVE') {
        openCalls++;
      } else if (Number.isFinite(numMult) && numMult > 0) {
        totalRecordedCalls++;
        if (numMult >= 1.0) {
          profitableCalls++;
        } else {
          losses++;
        }
      }
    }
  }

  // 2. Process call records (e.g. active registry) for open calls and any resolved calls not yet in ledger
  if (Array.isArray(callRecords)) {
    for (const call of callRecords) {
      if (!call || typeof call !== 'object') continue;
      if (!call.ticker || typeof call.ticker !== 'string') continue;
      if (call.status === 'CANCELLED') continue;

      if (call.status === 'LIVE' || call.outcome === 'PENDING') {
        openCalls++;
      } else if (call.status === 'CLOSED') {
        // If closed call in registry has outcome
        if (call.outcome === 'PROFIT' || call.takeProfits?.some((tp) => tp.hit)) {
          totalRecordedCalls++;
          profitableCalls++;
        } else if (call.outcome === 'LOSS') {
          totalRecordedCalls++;
          losses++;
        }
      }
    }
  }

  const resolvedCalls = profitableCalls + losses;
  let winRate: number | null = null;
  let winRateFormatted = '—';

  if (resolvedCalls > 0) {
    winRate = Math.round((profitableCalls / resolvedCalls) * 1000) / 10;
    // Format e.g. 100% or 75.5%
    winRateFormatted = Number.isInteger(winRate) ? `${winRate}%` : `${winRate.toFixed(1)}%`;
  }

  return {
    totalRecordedCalls,
    profitableCalls,
    losses,
    openCalls,
    resolvedCalls,
    winRate,
    winRateFormatted,
  };
}

