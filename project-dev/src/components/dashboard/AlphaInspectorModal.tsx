'use client';

import React, { useState } from 'react';
import type { AlphaItem } from '@/lib/types';
import { useGenesisBalance } from '@/context/GenesisContext';
import { MarketDataBadge } from './MarketDataBadge';
import {
  ADMIN_WALLET_SHORT,
  BUY_LINKS,
  CHAIN_METADATA,
  GENESIS_MINT,
  SOLSCAN,
} from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Flame,
  Lock,
  Pencil,
  Pin,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';

interface AlphaInspectorModalProps {
  token: AlphaItem | null;
  onClose: () => void;
  onEdit?: (token: AlphaItem) => void;
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
  if (token.chain === 'BSC') return `https://dexscreener.com/bsc/${token.ca}`;
  if (token.chain === 'AVAX') return `https://dexscreener.com/avalanche/${token.ca}`;
  if (token.chain === 'ROBIN') {
    return `https://dexscreener.com/search?q=${encodeURIComponent(token.ca)}`;
  }
  return `https://dexscreener.com`;
}

export const AlphaInspectorModal: React.FC<AlphaInspectorModalProps> = ({
  token,
  onClose,
  onEdit,
}) => {
  const {
    formattedBalance,
    isAdmin,
    setDemoPreset,
    demoEnabled,
    togglePinCall,
    toggleMaxAlpha,
    toggleTpHit,
    setCallOutcome,
    deleteAlphaCall,
  } = useGenesisBalance();
  const [copiedCa, setCopiedCa] = useState(false);
  const [copyCaError, setCopyCaError] = useState(false);
  const copyTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  React.useEffect(() => {
    if (!token) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [token, onClose]);

  if (!token) return null;

  const handleCopyCa = async () => {
    if (!token.ca) return;
    try {
      await navigator.clipboard.writeText(token.ca);
      setCopiedCa(true);
      setCopyCaError(false);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedCa(false), 1800);
    } catch {
      setCopyCaError(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyCaError(false), 2500);
    }
  };

  const isWatchlist = token.callType === 'WATCHLIST';
  const primaryMarketUrl = getPrimaryMarketUrl(token);
  const chainMeta = CHAIN_METADATA[token.chain] || CHAIN_METADATA.SOL;

  return (
    <div
      className="fixed inset-0 z-50 bg-canvas/95 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-token-name"
    >
      <div
        className={`w-full max-w-2xl rounded-xl bg-surface overflow-hidden transition-all shadow-none ${
          !isWatchlist && token.isMaxAlpha
            ? 'border-2 border-alpha-strong'
            : 'border border-border-default'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-3.5 bg-surface-card border-b border-border-default flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 font-sans text-xs font-bold">
            {isWatchlist && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-950/40 text-emerald-400 border border-emerald-500/40 font-extrabold uppercase">
                <span>WATCHLIST · RESEARCH</span>
              </span>
            )}
            {!isWatchlist && token.isMaxAlpha && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-alpha-bg text-alpha-text border border-alpha-border font-extrabold uppercase">
                <Flame className="w-3 h-3 text-alpha-primary" />
                <span>ALPHA CALL · PRO MAX</span>
              </span>
            )}
            {token.pinned && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-pump text-canvas font-extrabold uppercase">
                <Pin className="w-3 h-3" />
                <span>PINNED PRIORITY</span>
              </span>
            )}
            {!isWatchlist && token.outcome === 'PROFIT' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-pump text-canvas font-extrabold uppercase">
                <span>ACHIEVED (IN PROFIT) ✓</span>
              </span>
            )}
            {!isWatchlist && token.outcome === 'LOSS' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-danger text-white font-extrabold uppercase">
                <span>AT LOSS ✕</span>
              </span>
            )}
            {token.locked ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface border border-line text-amber">
                <Lock className="w-3 h-3" />
                <span>~$20 $H42 REQUIRED</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface border border-line text-pump">
                <Unlock className="w-3 h-3" />
                <span>LAB MEMBER UNLOCKED</span>
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-surface border border-line text-white font-mono">
              {chainMeta.label.toUpperCase()} ({token.chain})
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal dialog"
            className="w-7 h-7 rounded bg-surface hover:bg-surface-3 border border-line flex items-center justify-center text-muted hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          <div className="flex items-start gap-4">
            <TokenArtwork
              art={token.art}
              logoUrl={token.logoUrl}
              ticker={token.ticker}
              size="md"
              chain={token.chain}
              quoteToken={token.quoteToken}
              className="w-16 h-16"
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 id="modal-token-name" className="font-sans text-xl font-extrabold text-white flex items-center gap-2">
                    <span>{token.name}</span>
                    <span className="font-mono text-sm text-pump">{token.ticker}</span>
                  </h3>
                  <div className="font-sans text-xs text-muted mt-0.5 flex flex-wrap items-center gap-2">
                    <span>Caller: {token.caller}</span>
                    <span>•</span>
                    {isWatchlist ? (
                      <span className="text-sky-400 font-semibold">
                        Research Coverage
                      </span>
                    ) : (
                      <span className="text-pump-pill font-semibold">
                        {token.callerWinRate}
                      </span>
                    )}
                    <span>•</span>
                    <span>Posted: {token.age}</span>
                  </div>
                </div>

                <div className="text-right font-mono tnum">
                  <div className="text-lg font-extrabold text-white">
                    {isWatchlist ? token.marketCap || '—' : token.entryMarketCap || token.marketCap}
                  </div>
                  <div className="text-xs font-bold text-pump">
                    {isWatchlist ? 'CURRENT MC' : 'ENTRY MC'}
                  </div>
                </div>
              </div>

              <p className="font-sans text-sm text-muted leading-relaxed mt-2.5">
                {token.summary}
              </p>
            </div>
          </div>

          {/* Core Metrics: Research Telemetry (Watchlist) vs Trade Call Metrics (Alpha) */}
          {isWatchlist ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-sans text-xs tnum">
              <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1">
                <div className="text-[11px] text-muted font-bold uppercase">
                  CURRENT MARKET CAP
                </div>
                <div className="text-lg font-extrabold text-white font-mono">
                  {token.marketCap || '—'}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pt-1 font-mono text-xs text-muted">
                  <MarketDataBadge item={token} />
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1">
                <div className="text-[11px] text-muted font-bold uppercase">
                  RESEARCH CLASSIFICATION
                </div>
                <div className="text-sm font-extrabold text-emerald-400 font-mono">
                  Platform Watchlist
                </div>
                <div className="text-xs text-muted font-mono pt-1">
                  {token.volume24h && token.volume24h !== '—'
                    ? `24h Vol: ${token.volume24h}`
                    : `${chainMeta.label} • Ongoing Research`}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-sans text-xs tnum">
            {/* 1. Market Cap & Entry */}
            <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1">
              <div className="text-[11px] text-muted font-bold uppercase">
                ENTRY MARKET CAP
              </div>
              <div className="text-lg font-extrabold text-white font-mono">
                {token.entryMarketCap || token.marketCap}
              </div>
              <div className="text-xs text-pump font-mono">
                Recorded at time of call
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-1 font-mono text-xs text-muted">
                <span>Now: {token.marketCap || '—'}</span>
                <MarketDataBadge item={token} />
              </div>
            </div>

            {/* 2. Risk Ratio (Both: Risk Level 1-5 + R:R Ratio) */}
            <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted font-bold uppercase">
                  RISK RATIO (BOTH)
                </span>
                <span className="px-1.5 py-0.5 rounded bg-surface border border-line font-mono text-[11px] font-bold text-pump">
                  {token.riskRewardRatio}
                </span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-mono text-xs font-bold text-white">
                  Risk Level {token.risk}/5
                </span>
                <span className="font-mono text-[11px] text-amber">
                  {token.stopLoss}
                </span>
              </div>
              <div className="flex items-center gap-1 pt-0.5">
                {[1, 2, 3, 4, 5].map((lvl) => (
                  <span
                    key={lvl}
                    className={`h-1.5 flex-1 rounded-sm ${
                      lvl <= token.risk
                        ? token.risk >= 4
                          ? 'bg-amber'
                          : 'bg-pump'
                        : 'bg-canvas border border-line'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 3. Take Profit Multipliers (2x / 5x / 10x) */}
            <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted font-bold uppercase flex items-center gap-1">
                  <Target className="w-3 h-3 text-pump" />
                  <span>TAKE PROFIT TARGETS</span>
                </span>
                {isAdmin && (
                  <span className="text-[10px] text-pump font-mono">Click to mark hit</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {token.takeProfits.map((tp, idx) => (
                  <button
                    key={tp.label}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => isAdmin && toggleTpHit(token.id, idx)}
                    className={`px-2 py-1 rounded border font-mono text-xs font-extrabold inline-flex items-center gap-1 ${
                      tp.hit
                        ? 'bg-pump text-canvas border-pump'
                        : 'bg-surface text-white border-line'
                    } ${isAdmin ? 'cursor-pointer hover:border-pump' : 'cursor-default'}`}
                    title={tp.targetMc ? `Target MC: ${tp.targetMc}` : tp.label}
                  >
                    <span>{tp.label}</span>
                    {tp.targetMc && (
                      <span
                        className={`text-[10px] font-normal ${
                          tp.hit ? 'text-canvas' : 'text-muted'
                        }`}
                      >
                        ({tp.targetMc})
                      </span>
                    )}
                    {tp.hit && <Check className="w-3 h-3 stroke-[3]" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* Admin Quick Controls Inside Inspector */}
          {isAdmin && (
            <div className="p-3.5 rounded-lg bg-surface-card border border-pump flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-xs">
              <div className="flex items-center gap-2 text-pump font-bold">
                <span>ADMIN CONTROLS ({ADMIN_WALLET_SHORT})</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Edit Call Button */}
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(token);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded border border-pump bg-surface-card hover:bg-pump hover:text-canvas text-pump font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="Edit trade call parameters"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Edit Post</span>
                  </button>
                )}

                {/* Max Alpha Toggle (Alpha calls only) */}
                {!isWatchlist && (
                  <button
                    type="button"
                    onClick={() => toggleMaxAlpha(token.id, !token.isMaxAlpha)}
                    className={`px-3 py-1.5 rounded-lg border font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      token.isMaxAlpha
                        ? 'bg-alpha-strong text-white border-alpha-border'
                        : 'bg-surface text-white border-border-default hover:border-alpha-primary hover:text-alpha-primary'
                    }`}
                    title="Toggle Max Alpha (Purple highlight)"
                  >
                    <Flame className="w-3.5 h-3.5" />
                    <span>{token.isMaxAlpha ? 'Max Alpha Active' : 'Mark as Max Alpha'}</span>
                  </button>
                )}

                {/* Priority Pin Toggle */}
                <button
                  type="button"
                  onClick={() => togglePinCall(token.id, !token.pinned)}
                  className={`px-3 py-1.5 rounded border font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                    token.pinned
                      ? 'bg-pump text-canvas border-pump'
                      : 'bg-surface text-white border-line hover:border-pump'
                  }`}
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{token.pinned ? 'Unpin Priority' : 'Pin Priority'}</span>
                </button>

                {/* Outcome Selector (Alpha calls only) */}
                {!isWatchlist && (
                  <div className="flex items-center gap-1 sm:border-l sm:border-line sm:pl-2">
                    <button
                      type="button"
                      onClick={() => setCallOutcome(token.id, 'PROFIT')}
                      className={`px-2.5 py-1.5 rounded border font-bold text-xs cursor-pointer transition-colors ${
                        token.outcome === 'PROFIT'
                          ? 'bg-pump text-canvas border-pump'
                          : 'bg-surface text-muted hover:text-white border-line hover:border-pump'
                      }`}
                      title="Mark as Achieved (In Profit)"
                    >
                      ✓ Achieved (Profit)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallOutcome(token.id, 'LOSS')}
                      className={`px-2.5 py-1.5 rounded border font-bold text-xs cursor-pointer transition-colors ${
                        token.outcome === 'LOSS'
                          ? 'bg-danger text-white border-danger'
                          : 'bg-surface text-muted hover:text-white border-line hover:border-danger'
                      }`}
                      title="Mark as At Loss"
                    >
                      ✕ At Loss
                    </button>
                    <button
                      type="button"
                      onClick={() => setCallOutcome(token.id, 'PENDING')}
                      className={`px-2 py-1.5 rounded border text-xs cursor-pointer transition-colors ${
                        !token.outcome || token.outcome === 'PENDING'
                          ? 'bg-surface border-line text-white font-bold'
                          : 'bg-surface text-dim border-line hover:text-white'
                      }`}
                      title="Reset outcome to Open"
                    >
                      Reset
                    </button>
                  </div>
                )}

                {/* Delete Call */}
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Are you sure you want to delete alpha call ${token.ticker}? This action cannot be undone.`)) {
                      return;
                    }
                    await deleteAlphaCall(token.id);
                    onClose();
                  }}
                  className="px-2.5 py-1.5 rounded bg-surface hover:bg-danger/20 border border-line hover:border-danger text-danger font-bold inline-flex items-center gap-1 cursor-pointer"
                  title="Delete call"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Gating / Contract Address & External Market Links Section */}
          {token.locked ? (
            <div className="p-4 rounded-lg bg-surface-card border border-line space-y-3">
              <div className="flex items-start gap-3">
                <Lock className="w-5 h-5 text-amber shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-sans text-sm font-bold text-white">
                    Requires ~$20 $H42 in Login Wallet
                  </div>
                  <p className="font-sans text-xs text-muted leading-relaxed">
                    Your current balance is{' '}
                    <strong className="text-white">{formattedBalance} $H42</strong>.
                    Hold at least <strong className="text-amber">~$20 worth of $H42</strong>{' '}
                    from contract <span className="font-mono text-white">{GENESIS_MINT}</span>{' '}
                    (or stake $250 on StakePoint) to unmask this Contract Address (CA) and open market links.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-line">
                <a
                  href={BUY_LINKS.pump}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 px-4 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
                >
                  <span>Buy $H42 on Pump.fun</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {demoEnabled && (
                  <button
                    type="button"
                    onClick={() => setDemoPreset('1m')}
                    className="h-9 px-3.5 rounded-md bg-surface border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-pump" />
                    <span>Preview 1M $H42 Member →</span>
                  </button>
                )}
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
                    Copy CA to trade on external market
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-canvas border border-line font-mono text-xs">
                  <span className="text-white font-bold truncate tnum">{token.ca}</span>
                  <button
                    type="button"
                    onClick={handleCopyCa}
                    className={`px-3 py-1 rounded ${copyCaError ? 'bg-danger text-white' : 'bg-pump hover:bg-pump-hover text-canvas'} font-sans font-extrabold text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer`}
                  >
                    {copiedCa ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copyCaError ? 'COPY FAILED' : copiedCa ? 'CA COPIED ✓' : 'COPY CA'}</span>
                  </button>
                </div>
              </div>

              {/* Direct External Market Links to Trade Token */}
              <div className="p-4 rounded-lg bg-surface-card border border-line space-y-3">
                <div className="flex items-center justify-between font-sans text-xs">
                  <span className="text-white font-bold uppercase">
                    EXTERNAL MARKET LINKS FOR {token.ticker} ({chainMeta.label})
                  </span>
                  <span className="text-muted">DYOR • Trade at your own risk</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={primaryMarketUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-10 px-5 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
                  >
                    <span>Open {token.ticker} Market</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  {token.links.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="h-10 px-4 rounded-md bg-surface hover:bg-surface-3 border border-line text-white font-sans text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <span>{link.label}</span>
                      <ExternalLink className="w-3 h-3 text-pump" />
                    </a>
                  ))}

                  {token.ca && (
                    <a
                      href={
                        token.chain === 'SOL'
                          ? SOLSCAN.token(token.ca)
                          : chainMeta.explorerTokenUrl(token.ca)
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="h-10 px-4 rounded-md bg-surface hover:bg-surface-3 border border-line text-white font-sans text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <span>{chainMeta.explorerName}</span>
                      <ExternalLink className="w-3 h-3 text-muted" />
                    </a>
                  )}
                </div>
              </div>

              {/* Risk Disclaimer */}
              <div className="px-3.5 py-2.5 rounded-lg bg-canvas border border-line flex items-center gap-2.5 font-sans text-xs text-muted">
                <AlertTriangle className="w-4 h-4 text-amber shrink-0" />
                <span>
                  <strong className="text-white">DYOR Disclaimer:</strong> All Users are to take all trades at their own risk (DYOR). You are not subject to take any trade by the admins. All Information provided here are for research purposes only and can lose value.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
