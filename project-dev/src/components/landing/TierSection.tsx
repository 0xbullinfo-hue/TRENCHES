import React from 'react';
import { TierCard } from './TierCard';
import { getTierThresholds, TOKEN_DECIMALS } from '@/server/db';
import { BUY_LINKS, GENESIS_MINT, SOCIAL_LINKS } from '@/lib/config';
import {
  ArrowUpRight,
  FlaskConical,
  Send,
} from 'lucide-react';

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

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;
  const freeCtaDisabled = false;

  const freeFeatures = [
    'Closed calls + P&L ledger',
    'Public results channel',
    'Education content',
  ];

  const memberFeatures = [
    'Open calls (Limited)',
    'Member Telegram group',
    'Incubator dashboard access',
  ];

  const proFeatures = [
    'Everything in Member',
    'Real-time Telegram signals',
    'Push alerts on TP/SL hits',
    'Analyst commentary',
    'Early call execution',
  ];

  return (
    <section id="choose-your-access" className="bg-canvas py-16">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Section Header */}
        <div className="pb-6 border-b border-toxic-border">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
            MEMBERSHIP REQUIREMENT
          </span>
          <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
            Choose your access
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
            Hold $GENESIS in your wallet or stake for 90 days to unlock incubator signals and real-time alpha.
          </p>
        </div>

        {/* Unified Single Card (Same outer structure as the Join the Lab card) */}
        <div className="rounded-2xl bg-surface border border-toxic-border p-6 sm:p-8 lg:p-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column (4 cols): $GENESIS Intro Text & Buy Actions */}
            <div className="lg:col-span-4 space-y-6 lg:pr-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-toxic-bg border border-toxic-border text-toxic font-sans text-xs font-extrabold uppercase tracking-wider">
                <FlaskConical className="w-4 h-4" />
                <span>OFFICIAL LAB PASS</span>
              </div>

              <div className="space-y-2">
                <div className="font-sans text-xs font-bold uppercase tracking-wider text-muted">
                  REQUIRED WALLET BALANCE
                </div>
                <div className="font-sans text-4xl sm:text-5xl font-black text-white tracking-tight tnum">
                  <span className="text-toxic font-extrabold">$GENESIS</span>
                </div>
                <p className="font-sans text-sm text-muted leading-relaxed pt-1">
                  Hold at least <strong className="text-toxic">$20 $GENESIS</strong> from contract{' '}
                  <span className="font-mono text-xs text-white break-all">
                    {GENESIS_MINT}
                  </span>{' '}
                  in your wallet to enter the incubator dashboard.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-3">
                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 px-6 rounded-xl bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>BUY $GENESIS ON PUMP.FUN</span>
                  <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                </a>

                <a
                  href={communityUrl || SOCIAL_LINKS.telegram}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-11 px-6 rounded-xl bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-sans font-extrabold text-xs uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4 text-toxic" />
                  <span>JOIN TELEGRAM</span>
                  <ArrowUpRight className="w-4 h-4 text-toxic stroke-[2.5]" />
                </a>
              </div>
            </div>

            {/* Right Column (8 cols): 3 Simple Tier Cards */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-4 h-full items-stretch">
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

              {/* PRO */}
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
          </div>
        </div>

        {/* Footnote */}
        {showFootnote && recalculatedAt && (
          <p className="text-center font-sans text-xs text-muted/80 max-w-xl mx-auto pt-2 leading-relaxed">
            Thresholds are USD-denominated, recalculated weekly from a 7-day TWAP. Last updated{' '}
            {formatDate(recalculatedAt)}.
          </p>
        )}
      </div>
    </section>
  );
}
