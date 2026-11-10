import React from 'react';
import { MultiplierBlock } from './MultiplierBlock';
import { CopyableCA } from './CopyableCA';
import {
  formatChainLabel,
  formatLedgerDate,
  formatMarketCap,
  formatMultiplier,
  formatTicker,
} from '@/lib/ledger/format';
import { ArrowUpRight, CheckCircle2, Link as LinkIcon, HelpCircle } from 'lucide-react';

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

function XIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function getXShareUrl(entry: LedgerCardData): string {
  const ticker = formatTicker(entry.ticker);
  const mult = formatMultiplier(entry.multiplier);
  const entryMc = formatMarketCap(entry.entry_price);
  const exitMc = formatMarketCap(entry.exit_price);
  const chain = formatChainLabel(entry.chain);

  let text = `🚨 CLOSED CALL: ${ticker} achieved ${mult} on ${chain}!\n\n`;
  if (entryMc !== '—' && exitMc !== '—') {
    text += `📊 Entry MC: ${entryMc} ➔ Exit MC: ${exitMc}\n`;
  }
  text += `🎯 CA: ${entry.contract_address}\n\n`;
  text += `Curated via @TrenchLabsHQ incubator 🧪`;

  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://trenchlabshq.xyz')}`;
}

export function LedgerCard({ entry }: { entry: LedgerCardData }) {
  return (
    <div className="relative rounded-xl h-full flex flex-col justify-between p-5 sm:p-6 transition-all duration-150 bg-surface-card border border-border-default hover:border-toxic shadow-none min-h-[350px]">
      <div className="space-y-4">
        {/* Top Header: Ticker, Chain Pill, and Closed / Verification Badge */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-sans text-base font-bold text-white tracking-tight truncate">
              {formatTicker(entry.ticker)}
            </span>
            <span className="font-sans text-[10px] font-bold text-muted bg-surface px-2 py-0.5 rounded border border-toxic-border/40 shrink-0 uppercase tracking-wider">
              {formatChainLabel(entry.chain)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {entry.verification_status === 'ONCHAIN_VERIFIED' ? (
              <span className="font-sans text-[10px] font-bold text-toxic bg-toxic/15 border border-toxic/40 px-2 py-0.5 rounded uppercase tracking-wider shrink-0 select-none flex items-center gap-1" title="Independently validated on-chain">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Verified
              </span>
            ) : entry.verification_status === 'EVIDENCE_SUPPLIED' || entry.proof_url ? (
              <span className="font-sans text-[10px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 rounded uppercase tracking-wider shrink-0 select-none flex items-center gap-1" title="Evidence link attached">
                <LinkIcon className="w-2.5 h-2.5" />
                Evidence
              </span>
            ) : (
              <span className="font-sans text-[10px] font-bold text-zinc-400 bg-zinc-800/60 border border-zinc-700/50 px-2 py-0.5 rounded uppercase tracking-wider shrink-0 select-none flex items-center gap-1" title="Self-reported by team">
                <HelpCircle className="w-2.5 h-2.5" />
                Reported
              </span>
            )}
            <span className="font-sans text-[10px] font-bold text-toxic bg-toxic/15 border border-toxic/30 px-2 py-0.5 rounded uppercase tracking-wider shrink-0 select-none">
              CLOSED
            </span>
          </div>
        </div>

        {/* Multiplier Hero Block */}
        <div>
          <MultiplierBlock multiplier={entry.multiplier} />
        </div>

        {/* Entry & Exit in Market Caps (Not Price) */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface border border-toxic-border/40">
          <div>
            <span className="text-muted text-[10px] font-bold uppercase tracking-wider block">
              Entry MC
            </span>
            <span className="text-white font-mono text-xs sm:text-sm font-semibold tnum">
              {formatMarketCap(entry.entry_price)}
            </span>
          </div>
          <div>
            <span className="text-muted text-[10px] font-bold uppercase tracking-wider block">
              Exit MC
            </span>
            <span className="text-toxic font-mono text-xs sm:text-sm font-bold tnum">
              {formatMarketCap(entry.exit_price)}
            </span>
          </div>
        </div>

        {/* Contract Address */}
        <div>
          <CopyableCA address={entry.contract_address} />
        </div>

        {/* Share to X Button */}
        <div>
          <a
            href={getXShareUrl(entry)}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-10 px-4 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer group"
          >
            <XIcon className="w-3.5 h-3.5 text-toxic group-hover:scale-110 transition-transform" />
            <span>Share to X</span>
          </a>
        </div>
      </div>

      {/* Non-negotiable Footer Honesty Disclosure */}
      <div className="pt-4 mt-4 border-t border-toxic-border/30 flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
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
            className="text-toxic hover:text-white inline-flex items-center gap-0.5 shrink-0 transition-colors font-sans text-xs font-semibold"
          >
            <span>Proof</span>
            <ArrowUpRight className="w-3 h-3 stroke-[2.5]" />
          </a>
        )}
      </div>
    </div>
  );
}
