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
      className={`relative rounded-lg h-full flex flex-col justify-between p-8 sm:p-12 transition-colors ${
        emphasized
          ? 'bg-surface border-2 border-toxic shadow-sm'
          : 'bg-surface border border-toxic-border/60 shadow-sm'
      }`}
    >
      {/* Top Header & Badge */}
      <div>
        <div className="flex items-center justify-between min-h-[28px] mb-4">
          <span className="font-sans text-xs font-black uppercase tracking-widest text-muted">
            {name}
          </span>
          {badge && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-toxic/15 text-toxic border border-toxic/30">
              ★ {badge}
            </span>
          )}
        </div>

        {/* Price & Subtitle */}
        <div className="space-y-1 mb-6">
          <div className="font-sans text-3xl sm:text-4xl font-extrabold text-white tracking-tight tnum">
            {priceLabel}
          </div>
          <div className="font-sans text-sm text-muted font-medium">{subtitle}</div>
          {thresholdLabel && (
            <div className="font-mono text-xs text-toxic font-semibold pt-1 tnum">
              {thresholdLabel}
            </div>
          )}
        </div>

        {/* Feature List (✓ checkmarks, 16px gap) */}
        <ul className="space-y-4 pt-6 border-t border-toxic-border/30">
          {features.map((feature, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span className="text-toxic font-bold select-none leading-tight">✓</span>
              <span className="font-sans text-sm text-ink/90 leading-snug">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* CTA Button */}
      <div className="pt-8 mt-auto">
        {ctaDisabled ? (
          <div className="relative group">
            <button
              disabled
              title={ctaTooltip || 'Community link coming soon'}
              className="w-full h-11 px-6 rounded-md border border-toxic-border/40 text-muted cursor-not-allowed font-sans text-sm font-bold flex items-center justify-center select-none"
            >
              {ctaLabel}
            </button>
            {ctaTooltip && (
              <span className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 text-xs text-white bg-[#141b24] border border-toxic-border/40 rounded shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20">
                {ctaTooltip}
              </span>
            )}
          </div>
        ) : isExternal ? (
          <a
            href={ctaHref}
            target="_blank"
            rel="noreferrer"
            className={`w-full h-11 px-6 rounded-md font-sans text-sm font-bold flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toxic ${
              emphasized
                ? 'bg-toxic hover:bg-toxic-bright text-canvas font-black'
                : 'border border-toxic text-toxic hover:bg-toxic/10'
            }`}
          >
            {ctaLabel}
          </a>
        ) : (
          <Link
            href={ctaHref}
            className={`w-full h-11 px-6 rounded-md font-sans text-sm font-bold flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toxic ${
              emphasized
                ? 'bg-toxic hover:bg-toxic-bright text-canvas font-black'
                : 'border border-toxic text-toxic hover:bg-toxic/10'
            }`}
          >
            {ctaLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

