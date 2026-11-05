import React from 'react';
import { TierCard } from './TierCard';
import { getTierThresholds, TOKEN_DECIMALS } from '@/server/db';
import { GENESIS_MINT } from '@/lib/config';
import { ShieldCheck } from 'lucide-react';

const LAB_BENEFITS = [
  {
    title: 'Multi-Chain Trade Calls',
    body: 'Browse admin-posted calls across supported networks, filter by chain, and review the details before making your own decision.',
  },
  {
    title: 'Contract Address & Market Links',
    body: 'Copy the contract address shared in each post and open available external market links. Always verify the address and token independently.',
  },
  {
    title: 'Wallet-Balance Access',
    body: `Hold at least $20 $GENESIS from contract ${GENESIS_MINT} in your wallet to enter the incubator dashboard.`,
  },
  {
    title: 'Risk & Target Details',
    body: 'Review the market-cap snapshot, risk ratio, and take-profit targets entered with each call. Calls are informational and can lose value.',
  },
];

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

        {/* 4 Benefit Sub-Cards for the Tier Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          {LAB_BENEFITS.map((benefit) => (
            <div
              key={benefit.title}
              className="p-6 rounded-2xl bg-surface-card border border-toxic-border hover:border-toxic transition-colors space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-toxic shrink-0" />
                <h3 className="font-sans text-sm font-bold text-white">
                  {benefit.title}
                </h3>
              </div>
              <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
                {benefit.body}
              </p>
            </div>
          ))}
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

