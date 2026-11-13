import React from 'react';
import { ExternalLink } from 'lucide-react';
import {
  calculatePnL,
  formatChainLabel,
  formatMarketCap,
  formatMultiplier,
  formatTicker,
  getDexScreenerUrl,
} from '@/lib/ledger/format';

export interface LedgerCardData {
  id: string;
  ticker: string;
  chain: string;
  contract_address: string;
  multiplier: string;
  entry_price?: string | null;
  exit_price?: string | null;
  proof_url?: string | null;
  verification_status?: 'REPORTED' | 'EVIDENCE_SUPPLIED' | 'ONCHAIN_VERIFIED';
  notes?: string | null;
  closed_at: string;
  posted_at: string;
  updated_at?: string | null;
  edited?: boolean;
}

export function LedgerTableRow({ entry }: { entry: LedgerCardData }) {
  const exitMc = formatMarketCap(entry.exit_price);
  const pnl = calculatePnL(entry.multiplier);
  const dexUrl = getDexScreenerUrl(entry.chain, entry.contract_address);
  const tickerFormatted = formatTicker(entry.ticker);

  return (
    <tr
      key={entry.id}
      className="border-b border-border-default/30 hover:bg-surface-elevated/40 transition-colors"
    >
      {/* Column 1 — Ticker */}
      <td className="px-4 py-3.5 text-left whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span className="font-sans text-sm font-bold text-white tracking-tight">
            {tickerFormatted}
          </span>
          {entry.chain && (
            <span className="font-sans text-[10px] font-bold text-muted bg-surface px-1.5 py-0.5 rounded border border-toxic-border/40 uppercase tracking-wider">
              {formatChainLabel(entry.chain)}
            </span>
          )}
        </div>
      </td>

      {/* Column 2 — Entry MCAP */}
      <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm text-zinc-300 font-medium tnum whitespace-nowrap">
        {formatMarketCap(entry.entry_price)}
      </td>

      {/* Column 3 — Exit MCAP */}
      <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm font-medium tnum whitespace-nowrap">
        {exitMc !== '—' ? (
          <span className="text-toxic font-bold">{exitMc}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>

      {/* Column 4 — Multiplier */}
      <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm tnum whitespace-nowrap">
        <span className="inline-block px-2 py-0.5 rounded bg-toxic/10 border border-toxic/30 text-toxic font-bold font-mono">
          {formatMultiplier(entry.multiplier)}
        </span>
      </td>

      {/* Column 5 — PnL */}
      <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm tnum whitespace-nowrap">
        {pnl.sign === 'positive' && (
          <span className="text-toxic font-bold">{pnl.formatted}</span>
        )}
        {pnl.sign === 'negative' && (
          <span className="text-rose-400 font-bold">{pnl.formatted}</span>
        )}
        {pnl.sign === 'zero' && (
          <span className="text-muted font-medium">{pnl.formatted}</span>
        )}
        {pnl.sign === 'invalid' && (
          <span className="text-muted">{pnl.formatted}</span>
        )}
      </td>

      {/* Column 6 — DexScreener */}
      <td className="px-4 py-3.5 text-right whitespace-nowrap">
        {dexUrl ? (
          <a
            href={dexUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${tickerFormatted} on DexScreener`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface hover:bg-surface-elevated border border-border-default hover:border-toxic text-xs font-sans font-bold text-zinc-300 hover:text-toxic transition-colors cursor-pointer group"
          >
            <span>View</span>
            <ExternalLink className="w-3 h-3 text-muted group-hover:text-toxic transition-colors" />
          </a>
        ) : (
          <span className="text-muted font-mono text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

export const LedgerCard = LedgerTableRow;
