'use client';

import React, { useState } from 'react';
import type { AlphaItem } from '@/lib/types';
import { CHAIN_METADATA } from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import { getPrimaryMarketUrl } from './AlphaInspectorModal';
import { MarketDataBadge } from './MarketDataBadge';
import {
  Check,
  Copy,
  ExternalLink,
  Lock,
  Pencil,
  Star,
  Target,
  Trash2,
} from 'lucide-react';

interface AlphaCallCardProps {
  coin: AlphaItem;
  isAdmin?: boolean;
  isStarred?: boolean;
  onInspect?: (coin: AlphaItem) => void;
  onEdit?: (coin: AlphaItem) => void;
  onDelete?: (coin: AlphaItem) => void;
  onToggleWatchlist?: (id: string) => void;
  onSetOutcome?: (id: string, outcome: 'PROFIT' | 'LOSS') => void;
}

export const AlphaCallCard: React.FC<AlphaCallCardProps> = ({
  coin,
  isAdmin,
  isStarred,
  onInspect,
  onEdit,
  onDelete,
  onToggleWatchlist,
  onSetOutcome,
}) => {
  const [copied, setCopied] = useState(false);
  const chainMeta = CHAIN_METADATA[coin.chain] || CHAIN_METADATA.SOL;
  const serial = coin.serialTag || 'EXP01';
  const marketUrl = getPrimaryMarketUrl(coin);

  const handleCopyCa = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!coin.ca) return;
    navigator.clipboard.writeText(coin.ca);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isCompleted = coin.outcome === 'PROFIT';
  const isLoss = coin.outcome === 'LOSS';

  return (
    <article
      tabIndex={0}
      role="button"
      aria-label={`Inspect ${coin.name} (${coin.ticker}) call`}
      onClick={() => onInspect?.(coin)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onInspect?.(coin);
        }
      }}
      className={`group relative rounded-xl bg-surface flex flex-col justify-between h-full cursor-pointer transition-all duration-150 p-4 sm:p-5 focus:outline-none focus-visible:ring-1 focus-visible:ring-alpha-primary shadow-none ${
        coin.isMaxAlpha
          ? 'border border-alpha-strong hover:border-alpha-primary'
          : 'border border-alpha-border hover:border-alpha-primary'
      }`}
    >
      {/* 1. Top Section: Badges, Token Identity, Thesis & DexScreener Button */}
      <div className="space-y-3">
        {/* Top Row: Clean Alpha Badges */}
        <div className="flex items-center justify-between gap-1.5 pb-2.5 border-b border-border-default text-xs font-mono">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded-md border border-alpha-border bg-alpha-bg px-2.5 py-1 font-mono text-[11px] font-semibold text-alpha-text">
              <Target className="w-3 h-3 text-alpha-primary" />
              <span>{coin.isMaxAlpha ? 'ALPHA CALL · PRO MAX' : 'ALPHA CALL'}</span>
            </span>

            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] font-black uppercase tracking-wider ${
                isCompleted
                  ? 'bg-toxic text-canvas'
                  : isLoss
                  ? 'bg-danger text-white'
                  : 'bg-surface-card border border-border-default text-white'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isCompleted ? 'bg-canvas' : isLoss ? 'bg-white' : 'bg-toxic animate-pulse'
                }`}
              />
              <span>{isCompleted ? 'PROFIT ✓' : isLoss ? 'LOSS ✕' : 'ACTIVE'}</span>
            </span>

            <span className="px-2 py-0.5 rounded-md bg-surface-card border border-border-default font-mono text-[10px] font-bold text-white">
              {coin.chain === 'ROBIN' ? 'ROBIN' : coin.chain}
            </span>

            <MarketDataBadge item={coin} />
          </div>

          <div className="flex items-center gap-1.5 shrink-0 text-muted font-mono text-xs">
            <span className="text-alpha-primary font-bold">{serial}</span>

            {/* Admin Controls */}
            {isAdmin && onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(coin);
                }}
                className="px-2 py-0.5 rounded-md border border-border-default bg-surface-card hover:bg-surface-3 text-[10px] text-muted hover:text-alpha-primary cursor-pointer transition-colors inline-flex items-center gap-1"
                title="Edit Call"
              >
                <Pencil className="w-2.5 h-2.5" />
                <span>EDIT</span>
              </button>
            )}

            {isAdmin && onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(coin);
                }}
                className="w-6 h-6 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default hover:border-danger text-muted hover:text-danger flex items-center justify-center cursor-pointer transition-colors"
                title="Delete Call"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}

            {/* Watchlist Star */}
            {onToggleWatchlist && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatchlist(coin.id);
                }}
                className="w-6 h-6 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default flex items-center justify-center cursor-pointer"
                title="Toggle Watchlist"
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    isStarred ? 'text-amber fill-amber' : 'text-muted'
                  }`}
                />
              </button>
            )}
          </div>
        </div>

        {/* Token Identity: Real Onchain Logo + Name & Ticker */}
        <div className="flex items-center gap-3 pt-0.5">
          <TokenArtwork
            art={coin.art}
            logoUrl={coin.logoUrl}
            ticker={coin.ticker}
            size="sm"
            chain={coin.chain}
            quoteToken={coin.quoteToken}
            locked={coin.locked}
          />
          <div className="min-w-0">
            <h3 className="font-sans font-extrabold text-base text-white truncate leading-tight group-hover:text-alpha-primary transition-colors">
              {coin.name}
            </h3>
            <p className="font-mono text-xs text-alpha-primary font-bold">
              {coin.ticker} • {chainMeta.label}
            </p>
          </div>
        </div>

        {/* Call Summary / Thesis (Consistent vertical rhythm) */}
        {coin.summary ? (
          <p className="font-sans text-xs text-muted leading-relaxed line-clamp-2 min-h-[32px]">
            {coin.summary}
          </p>
        ) : (
          <div className="min-h-[32px]" />
        )}

        {/* Primary Action Button: Open Chart on DexScreener (Standard 40px height) */}
        {marketUrl && !coin.locked ? (
          <a
            href={marketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-between w-full h-10 px-3.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-alpha-border text-white font-sans text-xs font-bold transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5 text-alpha-primary" />
              <span>Open Chart on DexScreener</span>
            </span>
            <span className="text-alpha-primary">↗</span>
          </a>
        ) : (
          <div className="h-10 w-full rounded-lg bg-surface-card border border-border-default flex items-center justify-center text-xs font-mono text-muted">
            {coin.locked ? '🔒 Chart Locked' : '— Direct DEX Call —'}
          </div>
        )}
      </div>

      {/* 2. Bottom Section: 2x2 Metric Grid + Contract Address + Admin Outcome */}
      <div className="mt-4 pt-1 space-y-2">
        {/* 2x2 Clean Metric Grid */}
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          {/* 1. Entry Market Cap */}
          <div className="h-[62px] p-2.5 rounded-lg bg-surface-card border border-border-default flex flex-col justify-between">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider">
              ENTRY MC
            </div>
            <div className="text-base font-extrabold text-white truncate tnum">
              {coin.entryMarketCap || coin.marketCap || '—'}
            </div>
          </div>

          {/* 2. Target Take Profits */}
          <div className="h-[62px] p-2.5 rounded-lg bg-surface-card border border-border-default flex flex-col justify-between">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3 text-alpha-primary" />
              <span>TARGET TP</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {coin.takeProfits && coin.takeProfits.length > 0 ? (
                coin.takeProfits.slice(0, 3).map((tp) => (
                  <span
                    key={tp.label}
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold border ${
                      tp.hit
                        ? 'bg-toxic text-canvas border-toxic'
                        : 'bg-surface text-white border-border-default'
                    }`}
                  >
                    {tp.label}
                    {tp.hit ? ' ✓' : ''}
                  </span>
                ))
              ) : (
                <span className="text-muted text-[11px]">2x • 5x • 10x</span>
              )}
            </div>
          </div>

          {/* 3. Risk Ratio */}
          <div className="h-[62px] p-2.5 rounded-lg bg-surface-card border border-border-default flex flex-col justify-between">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider">
              RISK RATIO
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-white text-[11px]">
                Lvl {coin.risk}/5
              </span>
              <span className="px-1.5 py-0.5 rounded-md bg-surface border border-border-default text-alpha-primary font-bold text-[10px]">
                {coin.riskRewardRatio || '2.5:1'}
              </span>
            </div>
          </div>

          {/* 4. Stop Loss (SL) */}
          <div className="h-[62px] p-2.5 rounded-lg bg-surface-card border border-border-default flex flex-col justify-between">
            <div className="text-[10px] text-muted uppercase font-bold tracking-wider">
              STOP LOSS (SL)
            </div>
            <div className="text-xs font-extrabold text-amber truncate">
              {coin.stopLoss || '-25% SL'}
            </div>
          </div>
        </div>

        {/* Contract Address Bar (Uniform Height & Clean Alignment) */}
        {coin.locked ? (
          <div className="h-10 px-3 rounded-lg bg-surface-card border border-border-default flex items-center justify-center gap-1.5 font-sans text-xs text-amber font-semibold">
            <Lock className="w-3.5 h-3.5" />
            <span>Connect Wallet to Reveal CA</span>
          </div>
        ) : coin.ca ? (
          <div className="h-10 px-3 rounded-lg bg-surface-card border border-border-default flex items-center justify-between gap-2 font-mono text-xs">
            <span className="text-muted text-[11px] shrink-0 font-bold">CA:</span>
            <span className="text-white truncate tnum">{coin.ca}</span>
            <button
              type="button"
              onClick={handleCopyCa}
              className="text-alpha-primary hover:text-white font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="text-[11px]">{copied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>
        ) : (
          <div className="h-10 px-3 rounded-lg bg-surface-card border border-border-default flex items-center justify-between font-mono text-xs text-muted">
            <span>CA:</span>
            <span className="italic text-[11px]">Unreleased</span>
          </div>
        )}

        {/* Admin Quick Outcome Selector */}
        {isAdmin && onSetOutcome && (
          <div className="pt-2 border-t border-border-default flex items-center justify-between gap-1.5 font-mono text-xs">
            <span className="text-[10px] uppercase font-bold text-muted">OUTCOME:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetOutcome(coin.id, 'PROFIT');
                }}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                  coin.outcome === 'PROFIT'
                    ? 'bg-toxic text-canvas font-black'
                    : 'bg-surface-card hover:bg-surface-3 border border-border-default text-muted hover:text-toxic'
                }`}
              >
                PROFIT ✓
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetOutcome(coin.id, 'LOSS');
                }}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-colors ${
                  coin.outcome === 'LOSS'
                    ? 'bg-danger text-white font-black'
                    : 'bg-surface-card hover:bg-surface-3 border border-border-default text-muted hover:text-danger'
                }`}
              >
                LOSS ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
};
