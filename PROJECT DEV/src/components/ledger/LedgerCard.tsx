import React from 'react';
import { MultiplierBlock } from './MultiplierBlock';
import { CopyableCA } from './CopyableCA';
import { formatChainLabel, formatLedgerDate, formatTicker } from '@/lib/ledger/format';
import { ArrowUpRight } from 'lucide-react';

export interface LedgerCardData {
  id: string;
  ticker: string;
  chain: string;
  contract_address: string;
  multiplier: string;
  entry_price?: string | null;
  exit_price?: string | null;
  proof_url?: string | null;
  notes?: string | null;
  closed_at: string;
  posted_at: string;
  updated_at?: string | null;
  edited?: boolean;
}

export function LedgerCard({ entry }: { entry: LedgerCardData }) {
  const hasPricing = Boolean(entry.entry_price || entry.exit_price);

  return (
    <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-5 flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5 hover:border-neutral-700 shadow-sm min-h-[320px]">
      <div>
        {/* Top Header: Ticker, Chain Pill, and Closed Badge */}
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-sans text-lg font-semibold text-white tracking-tight truncate">
              {formatTicker(entry.ticker)}
            </span>
            <span className="font-sans text-[11px] font-medium text-muted bg-neutral-950 px-2 py-0.5 rounded border border-neutral-800/80 shrink-0">
              {formatChainLabel(entry.chain)}
            </span>
          </div>

          <span className="font-sans text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded uppercase tracking-wider shrink-0 select-none">
            CLOSED
          </span>
        </div>

        {/* Multiplier Hero Block */}
        <div className="mb-4">
          <MultiplierBlock multiplier={entry.multiplier} />
        </div>

        {/* Entry / Exit Row: Only rendered if present (No placeholders per §3) */}
        {hasPricing && (
          <div className="flex items-center gap-4 mb-3 font-mono text-xs">
            {entry.entry_price && (
              <div>
                <span className="text-muted text-[10px] uppercase block">Entry</span>
                <span className="text-white font-medium tnum">{entry.entry_price}</span>
              </div>
            )}
            {entry.exit_price && (
              <div>
                <span className="text-muted text-[10px] uppercase block">Exit</span>
                <span className="text-white font-medium tnum">{entry.exit_price}</span>
              </div>
            )}
          </div>
        )}

        {/* Contract Address */}
        <div className="mb-3">
          <CopyableCA address={entry.contract_address} />
        </div>

        {/* Notes (if present) */}
        {entry.notes && (
          <p className="font-sans text-xs text-muted/90 italic leading-relaxed mb-4 line-clamp-3">
            &ldquo;{entry.notes}&rdquo;
          </p>
        )}
      </div>

      {/* Non-negotiable Footer Honesty Disclosure */}
      <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
        <div className="flex items-center gap-1.5 truncate">
          <span className="truncate">
            Recorded by the TrenchLabs team · {formatLedgerDate(entry.closed_at)}
          </span>
          {entry.edited && (
            <span className="text-[9px] uppercase font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1 py-0.2 rounded shrink-0">
              edited
            </span>
          )}
        </div>

        {entry.proof_url && (
          <a
            href={entry.proof_url}
            target="_blank"
            rel="noreferrer"
            className="text-pump hover:text-white inline-flex items-center gap-0.5 shrink-0 transition-colors font-sans text-xs font-semibold"
          >
            <span>Proof</span>
            <ArrowUpRight className="w-3 h-3 stroke-[2.5]" />
          </a>
        )}
      </div>
    </div>
  );
}
