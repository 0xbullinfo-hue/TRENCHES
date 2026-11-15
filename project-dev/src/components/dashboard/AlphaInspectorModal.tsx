'use client';

import React, { useState } from 'react';
import type { AlphaItem } from '@/lib/types';
import { useGenesisBalance } from '@/context/GenesisContext';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LaunchLockedButton } from '@/components/LaunchLockedButton';
import { cn } from '@/components/ui/cn';
import { MarketDataBadge } from './MarketDataBadge';
import {
  ADMIN_WALLET_SHORT,
  BUY_LINKS,
  BUY_LOCK,
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
    <Modal
      isOpen={Boolean(token)}
      onClose={onClose}
      titleId="modal-token-name"
      containerClassName="bg-canvas/95"
      className={cn(
        'w-full max-w-2xl rounded-xl bg-surface p-0 overflow-hidden transition-all shadow-none',
        !isWatchlist && token.isMaxAlpha
          ? 'border-2 border-alpha-strong'
          : 'border border-border-default'
      )}
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
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-brand text-canvas font-extrabold uppercase">
              <Pin className="w-3 h-3" />
              <span>PINNED PRIORITY</span>
            </span>
          )}
          {!isWatchlist && token.outcome === 'PROFIT' && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-brand text-canvas font-extrabold uppercase">
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
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface border border-line text-brand">
              <Unlock className="w-3 h-3" />
              <span>LAB MEMBER UNLOCKED</span>
            </span>
          )}
          <span className="px-2 py-0.5 rounded bg-surface border border-line text-white font-mono">
            {chainMeta.label.toUpperCase()} ({token.chain})
          </span>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close modal dialog"
          className="w-7 h-7 p-0 rounded bg-surface hover:bg-surface-3 border border-line flex items-center justify-center text-muted hover:text-white"
        >
          <X className="w-4 h-4" />
        </Button>
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
                    <span className="font-mono text-sm text-brand">{token.ticker}</span>
                  </h3>
                  <div className="font-sans text-xs text-muted mt-0.5 flex flex-wrap items-center gap-2">
                    <span>Caller: {token.caller}</span>
                    <span>•</span>
                    {isWatchlist ? (
                      <span className="text-sky-400 font-semibold">
                        Research Coverage
                      </span>
                    ) : (
                      <span className="text-brand-pill font-semibold">
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
                  <div className="text-xs font-bold text-brand">
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
                <div className="text-xs text-muted font-bold uppercase">
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
                <div className="text-xs text-muted font-bold uppercase">
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
              <div className="text-xs text-muted font-bold uppercase">
                ENTRY MARKET CAP
              </div>
              <div className="text-lg font-extrabold text-white font-mono">
                {token.entryMarketCap || token.marketCap}
              </div>
              <div className="text-xs text-brand font-mono">
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
                <span className="text-xs text-muted font-bold uppercase">
                  RISK RATIO (BOTH)
                </span>
                <span className="px-1.5 py-0.5 rounded bg-surface border border-line font-mono text-xs font-bold text-brand">
                  {token.riskRewardRatio}
                </span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-mono text-xs font-bold text-white">
                  Risk Level {token.risk}/5
                </span>
                <span className="font-mono text-xs text-amber">
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
                          : 'bg-brand'
                        : 'bg-canvas border border-line'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* 3. Take Profit Multipliers (2x / 5x / 10x) */}
            <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-bold uppercase flex items-center gap-1">
                  <Target className="w-3 h-3 text-brand" />
                  <span>TAKE PROFIT TARGETS</span>
                </span>
                {isAdmin && (
                  <span className="text-xs text-brand font-mono">Click to mark hit</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                {token.takeProfits.map((tp, idx) => (
                  <Button
                    key={tp.label}
                    type="button"
                    variant={tp.hit ? 'primary' : 'secondary'}
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => isAdmin && toggleTpHit(token.id, idx)}
                    className={`h-auto px-2 py-1 rounded font-mono text-xs font-extrabold inline-flex items-center gap-1 ${
                      tp.hit
                        ? 'bg-brand text-canvas border-brand hover:bg-brand'
                        : 'bg-surface text-white border-line'
                    } ${isAdmin ? 'cursor-pointer hover:border-brand' : 'cursor-default'}`}
                    title={tp.targetMc ? `Target MC: ${tp.targetMc}` : tp.label}
                  >
                    <span>{tp.label}</span>
                    {tp.targetMc && (
                      <span
                        className={`text-xs font-normal ${
                          tp.hit ? 'text-canvas' : 'text-muted'
                        }`}
                      >
                        ({tp.targetMc})
                      </span>
                    )}
                    {tp.hit && <Check className="w-3 h-3 stroke-[3]" />}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          )}

          {/* Admin Quick Controls Inside Inspector */}
          {isAdmin && (
            <div className="p-3.5 rounded-lg bg-surface-card border border-brand flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-xs">
              <div className="flex items-center gap-2 text-brand font-bold">
                <span>ADMIN CONTROLS ({ADMIN_WALLET_SHORT})</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Edit Call Button */}
                {onEdit && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onEdit(token);
                      onClose();
                    }}
                    className="px-3 py-1.5 rounded border border-brand bg-surface-card hover:bg-brand hover:text-canvas text-brand font-bold inline-flex items-center gap-1.5 transition-colors"
                    title="Edit trade call parameters"
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1" />
                    <span>Edit Post</span>
                  </Button>
                )}

                {/* Max Alpha Toggle (Alpha calls only) */}
                {!isWatchlist && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleMaxAlpha(token.id, !token.isMaxAlpha)}
                    className={`px-3 py-1.5 rounded-lg border font-bold inline-flex items-center gap-1.5 transition-colors ${
                      token.isMaxAlpha
                        ? 'bg-alpha-strong text-white border-alpha-border hover:bg-alpha-strong'
                        : 'bg-surface text-white border-border-default hover:border-alpha-primary hover:text-alpha-primary'
                    }`}
                    title="Toggle Max Alpha (Purple highlight)"
                  >
                    <Flame className="w-3.5 h-3.5 mr-1" />
                    <span>{token.isMaxAlpha ? 'Max Alpha Active' : 'Mark as Max Alpha'}</span>
                  </Button>
                )}

                {/* Priority Pin Toggle */}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => togglePinCall(token.id, !token.pinned)}
                  className={`px-3 py-1.5 rounded border font-bold inline-flex items-center gap-1.5 ${
                    token.pinned
                      ? 'bg-brand text-canvas border-brand hover:bg-brand'
                      : 'bg-surface text-white border-line hover:border-brand'
                  }`}
                >
                  <Pin className="w-3.5 h-3.5 mr-1" />
                  <span>{token.pinned ? 'Unpin Priority' : 'Pin Priority'}</span>
                </Button>

                {/* Outcome Selector (Alpha calls only) */}
                {!isWatchlist && (
                  <div className="flex items-center gap-1 sm:border-l sm:border-line sm:pl-2">
                    <Button
                      type="button"
                      variant={token.outcome === 'PROFIT' ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setCallOutcome(token.id, 'PROFIT')}
                      className={`px-2.5 py-1.5 rounded border font-bold text-xs transition-colors ${
                        token.outcome === 'PROFIT'
                          ? 'bg-brand text-canvas border-brand hover:bg-brand'
                          : 'bg-surface text-muted hover:text-white border-line hover:border-brand'
                      }`}
                      title="Mark as Achieved (In Profit)"
                    >
                      ✓ Achieved (Profit)
                    </Button>
                    <Button
                      type="button"
                      variant={token.outcome === 'LOSS' ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => setCallOutcome(token.id, 'LOSS')}
                      className={`px-2.5 py-1.5 rounded border font-bold text-xs transition-colors ${
                        token.outcome === 'LOSS'
                          ? 'bg-danger text-white border-danger hover:bg-danger'
                          : 'bg-surface text-muted hover:text-white border-line hover:border-danger'
                      }`}
                      title="Mark as At Loss"
                    >
                      ✕ At Loss
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setCallOutcome(token.id, 'PENDING')}
                      className={`px-2 py-1.5 rounded border text-xs transition-colors ${
                        !token.outcome || token.outcome === 'PENDING'
                          ? 'bg-surface border-line text-white font-bold'
                          : 'bg-surface text-dim border-line hover:text-white'
                      }`}
                      title="Reset outcome to Open"
                    >
                      Reset
                    </Button>
                  </div>
                )}

                {/* Delete Call */}
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  aria-label="Delete call"
                  onClick={async () => {
                    if (!window.confirm(`Are you sure you want to delete alpha call ${token.ticker}? This action cannot be undone.`)) {
                      return;
                    }
                    await deleteAlphaCall(token.id);
                    onClose();
                  }}
                  className="px-2.5 py-1.5 rounded bg-surface hover:bg-danger/20 border border-line hover:border-danger text-danger font-bold inline-flex items-center gap-1 hover:bg-surface"
                  title="Delete call"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
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
                {BUY_LOCK ? (
                  <LaunchLockedButton className="h-9 px-4 rounded-md font-sans text-xs font-extrabold inline-flex items-center gap-1.5">
                    <span>Buy $H42 on Pump.fun</span>
                  </LaunchLockedButton>
                ) : (
                  <a
                    href={BUY_LINKS.pump}
                    target="_blank"
                    rel="noreferrer"
                    className="h-9 px-4 rounded-md bg-brand hover:bg-brand-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
                  >
                    <span>Buy $H42 on Pump.fun</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                {demoEnabled && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setDemoPreset('1m')}
                    className="h-9 px-3.5 rounded-md bg-surface border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-brand mr-1" />
                    <span>Preview 1M $H42 Member →</span>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Unmasked Contract Address Bar */}
              <div className="p-3.5 rounded-lg bg-surface-card border border-line space-y-2.5">
                <div className="flex items-center justify-between font-sans text-xs">
                  <span className="text-brand font-bold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>VERIFIED CONTRACT ADDRESS ({token.chain})</span>
                  </span>
                  <span className="text-muted font-medium">
                    Copy CA to trade on external market
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-canvas border border-line font-mono text-xs">
                  <span className="text-white font-bold truncate tnum">{token.ca}</span>
                  <Button
                    type="button"
                    variant={copyCaError ? 'danger' : 'primary'}
                    size="sm"
                    onClick={handleCopyCa}
                    className={`px-3 py-1 rounded ${copyCaError ? 'bg-danger text-white hover:bg-danger' : 'bg-brand hover:bg-brand-hover text-canvas'} font-sans font-extrabold text-xs inline-flex items-center gap-1.5 shrink-0`}
                  >
                    {copiedCa ? (
                      <Check className="w-3.5 h-3.5 mr-1" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 mr-1" />
                    )}
                    <span>{copyCaError ? 'COPY FAILED' : copiedCa ? 'CA COPIED ✓' : 'COPY CA'}</span>
                  </Button>
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
                    className="h-10 px-5 rounded-md bg-brand hover:bg-brand-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5"
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
                      <ExternalLink className="w-3 h-3 text-brand" />
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
    </Modal>
  );
};
