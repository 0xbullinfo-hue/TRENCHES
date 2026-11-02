'use client';

import React, { useEffect, useState } from 'react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { SOLSCAN } from '@/lib/config';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  Send,
  TrendingUp,
} from 'lucide-react';

function formatRevealTimer(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export const PipelineAllocations: React.FC = () => {
  const { portfolio, shortAddress, tier } = useGenesisBalance();

  // REVEAL T-MINUS: 04h 20m 11s
  const [revealSeconds, setRevealSeconds] = useState<number>(4 * 3600 + 20 * 60 + 11);
  const [tgAccessKey, setTgAccessKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  useEffect(() => {
    const id = setInterval(() => {
      setRevealSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const handleGenerateTelegramKey = () => {
    const entropy = Math.random().toString(36).substring(2, 8).toUpperCase();
    const prefix = tier.id === 'LAB_MEMBER' ? 'MEMBER' : 'LOCKED';
    setTgAccessKey(`TLHQ-${prefix}-${entropy}`);
  };

  const handleCopyTgKey = () => {
    if (!tgAccessKey) return;
    navigator.clipboard.writeText(tgAccessKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const claimedCount = portfolio?.claimedCount ?? 4;
  const totalRealizedPnl = portfolio?.totalRealizedPnl ?? '+42.50 SOL';
  const history = portfolio?.history ?? [];

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* 1. Top Card: UPCOMING ALPHA — NO REVEALS YET */}
      <div className="card">
        <div className="card-head">
          <div className="flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-amber" />
            <span className="text-ink font-semibold">UPCOMING ALPHA — NO REVEALS YET</span>
          </div>
          <span className="text-amber font-semibold">SEALED</span>
        </div>

        <div className="p-3.5 space-y-2.5">
          {/* Terminal Countdown */}
          <div className="bg-surface-2 border border-line rounded-sm px-3 py-2 flex items-center justify-between font-mono text-xs">
            <span className="text-dim">REVEAL T-MINUS:</span>
            <span className="text-amber font-bold tnum">
              {formatRevealTimer(revealSeconds)}
            </span>
          </div>

          <div className="relative rounded-sm border border-line bg-surface-card p-3 overflow-hidden">
            <div
              aria-hidden="true"
              className="select-none pointer-events-none opacity-25 font-mono text-2xs space-y-1.5"
            >
              <div className="flex justify-between">
                <span>TICKER: $REDACTED_SOL</span>
                <span>POOL: 180.0 SOL</span>
              </div>
              <div className="flex justify-between">
                <span>CA: 9xKm...4pQv</span>
                <span>LP: LOCKED 365D</span>
              </div>
              <div className="flex justify-between">
                <span>SYNDICATE: GROUP #07</span>
                <span>GATE: 1M $GENESIS</span>
              </div>
            </div>

            <div className="absolute inset-0 bg-canvas flex flex-col items-center justify-center px-3 text-center">
              <div className="w-7 h-7 rounded-sm bg-surface-2 border border-line flex items-center justify-center text-amber mb-1">
                <Lock className="w-3.5 h-3.5" />
              </div>
              <p className="font-mono text-2xs text-ink">
                New incubations loading... Next curation drops soon.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Middle Card: TRENCH SYNDICATE TELEGRAM */}
      <div className="card">
        <div className="card-head">
          <div className="flex items-center gap-1.5">
            <Send className="w-3 h-3 text-accent" />
            <span className="text-ink font-semibold">TRENCH SYNDICATE TELEGRAM</span>
          </div>
          <span className="text-accent font-semibold">GASLESS</span>
        </div>

        <div className="p-3.5 space-y-2.5">
          <div className="flex items-center justify-between bg-surface-2 border border-line rounded-sm px-3 py-2 font-mono text-2xs">
            <span className="text-dim">STATUS</span>
            <span className="text-accent font-semibold flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              VERIFIED HOLDER DETECTED
            </span>
          </div>

          {tgAccessKey ? (
            <div className="flex items-center justify-between gap-2 bg-surface-2 border border-hairline rounded-sm px-3 py-2 font-mono text-xs">
              <div>
                <div className="text-2xs text-dim">ONE-TIME ACCESS KEY ({shortAddress})</div>
                <div className="text-accent font-bold tnum">{tgAccessKey}</div>
              </div>
              <button
                type="button"
                onClick={handleCopyTgKey}
                className="btn btn-secondary btn-sm cursor-pointer"
              >
                {copiedKey ? (
                  <>
                    <Check className="w-3 h-3 text-accent" />
                    <span className="text-accent">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGenerateTelegramKey}
              className="btn btn-secondary w-full h-8 text-2xs cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-accent" />
              <span>[Generate Telegram Access Key]</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Bottom Card: MY ALLOCATIONS */}
      <div className="card flex-1 flex flex-col justify-between">
        <div>
          <div className="card-head">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-accent" />
              <span className="text-ink font-semibold">MY ALLOCATIONS</span>
            </div>
            <span className="text-dim">SOLSCAN VERIFIED</span>
          </div>

          <div className="p-3.5 space-y-2.5">
            {/* Compact Metrics Bar: Claimed: 04 | Total Realized: +42.50 SOL */}
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              <div className="bg-surface-2 border border-line rounded-sm px-2.5 py-2 flex items-center justify-between">
                <span className="text-dim text-2xs">Claimed:</span>
                <span className="text-ink font-bold tnum">
                  {String(claimedCount).padStart(2, '0')}
                </span>
              </div>
              <div className="bg-surface-2 border border-line rounded-sm px-2.5 py-2 flex items-center justify-between">
                <span className="text-dim text-2xs">Total Realized:</span>
                <span className="text-accent font-bold tnum">{totalRealizedPnl}</span>
              </div>
            </div>

            {/* Clean Tabular History Rows with Solscan Transaction Hash Links */}
            <div className="border border-line rounded-sm divide-y divide-line font-mono text-2xs">
              <div className="px-2.5 py-1.5 bg-surface-2 text-dim grid grid-cols-12 gap-1 uppercase">
                <span className="col-span-4">TOKEN</span>
                <span className="col-span-3 text-right">SIZE</span>
                <span className="col-span-3 text-right">REALIZED</span>
                <span className="col-span-2 text-right">TX</span>
              </div>

              {history.map((row) => (
                <div
                  key={row.sig}
                  className="px-2.5 py-2 bg-surface hover:bg-surface-2 transition-colors grid grid-cols-12 gap-1 items-center tnum"
                >
                  <div className="col-span-4 font-semibold text-ink truncate">
                    {row.ticker}
                  </div>
                  <div className="col-span-3 text-right text-muted">{row.size}</div>
                  <div
                    className={`col-span-3 text-right font-semibold ${
                      row.pnlPositive ? 'text-accent' : 'text-danger'
                    }`}
                  >
                    {row.pnl}
                  </div>
                  <div className="col-span-2 text-right">
                    <a
                      href={SOLSCAN.tx(row.sig)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-end gap-0.5 text-muted hover:text-accent"
                      title={`Slot #${row.slot} — ${row.sig}`}
                    >
                      <span>{row.sig.slice(0, 4)}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
