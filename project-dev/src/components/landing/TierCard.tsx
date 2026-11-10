import React from 'react';
import Link from 'next/link';
import { TierCardProps } from './TierCard.types';

export function TierCard({
  name,
  priceLabel,
  subtitle,
  thresholdLabel,
  features,
  ctaLabel,
  ctaHref,
  ctaDisabled = false,
  ctaTooltip,
  emphasized = false,
  badge,
}: TierCardProps) {
  const isExternal = ctaHref.startsWith('http');

  return (
    <div
      className={`relative rounded-xl h-full flex flex-col justify-between p-5 sm:p-6 transition-colors bg-surface-card shadow-none ${
        emphasized
          ? 'border border-toxic hover:border-toxic-bright'
          : 'border border-border-default hover:border-toxic'
      }`}
    >
      {/* Top Header & Badge */}
      <div>
        <div className="flex items-center justify-between min-h-[24px] mb-3">
          <span className="font-sans text-xs font-bold uppercase tracking-wider text-muted">
            {name}
          </span>
          {badge && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-toxic-bg text-toxic border border-toxic-border uppercase tracking-wide">
              {badge}
            </span>
          )}
        </div>

        {/* Price & Subtitle (Consistent alignment) */}
        <div className="space-y-1 mb-4 min-h-[88px] flex flex-col justify-start">
          <div className="font-sans text-2xl font-black text-white tracking-tight tnum">
            {priceLabel}
          </div>
          <div className="font-sans text-xs text-muted font-medium">{subtitle}</div>
          {thresholdLabel ? (
            <div className="font-mono text-[11px] text-toxic font-semibold pt-0.5 tnum">
              {thresholdLabel}
            </div>
          ) : (
            <div className="font-mono text-[11px] text-muted/40 font-medium pt-0.5 select-none">
              —
            </div>
          )}
        </div>

        {/* Feature List */}
        <ul className="space-y-2.5 pt-4 border-t border-border-default">
          {features.map((feature, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <span className="text-toxic font-bold text-xs select-none leading-none pt-0.5">✓</span>
              <span className="font-sans text-xs text-ink/90 leading-tight">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTA Button */}
      <div className="pt-6 mt-auto">
        {ctaDisabled ? (
          <div className="relative group" data-target-href={ctaHref}>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={ctaTooltip || 'LIVE SOON'}
              className="w-full h-10 px-4 rounded-lg border border-border-default bg-surface text-muted cursor-not-allowed font-sans text-xs font-black uppercase tracking-wide flex items-center justify-center select-none opacity-80"
            >
              {ctaLabel.toUpperCase()}
            </button>
            {ctaTooltip && (
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-1 text-[11px] text-white uppercase bg-surface-card border border-border-default rounded-md shadow-none pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20">
                {ctaTooltip}
              </span>
            )}
          </div>
        ) : isExternal ? (
          <a
            href={ctaHref}
            target="_blank"
            rel="noreferrer"
            className={`w-full h-10 px-4 rounded-lg font-sans text-xs font-bold uppercase tracking-wide flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-toxic ${
              emphasized
                ? 'bg-toxic hover:bg-toxic-bright text-canvas font-black'
                : 'border border-toxic text-toxic hover:bg-toxic/10'
            }`}
          >
            {ctaLabel.toUpperCase()}
          </a>
        ) : (
          <Link
            href={ctaHref}
            className={`w-full h-10 px-4 rounded-lg font-sans text-xs font-bold uppercase tracking-wide flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-toxic ${
              emphasized
                ? 'bg-toxic hover:bg-toxic-bright text-canvas font-black'
                : 'border border-toxic text-toxic hover:bg-toxic/10'
            }`}
          >
            {ctaLabel.toUpperCase()}
          </Link>
        )}
      </div>
    </div>
  );
}
