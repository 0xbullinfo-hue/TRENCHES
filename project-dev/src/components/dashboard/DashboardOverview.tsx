'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { LaunchLockedButton } from '@/components/LaunchLockedButton';
import { BUY_LINKS, BUY_LOCK } from '@/lib/config';
import {
  ArrowUpRight,
  Check,
  Copy,
  Flame,
  Wallet,
} from 'lucide-react';

interface DashboardOverviewProps {
  connected: boolean;
  shortAddress: string;
  tier: { id: string; label?: string; multiplier?: number };
  formattedBalance: string;
  onCopyGenesisCa: (e: React.MouseEvent) => void;
  copiedGenesisCa: boolean;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  connected,
  shortAddress,
  tier,
  formattedBalance,
  onCopyGenesisCa,
  copiedGenesisCa,
}) => {
  const isPro = tier.id === 'PRO';
  const isMember = tier.id === 'MEMBER' || tier.id === 'LAB_MEMBER';
  const tierDisplayName = isPro ? 'PRO TIER' : isMember ? 'MEMBER TIER' : 'FREE TIER';

  return (
    <div className="space-y-5">
      {/* 1. Welcome Panel & Membership Summary Strip */}
      <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border-default">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-brand shrink-0">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-sans text-xl sm:text-2xl font-black text-white uppercase tracking-tight">
                  Welcome to the Lab
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-xs font-black uppercase ${
                    isPro
                      ? 'bg-alpha-strong text-white border border-alpha-border'
                      : isMember
                      ? 'bg-brand-bg text-brand border border-brand-border'
                      : 'bg-surface-card text-muted border border-border-default'
                  }`}
                >
                  {tierDisplayName}
                </span>
              </div>
              <p className="font-sans text-xs text-muted mt-0.5">
                Multi-chain trade intelligence terminal, risk telemetry, and community rewards.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={onCopyGenesisCa}
              className="px-3.5 gap-1.5"
              title="Copy $H42 token contract address"
            >
              {copiedGenesisCa ? (
                <Check className="w-3.5 h-3.5 text-brand" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-brand" />
              )}
              <span>{copiedGenesisCa ? 'Copied CA' : 'Copy $H42 CA'}</span>
            </Button>

            {BUY_LOCK ? (
              <LaunchLockedButton className="h-10 px-4 rounded-lg font-sans text-xs font-black uppercase inline-flex items-center gap-1.5">
                <span>Buy $H42</span>
              </LaunchLockedButton>
            ) : (
              <a
                href={BUY_LINKS.pump}
                target="_blank"
                rel="noreferrer"
                className="h-10 px-4 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Buy $H42</span>
                <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </a>
            )}
          </div>
        </div>

        {/* Holdings-first overview: only the connected wallet and verified $H42 balance. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
          <div className="p-4 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-xs text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>CONNECTED WALLET</span>
              <Wallet className="w-3.5 h-3.5 text-brand" />
            </div>
            <div className="text-white font-bold truncate tnum">{connected ? shortAddress : 'Disconnected'}</div>
          </div>
          <div className="p-4 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-xs text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>VERIFIED $H42 HOLDING</span>
              <span className="text-brand font-mono text-xs">SPL</span>
            </div>
            <div className="text-white font-black tnum">{formattedBalance} $H42</div>
          </div>
        </div>
      </div>


    </div>
  );
};
