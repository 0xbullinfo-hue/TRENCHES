import React from 'react';
import { TierCard } from './TierCard';
import { getTierThresholds, TOKEN_DECIMALS } from '@/server/db';

export function formatTokenAmountDisplay(rawString: string, decimals = TOKEN_DECIMALS): string {
  try {
    const tokens = Number(BigInt(rawString)) / Math.pow(10, decimals);
    if (tokens >= 1_000_000) {
      const val = tokens / 1_000_000;
      return `${val.toFixed(1)}M $GENESIS`;
    }
    if (tokens >= 1_000) {
      const val = tokens / 1_000;
      return `${val.toFixed(1)}K $GENESIS`;
    }
    return `${tokens.toFixed(1)} $GENESIS`;
  } catch {
    return '1.2M $GENESIS';
  }
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export async function TierSection() {
  let memberTokenFormatted = '1.2M $GENESIS';
  let proTokenFormatted = '15.2M $GENESIS';
  let recalculatedAt = '';
  let showFootnote = false;

  // 1. Try server fetch of /api/tiers/current
  try {
    const siteUrl = process.env.SITE_URL || 'http://localhost:3000';
    const res = await fetch(`${siteUrl}/api/tiers/current`, {
      cache: 'no-store',
      next: { revalidate: 60 },
    });

    if (res.ok) {
      const data = await res.json();
      memberTokenFormatted = formatTokenAmountDisplay(
        data.member?.token_amount,
        data.member?.token_decimals ?? 9
      );
      proTokenFormatted = formatTokenAmountDisplay(
        data.pro?.token_amount,
        data.pro?.token_decimals ?? 9
      );
      recalculatedAt = data.recalculated_at;
      showFootnote = true;
    } else {
      throw new Error(`API returned ${res.status}`);
    }
  } catch {
    // 2. Fallback: query database directly
    try {
      const { member, pro } = await getTierThresholds();
      memberTokenFormatted = formatTokenAmountDisplay(member.token_amount, TOKEN_DECIMALS);
      proTokenFormatted = formatTokenAmountDisplay(pro.token_amount, TOKEN_DECIMALS);
      recalculatedAt = member.valid_from;
      showFootnote = true;
    } catch {
      // 3. Fallback: placeholders, hide footnote
      showFootnote = false;
    }
  }

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim();
  const freeCtaDisabled = !communityUrl;

  const freeFeatures = [
    'Closed calls + full P&L ledger',
    'Public results channel',
    'Education content',
  ];

  const memberFeatures = [
    'Open calls, 15-minute delayed',
    'Member Telegram group',
    'Community discussion',
  ];

  const proFeatures = [
    'Everything in Member',
    'Real-time signals in Telegram',
    'Push alerts on TP/SL hits',
    'Analyst commentary',
    'Early calls (before Member delayed tier)',
  ];

  return (
    <section id="choose-your-access" className="bg-canvas py-16 sm:py-24 border-t border-toxic-border/20">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
            ACCESS TIERS
          </span>
          <h2 className="font-sans text-3xl sm:text-4xl font-extrabold uppercase tracking-tight text-white">
            Choose your access
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted">
            Select the tier that fits your trading conviction. Upgrade or stake anytime.
          </p>
        </div>

        {/* 3-Column Tier Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch">
          {/* FREE */}
          <TierCard
            name="Free"
            priceLabel="$0"
            subtitle="Watch and learn"
            features={freeFeatures}
            ctaLabel="Join Community"
            ctaHref={communityUrl || '#'}
            ctaDisabled={freeCtaDisabled}
            ctaTooltip={freeCtaDisabled ? 'Community link coming soon' : undefined}
          />

          {/* MEMBER */}
          <TierCard
            name="Member"
            priceLabel="~$20 held"
            subtitle="Follow in real time"
            thresholdLabel={`≈ ${memberTokenFormatted}`}
            features={memberFeatures}
            ctaLabel="Get Member →"
            ctaHref="/dashboard"
          />

          {/* PRO (Emphasized) */}
          <TierCard
            name="Pro"
            priceLabel="~$250 staked"
            subtitle="90-day lock · Real-time alpha"
            thresholdLabel={`≈ ${proTokenFormatted}`}
            features={proFeatures}
            ctaLabel="Stake for Pro →"
            ctaHref="/dashboard/stake"
            emphasized={true}
            badge="Recommended"
          />
        </div>

        {/* Footnote */}
        {showFootnote && recalculatedAt && (
          <p className="text-center font-sans text-xs text-muted/80 max-w-xl mx-auto pt-4 leading-relaxed">
            Thresholds are USD-denominated, recalculated weekly from a 7-day TWAP. Last updated{' '}
            {formatDate(recalculatedAt)}.
          </p>
        )}
      </div>
    </section>
  );
}

