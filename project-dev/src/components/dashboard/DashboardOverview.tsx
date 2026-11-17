'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { LaunchLockedButton } from '@/components/LaunchLockedButton';
import { BUY_LINKS, BUY_LOCK } from '@/lib/config';
import type {
  AlphaItem,
  Campaign,
  FavoritePostKind,
  FavoritePostRecord,
  Portfolio,
} from '@/lib/types';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Flame,
  Gift,
  KeyRound,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Wallet,
} from 'lucide-react';
import { ProProgressBar } from './ProProgressBar';
import { OnboardingChecklist } from './OnboardingChecklist';
import { WeeklyPerformanceDigest } from './WeeklyPerformanceDigest';
import { MyPinnedPosts } from './MyPinnedPosts';
import { UserCallHistoryPanel } from './UserCallHistoryPanel';
import { TelegramVerificationCard } from '@/components/telegram/TelegramVerificationCard';

export interface DashboardOverviewProps {
  connected: boolean;
  walletAddress?: string | null;
  shortAddress: string;
  tier: { id: string; label?: string; multiplier?: number };
  formattedBalance: string;
  alphasCount: number;
  newCallsCount: number;
  raidsCount: number;
  isUnlocked: boolean;
  isAdmin?: boolean;
  isVerified?: boolean;
  needsVerification?: boolean;
  telegramConnected?: boolean | null;
  favorites?: FavoritePostRecord[];
  alphas?: AlphaItem[];
  campaigns?: Campaign[];
  portfolio?: Portfolio | null;
  onCopyGenesisCa: (e: React.MouseEvent) => void;
  copiedGenesisCa: boolean;
  onConnectWallet?: () => void;
  onVerifyWallet?: () => void;
  onTelegramStatusChange?: (connected: boolean) => void;
  onOpenAlpha?: (coin: AlphaItem, destination: 'ALPHA' | 'MAX_ALPHA') => void;
  onOpenRaid?: (campaignId: string) => void;
  onUnpinPost?: (kind: FavoritePostKind, id: string) => void;
  onSelectFilter?: (filter: 'all' | 'new') => void;
  onSelectTab?: (tab: 'ALPHA' | 'SOCIAL' | 'MAX_ALPHA' | 'STAKE') => void;
  /** Additional Connected Services panel (e.g. Multi-Chain EVM Binding) displayed beside Telegram Verification. */
  children?: React.ReactNode;
}

interface OverviewAlertItem {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  tone: 'brand' | 'amber' | 'danger';
  onAction: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  connected,
  walletAddress,
  shortAddress,
  tier,
  formattedBalance,
  alphasCount,
  newCallsCount,
  raidsCount,
  isUnlocked,
  isAdmin = false,
  isVerified = false,
  needsVerification = false,
  favorites = [],
  alphas = [],
  campaigns = [],
  portfolio = null,
  onCopyGenesisCa,
  copiedGenesisCa,
  onConnectWallet,
  onVerifyWallet,
  onTelegramStatusChange,
  onOpenAlpha,
  onOpenRaid,
  onUnpinPost,
  onSelectFilter,
  onSelectTab,
  children,
}) => {
  // Secondary analytics, setup checklist & Telegram/EVM forms are collapsed by default to keep Overview compact (Section 12.2 F)
  const [secondaryExpanded, setSecondaryExpanded] = useState(false);

  const isPro = isAdmin || tier.id === 'PRO';
  const isMember = !isPro && (tier.id === 'MEMBER' || tier.id === 'LAB_MEMBER');
  const membershipTier: 'FREE' | 'MEMBER' | 'PRO' = isPro ? 'PRO' : isMember ? 'MEMBER' : 'FREE';
  const tierDisplayName = isPro ? 'PRO TIER' : isMember ? 'MEMBER TIER' : 'FREE TIER';

  // Compute accessible pinned count consistently with MyPinnedPosts rules
  const accessiblePinnedCount = useMemo(() => {
    const alphaIds = new Map(alphas.map((a) => [a.id, a]));
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const seen = new Set<string>();
    for (const fav of favorites) {
      if (fav.kind === 'RAID') {
        if (campaignIds.has(fav.id)) seen.add(`RAID:${fav.id}`);
        continue;
      }
      const alpha = alphaIds.get(fav.id);
      if (!alpha || alpha.callType === 'WATCHLIST') continue;
      if (membershipTier === 'FREE' && !isAdmin) continue;
      const isMax =
        alpha.callType === 'MAX_ALPHA' ||
        Boolean(alpha.isMaxAlpha) ||
        (Boolean(alpha.destinations?.includes('MAX_ALPHA')) && !alpha.destinations?.includes('ALPHA'));
      if (isMax && !isPro) continue;
      seen.add(`CALL:${fav.id}`);
    }
    return seen.size;
  }, [favorites, alphas, campaigns, membershipTier, isAdmin, isPro]);

  // Actionable alerts — only shown when action is actually required (Section 12.2 C & 12.3)
  const alerts = useMemo<OverviewAlertItem[]>(() => {
    const list: OverviewAlertItem[] = [];
    if (!connected) return list;

    if (needsVerification && onVerifyWallet) {
      list.push({
        id: 'verify-wallet',
        title: 'Wallet Signature Required',
        description: `Sign a one-time verification message in ${shortAddress} to load gated Alpha calls and confirm stakes.`,
        actionLabel: 'Verify Wallet',
        tone: 'brand',
        onAction: onVerifyWallet,
      });
    } else if (membershipTier === 'FREE') {
      list.push({
        id: 'upgrade-member',
        title: 'Insufficient Membership Balance',
        description: 'Hold ~$20 in $H42 for Alpha Calls or stake $250 on StakePoint for full Pro access.',
        actionLabel: 'Stake for Access',
        tone: 'amber',
        onAction: () => onSelectTab?.('STAKE'),
      });
    } else if (membershipTier === 'MEMBER' && !isPro) {
      list.push({
        id: 'upgrade-pro',
        title: 'Unlock Max Alpha & Pro Alerts',
        description: 'Stake $250 in $H42 via StakePoint (90d lock) to access Max Alpha setups and private Pro Telegram channels.',
        actionLabel: 'Upgrade to Pro',
        tone: 'brand',
        onAction: () => onSelectTab?.('STAKE'),
      });
    }

    return list;
  }, [connected, needsVerification, onVerifyWallet, shortAddress, membershipTier, isPro, onSelectTab]);

  return (
    <div className="space-y-4">
      {/* 1. Compact Welcome Header + Unified Account Summary (Sections 12.2 A & B) */}
      <section
        data-testid="overview-account-summary"
        className="rounded-xl bg-surface border border-border-default p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 pb-4 border-b border-border-default">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-brand shrink-0">
              <Flame className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-sans text-lg sm:text-xl font-black text-white uppercase tracking-tight">
                  Welcome to the Lab
                </h1>
                <span
                  data-testid="overview-tier-badge"
                  className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-black uppercase ${
                    isPro
                      ? 'bg-alpha-strong text-white border border-alpha-border'
                      : isMember
                      ? 'bg-brand-bg text-brand border border-brand-border'
                      : 'bg-surface-card text-muted border border-border-default'
                  }`}
                >
                  {tierDisplayName}
                </span>
                {connected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-card border border-border-default font-mono text-[11px] text-white tnum">
                    <Wallet className="w-3 h-3 text-brand" />
                    <span>{shortAddress}</span>
                  </span>
                )}
                {connected && (
                  <span
                    data-testid="overview-verification-badge"
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[11px] font-bold uppercase ${
                      needsVerification
                        ? 'bg-amber/10 border-amber/40 text-amber'
                        : isVerified
                        ? 'bg-brand-bg border-brand-border text-brand'
                        : 'bg-surface-card border-border-default text-muted'
                    }`}
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>{needsVerification ? 'Signature Pending' : isVerified ? 'Verified' : 'Connected'}</span>
                  </span>
                )}
              </div>
              <p className="font-sans text-xs text-muted">
                Holdings, membership status, pinned calls, and personal account activity at a glance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setSecondaryExpanded((v) => !v)}
              className="h-9 px-3 gap-1.5 font-mono text-xs"
              title="Toggle Telegram alerts, EVM binding & weekly analytics"
            >
              <Settings2 className="w-3.5 h-3.5 text-brand" />
              <span>Account Tools</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCopyGenesisCa}
              className="h-9 px-3 gap-1.5 font-mono text-xs"
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
              <LaunchLockedButton className="h-9 px-3.5 rounded-lg font-sans text-xs font-black uppercase inline-flex items-center gap-1.5">
                <span>Buy $H42</span>
              </LaunchLockedButton>
            ) : (
              <a
                href={BUY_LINKS.pump}
                target="_blank"
                rel="noreferrer"
                className="h-9 px-3.5 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>Buy $H42</span>
                <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
              </a>
            )}
          </div>
        </div>

        {/* Unified 4-Tile Account Telemetry */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>Verified Holdings</span>
              <span className="text-brand font-mono text-[11px]">$H42</span>
            </div>
            <div className="text-white font-black text-sm tnum">
              {formattedBalance} $H42
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>Membership Tier</span>
              <ShieldCheck className="w-3.5 h-3.5 text-brand" />
            </div>
            <div className="text-white font-bold text-sm">
              {isPro ? 'Pro (Max Alpha)' : isMember ? 'Member (Standard)' : 'Free (Raids Only)'}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-surface-card border border-border-default space-y-1">
            <div className="text-[11px] text-muted uppercase font-bold tracking-wider flex items-center justify-between">
              <span>Research Access</span>
              <Target className="w-3.5 h-3.5 text-alpha-primary" />
            </div>
            <div className="text-white font-bold text-sm">
              {isUnlocked ? 'Unlocked (Live Feeds)' : 'Locked (~$20 Required)'}
            </div>
          </div>

          <Link
            href="/dashboard?tab=STAKE"
            onClick={(e) => {
              if (onSelectTab) {
                e.preventDefault();
                onSelectTab('STAKE');
              }
            }}
            className="p-3 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand space-y-1 transition-colors cursor-pointer block group focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
            title="Open Stake $H42 workspace"
          >
            <div className="text-[11px] text-muted group-hover:text-brand uppercase font-bold tracking-wider flex items-center justify-between">
              <span>Pro Staking</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-brand" />
            </div>
            <div className="text-brand-bright font-black text-sm">
              {isPro ? 'Pro Eligible · Manage' : 'Stake $250 on StakePoint'}
            </div>
          </Link>
        </div>

        {/* Compact Workspace Shortcuts Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 pt-1 font-mono text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSelectTab?.('ALPHA');
              onSelectFilter?.('all');
            }}
            className="p-2.5 h-auto w-full bg-surface-card/60 hover:bg-surface-card border border-border-default/60 hover:border-alpha-border flex items-center justify-between text-left font-normal"
          >
            <div>
              <div className="text-[10px] text-muted uppercase font-bold">Active Calls</div>
              <div className="text-sm font-black text-white tnum">{alphasCount}</div>
            </div>
            <Target className="w-4 h-4 text-alpha-primary shrink-0" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onSelectTab?.('ALPHA');
              onSelectFilter?.('new');
            }}
            className="p-2.5 h-auto w-full bg-surface-card/60 hover:bg-surface-card border border-border-default/60 hover:border-brand flex items-center justify-between text-left font-normal"
          >
            <div>
              <div className="text-[10px] text-muted uppercase font-bold">New Calls</div>
              <div className="text-sm font-black text-brand tnum">{newCallsCount}</div>
            </div>
            <Sparkles className="w-4 h-4 text-brand shrink-0" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSelectTab?.('SOCIAL')}
            className="p-2.5 h-auto w-full bg-surface-card/60 hover:bg-surface-card border border-border-default/60 hover:border-raid-border flex items-center justify-between text-left font-normal"
          >
            <div>
              <div className="text-[10px] text-muted uppercase font-bold">Active Raids</div>
              <div className="text-sm font-black text-raid-primary tnum">{raidsCount}</div>
            </div>
            <Gift className="w-4 h-4 text-raid-primary shrink-0" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              document.getElementById('pinned-posts')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="p-2.5 h-auto w-full bg-surface-card/60 hover:bg-surface-card border border-border-default/60 hover:border-amber flex items-center justify-between text-left font-normal"
          >
            <div>
              <div className="text-[10px] text-muted uppercase font-bold">My Pinned Posts</div>
              <div className="text-sm font-black text-amber tnum">{accessiblePinnedCount}</div>
            </div>
            <Star className="w-4 h-4 text-amber shrink-0" />
          </Button>
        </div>
      </section>

      {/* 2. Important Account Alerts — Only shown when action is required (Section 12.2 C) */}
      {alerts.length > 0 && (
        <section
          data-testid="overview-account-alerts"
          aria-label="Important account alerts"
          className="space-y-2.5"
        >
          {alerts.map((alert) => (
            <div
              key={alert.id}
              data-testid={`overview-alert-${alert.id}`}
              className={`rounded-xl bg-surface border p-3.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                alert.tone === 'brand'
                  ? 'border-brand/60'
                  : alert.tone === 'danger'
                  ? 'border-danger/60'
                  : 'border-amber/50'
              }`}
            >
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div
                  className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${
                    alert.tone === 'brand'
                      ? 'bg-brand-bg border-brand-border text-brand'
                      : 'bg-amber/10 border-amber/40 text-amber'
                  }`}
                >
                  {alert.id === 'verify-wallet' ? (
                    <KeyRound className="w-4 h-4" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="font-sans text-xs font-black uppercase tracking-wide text-white">
                    {alert.title}
                  </div>
                  <p className="font-sans text-xs text-muted leading-snug">
                    {alert.description}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                variant={alert.tone === 'brand' ? 'primary' : 'secondary'}
                size="sm"
                onClick={alert.onAction}
                className="h-9 px-4 text-xs font-black uppercase shrink-0"
              >
                {alert.actionLabel}
              </Button>
            </div>
          ))}
        </section>
      )}

      {/* 3. Account Verification & Connected Services — Visible by default (Section 21.3) */}
      <section
        id="overview-verification"
        data-testid="overview-connected-services"
        aria-label="Account verification and connected services"
        className="space-y-2.5"
      >
        <div className="flex items-center justify-between px-0.5">
          <div>
            <h2 className="font-sans text-sm font-extrabold uppercase tracking-wider text-white">
              Account Verification &amp; Connected Services
            </h2>
            <p className="font-sans text-xs text-muted">
              Verify Telegram group alerts and optional multi-chain EVM notifications
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <div id="overview-telegram" className="flex flex-col">
            <TelegramVerificationCard
              connected={connected}
              isPro={isPro}
              isVerified={isVerified}
              needsVerification={needsVerification}
              walletAddress={walletAddress}
              onVerifyWallet={onVerifyWallet}
              onConnectWallet={onConnectWallet}
              onStatusChange={onTelegramStatusChange}
            />
          </div>
          {children}
        </div>
      </section>

      {/* 4. Primary Overview Panels: Unified My Pinned Posts + Personal Account Call History (Sections 12.2 D & E) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        <div className="xl:col-span-7 flex flex-col">
          <MyPinnedPosts
            favorites={favorites}
            alphas={alphas}
            campaigns={campaigns}
            membershipTier={membershipTier}
            isAdmin={isAdmin}
            onOpenAlpha={(coin, dest) => onOpenAlpha?.(coin, dest)}
            onOpenRaid={(id) => onOpenRaid?.(id)}
            onUnpin={(kind, id) => onUnpinPost?.(kind, id)}
            onBrowseWorkspace={(ws) => onSelectTab?.(ws)}
          />
        </div>

        <div className="xl:col-span-5 flex flex-col">
          <UserCallHistoryPanel
            portfolio={portfolio}
            connected={connected}
            onExploreAlpha={isUnlocked ? () => onSelectTab?.('ALPHA') : undefined}
          />
        </div>
      </div>

      {/* 5. Secondary Analytics & Onboarding — Collapsed by Default (Section 12.2 F) */}
      <section
        data-testid="overview-secondary-tools"
        className="rounded-xl bg-surface border border-border-default overflow-hidden"
      >
        <button
          type="button"
          data-testid="toggle-secondary-tools"
          aria-expanded={secondaryExpanded}
          onClick={() => setSecondaryExpanded((v) => !v)}
          className="w-full px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-left hover:bg-surface-card/60 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-brand shrink-0" />
              <span className="font-sans text-sm font-extrabold text-white">
                Account Tools &amp; Weekly Analytics
              </span>
            </div>
            <p className="font-sans text-xs text-muted">
              Pro unlock progress tracker, 7-day performance digest, and onboarding checklist
            </p>
          </div>

          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-brand shrink-0">
            <span>{secondaryExpanded ? 'Collapse' : 'Expand tools'}</span>
            {secondaryExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </button>

        {secondaryExpanded && (
          <div
            data-testid="overview-secondary-content"
            className="p-4 sm:p-5 border-t border-border-default space-y-5 bg-surface/50"
          >
            <OnboardingChecklist onExploreCalls={() => onSelectTab?.('ALPHA')} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
              <ProProgressBar isPro={isPro} />
              <WeeklyPerformanceDigest tierId={tier.id} isUnlocked={isUnlocked} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
