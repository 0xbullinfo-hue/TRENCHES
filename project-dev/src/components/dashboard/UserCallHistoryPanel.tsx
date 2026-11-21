'use client';

import React, { useState } from 'react';
import type { Portfolio } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Activity, ArrowUpRight, Target } from 'lucide-react';

export interface UserCallHistoryPanelProps {
  portfolio: Portfolio | null;
  connected: boolean;
  onExploreAlpha?: () => void;
}

const PREVIEW_ROWS = 4;

export const UserCallHistoryPanel: React.FC<UserCallHistoryPanelProps> = ({
  portfolio,
  connected,
  onExploreAlpha,
}) => {
  const [expanded, setExpanded] = useState(false);
  const history = portfolio?.history ?? [];
  const visibleRows = expanded ? history : history.slice(0, PREVIEW_ROWS);

  return (
    <section
      id="account-activity"
      data-testid="user-call-history"
      aria-labelledby="user-call-history-heading"
      className="rounded-xl bg-surface border border-border-default p-4 sm:p-5 space-y-4 flex flex-col justify-between"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-border-default">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-bg border border-brand-border flex items-center justify-center text-brand shrink-0">
              <Activity className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="user-call-history-heading"
                className="font-sans text-sm sm:text-base font-extrabold text-white tracking-tight"
              >
                Account Call History
              </h2>
              <p className="font-sans text-xs text-muted">
                Your personal wallet allocation &amp; claim log
              </p>
            </div>
          </div>

          <span className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default font-mono text-[10px] font-bold uppercase text-dim shrink-0">
            Personal
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
          <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-0.5">
            <div className="text-[11px] font-bold uppercase text-muted">Recorded Calls</div>
            <div className="text-base font-black text-white tnum">
              {portfolio?.claimedCount ?? 0}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-0.5">
            <div className="text-[11px] font-bold uppercase text-muted">Realized PnL</div>
            <div className="text-base font-black text-brand tnum truncate">
              {portfolio?.totalRealizedPnl || '—'}
            </div>
          </div>
        </div>

        {history.length === 0 ? (
          <div
            data-testid="user-call-history-empty"
            className="rounded-lg bg-surface-card/70 border border-dashed border-border-default p-4 text-center space-y-2.5"
          >
            <p className="font-sans text-xs text-muted leading-relaxed">
              {connected
                ? portfolio?.note || 'No personal call allocations or verified claims recorded for this wallet yet.'
                : 'Connect and verify your wallet to track personal call allocations and realized history.'}
            </p>
            {onExploreAlpha && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onExploreAlpha}
                className="h-8 px-3 text-xs font-mono font-bold gap-1.5"
              >
                <Target className="w-3.5 h-3.5 text-alpha-primary" />
                <span>Explore Active Calls</span>
                <ArrowUpRight className="w-3 h-3" />
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border-default rounded-lg border border-border-default bg-surface-card/60 overflow-hidden">
            {visibleRows.map((entry, idx) => (
              <div
                key={`${entry.sig}-${idx}`}
                className="px-3 py-2.5 flex items-center justify-between gap-3 font-mono text-xs"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">{entry.ticker}</span>
                    <span className="px-1.5 py-0.5 rounded bg-surface border border-border-default text-2xs font-bold text-muted">
                      {entry.chain}
                    </span>
                    <span className="text-muted text-[11px] tnum">{entry.size}</span>
                  </div>
                  <div className="text-[10px] text-dim tnum truncate">
                    {new Date(entry.claimedAt).toLocaleDateString()} · {entry.sig.slice(0, 10)}
                  </div>
                </div>
                <span
                  className={`font-bold text-xs shrink-0 tnum ${
                    entry.pnlPositive ? 'text-brand' : 'text-danger'
                  }`}
                >
                  {entry.pnl}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {history.length > PREVIEW_ROWS && (
        <div className="pt-1 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            className="h-7 px-2.5 text-xs font-mono font-bold text-brand"
          >
            {expanded ? 'Show fewer' : `Show all (${history.length})`}
          </Button>
        </div>
      )}
    </section>
  );
};
