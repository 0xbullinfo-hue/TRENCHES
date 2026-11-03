'use client';

import React, { useEffect, useState } from 'react';
import { useGenesisBalance } from '@/context/GenesisContext';
import type { AlphaItem, Chain } from '@/lib/types';
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  Lock,
  X,
} from 'lucide-react';

const CHAIN_CHIPS: ('ALL' | Chain)[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

const INITIAL_TIMERS: Record<string, number> = {
  'sol-trench': 1 * 3600 + 45 * 60 + 19, // 01h 45m
  'pepe-trench': 3 * 3600 + 12 * 60 + 44, // 03h 12m
};

function formatHms(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function BeakerRiskGauge({ level }: { level: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5 font-mono text-2xs"
      title={`Degen Risk Gauge: ${level}/5 Beakers`}
    >
      {Array.from({ length: 5 }).map((_, idx) => {
        const active = idx < level;
        return (
          <FlaskConical
            key={idx}
            className={`w-3 h-3 ${active ? 'text-accent' : 'text-line'}`}
          />
        );
      })}
      <span className="ml-1 text-muted tnum">({level}/5)</span>
    </span>
  );
}

export const ActiveAlphas: React.FC = () => {
  const { alphas, tier, setDemoPreset } = useGenesisBalance();
  const [chainFilter, setChainFilter] = useState<'ALL' | Chain>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeModalItem, setActiveModalItem] = useState<AlphaItem | null>(null);
  const [claimedIds, setClaimedIds] = useState<Record<string, boolean>>({});
  const [timers, setTimers] = useState<Record<string, number>>(INITIAL_TIMERS);

  // 1Hz countdown tick for live timers
  useEffect(() => {
    const id = setInterval(() => {
      setTimers((prev) => {
        const next: Record<string, number> = {};
        for (const k of Object.keys(prev)) {
          next[k] = Math.max(0, prev[k] - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = alphas.filter((item) =>
    chainFilter === 'ALL' ? true : item.chain === chainFilter
  );

  const handleCopyCa = (id: string, ca: string | null) => {
    if (!ca) return;
    navigator.clipboard.writeText(ca);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClaim = (id: string) => {
    setClaimedIds((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <>
      <div className="card flex flex-col justify-between h-full">
        <div>
          {/* Card Header with Live Pulse Dot & Chain Filter Chips */}
          <div className="card-head flex-wrap h-auto py-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping1hz absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
              </span>
              <span className="text-ink font-semibold">ACTIVE ALPHAS</span>
            </div>

            <div className="flex items-center gap-1" role="group" aria-label="Chain Filter">
              {CHAIN_CHIPS.map((chip) => {
                const active = chainFilter === chip;
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setChainFilter(chip)}
                    className={`chip cursor-pointer ${active ? 'chip-active' : ''}`}
                  >
                    {chip}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Alpha Cards Stack */}
          <div className="p-3 space-y-2.5">
            {filtered.map((item) => {
              const isLive = item.status === 'LIVE';
              const isIncubating = item.status === 'INCUBATING';
              const timerSeconds = timers[item.id];
              const isCopied = copiedId === item.id;
              const isClaimed = !!claimedIds[item.id];

              return (
                <article
                  key={item.id}
                  className={`rounded-sm border p-3.5 transition-colors ${
                    item.locked
                      ? 'bg-surface-2/60 border-line'
                      : isLive
                      ? 'bg-surface-2 border-hairline hover:border-hairline-hover'
                      : 'bg-surface-2 border-line hover:border-hairline-hover'
                  }`}
                >
                  {/* Row 1: Ticker + Chain Pill + Status Badge */}
                  <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-line">
                    <div className="flex items-center gap-2">
                      <h4 className="font-mono text-sm font-bold text-ink">{item.ticker}</h4>
                      <span className="px-1.5 py-0.5 rounded-sm bg-canvas border border-line font-mono text-2xs font-semibold text-muted uppercase">
                        {item.chain}
                      </span>
                    </div>

                    {isLive ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-accent/10 border border-accent/40 text-accent font-mono text-2xs font-semibold uppercase">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping1hz absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent" />
                        </span>
                        {item.statusLabel}
                      </span>
                    ) : isIncubating ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-amber/10 border border-amber/40 text-amber font-mono text-2xs font-semibold uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber" />
                        {item.statusLabel}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-idle/15 border border-idle/40 text-idle font-mono text-2xs font-semibold uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-idle" />
                        {item.statusLabel}
                      </span>
                    )}
                  </div>

                  {/* Row 2: Tabular Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2.5 font-mono text-xs">
                    <div>
                      <div className="text-2xs text-dim uppercase">{item.allocationLabel}</div>
                      <div
                        className={`font-bold tnum mt-0.5 ${
                          item.locked ? 'text-dim' : 'text-accent'
                        }`}
                      >
                        {item.id === 'alpha-x' ? '25.0 ETH' : item.allocation}
                      </div>
                    </div>

                    <div>
                      <div className="text-2xs text-dim uppercase">
                        {timerSeconds !== undefined ? 'TIMER' : 'TIER GATE'}
                      </div>
                      <div className="font-semibold text-ink tnum mt-0.5">
                        {timerSeconds !== undefined
                          ? formatHms(timerSeconds)
                          : item.minTierLabel}
                      </div>
                    </div>

                    <div className="col-span-2 sm:col-span-1">
                      <div className="text-2xs text-dim uppercase">DEGEN RISK GAUGE</div>
                      <div className="mt-0.5">
                        <BeakerRiskGauge level={item.risk} />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Quick Actions or Tier Gate Notice */}
                  <div className="pt-2.5 border-t border-line flex flex-wrap items-center justify-between gap-2 font-mono text-2xs">
                    {item.locked ? (
                      <div className="w-full flex items-center justify-between gap-2 text-amber">
                        <span className="inline-flex items-center gap-1.5">
                          <Lock className="w-3 h-3" />
                          <span>
                            Tier Gate: <strong>{item.minTierLabel}</strong> required (You hold{' '}
                            {tier.label})
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDemoPreset('1m')}
                          className="text-accent hover:underline font-semibold cursor-pointer"
                        >
                          Simulate 1M →
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActiveModalItem(item)}
                            className="btn btn-secondary btn-sm cursor-pointer"
                          >
                            <span>
                              {item.id === 'sol-trench'
                                ? '[View Details & Claim]'
                                : '[View Details]'}
                            </span>
                          </button>

                          {item.ca && (
                            <button
                              type="button"
                              onClick={() => handleCopyCa(item.id, item.ca)}
                              className={`btn btn-sm border cursor-pointer ${
                                isCopied
                                  ? 'bg-accent/15 border-accent text-accent'
                                  : 'btn-secondary'
                              }`}
                              title={`CA: ${item.ca}`}
                            >
                              {isCopied ? (
                                <>
                                  <Check className="w-3 h-3 text-accent" />
                                  <span>[CA Copied]</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>[Copy CA]</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {/* External Terminal Links ([Photon / BullX] or [DexScreener]) */}
                        <div className="flex items-center gap-1.5">
                          {item.id === 'sol-trench' ? (
                            <a
                              href="https://photon-sol.tinyastro.io/"
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost btn-sm border border-line text-muted hover:text-accent"
                            >
                              <span>[Photon / BullX]</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          ) : (
                            item.links.map((lk) => (
                              <a
                                key={lk.label}
                                href={lk.href}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-ghost btn-sm border border-line text-muted hover:text-accent"
                              >
                                <span>[{lk.label}]</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {isClaimed && (
                    <div className="mt-2 px-2.5 py-1 rounded-sm bg-accent/10 border border-accent/30 font-mono text-2xs text-accent flex items-center justify-between">
                      <span>✓ ALLOCATION CLAIM REGISTERED ON SOLANA RELAY</span>
                      <span>CONFIRMED</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {/* Footer Status Strip */}
        <div className="px-4 py-2.5 border-t border-line flex items-center justify-between font-mono text-2xs text-dim">
          <span>API ENGINE: /api/alphas</span>
          <span className="text-accent">TIER FILTER: {tier.label.toUpperCase()}</span>
        </div>
      </div>

      {/* Alpha Detail & Claim Modal */}
      {activeModalItem && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${activeModalItem.ticker} Details`}
        >
          <div className="card w-full max-w-lg">
            <div className="card-head">
              <div className="flex items-center gap-2 text-ink font-semibold">
                <span>ALPHA_DOSSIER</span>
                <span className="text-accent">{activeModalItem.ticker}</span>
                <span className="px-1.5 py-0.5 rounded-sm bg-surface-2 border border-line text-2xs">
                  {activeModalItem.chain}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalItem(null)}
                className="text-muted hover:text-ink p-1 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-muted leading-relaxed">{activeModalItem.summary}</p>

              <div className="bg-surface-2 border border-line rounded-sm divide-y divide-line font-mono text-xs">
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">{activeModalItem.allocationLabel.toUpperCase()}</span>
                  <span className="text-accent font-bold tnum">{activeModalItem.allocation}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">MINIMUM TIER</span>
                  <span className="text-ink font-semibold">{activeModalItem.minTierLabel}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">DEGEN RISK</span>
                  <BeakerRiskGauge level={activeModalItem.risk} />
                </div>
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-dim shrink-0">CONTRACT (CA)</span>
                  <span className="text-ink tnum truncate">
                    {activeModalItem.ca ?? 'REDACTED'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {activeModalItem.ca && (
                  <button
                    type="button"
                    onClick={() => handleCopyCa(activeModalItem.id, activeModalItem.ca)}
                    className="btn btn-secondary h-9 px-3 text-xs cursor-pointer"
                  >
                    {copiedId === activeModalItem.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-accent" />
                        <span className="text-accent">CA Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy CA</span>
                      </>
                    )}
                  </button>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  {activeModalItem.status === 'LIVE' && (
                    <button
                      type="button"
                      onClick={() => {
                        handleClaim(activeModalItem.id);
                        setActiveModalItem(null);
                      }}
                      className="btn btn-primary h-9 px-4 text-xs cursor-pointer"
                    >
                      <span>
                        {claimedIds[activeModalItem.id]
                          ? 'Allocation Claimed ✓'
                          : `Claim ${activeModalItem.allocation}`}
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveModalItem(null)}
                    className="btn btn-secondary h-9 px-3 text-xs cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
