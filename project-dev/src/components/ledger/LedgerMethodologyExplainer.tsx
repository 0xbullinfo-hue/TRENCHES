'use client';

import React, { useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, ChevronUp, HelpCircle, Shield, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';

const STORAGE_KEY = 'trenchlabs_ledger_explainer_dismissed_v1';

export const LedgerMethodologyExplainer: React.FC<{ className?: string }> = ({ className }) => {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = useState<boolean>(false);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
  };

  const handleRestore = () => {
    setDismissed(false);
    setExpanded(true);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  if (dismissed) {
    return (
      <div className={cn('flex justify-end', className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleRestore}
          className="font-mono text-xs text-muted hover:text-white inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-default hover:border-brand/40"
          title="Open ledger methodology explainer"
        >
          <HelpCircle className="w-3.5 h-3.5 text-brand" />
          <span>How this ledger works</span>
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="ledger-methodology-explainer"
      className={cn(
        'rounded-xl bg-surface border border-brand/30 p-5 sm:p-6 space-y-4 shadow-sm transition-all',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-card border border-brand/30 flex items-center justify-center text-brand shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-sans text-sm sm:text-base font-bold uppercase tracking-wider text-white">
              How This Ledger Works â€” Recording &amp; Calculation Methodology
            </h2>
            <p className="font-sans text-xs text-muted">
              Honest, verifiable performance tracking derived strictly from recorded on-chain calls.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-muted hover:text-white h-7 px-2 font-mono text-xs inline-flex items-center gap-1"
            aria-label={expanded ? 'Collapse methodology details' : 'Expand methodology details'}
          >
            <span>{expanded ? 'Collapse' : 'Details'}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="w-7 h-7 p-0 text-muted hover:text-white"
            title="Dismiss explainer"
            aria-label="Dismiss ledger explainer"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary Points */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs pt-1">
        <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
          <div className="flex items-center gap-1.5 text-brand font-bold uppercase">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Resolved Calls Only</span>
          </div>
          <p className="font-sans text-xs text-muted">
            Win rate is calculated strictly on resolved calls. Active or pending calls are excluded from the denominator.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
          <div className="flex items-center gap-1.5 text-brand font-bold uppercase">
            <Shield className="w-3.5 h-3.5" />
            <span>Research Isolated</span>
          </div>
          <p className="font-sans text-xs text-muted">
            Curated Watchlist &amp; research entries do not impact win rates or historical trade outcome metrics.
          </p>
        </div>

        <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
          <div className="flex items-center gap-1.5 text-brand font-bold uppercase">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Strict CA Validation</span>
          </div>
          <p className="font-sans text-xs text-muted">
            All Solana (32â€“44 Base58) and EVM (0x40 Hex) contract addresses are cryptographically validated.
          </p>
        </div>
      </div>

      {/* Expanded Detailed Rules */}
      {expanded && (
        <div className="pt-3 border-t border-border-default space-y-2 text-xs font-sans text-muted leading-relaxed">
          <h4 className="font-bold text-white uppercase font-mono text-xs">Mathematical Formula:</h4>
          <div className="p-3 rounded-lg bg-canvas font-mono text-xs text-brand border border-border-default">
            Win Rate = (Profitable Calls / (Profitable Calls + Losses)) Ã— 100
          </div>
          <ul className="list-disc list-inside space-y-1 pt-1">
            <li><strong>Profitable Outcomes:</strong> Recorded calls achieving peak multiple â‰¥ 1.0Ã— or designated take-profit hit.</li>
            <li><strong>Loss Outcomes:</strong> Recorded calls hitting stop-loss parameters or closing below 1.0Ã— multiple.</li>
            <li><strong>Multi-Chain Compatibility:</strong> Supports Solana SPL tokens and EVM contracts across Ethereum, Base, and BSC.</li>
          </ul>
        </div>
      )}
    </div>
  );
};
