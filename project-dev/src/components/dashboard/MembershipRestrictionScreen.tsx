'use client';

import React from 'react';
import Link from 'next/link';
import { Lock, ShieldAlert, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';

export type RestrictedCategory = 'ALPHA' | 'WATCHLIST' | 'MAX_ALPHA';
export type UserMembershipTier = 'FREE' | 'MEMBER' | 'PRO';

export interface MembershipRestrictionScreenProps {
  category: RestrictedCategory;
  userTier: UserMembershipTier;
  onUpgradeClick?: () => void;
  onVerifyClick?: () => void;
  needsVerification?: boolean;
}

interface RestrictionContent {
  categoryName: string;
  categoryDescription: string;
  requiredTier: 'MEMBER' | 'PRO';
  restrictionMessage: string;
  recommendation: string;
  ctaLabel: string;
  ctaHref: string;
  badgeText: string;
}

function getRestrictionContent(
  category: RestrictedCategory,
  userTier: UserMembershipTier
): RestrictionContent {
  if (category === 'ALPHA') {
    // 4.1 FREE user opening ALPHA
    return {
      categoryName: 'ALPHA CALLS',
      categoryDescription:
        'Access curated Alpha Calls, including token entries, market intelligence and trading opportunities.',
      requiredTier: 'MEMBER',
      restrictionMessage: 'Alpha Calls are available to verified Members and PRO users.',
      recommendation: 'Upgrade to Member or PRO to unlock Alpha Calls.',
      ctaLabel: 'BECOME A MEMBER',
      ctaHref: '/dashboard/stake',
      badgeText: 'MEMBER TIER REQUIRED',
    };
  }

  if (category === 'WATCHLIST') {
    if (userTier === 'MEMBER') {
      // 4.3 MEMBER user opening WATCHLIST
      return {
        categoryName: 'WATCHLIST',
        categoryDescription:
          'Discover curated long-term projects selected by the TRENCHLABS team for ongoing monitoring.',
        requiredTier: 'PRO',
        restrictionMessage: 'This category is available exclusively to PRO members.',
        recommendation: 'Upgrade your membership to PRO to unlock WATCHLIST.',
        ctaLabel: 'UPGRADE TO PRO',
        ctaHref: '/dashboard/stake',
        badgeText: 'PRO EXCLUSIVE',
      };
    }
    // 4.2 FREE user opening WATCHLIST
    return {
      categoryName: 'WATCHLIST',
      categoryDescription:
        'Discover curated long-term projects selected by the TRENCHLABS team for ongoing monitoring.',
      requiredTier: 'PRO',
      restrictionMessage: 'WATCHLIST access is exclusive to PRO members.',
      recommendation: 'Upgrade to PRO to access long-term project research and monitoring.',
      ctaLabel: 'UPGRADE TO PRO',
      ctaHref: '/dashboard/stake',
      badgeText: 'PRO EXCLUSIVE',
    };
  }

  // category === 'MAX_ALPHA'
  if (userTier === 'MEMBER') {
    // 4.5 MEMBER user opening MAX ALPHA
    return {
      categoryName: 'MAX ALPHA',
      categoryDescription:
        'Access premium Alpha Calls reserved for TRENCHLABS PRO members.',
      requiredTier: 'PRO',
      restrictionMessage: 'Your current membership does not include MAX ALPHA access.',
      recommendation: 'Upgrade to PRO to unlock this category.',
      ctaLabel: 'UPGRADE TO PRO',
      ctaHref: '/dashboard/stake',
      badgeText: 'PRO EXCLUSIVE',
    };
  }

  // 4.4 FREE user opening MAX ALPHA
  return {
    categoryName: 'MAX ALPHA',
    categoryDescription:
      'Access premium Alpha Calls reserved for TRENCHLABS PRO members.',
    requiredTier: 'PRO',
    restrictionMessage: 'MAX ALPHA is a PRO-exclusive category.',
    recommendation: 'Upgrade to PRO to unlock premium Alpha Calls.',
    ctaLabel: 'UPGRADE TO PRO',
    ctaHref: '/dashboard/stake',
    badgeText: 'PRO EXCLUSIVE',
  };
}

export const MembershipRestrictionScreen: React.FC<MembershipRestrictionScreenProps> = ({
  category,
  userTier,
  onUpgradeClick,
  onVerifyClick,
  needsVerification,
}) => {
  const content = getRestrictionContent(category, userTier);

  return (
    <div
      data-testid="membership-restriction-screen"
      data-category={category}
      data-tier={userTier}
      className="rounded-xl bg-surface border border-border-default p-6 sm:p-8 md:p-10 text-center max-w-3xl mx-auto space-y-6 my-4 shadow-none"
    >
      {/* Category Header Badge & Icon */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-surface-card border border-border-default flex items-center justify-center text-foreground-muted">
          <Lock className="w-6 h-6 text-toxic" />
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-card border border-border-default font-mono text-[11px] font-bold text-foreground-muted uppercase tracking-wider">
          <ShieldAlert className="w-3.5 h-3.5 text-toxic" />
          <span>{content.badgeText}</span>
        </div>
      </div>

      {/* Category Name & Description */}
      <div className="space-y-2">
        <h2 className="font-sans text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">
          {content.categoryName}
        </h2>
        <p className="font-sans text-sm sm:text-base text-foreground-muted max-w-xl mx-auto leading-relaxed">
          {content.categoryDescription}
        </p>
      </div>

      {/* Restriction Message Box */}
      <div className="rounded-lg bg-surface-card border border-border-default p-4 sm:p-5 max-w-xl mx-auto space-y-3 text-left font-sans">
        <div className="space-y-1">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-muted">
            ACCESS RESTRICTION
          </div>
          <p className="text-sm font-semibold text-white">
            {content.restrictionMessage}
          </p>
        </div>

        <div className="pt-2 border-t border-border-default space-y-1">
          <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-toxic">
            RECOMMENDED ACTION
          </div>
          <p className="text-xs text-foreground-muted">
            {content.recommendation}
          </p>
        </div>
      </div>

      {/* Tier Requirement Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl mx-auto text-left font-sans text-xs">
        <div className={`p-3.5 rounded-lg border ${content.requiredTier === 'MEMBER' ? 'bg-surface-card border-toxic/40' : 'bg-surface-card/50 border-border-default'}`}>
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            <CheckCircle2 className={`w-3.5 h-3.5 ${content.requiredTier === 'MEMBER' ? 'text-toxic' : 'text-muted'}`} />
            <span>MEMBER ACCESS</span>
          </div>
          <p className="text-foreground-muted text-[11px] mt-1 leading-relaxed">
            Hold at least <strong className="text-white">$20 worth of $H42</strong> in your connected wallet to unlock Member access.
          </p>
        </div>

        <div className={`p-3.5 rounded-lg border ${content.requiredTier === 'PRO' ? 'bg-surface-card border-alpha-border' : 'bg-surface-card/50 border-border-default'}`}>
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted">
            <Sparkles className={`w-3.5 h-3.5 ${content.requiredTier === 'PRO' ? 'text-alpha-primary' : 'text-muted'}`} />
            <span>PRO ACCESS</span>
          </div>
          <p className="text-foreground-muted text-[11px] mt-1 leading-relaxed">
            Stake at least <strong className="text-white">$250 worth of $H42</strong> through StakePoint to unlock Pro access. Qualifying stakes are verified independently of your liquid wallet balance.
          </p>
        </div>
      </div>

      {/* Action CTA Button */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
        {needsVerification && onVerifyClick && (
          <button
            type="button"
            onClick={onVerifyClick}
            className="w-full sm:w-auto min-h-[44px] px-8 py-3 rounded-lg bg-surface border border-toxic text-toxic hover:bg-surface-3 font-sans text-xs sm:text-sm font-bold uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>VERIFY WALLET OWNERSHIP</span>
          </button>
        )}
        {onUpgradeClick ? (
          <button
            type="button"
            onClick={onUpgradeClick}
            className="w-full sm:w-auto min-h-[44px] px-8 py-3 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>{content.ctaLabel}</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        ) : (
          <Link
            href={content.ctaHref}
            className="w-full sm:w-auto min-h-[44px] px-8 py-3 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs sm:text-sm font-black uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>{content.ctaLabel}</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </Link>
        )}
      </div>
    </div>
  );
};

