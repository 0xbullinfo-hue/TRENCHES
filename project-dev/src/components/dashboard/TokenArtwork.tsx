'use client';

import React from 'react';
import type { AlphaArtTheme, Chain, QuoteToken } from '@/lib/types';

interface TokenArtworkProps {
  art: AlphaArtTheme;
  logoUrl?: string;
  ticker?: string;
  sparkline?: number[];
  chain?: Chain;
  quoteToken?: QuoteToken;
  size?: 'sm' | 'md' | 'card';
  locked?: boolean;
  className?: string;
}

function buildSparklinePoints(data: number[], width: number, height: number): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = Math.max(max - min, 1);
  return data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function MotifGraphic({
  motif,
  accent,
  secondary,
}: {
  motif: AlphaArtTheme['motif'];
  accent: string;
  secondary: string;
}) {
  switch (motif) {
    case 'pill':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <defs>
            <linearGradient id="pillGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#34D399" />
              <stop offset="100%" stopColor="#10B981" />
            </linearGradient>
          </defs>
          <g transform="rotate(-35 60 60)">
            <rect
              x="36"
              y="20"
              width="48"
              height="80"
              rx="24"
              fill="#F8FAFC"
              stroke="#0A0E13"
              strokeWidth="4"
            />
            <path d="M36 60 H84 V76 A24 24 0 0 1 36 76 Z" fill="url(#pillGrad)" />
            <ellipse cx="50" cy="38" rx="5" ry="10" fill="#FFFFFF" opacity="0.8" />
          </g>
        </svg>
      );

    case 'baton':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r="42" fill={accent} opacity="0.14" />
          <g transform="rotate(-28 60 60)">
            <rect
              x="46"
              y="18"
              width="28"
              height="84"
              rx="10"
              fill={accent}
              stroke={secondary}
              strokeWidth="3"
            />
            <rect x="46" y="38" width="28" height="12" fill="#11161D" />
            <rect x="46" y="68" width="28" height="12" fill="#11161D" />
            <circle cx="60" cy="28" r="5" fill="#34D399" />
          </g>
        </svg>
      );

    case 'bull':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="62" r="38" fill={accent} opacity="0.2" />
          <path
            d="M24 38 Q30 18 46 34"
            fill="none"
            stroke={secondary}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M96 38 Q90 18 74 34"
            fill="none"
            stroke={secondary}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <rect
            x="34"
            y="34"
            width="52"
            height="52"
            rx="14"
            fill={accent}
            stroke="#161C24"
            strokeWidth="3"
          />
          <circle cx="48" cy="54" r="5" fill="#11161D" />
          <circle cx="72" cy="54" r="5" fill="#11161D" />
          <circle cx="60" cy="74" r="10" fill="none" stroke="#FDE047" strokeWidth="4" />
        </svg>
      );

    case 'swordcat':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <polygon points="34,42 42,20 54,38" fill={accent} />
          <polygon points="86,42 78,20 66,38" fill={accent} />
          <circle cx="60" cy="64" r="28" fill="#E2E8F0" />
          <circle cx="50" cy="60" r="4" fill="#0A0E13" />
          <circle cx="70" cy="60" r="4" fill="#0A0E13" />
          <polygon points="57,68 63,68 60,73" fill="#F43F5E" />
          {/* Tactical Sword */}
          <line
            x1="22"
            y1="96"
            x2="96"
            y2="22"
            stroke="#34D399"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <line
            x1="28"
            y1="76"
            x2="44"
            y2="92"
            stroke={accent}
            strokeWidth="5"
            strokeLinecap="round"
          />
        </svg>
      );

    case 'jubjub':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <rect x="24" y="24" width="72" height="72" rx="16" fill="#F8FAFC" />
          <path d="M45 78 C45 48 75 48 75 78" fill="none" stroke="#0A0E13" strokeWidth="5" />
          <circle cx="54" cy="46" r="8" fill="#0A0E13" />
          <polygon points="62,44 78,48 62,53" fill={accent} />
          <line x1="52" y1="78" x2="48" y2="92" stroke="#0A0E13" strokeWidth="4" />
          <line x1="66" y1="78" x2="70" y2="92" stroke="#0A0E13" strokeWidth="4" />
        </svg>
      );

    case 'catdog':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="44" cy="64" r="22" fill="#F8FAFC" />
          <polygon points="28,50 34,32 44,46" fill="#E2E8F0" />
          <polygon points="60,50 54,32 44,46" fill="#E2E8F0" />
          <circle cx="38" cy="62" r="3" fill="#0A0E13" />
          <circle cx="50" cy="62" r="3" fill="#0A0E13" />
          <circle cx="76" cy="60" r="24" fill="#D97706" />
          <circle cx="68" cy="56" r="3.5" fill="#0A0E13" />
          <circle cx="84" cy="56" r="3.5" fill="#0A0E13" />
          <ellipse cx="76" cy="65" rx="5" ry="3.5" fill="#0A0E13" />
        </svg>
      );

    case 'anteater':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <ellipse cx="58" cy="68" rx="28" ry="22" fill={accent} />
          <path d="M36 60 Q16 62 14 74 Q26 74 40 68" fill={secondary} />
          <path
            d="M78 56 Q102 36 96 68 Q88 74 78 68"
            fill={accent}
            stroke={secondary}
            strokeWidth="3"
          />
          <circle cx="40" cy="58" r="4" fill="#0A0E13" />
        </svg>
      );

    case 'stealth':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <path
            d="M78 24 C42 26 26 44 54 56 C82 68 68 88 28 94 C58 92 92 78 66 60 C42 44 58 32 88 26 Z"
            fill="#34D399"
          />
        </svg>
      );

    case 'babypump':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <g transform="rotate(24 60 60)">
            <rect
              x="32"
              y="18"
              width="56"
              height="84"
              rx="28"
              fill="#F8FAFC"
              stroke="#064E3B"
              strokeWidth="4"
            />
            <path d="M32 60 H88 V74 A28 28 0 0 1 32 74 Z" fill="#34D399" />
            <circle cx="48" cy="44" r="4.5" fill="#0A0E13" />
            <circle cx="72" cy="44" r="4.5" fill="#0A0E13" />
            <circle
              cx="60"
              cy="53"
              r="6"
              fill="#6EE7B7"
              stroke="#0A0E13"
              strokeWidth="2.5"
            />
          </g>
        </svg>
      );

    case 'barron':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <rect x="18" y="20" width="84" height="80" rx="8" fill="#161C24" />
          <text
            x="24"
            y="46"
            fill="#34D399"
            fontSize="16"
            fontWeight="900"
            fontFamily="monospace"
          >
            TRENCH
          </text>
          <circle cx="60" cy="52" r="18" fill="#FDE68A" />
          <path d="M34 98 C36 74 84 74 86 98 Z" fill="#0A0E13" />
          <polygon points="56,76 64,76 62,96 58,96" fill="#EF4444" />
        </svg>
      );

    case 'ape':
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r="36" fill={accent} opacity="0.22" />
          <circle cx="60" cy="54" r="22" fill="#9A3412" />
          <ellipse cx="60" cy="62" rx="14" ry="10" fill="#FDBA74" />
          <circle cx="52" cy="48" r="3.5" fill="#0A0E13" />
          <circle cx="68" cy="48" r="3.5" fill="#0A0E13" />
          <rect x="44" y="74" width="32" height="22" rx="8" fill="#7C2D12" />
        </svg>
      );

    case 'otcity':
    default:
      return (
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <rect
            x="22"
            y="22"
            width="76"
            height="58"
            rx="10"
            fill="#11161D"
            stroke="#34D399"
            strokeWidth="4"
          />
          <rect x="34" y="42" width="10" height="32" fill="#34D399" />
          <rect x="48" y="32" width="12" height="42" fill="#6EE7B7" />
          <rect x="64" y="38" width="10" height="36" fill="#34D399" />
          <rect x="78" y="48" width="8" height="26" fill="#6EE7B7" />
          <text
            x="60"
            y="98"
            textAnchor="middle"
            fill="#34D399"
            fontSize="14"
            fontWeight="800"
            fontFamily="monospace"
          >
            OTCity
          </text>
        </svg>
      );
  }
}

export const TokenArtwork: React.FC<TokenArtworkProps> = ({
  art,
  logoUrl,
  ticker,
  sparkline,
  chain = 'SOL',
  quoteToken = 'PUMP',
  size = 'card',
  locked = false,
  className = '',
}) => {
  const [imgError, setImgError] = React.useState(false);
  const effectiveLogoUrl = !imgError && (logoUrl || art.imageUrl);

  if (size === 'sm' || size === 'md') {
    const dim = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
    return (
      <div
        className={`relative ${dim} rounded-lg overflow-hidden shrink-0 border border-line bg-surface-card ${className}`}
      >
        {effectiveLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic external DEX/IPFS token logo URL with onError fallback
          <img
            src={effectiveLogoUrl}
            alt={ticker ? `${ticker} logo` : 'Token logo'}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <MotifGraphic motif={art.motif} accent={art.accent} secondary={art.secondary} />
        )}
      </div>
    );
  }

  const polyPoints = sparkline ? buildSparklinePoints(sparkline, 86, 32) : '';

  return (
    <div
      className={`relative w-full aspect-square rounded-xl overflow-hidden border border-line bg-surface-card select-none ${className}`}
    >
      {/* Top-Left Category / Motif Pill if present */}
      {art.badgeText && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-pump text-canvas font-sans text-[10px] font-bold">
          ♥ {art.badgeText}
        </div>
      )}

      {/* Main Illustration / Onchain Logo */}
      <div
        className={`w-full h-full p-4 transition-transform duration-200 group-hover:scale-105 flex items-center justify-center ${
          locked ? 'opacity-65' : ''
        }`}
      >
        {effectiveLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- dynamic external DEX/IPFS token logo URL with onError fallback
          <img
            src={effectiveLogoUrl}
            alt={ticker ? `${ticker} logo` : 'Token logo'}
            className="w-full h-full object-cover rounded-lg shadow-sm"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <MotifGraphic motif={art.motif} accent={art.accent} secondary={art.secondary} />
        )}
      </div>

      {/* Bottom-Right Inline Toxic Lime Sparkline + Chain/Quote Pill */}
      <div className="absolute bottom-2 right-2 left-2 flex items-end justify-between pointer-events-none">
        <div className="flex-1 pr-2">
          {polyPoints && (
            <svg viewBox="0 0 86 32" className="w-24 h-8 overflow-visible ml-auto">
              <polyline
                fill="none"
                stroke="#34D399"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polyPoints}
              />
            </svg>
          )}
        </div>

        {/* Dual Chain + Quote Token Badge */}
        <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-surface border border-line font-mono text-[10px] font-bold text-white shrink-0">
          <span
            className={`w-2 h-2 rounded-full ${
              chain === 'SOL' || chain === 'ROBIN'
                ? 'bg-pump'
                : chain === 'BASE' || chain === 'ETH'
                ? 'bg-pump-pill'
                : 'bg-amber'
            }`}
          />
          <span>{chain}</span>
        </div>
      </div>
    </div>
  );
};
