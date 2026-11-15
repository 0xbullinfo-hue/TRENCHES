import { computePerformanceStats } from './performance-stats';

/** Subset of a public ledger entry (see LedgerEntryRow in src/server/db.ts). */
export interface DigestLedgerEntry {
  id?: string;
  ticker?: string;
  chain?: string;
  contract_address?: string;
  multiplier?: string | number | null;
  closed_at?: string | null;
  status?: string | null;
  callType?: string | null;
  outcome?: string | null;
}

export type DigestTier = 'FREE' | 'MEMBER' | 'PRO';

export interface DigestCallSummary {
  ticker: string;
  chain: string;
  multiplier: number;
  multiplierFormatted: string;
  /** Full contract address, or null in the sanitized (free) variant. */
  contractAddress: string | null;
  outcome: 'PROFIT' | 'LOSS';
}

export interface WeeklyPerformanceDigest {
  windowStart: string;
  windowEnd: string;
  resolvedCalls: number;
  profitableCalls: number;
  losses: number;
  winRateFormatted: string;
  /** Highest multiplier in the window, or null when there are no closed calls. */
  topMultiplier: number | null;
  calls: DigestCallSummary[];
  isSanitized: boolean;
  tier: DigestTier;
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CALLS = 5;

function toMultiplier(raw: DigestLedgerEntry['multiplier']): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function maskTicker(ticker: string): string {
  return `${ticker.slice(0, 1)}***`;
}

/**
 * Builds a weekly digest from closed ledger entries.
 *
 * - Only entries whose `closed_at` falls inside the last 7 days are included.
 * - WATCHLIST and CANCELLED records are excluded (same rules as computePerformanceStats).
 * - Win rate / W / L come from computePerformanceStats, so they match the public ledger stats.
 * - FREE tier receives a sanitized variant: tickers masked, contract addresses withheld.
 */
export function generateWeeklyPerformanceDigest(
  entries: DigestLedgerEntry[] = [],
  tier: DigestTier = 'FREE',
  now: Date = new Date()
): WeeklyPerformanceDigest {
  const isSanitized = tier === 'FREE';
  const windowEndMs = now.getTime();
  const windowStartMs = windowEndMs - WINDOW_MS;

  const inWindow = (Array.isArray(entries) ? entries : []).filter((e) => {
    if (!e || typeof e !== 'object' || !e.ticker) return false;
    if (e.status === 'CANCELLED' || e.callType === 'WATCHLIST') return false;
    if (!e.closed_at) return false;
    const t = new Date(e.closed_at).getTime();
    return Number.isFinite(t) && t >= windowStartMs && t <= windowEndMs;
  });

  const stats = computePerformanceStats(inWindow);

  const calls: DigestCallSummary[] = [];
  for (const e of inWindow) {
    const mult = toMultiplier(e.multiplier);
    const isProfit = e.outcome === 'PROFIT' || (e.outcome !== 'LOSS' && mult !== null && mult >= 1);
    const isLoss = e.outcome === 'LOSS' || (e.outcome !== 'PROFIT' && mult !== null && mult < 1);
    if (mult === null || (!isProfit && !isLoss)) continue;
    const ticker = e.ticker as string;
    calls.push({
      ticker: `$${isSanitized ? maskTicker(ticker) : ticker}`,
      chain: e.chain || 'other',
      multiplier: mult,
      multiplierFormatted: `${mult.toFixed(2)}x`,
      contractAddress: isSanitized ? null : e.contract_address || null,
      outcome: isProfit ? 'PROFIT' : 'LOSS',
    });
  }

  calls.sort((a, b) => b.multiplier - a.multiplier);

  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    resolvedCalls: stats.resolvedCalls,
    profitableCalls: stats.profitableCalls,
    losses: stats.losses,
    winRateFormatted: stats.winRateFormatted,
    topMultiplier: calls.length > 0 ? calls[0].multiplier : null,
    calls: calls.slice(0, MAX_CALLS),
    isSanitized,
    tier,
  };
}

function escapeHtml(str: string): string {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Formats a digest as Telegram HTML (parse_mode=HTML).
 * NOTE: not yet wired to the bot. Delivery requires a server/cron change in a frozen zone
 * (src/server/**, src/app/api/**) and needs separate approval.
 */
export function formatTelegramDigest(digest: WeeklyPerformanceDigest): string {
  const start = digest.windowStart.slice(0, 10);
  const end = digest.windowEnd.slice(0, 10);
  const lines: string[] = [
    '<b>TrenchLabs weekly digest</b>',
    `<i>${escapeHtml(start)} to ${escapeHtml(end)}</i>`,
    '',
    `Win rate: ${escapeHtml(digest.winRateFormatted)} (${digest.profitableCalls}W / ${digest.losses}L)`,
    `Top multiple: ${digest.topMultiplier !== null ? `${digest.topMultiplier.toFixed(2)}x` : '-'}`,
    `Resolved calls: ${digest.resolvedCalls}`,
    '',
  ];

  if (digest.calls.length === 0) {
    lines.push('No calls closed in the last 7 days.');
  } else {
    lines.push('<b>Top closed calls</b>');
    for (const c of digest.calls) {
      const ca = c.contractAddress ? ` <code>${escapeHtml(c.contractAddress)}</code>` : '';
      lines.push(`${escapeHtml(c.ticker)} (${escapeHtml(c.chain)}): ${c.multiplierFormatted}${ca}`);
    }
  }

  if (digest.isSanitized) {
    lines.push('', '<i>Free preview. Hold or stake $H42 for full call details.</i>');
  }

  return lines.join('\n');
}
