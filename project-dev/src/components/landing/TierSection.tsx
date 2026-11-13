import React from 'react';
import { TierCard } from './TierCard';
import { getTierThresholds, TOKEN_DECIMALS } from '@/server/db';
import { BUY_LINKS, GENESIS_MINT, SOCIAL_LINKS } from '@/lib/config';
import {
  ArrowUpRight,
  Check,
  FlaskConical,
  Minus,
  Send,
} from 'lucide-react';

export function formatTokenAmountDisplay(rawString: string, decimals = TOKEN_DECIMALS): string {
  try {
    const tokens = Number(BigInt(rawString)) / Math.pow(10, decimals);
    if (tokens >= 1_000_000) {
      const val = tokens / 1_000_000;
      return `${val.toFixed(1)}M $H42`;
    }
    if (tokens >= 1_000) {
      const val = tokens / 1_000;
      return `${val.toFixed(1)}K $H42`;
    }
    return `${tokens.toFixed(1)} $H42`;
  } catch {
    return '1.2M $H42';
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

interface MatrixRow {
  feature: string;
  free: boolean | string;
  member: boolean | string;
  pro: boolean | string;
}

const COMPARISON_MATRIX: MatrixRow[] = [
  {
    feature: 'Public Track Record & Performance Ledger',
    free: true,
    member: true,
    pro: true,
  },
  {
    feature: 'Community Reward Social Raids & Airdrops',
    free: true,
    member: true,
    pro: true,
  },
  {
    feature: 'Standard Alpha Calls & Invalidation Parameters',
    free: false,
    member: true,
    pro: true,
  },
  {
    feature: 'Telegram Signal Delivery',
    free: 'Public Channel',
    member: '5m Delayed Alerts',
    pro: 'Instant Real-Time Signals',
  },
  {
    feature: 'Max Alpha High-Conviction Research',
    free: false,
    member: false,
    pro: true,
  },
  {
    feature: 'Automated Take-Profit & Stop-Loss Push Alerts',
    free: false,
    member: false,
    pro: true,
  },
  {
    feature: 'Exclusive Pro Syndicate Group Access',
    free: false,
    member: false,
    pro: true,
  },
  {
    feature: 'Eligibility Requirement',
    free: 'Free ($0)',
    member: 'Hold ~$20 $H42 in Wallet',
    pro: 'Stake ~$250 on StakePoint (90 Days)',
  },
];

export async function TierSection() {
  let memberTokenFormatted = '1.2M $H42';
  let proTokenFormatted = '15.2M $H42';
  let recalculatedAt = '';
  let showFootnote = false;

  try {
    const { member, pro } = await getTierThresholds();
    memberTokenFormatted = formatTokenAmountDisplay(member.token_amount, TOKEN_DECIMALS);
    proTokenFormatted = formatTokenAmountDisplay(pro.token_amount, TOKEN_DECIMALS);
    recalculatedAt = member.valid_from;
    showFootnote = true;
  } catch {
    showFootnote = false;
  }

  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_TG_URL?.trim() || SOCIAL_LINKS.telegram;
  const freeCtaDisabled = false;

  const freeFeatures = [
    'Closed calls + P&L ledger',
    'Public results channel',
    'Community Social Raids',
    'Education content',
  ];

  const memberFeatures = [
    'Open calls (Standard)',
    'Member Telegram group',
    'Incubator dashboard access',
    '5-minute delayed signals',
  ];

  const proFeatures = [
    'Everything in Member',
    'Max Alpha high-conviction calls',
    'Real-time instant Telegram signals',
    'Automated TP/SL push alerts',
    'Pro Syndicate group access',
  ];

  return (
    <section id="choose-your-access" className="bg-canvas py-16 border-b border-toxic-border scroll-mt-20 sm:scroll-mt-24">
      <div className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Section Header */}
        <div className="pb-6 border-b border-toxic-border">
          <span className="font-sans text-xs font-bold uppercase tracking-widest text-toxic">
            MEMBERSHIP REQUIREMENT
          </span>
          <h2 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white mt-1">
            Choose your access
          </h2>
          <p className="font-sans text-sm sm:text-base text-muted mt-1.5 max-w-2xl">
            Hold $H42 in your wallet or stake for 90 days to unlock incubator signals and real-time alpha.
          </p>
        </div>

        {/* Unified Cards Grid */}
        <div className="rounded-2xl bg-surface border border-border-default p-6 sm:p-8 lg:p-10 shadow-none">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column (4 cols): $H42 Intro Text & Buy Actions */}
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
                  <span className="text-toxic font-extrabold">$H42</span>
                </div>
                <p className="font-sans text-sm text-muted leading-relaxed pt-1">
                  Hold at least <strong className="text-toxic">$20 $H42</strong> from contract{' '}
                  <span className="font-mono text-xs text-white break-all">
                    {GENESIS_MINT}
                  </span>{' '}
                  in your wallet (or stake $250 for 90 days on StakePoint) to enter the incubator dashboard.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 space-y-3">
                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
                >
                  <span>BUY $H42 ON PUMP.FUN</span>
                  <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                </a>

                <a
                  href={communityUrl || SOCIAL_LINKS.telegram}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-11 px-6 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-toxic text-white font-sans font-extrabold text-xs uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
                >
                  <Send className="w-4 h-4 text-toxic" />
                  <span>JOIN TELEGRAM</span>
                  <ArrowUpRight className="w-4 h-4 text-toxic stroke-[2.5]" />
                </a>
              </div>
            </div>

            {/* Right Column (8 cols): 3 Tier Cards */}
            <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-4 h-full items-stretch">
              {/* FREE */}
              <TierCard
                name="Free"
                priceLabel="$0"
                subtitle="Watch and learn"
                features={freeFeatures}
                ctaLabel="JOIN COMMUNITY"
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
                ctaLabel="CONNECT WALLET · LIVE SOON"
                ctaHref="/dashboard"
                ctaDisabled={true}
                ctaTooltip="Wallet connection live soon"
              />

              {/* PRO */}
              <TierCard
                name="Pro"
                priceLabel="~$250 staked"
                subtitle="90-day lock · Real-time alpha"
                thresholdLabel={`≈ ${proTokenFormatted}`}
                features={proFeatures}
                ctaLabel="EXPLORE STAKEPOINT · LIVE SOON"
                ctaHref="/dashboard/stake"
                ctaDisabled={true}
                ctaTooltip="StakePoint staking live soon"
                emphasized={true}
                badge="Recommended"
              />
            </div>
          </div>
        </div>

        {/* Responsive Comparison Matrix Table (Section 3.7) */}
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="font-sans text-lg sm:text-xl font-extrabold text-white uppercase tracking-tight">
              TIER FEATURE COMPARISON
            </h3>
            <span className="text-xs font-sans text-muted">
              USD-indexed thresholds evaluated on-chain
            </span>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block rounded-xl bg-surface border border-border-default overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-default bg-surface-card font-sans text-xs uppercase tracking-wider text-muted">
                  <th className="py-3.5 px-6 font-bold">Feature</th>
                  <th className="py-3.5 px-4 font-bold text-center w-36">Free</th>
                  <th className="py-3.5 px-4 font-bold text-center w-48 text-white">Member</th>
                  <th className="py-3.5 px-4 font-bold text-center w-56 text-toxic">Pro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default font-sans text-xs">
                {COMPARISON_MATRIX.map((row, idx) => (
                  <tr key={idx} className="hover:bg-surface-card/60 transition-colors">
                    <td className="py-3.5 px-6 font-medium text-white">{row.feature}</td>

                    {/* Free */}
                    <td className="py-3.5 px-4 text-center">
                      {typeof row.free === 'boolean' ? (
                        row.free ? (
                          <Check className="w-4 h-4 text-toxic mx-auto" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted/40 mx-auto" />
                        )
                      ) : (
                        <span className="font-mono text-muted">{row.free}</span>
                      )}
                    </td>

                    {/* Member */}
                    <td className="py-3.5 px-4 text-center">
                      {typeof row.member === 'boolean' ? (
                        row.member ? (
                          <Check className="w-4 h-4 text-toxic mx-auto" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted/40 mx-auto" />
                        )
                      ) : (
                        <span className="font-mono text-white font-semibold">{row.member}</span>
                      )}
                    </td>

                    {/* Pro */}
                    <td className="py-3.5 px-4 text-center bg-toxic-bg/10">
                      {typeof row.pro === 'boolean' ? (
                        row.pro ? (
                          <Check className="w-4 h-4 text-toxic mx-auto" />
                        ) : (
                          <Minus className="w-4 h-4 text-muted/40 mx-auto" />
                        )
                      ) : (
                        <span className="font-mono text-toxic font-bold">{row.pro}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards Comparison */}
          <div className="md:hidden space-y-3">
            {COMPARISON_MATRIX.map((row, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-surface border border-border-default space-y-2.5 font-sans text-xs"
              >
                <div className="font-bold text-white leading-tight">{row.feature}</div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-border-default font-mono text-[11px] text-center">
                  <div className="p-2 rounded bg-surface-card">
                    <div className="text-[10px] text-muted uppercase font-bold">FREE</div>
                    <div className="mt-1 flex items-center justify-center">
                      {typeof row.free === 'boolean' ? (
                        row.free ? <Check className="w-3.5 h-3.5 text-toxic" /> : <Minus className="w-3.5 h-3.5 text-muted/40" />
                      ) : (
                        <span className="truncate">{row.free}</span>
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-surface-card border border-border-default">
                    <div className="text-[10px] text-white uppercase font-bold">MEMBER</div>
                    <div className="mt-1 flex items-center justify-center">
                      {typeof row.member === 'boolean' ? (
                        row.member ? <Check className="w-3.5 h-3.5 text-toxic" /> : <Minus className="w-3.5 h-3.5 text-muted/40" />
                      ) : (
                        <span className="truncate text-white font-semibold">{row.member}</span>
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded bg-toxic-bg border border-toxic-border">
                    <div className="text-[10px] text-toxic uppercase font-bold">PRO</div>
                    <div className="mt-1 flex items-center justify-center">
                      {typeof row.pro === 'boolean' ? (
                        row.pro ? <Check className="w-3.5 h-3.5 text-toxic" /> : <Minus className="w-3.5 h-3.5 text-muted/40" />
                      ) : (
                        <span className="truncate text-toxic font-bold">{row.pro}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
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
