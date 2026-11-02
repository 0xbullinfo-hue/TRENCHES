'use client';

import React, { useState } from 'react';
import type { AlphaItem } from '@/lib/types';
import { useGenesisBalance } from '@/context/GenesisContext';
import { BUY_LINKS, GENESIS_MINT, SOLSCAN } from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import {
  Check,
  Copy,
  ExternalLink,
  Lock,
  ShieldCheck,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';

interface AlphaInspectorModalProps {
  token: AlphaItem | null;
  onClose: () => void;
}

export function getPrimaryMarketUrl(token: AlphaItem): string {
  if (token.links && token.links.length > 0) {
    return token.links[0].href;
  }
  if (!token.ca) return 'https://dexscreener.com';
  if (token.chain === 'SOL') {
    return token.quoteToken === 'PUMP'
      ? `https://pump.fun/coin/${token.ca}`
      : `https://dexscreener.com/solana/${token.ca}`;
  }
  if (token.chain === 'BASE') return `https://dexscreener.com/base/${token.ca}`;
  if (token.chain === 'ETH') return `https://dexscreener.com/ethereum/${token.ca}`;
  return `https://dexscreener.com/bsc/${token.ca}`;
}

export const AlphaInspectorModal: React.FC<AlphaInspectorModalProps> = ({
  token,
  onClose,
}) => {
  const { formattedBalance, setDemoPreset } = useGenesisBalance();
  const [copiedCa, setCopiedCa] = useState(false);

  if (!token) return null;

  const handleCopyCa = () => {
    if (!token.ca) return;
    navigator.clipboard.writeText(token.ca);
    setCopiedCa(true);
    setTimeout(() => setCopiedCa(false), 1800);
  };

  const primaryMarketUrl = getPrimaryMarketUrl(token);

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl bg-surface border border-line overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 bg-surface-card border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2 font-sans text-xs font-bold">
            {token.locked ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-amber/15 border border-amber/40 text-amber">
                <Lock className="w-3 h-3" />
                <span>1,000,000 $GENESIS REQUIRED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface-card border border-line text-pump">
                <Unlock className="w-3 h-3" />
                <span>LAB MEMBER UNLOCKED</span>
              </span>
            )}
            <span className="text-muted font-mono">{token.chain} NETWORK</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded bg-surface hover:bg-surface-3 border border-line flex items-center justify-center text-muted hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          <div className="flex items-start gap-4">
            <TokenArtwork
              art={token.art}
              size="md"
              chain={token.chain}
              quoteToken={token.quoteToken}
              className="w-16 h-16"
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-sans text-xl font-extrabold text-white flex items-center gap-2">
                    <span>{token.name}</span>
                    <span className="font-mono text-sm text-pump">
                      {token.ticker}
                    </span>
                  </h3>
                  <div className="font-sans text-xs text-muted mt-0.5 flex items-center gap-2">
                    <span>Caller: {token.caller}</span>
                    <span>•</span>
                    <span className="text-pump-pill font-semibold">
                      {token.callerWinRate}
                    </span>
                    <span>•</span>
                    <span>Age: {token.age}</span>
                  </div>
                </div>

                <div className="text-right font-mono tnum">
                  <div className="text-lg font-extrabold text-white">
                    {token.marketCap} MC
                  </div>
                  <div className="text-xs font-bold text-pump">
                    +{token.change24hPct.toFixed(1)}% (24h)
                  </div>
                </div>
              </div>

              <p className="font-sans text-sm text-muted leading-relaxed mt-2.5">
                {token.summary}
              </p>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-sans text-xs tnum">
            <div className="p-3 rounded-lg bg-surface-card border border-line">
              <div className="text-[11px] text-muted font-semibold uppercase">
                HOLDER REWARDS
              </div>
              <div className="text-sm font-bold text-pump mt-0.5">
                {token.holderRewardsUsd}
              </div>
              <div className="text-[11px] text-muted">{token.holderRewardsQuote}</div>
            </div>
            <div className="p-3 rounded-lg bg-surface-card border border-line">
              <div className="text-[11px] text-muted font-semibold uppercase">
                24H VOLUME
              </div>
              <div className="text-sm font-bold text-white mt-0.5">{token.volume24h}</div>
              <div className="text-[11px] text-pump-pill">Net {token.netInflow24h}</div>
            </div>
            <div className="p-3 rounded-lg bg-surface-card border border-line">
              <div className="text-[11px] text-muted font-semibold uppercase">
                WALLETS PAID
              </div>
              <div className="text-sm font-bold text-white mt-0.5">
                {token.holdersPaid.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted">
                Paired w/ {token.quoteToken}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-surface-card border border-line">
              <div className="text-[11px] text-muted font-semibold uppercase">
                REQUIRED $GENESIS
              </div>
              <div className="text-sm font-bold text-white mt-0.5">1,000,000+</div>
              <div className="text-[11px] text-pump">Lab Member</div>
            </div>
          </div>

          {/* Gating / Contract Address & External Market Links Section */}
          {token.locked ? (
            <div className="p-4 rounded-lg bg-amber/10 border border-amber/40 space-y-3">
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-amber shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-sans text-sm font-bold text-white">
                    Requires 1,000,000 $GENESIS in Login Wallet
                  </div>
                  <p className="font-sans text-xs text-muted leading-relaxed">
                    Your current balance is{' '}
                    <strong className="text-white">{formattedBalance} $GENESIS</strong>.
                    Hold at least <strong className="text-amber">1,000,000 $GENESIS</strong>{' '}
                    from contract <span className="font-mono text-white">{GENESIS_MINT}</span>{' '}
                    to unmask this Contract Address (CA) and open market links.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber/25">
                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-4 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
                >
                  <span>Buy $GENESIS on Pump.fun</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  type="button"
                  onClick={() => setDemoPreset('1m')}
                  className="h-9 px-3.5 rounded-md bg-surface-card border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-pump" />
                  <span>Preview 1M $GENESIS Member →</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Unmasked Contract Address Bar */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-2.5">
                <div className="flex items-center justify-between font-sans text-xs">
                  <span className="text-pump font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>VERIFIED CONTRACT ADDRESS ({token.chain})</span>
                  </span>
                  <span className="text-muted font-medium">
                    Copy CA to buy on market
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-canvas border border-line font-mono text-xs">
                  <span className="text-white font-bold truncate tnum">{token.ca}</span>
                  <button
                    type="button"
                    onClick={handleCopyCa}
                    className="px-3 py-1 rounded bg-pump hover:bg-pump-hover text-canvas font-sans font-extrabold text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    {copiedCa ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedCa ? 'CA COPIED ✓' : 'COPY CA'}</span>
                  </button>
                </div>
              </div>

              {/* Direct External Market Links to Buy Token */}
              <div className="p-4 rounded-lg bg-surface-card border border-line space-y-3">
                <div className="flex items-center justify-between font-sans text-xs">
                  <span className="text-white font-bold uppercase">
                    OPEN EXTERNAL MARKET TO BUY {token.ticker}
                  </span>
                  <span className="text-muted">Direct Market Links</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={primaryMarketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-10 px-5 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
                  >
                    <span>Open Market to Buy {token.ticker}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  {token.links.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="h-10 px-4 rounded-md bg-surface hover:bg-surface-3 border border-line hover:border-white/20 text-white font-sans text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <span>{link.label}</span>
                      <ExternalLink className="w-3 h-3 text-pump" />
                    </a>
                  ))}

                  {token.chain === 'SOL' && token.ca && (
                    <a
                      href={SOLSCAN.token(token.ca)}
                      target="_blank"
                      rel="noreferrer"
                      className="h-10 px-4 rounded-md bg-surface hover:bg-surface-3 border border-line hover:border-white/20 text-white font-sans text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <span>Solscan</span>
                      <ExternalLink className="w-3 h-3 text-muted" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
