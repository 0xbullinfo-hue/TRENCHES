'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { GenesisContext } from '@/context/GenesisContext';
import { BUY_LINKS } from '@/lib/config';

export interface OnboardingChecklistProps {
  className?: string;
  onExploreCalls?: () => void;
  // Optional test/dependency injection overrides
  walletAddress?: string;
  isWalletConnected?: boolean;
  isUnlockedOverride?: boolean;
}

const getStorageKey = (wallet: string) => `trenchlabs_onboarding_dismissed_v1:${wallet || 'anon'}`;

export const OnboardingChecklist: React.FC<OnboardingChecklistProps> = ({
  className,
  onExploreCalls,
  walletAddress,
  isWalletConnected,
  isUnlockedOverride,
}) => {
  const context = React.useContext(GenesisContext);
  const connected = isWalletConnected ?? context?.connected ?? false;
  const activeWallet = walletAddress ?? context?.publicKeyBase58 ?? '';
  const isUnlocked = isUnlockedOverride ?? context?.isUnlocked ?? false;
  const isPro = context?.tier?.id === 'PRO';
  const isMember = context?.tier?.id === 'LAB_MEMBER' || isUnlocked;

  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    if (!activeWallet) {
      queueMicrotask(() => setDismissed(true));
      return;
    }
    try {
      const isDismissed = window.localStorage.getItem(getStorageKey(activeWallet)) === 'true';
      queueMicrotask(() => setDismissed(isDismissed));
    } catch {
      queueMicrotask(() => setDismissed(false));
    }
  }, [activeWallet]);

  if (!connected || !activeWallet || dismissed) {
    return null;
  }

  // 4 steps determination:
  const step1Done = true;
  const step2Done = isMember || isPro;
  const step3Done = isPro;
  const step4Done = isUnlocked;

  const completedCount = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      if (activeWallet) {
        window.localStorage.setItem(getStorageKey(activeWallet), 'true');
      }
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-testid="onboarding-checklist"
      className={cn(
        'p-5 sm:p-6 rounded-xl bg-surface border border-brand/40 space-y-4 transition-all shadow-sm',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-border-default">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-card border border-brand/40 flex items-center justify-center text-brand shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-sans text-sm sm:text-base font-bold uppercase tracking-wider text-white">
                Getting Started in TrenchLabs HQ
              </h2>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface-card border border-border-default text-brand font-bold">
                {completedCount} of 4 Complete
              </span>
            </div>
            <p className="font-sans text-xs text-muted">
              Complete these 4 steps to get the full research, signal alert, and incubator experience.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          className="w-7 h-7 p-0 text-muted hover:text-white"
          title="Dismiss onboarding checklist"
          aria-label="Dismiss onboarding checklist"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* 4 Steps Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        {/* Step 1 */}
        <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted font-bold">STEP 1</span>
            <CheckCircle2 className="w-4 h-4 text-brand" />
          </div>
          <div className="font-bold text-white font-sans text-xs">Connect Solana Wallet</div>
          <p className="font-sans text-xs text-muted">Wallet successfully authenticated.</p>
        </div>

        {/* Step 2 */}
        <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted font-bold">STEP 2</span>
            {step2Done ? (
              <CheckCircle2 className="w-4 h-4 text-brand" />
            ) : (
              <Circle className="w-4 h-4 text-muted" />
            )}
          </div>
          <div className="font-bold text-white font-sans text-xs">Hold ~$20 in $H42</div>
          <p className="font-sans text-xs text-muted">
            {step2Done ? 'Member tier holding verified.' : 'Required for standard alpha access.'}
          </p>
          {!step2Done && (
            <a
              href={BUY_LINKS.pump}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-brand hover:text-brand-bright inline-flex items-center gap-1 mt-1 text-xs"
            >
              <span>Get $H42</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Step 3 */}
        <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted font-bold">STEP 3</span>
            {step3Done ? (
              <CheckCircle2 className="w-4 h-4 text-brand" />
            ) : (
              <Circle className="w-4 h-4 text-muted" />
            )}
          </div>
          <div className="font-bold text-white font-sans text-xs">Stake for Pro ($250)</div>
          <p className="font-sans text-xs text-muted">
            {step3Done ? 'Pro tier unlocked (instant calls).' : 'Stake $H42 on StakePoint.'}
          </p>
          {!step3Done && (
            <Link
              href="/dashboard/stake"
              className="font-bold text-brand hover:text-brand-bright inline-flex items-center gap-1 mt-1 text-xs"
            >
              <span>Stake on StakePoint</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>

        {/* Step 4 */}
        <div className="p-3.5 rounded-lg bg-surface-card border border-border-default space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-muted font-bold">STEP 4</span>
            {step4Done ? (
              <CheckCircle2 className="w-4 h-4 text-brand" />
            ) : (
              <Circle className="w-4 h-4 text-muted" />
            )}
          </div>
          <div className="font-bold text-white font-sans text-xs">Explore Curated Alpha</div>
          <p className="font-sans text-xs text-muted">Review trade milestones, CAs &amp; TP/SL.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onExploreCalls}
            className="p-0 h-auto font-bold text-brand hover:text-brand-bright inline-flex items-center gap-1 text-xs text-left"
          >
            <span>Browse Calls â†’</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
