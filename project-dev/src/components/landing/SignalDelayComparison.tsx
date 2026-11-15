import React from 'react';
import { Clock, ShieldCheck, Zap } from 'lucide-react';
import { MEMBER_USD_TARGET, PRO_USD_TARGET } from '@/lib/tiers';
import { cn } from '@/components/ui/cn';

export interface TierTimingWindow {
  tierId: 'FREE' | 'LAB_MEMBER' | 'PRO';
  tierLabel: string;
  costRequirement: string;
  dispatchDelaySeconds: number | null;
  dispatchLabel: string;
  callCoverage: string;
  sanitizedExampleEntry: string;
  executionNote: string;
}

export const MEMBER_SIGNAL_DELAY_SECONDS = 300; // 5 minutes (matches MEMBER_DELAY_MS in telegram.ts)
export const PRO_SIGNAL_DELAY_SECONDS = 0;

export function getTierTimingComparison(
  memberUsdTarget = MEMBER_USD_TARGET,
  proUsdTarget = PRO_USD_TARGET
): TierTimingWindow[] {
  return [
    {
      tierId: 'PRO',
      tierLabel: 'Pro',
      costRequirement: `~$${proUsdTarget} $H42 staked (90d)`,
      dispatchDelaySeconds: PRO_SIGNAL_DELAY_SECONDS,
      dispatchLabel: 'T+0s (Instant)',
      callCoverage: 'Standard + Max Alpha + TP/SL Push',
      sanitizedExampleEntry: '$A*** @ T+0s dispatch',
      executionNote: 'Immediate Telegram push at the moment the call is recorded on-chain.',
    },
    {
      tierId: 'LAB_MEMBER',
      tierLabel: 'Member',
      costRequirement: `~$${memberUsdTarget} $H42 held in wallet`,
      dispatchDelaySeconds: MEMBER_SIGNAL_DELAY_SECONDS,
      dispatchLabel: 'T+300s (5m delay)',
      callCoverage: 'Standard calls only',
      sanitizedExampleEntry: '$A*** @ T+5m queue release',
      executionNote: 'Queued in the delayed outbox for 5 minutes after Pro dispatch; excludes Pro-only Max Alpha calls.',
    },
    {
      tierId: 'FREE',
      tierLabel: 'Free',
      costRequirement: '$0 (Public access)',
      dispatchDelaySeconds: null,
      dispatchLabel: 'Post-resolution',
      callCoverage: 'Closed ledger archive only',
      sanitizedExampleEntry: '$A*** after trade closes',
      executionNote: 'Visible on the public ledger and results channel once the call is resolved.',
    },
  ];
}

interface SignalDelayComparisonProps {
  className?: string;
}

export const SignalDelayComparison: React.FC<SignalDelayComparisonProps> = ({ className }) => {
  const tiers = getTierTimingComparison();

  return (
    <div
      data-testid="signal-delay-comparison"
      aria-labelledby="signal-delay-heading"
      className={cn(
        'rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-5',
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border-default">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-brand shrink-0">
            <Clock className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h3 id="signal-delay-heading" className="font-sans text-base sm:text-lg font-extrabold text-white">
              Signal dispatch timing &amp; cost comparison
            </h3>
            <p className="font-sans text-xs text-muted">
              How holding vs. staking $H42 affects Telegram alert latency and call coverage (sanitized preview).
            </p>
          </div>
        </div>
        <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-surface-card border border-border-default text-muted self-start sm:self-auto">
          5m member queue window
        </span>
      </div>

      {/* Visual Dispatch Timeline */}
      <div className="p-3.5 sm:p-4 rounded-lg bg-surface-card border border-border-default space-y-2.5">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="text-brand font-bold">T+0s: Pro instant dispatch</span>
          <span className="text-white font-semibold">T+5m: Member queue release</span>
          <span className="text-muted">Closed: Public ledger</span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-canvas overflow-hidden border border-border-default">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-brand rounded-l-full" />
          <div className="absolute inset-y-0 left-1/2 w-1/4 bg-brand/40" />
        </div>
        <p className="font-sans text-xs text-muted">
          In fast-moving on-chain markets, the 300-second queue window separates immediate execution from delayed confirmation. Active tickers are masked (`$A***`) in public previews.
        </p>
      </div>

      {/* Tier Timing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((tier) => {
          const isPro = tier.tierId === 'PRO';
          const isMember = tier.tierId === 'LAB_MEMBER';
          return (
            <div
              key={tier.tierId}
              data-testid={`signal-delay-tier-${tier.tierId.toLowerCase()}`}
              className={cn(
                'p-4 rounded-xl bg-surface-card border flex flex-col justify-between space-y-3',
                isPro ? 'border-brand' : 'border-border-default'
              )}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-xs font-bold text-white inline-flex items-center gap-1.5">
                    {isPro ? (
                      <Zap className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                    ) : isMember ? (
                      <Clock className="w-3.5 h-3.5 text-white" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5 text-muted" aria-hidden="true" />
                    )}
                    {tier.tierLabel}
                  </span>
                  <span
                    className={cn(
                      'font-mono text-xs px-2 py-0.5 rounded font-bold tnum',
                      isPro
                        ? 'bg-brand-bg text-brand border border-brand-border'
                        : 'bg-surface text-muted border border-border-default'
                    )}
                  >
                    {tier.dispatchLabel}
                  </span>
                </div>

                <div className="font-mono text-xs text-brand font-semibold tnum">
                  {tier.costRequirement}
                </div>

                <p className="font-sans text-xs text-muted leading-relaxed">
                  {tier.executionNote}
                </p>
              </div>

              <div className="pt-2.5 border-t border-border-default space-y-1 font-mono text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Coverage:</span>
                  <span className="text-white truncate">{tier.callCoverage}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Feed sample:</span>
                  <span className="text-brand">{tier.sanitizedExampleEntry}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
