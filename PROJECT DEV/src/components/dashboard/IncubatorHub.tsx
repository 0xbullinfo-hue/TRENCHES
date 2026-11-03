'use client';

import React, { useMemo, useState } from 'react';
import type { AlphaItem, Chain } from '@/lib/types';
import { useGenesisBalance } from '@/context/GenesisContext';
import {
  ADMIN_WALLET,
  ADMIN_WALLET_SHORT,
  BUY_LINKS,
  CHAIN_METADATA,
  GENESIS_MINT,
  GENESIS_MINT_SHORT,
  SOLSCAN,
} from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import { AlphaInspectorModal, getPrimaryMarketUrl } from './AlphaInspectorModal';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Filter,
  Flame,
  LayoutGrid,
  List,
  Pin,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Unlock,
  Wallet,
} from 'lucide-react';

type FilterTab = 'ALL' | 'PINNED' | 'MOVERS' | 'NEW' | 'WATCHLIST';
type SortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';

const ALL_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

export const IncubatorHub: React.FC = () => {
  const {
    connected,
    publicKeyBase58,
    shortAddress,
    formattedBalance,
    tier,
    isAdmin,
    demoPreset,
    setDemoPreset,
    alphas,
    watchlist,
    toggleWatchlist,
    boundEvmAddress,
    setBoundEvmAddress,
    createAlphaCall,
    togglePinCall,
    toggleTpHit,
    deleteAlphaCall,
    setCallOutcome,
    apiLoading,
    apiError,
    refreshAll,
    searchQuery,
    setSearchQuery,
  } = useGenesisBalance();

  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [selectedChain, setSelectedChain] = useState<Chain | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('PRIORITY');
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');

  const [inspectedToken, setInspectedToken] = useState<AlphaItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Admin Create Call Form State
  const [showAdminForm, setShowAdminForm] = useState<boolean>(true);
  const [formCa, setFormCa] = useState('');
  const [formName, setFormName] = useState('');
  const [formTicker, setFormTicker] = useState('');
  const [formChain, setFormChain] = useState<Chain>('SOL');
  const [formCurrentMc, setFormCurrentMc] = useState('$250K');
  const [formEntryMc, setFormEntryMc] = useState('$250K');
  const [formRiskLevel, setFormRiskLevel] = useState<number>(3);
  const [formRiskRatio, setFormRiskRatio] = useState('1:5 R:R');
  const [formStopLoss, setFormStopLoss] = useState('-25% SL');
  const [formTakeProfits, setFormTakeProfits] = useState('2x, 5x, 10x');
  const [formPinned, setFormPinned] = useState(true);
  const [formSummary, setFormSummary] = useState('');
  const [formSerialTag, setFormSerialTag] = useState('');
  const [fetchingDex, setFetchingDex] = useState(false);
  const [submittingCall, setSubmittingCall] = useState(false);

  const nextSerialTag = `EXP${String(alphas.length + 1).padStart(2, '0')}`;

  const [evmDraft, setEvmDraft] = useState(boundEvmAddress);
  const [evmSaved, setEvmSaved] = useState(false);
  const [tgKey, setTgKey] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2800);
  };

  const handleCopyText = (
    text: string,
    id: string,
    label?: string,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    if (label) {
      showToast(`Copied ${label} CA: ${text}`);
    }
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleAutoFillDexScreener = async () => {
    const cleanCa = formCa.trim();
    if (!cleanCa) {
      showToast('Paste a Contract Address (CA) first to auto-fill.');
      return;
    }
    setFetchingDex(true);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(cleanCa)}`
      );
      if (!res.ok) {
        if (res.status === 429) {
          showToast('DexScreener rate limit reached (HTTP 429). Please retry in a few seconds.');
        } else {
          showToast(`DexScreener request failed (HTTP ${res.status}). Enter details manually.`);
        }
        return;
      }
      const data = await res.json();
      const pair = data?.pairs?.[0];
      if (pair) {
        if (pair.baseToken?.name) setFormName(pair.baseToken.name);
        if (pair.baseToken?.symbol) setFormTicker(`$${pair.baseToken.symbol}`);
        const chainId = String(pair.chainId || '').toLowerCase();
        if (chainId.includes('sol')) setFormChain('SOL');
        else if (chainId.includes('bsc')) setFormChain('BSC');
        else if (chainId.includes('eth')) setFormChain('ETH');
        else if (chainId.includes('base')) setFormChain('BASE');
        else if (chainId.includes('avax') || chainId.includes('avalanche')) setFormChain('AVAX');
        else if (chainId.includes('robin')) setFormChain('ROBIN');

        const mc = Number(pair.marketCap || pair.fdv || 0);
        if (mc > 0) {
          const formatted =
            mc >= 1_000_000
              ? `$${(mc / 1_000_000).toFixed(2)}M`
              : `$${(mc / 1_000).toFixed(1)}K`;
          setFormCurrentMc(formatted);
          setFormEntryMc(formatted);
        }
        showToast(`Auto-filled live telemetry for ${pair.baseToken?.symbol || cleanCa}`);
      } else {
        showToast('No active DEX trading pair found for this CA. Enter details manually.');
      }
    } catch (err) {
      showToast(`Network error reaching DexScreener: ${(err as Error).message || 'offline'}`);
    } finally {
      setFetchingDex(false);
    }
  };

  const handleAdminPostCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formTicker.trim() || !formCa.trim()) {
      showToast('Token Name, Ticker, and Contract Address (CA) are required.');
      return;
    }
    setSubmittingCall(true);
    const ok = await createAlphaCall({
      name: formName.trim(),
      ticker: formTicker.trim(),
      ca: formCa.trim(),
      chain: formChain,
      marketCap: formCurrentMc.trim() || '$250K',
      entryMarketCap: formEntryMc.trim() || formCurrentMc.trim() || '$250K',
      risk: formRiskLevel,
      riskRewardRatio: formRiskRatio.trim() || '1:5 R:R',
      stopLoss: formStopLoss.trim() || '-25% SL',
      takeProfitInput: formTakeProfits.trim() || '2x, 5x, 10x',
      pinned: formPinned,
      summary: formSummary.trim(),
      serialTag: formSerialTag.trim() || nextSerialTag,
    });
    setSubmittingCall(false);
    if (ok) {
      showToast(
        `Posted ${formTicker.toUpperCase()} (${formChain}) [${
          formSerialTag.trim() || nextSerialTag
        }]${formPinned ? ' as PINNED PRIORITY CALL' : ''}`
      );
      setFormCa('');
      setFormName('');
      setFormTicker('');
      setFormSummary('');
      setFormSerialTag('');
    } else {
      showToast('Failed to post call — ensure Admin Wallet is active.');
    }
  };

  const handleSaveEvm = (e: React.FormEvent) => {
    e.preventDefault();
    setBoundEvmAddress(evmDraft.trim());
    setEvmSaved(true);
    setTimeout(() => setEvmSaved(false), 2000);
  };

  const handleGenerateTelegramKey = () => {
    const suffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    setTgKey(`TL-LAB-1M-${suffix}`);
  };

  const pinnedCalls = useMemo(
    () =>
      alphas.filter(
        (a) =>
          a.pinned && (selectedChain === 'ALL' || a.chain === selectedChain)
      ),
    [alphas, selectedChain]
  );

  const chainCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: alphas.length };
    for (const ch of ['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX']) {
      counts[ch] = alphas.filter((a) => a.chain === ch).length;
    }
    return counts;
  }, [alphas]);

  const filteredTokens = useMemo(() => {
    return alphas
      .filter((item) => {
        if (selectedChain !== 'ALL' && item.chain !== selectedChain) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.name.toLowerCase().includes(q);
          const matchTicker = item.ticker.toLowerCase().includes(q);
          const matchCaller = item.caller.toLowerCase().includes(q);
          const matchChain = item.chain.toLowerCase().includes(q);
          const matchCa = item.ca?.toLowerCase().includes(q) ?? false;
          if (!matchName && !matchTicker && !matchCaller && !matchChain && !matchCa)
            return false;
        }
        switch (activeFilter) {
          case 'PINNED':
            return item.pinned;
          case 'MOVERS':
            return item.change24hPct >= 200;
          case 'NEW':
            return item.ageMinutes <= 180;
          case 'WATCHLIST':
            return watchlist.includes(item.id);
          case 'ALL':
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (sortBy === 'PRIORITY') {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return a.ageMinutes - b.ageMinutes;
        }
        if (sortBy === 'MCAP') return b.marketCapUsd - a.marketCapUsd;
        if (sortBy === 'CHANGE') return b.change24hPct - a.change24hPct;
        return a.ageMinutes - b.ageMinutes;
      });
  }, [alphas, selectedChain, searchQuery, activeFilter, watchlist, sortBy]);

  const topWinningCoins = useMemo(
    () => [...alphas].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 4),
    [alphas]
  );

  const renderAlphaCard = (coin: AlphaItem) => {
    const isStarred = watchlist.includes(coin.id);
    const marketUrl = getPrimaryMarketUrl(coin);
    const chainMeta = CHAIN_METADATA[coin.chain] || CHAIN_METADATA.SOL;
    const isPinned = Boolean(coin.pinned);
    const serial = coin.serialTag || 'EXP01';

    return (
      <article
        key={coin.id}
        tabIndex={0}
        role="button"
        aria-label={`Inspect ${coin.name} (${coin.ticker}) call`}
        onClick={() => setInspectedToken(coin)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setInspectedToken(coin);
          }
        }}
        className={`group relative rounded-xl bg-surface flex flex-col justify-between cursor-pointer transition-colors p-4 focus:outline-none ${
          isPinned ? 'border-2 border-pump' : 'border border-line hover:border-pump'
        }`}
      >
        <div>
          {/* Top Row: Serial Tag (EXP01) + Priority Pin + Chain Badge + Age + Star & Admin buttons */}
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-line">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-surface-card border border-pump font-mono text-xs font-black text-pump">
                {serial}
              </span>

              {isPinned && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-pump text-canvas font-mono text-[10px] font-black uppercase">
                  <Pin className="w-2.5 h-2.5" />
                  <span>PRIORITY PIN</span>
                </span>
              )}

              <span className="px-2 py-0.5 rounded bg-surface-card border border-line font-mono text-[10px] font-bold text-white">
                {coin.chain === 'ROBIN' ? 'ROBIN (Robinhood)' : coin.chain}
              </span>

              {coin.outcome === 'PROFIT' && (
                <span className="px-2 py-0.5 rounded bg-pump text-canvas font-mono text-[10px] font-black uppercase">
                  PROFIT MADE ✓
                </span>
              )}
              {coin.outcome === 'LOSS' && (
                <span className="px-2 py-0.5 rounded bg-danger text-white font-mono text-[10px] font-black uppercase">
                  LOSE MADE ✕
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-xs text-muted">{coin.age}</span>

              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinCall(coin.id, !coin.pinned);
                    showToast(`${coin.pinned ? 'Unpinned' : 'Pinned'} ${coin.ticker}`);
                  }}
                  className={`px-2 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                    coin.pinned
                      ? 'bg-pump text-canvas border-pump font-black'
                      : 'bg-surface-card hover:bg-surface-3 border-line text-muted hover:text-white'
                  }`}
                  title={coin.pinned ? 'Unpin Priority Call' : 'Pin Call as Priority'}
                >
                  {coin.pinned ? 'PINNED' : 'PIN'}
                </button>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteAlphaCall(coin.id);
                    showToast(`Deleted call ${coin.ticker}`);
                  }}
                  className="w-6 h-6 rounded bg-surface-card hover:bg-surface-3 border border-line hover:border-danger text-muted hover:text-danger flex items-center justify-center cursor-pointer"
                  title="Delete Call"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWatchlist(coin.id);
                }}
                className="w-6 h-6 rounded bg-surface-card hover:bg-surface-3 border border-line flex items-center justify-center cursor-pointer"
                title="Toggle Watchlist"
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    isStarred ? 'text-amber fill-amber' : 'text-muted'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Token Identity + Current Market Cap */}
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <TokenArtwork
                art={coin.art}
                size="sm"
                chain={coin.chain}
                quoteToken={coin.quoteToken}
                locked={coin.locked}
              />
              <div className="min-w-0">
                <div className="font-sans font-extrabold text-base text-white truncate">
                  {coin.name}
                </div>
                <div className="font-mono text-xs text-pump font-bold">
                  {coin.ticker} • {chainMeta.label}
                </div>
              </div>
            </div>

            <div className="text-right font-mono tnum shrink-0">
              <div className="text-[10px] text-muted uppercase">CURRENT MC</div>
              <div className="text-lg font-extrabold text-white">
                {coin.marketCap}
              </div>
              <div className="text-[11px] text-pump">
                Entry {coin.entryMarketCap}
              </div>
            </div>
          </div>

          {/* Contract Address (CA) Bar */}
          <div className="px-2.5 py-1.5 rounded bg-surface-card border border-line flex items-center justify-between gap-2 font-mono text-xs">
            <span className="text-muted text-[11px] shrink-0">CA:</span>
            <span className="text-white truncate tnum">{coin.ca || 'Locked'}</span>
            {coin.ca && (
              <button
                type="button"
                onClick={(e) =>
                  handleCopyText(coin.ca || '', `card-ca-${coin.id}`, coin.ticker, e)
                }
                className="text-pump hover:text-white font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                {copiedId === `card-ca-${coin.id}` ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[11px]">
                  {copiedId === `card-ca-${coin.id}` ? 'COPIED' : 'COPY'}
                </span>
              </button>
            )}
          </div>

          {/* Dual Risk Ratio + Take Profit Multipliers */}
          <div className="grid grid-cols-2 gap-2 mt-3 font-mono text-xs">
            <div className="p-2.5 rounded bg-surface-card border border-line">
              <div className="flex items-center justify-between text-[10px] text-muted uppercase">
                <span>RISK RATIO</span>
                <span className="text-amber">{coin.stopLoss}</span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-bold text-white">
                  Lvl {coin.risk}/5
                </span>
                <span className="px-1.5 py-0.5 rounded bg-surface border border-line text-pump font-bold text-[11px]">
                  {coin.riskRewardRatio}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded bg-surface-card border border-line">
              <div className="text-[10px] text-muted uppercase flex items-center gap-1">
                <Target className="w-3 h-3 text-pump" />
                <span>TAKE PROFIT</span>
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {coin.takeProfits.map((tp) => (
                  <span
                    key={tp.label}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${
                      tp.hit
                        ? 'bg-pump text-canvas border-pump'
                        : 'bg-surface text-white border-line'
                    }`}
                  >
                    {tp.label}
                    {tp.hit ? ' ✓' : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Admin Outcome Selector (Visible strictly when Master Admin is connected) */}
        {isAdmin && (
          <div className="mt-3 pt-2 border-t border-line flex items-center justify-between gap-1.5 font-mono text-xs">
            <span className="text-[10px] uppercase font-bold text-muted">SET OUTCOME:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCallOutcome(coin.id, 'PROFIT');
                  showToast(`Marked ${coin.ticker} as Profit Made ✓`);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                  coin.outcome === 'PROFIT'
                    ? 'bg-pump text-canvas border-pump'
                    : 'bg-surface-card hover:bg-surface-3 text-muted hover:text-white border-line'
                }`}
                title="Mark trade call as Profit Made"
              >
                ✓ PROFIT
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCallOutcome(coin.id, 'LOSS');
                  showToast(`Marked ${coin.ticker} as Lose Made ✕`);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-bold border transition-colors cursor-pointer ${
                  coin.outcome === 'LOSS'
                    ? 'bg-danger text-white border-danger'
                    : 'bg-surface-card hover:bg-surface-3 text-muted hover:text-white border-line'
                }`}
                title="Mark trade call as Lose Made"
              >
                ✕ LOSE
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCallOutcome(coin.id, 'PENDING');
                  showToast(`Reset ${coin.ticker} to Open`);
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors cursor-pointer ${
                  !coin.outcome || coin.outcome === 'PENDING'
                    ? 'bg-surface border-line text-white font-bold'
                    : 'bg-surface-card hover:bg-surface-3 text-dim border-line'
                }`}
                title="Reset outcome to Open"
              >
                RESET
              </button>
            </div>
          </div>
        )}

        {/* Card Footer */}
        <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2 font-sans text-xs">
          {coin.ca ? (
            <button
              type="button"
              onClick={(e) =>
                handleCopyText(coin.ca || '', `card-btn-${coin.id}`, coin.ticker, e)
              }
              className="flex-1 py-1.5 px-3 rounded bg-surface-card hover:bg-surface-3 border border-line text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {copiedId === `card-btn-${coin.id}` ? (
                <Check className="w-3.5 h-3.5 text-pump" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-pump" />
              )}
              <span>
                {copiedId === `card-btn-${coin.id}` ? 'COPIED CA' : 'COPY CA'}
              </span>
            </button>
          ) : (
            <div className="flex-1 py-1.5 px-3 rounded bg-surface-card border border-line text-muted text-center font-mono text-[11px]">
              LOCKED (1M REQ)
            </div>
          )}

          <a
            href={marketUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="py-1.5 px-3.5 rounded bg-pump hover:bg-pump-hover text-canvas font-extrabold inline-flex items-center gap-1.5 transition-colors shrink-0"
          >
            <span>TRADE ON MARKET</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </article>
    );
  };

  // Admin Telemetry & Performance Calculations
  const totalCallsMade = alphas.length;
  const totalProfitCalls = alphas.filter((a) => a.outcome === 'PROFIT').length;
  const totalLoseCalls = alphas.filter((a) => a.outcome === 'LOSS').length;
  const totalVerifiedUsers = 142;

  return (
    <div className="space-y-6 pb-10">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg bg-surface border border-pump text-white font-sans text-xs font-semibold flex items-center gap-2.5">
          <Check className="w-4 h-4 text-pump shrink-0" />
          <span className="truncate max-w-md">{toastMessage}</span>
        </div>
      )}

      {/* 1. DISCLAIMER BANNER (Directly on top of Welcome To The Lab card) */}
      <div className="rounded-xl bg-surface border border-pump/30 p-3.5 sm:p-4 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-pump shrink-0" />
        <p className="font-sans text-xs text-muted leading-relaxed">
          <strong className="text-white uppercase tracking-wider mr-1.5">
            ALPHA CALLS DISCLAIMER:
          </strong>
          Admin posts trade calls for verified{' '}
          <strong className="text-pump">1,000,000+ $GENESIS</strong> holders. Users take all
          trades at their own risk (DYOR). Information provided is for research purposes only
          and can lose value.
        </p>
      </div>

      {/* 3. WELCOME TO THE LAB CARD */}
      <div className="relative rounded-xl border border-line bg-surface p-5 sm:p-6 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-surface-card border border-line flex items-center justify-center text-pump">
                <Flame className="w-4 h-4" />
              </span>
              <h1 className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                Welcome To The Lab
              </h1>
            </div>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Exclusive multi-chain trade calls for verified{' '}
              <span className="text-pump font-bold">1,000,000+ $GENESIS</span> holders
              across <strong className="text-white">SOL, BSC, ETH, BASE, ROBIN (Robinhood Chain), &amp; AVAX</strong>.
              Every card displays live Market Cap, dual Risk Ratio, and Take Profit
              multipliers (<span className="font-mono text-pump">2x / 5x / 10x</span>).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$GENESIS', e)}
              className="px-4 py-2 rounded-lg bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedId === 'hero-gen-ca' ? (
                <Check className="w-3.5 h-3.5 text-pump" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-pump" />
              )}
              <span>
                {copiedId === 'hero-gen-ca' ? 'Copied $GENESIS CA' : 'Copy $GENESIS CA'}
              </span>
            </button>

            <a
              href={BUY_LINKS.pump}
              target="_blank"
              rel="noreferrer"
              className="px-5 py-2 rounded-lg bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5 transition-all"
            >
              <span>Buy $GENESIS on Pump.fun</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* 4-Column KPI Stat Box (Supported Blockchains: 2 lines, 3 per line) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 rounded-xl bg-surface-card border border-line divide-y sm:divide-y-0 sm:divide-x divide-line">
          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              ACTIVE ALPHA CALLS
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-pump mt-1 tnum">
              {alphas.length} CALLS
            </div>
            <div className="font-sans text-xs text-muted mt-1">
              {pinnedCalls.length} Pinned Priority • 6 Chains
            </div>
          </div>

          {/* Supported Blockchains in 2 lines, 3 per line */}
          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              SUPPORTED BLOCKCHAINS
            </div>
            <div className="font-mono text-sm sm:text-base font-extrabold text-white mt-1.5 space-y-0.5">
              <div>SOL • BSC • ETH</div>
              <div className="text-pump">BASE • ROBIN • AVAX</div>
            </div>
            <div className="font-sans text-[11px] text-muted mt-1">
              Includes Robinhood Chain (ROBIN)
            </div>
          </div>

          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              LAB ACCESS PASS
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-pump mt-1 tnum">
              1,000,000
            </div>
            <div className="font-sans text-xs text-white mt-1 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-surface border border-line text-pump font-bold">
                $GENESIS REQUIRED
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between font-sans text-xs text-muted uppercase tracking-wider font-bold">
              <span>ADMIN DESK WIN RATE</span>
              <span className="text-pump font-bold">2X+ HIT RATE</span>
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-white mt-1 tnum">
              86.4% <span className="text-pump text-sm font-mono">(2x / 5x TP)</span>
            </div>
            <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden mt-2 border border-line">
              <div className="h-full bg-pump w-[86%]" />
            </div>
          </div>
        </div>
      </div>

      {/* 1. ADMIN COMMAND DESK (Visible when connected as FzFuSbWnTk7PR6fD84HHnE5w8qdwHjQr78HzfR817p3e or Admin Mode) */}
      {isAdmin && (
        <div className="rounded-xl bg-surface border-2 border-pump overflow-hidden">
          <div className="px-5 py-3.5 bg-surface-card border-b border-line flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded bg-pump text-canvas font-mono text-xs font-extrabold uppercase">
                MASTER ADMIN DESK
              </span>
              <span className="font-mono text-xs text-white font-bold">
                {ADMIN_WALLET}
              </span>
              <span className="hidden md:inline font-sans text-xs text-muted">
                • Full access to post, categorize, &amp; pin priority calls
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowAdminForm(!showAdminForm)}
              className="px-3.5 py-1.5 rounded bg-surface border border-pump font-sans text-xs font-black text-pump hover:bg-surface-3 cursor-pointer transition-colors"
            >
              {showAdminForm ? 'Hide Post Form' : '+ Post New Alpha Call'}
            </button>
          </div>

          {/* ADMIN TELEMETRY & PERFORMANCE OVERVIEW CARD */}
          <div className="p-5 border-b border-line bg-surface">
            <div className="font-sans text-xs font-black uppercase tracking-widest text-pump mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-pump" />
              <span>ADMIN TELEMETRY &amp; PERFORMANCE CARD</span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 1. Total Verified Users */}
              <div className="p-4 rounded-xl bg-surface-card border border-line">
                <div className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
                  TOTAL VERIFIED USERS
                </div>
                <div className="font-sans text-2xl sm:text-3xl font-black text-white mt-1 tnum">
                  {totalVerifiedUsers.toLocaleString()}
                </div>
                <div className="font-sans text-xs text-pump mt-1">
                  Verified 1M+ $GENESIS Holders
                </div>
              </div>

              {/* 2. Total Calls Made */}
              <div className="p-4 rounded-xl bg-surface-card border border-line">
                <div className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
                  TOTAL CALLS MADE
                </div>
                <div className="font-sans text-2xl sm:text-3xl font-black text-white mt-1 tnum">
                  {totalCallsMade}
                </div>
                <div className="font-sans text-xs text-muted mt-1">
                  Active Dispatches Across 6 Chains
                </div>
              </div>

              {/* 3. Total Profit Calls */}
              <div className="p-4 rounded-xl bg-surface-card border border-line">
                <div className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
                  TOTAL PROFIT CALLS
                </div>
                <div className="font-sans text-2xl sm:text-3xl font-black text-pump mt-1 tnum">
                  {totalProfitCalls}
                </div>
                <div className="font-sans text-xs text-pump font-semibold mt-1">
                  ✓ Profit Targets Hit
                </div>
              </div>

              {/* 4. Total Lose Calls */}
              <div className="p-4 rounded-xl bg-surface-card border border-line">
                <div className="font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
                  TOTAL LOSE CALLS
                </div>
                <div className="font-sans text-2xl sm:text-3xl font-black text-danger mt-1 tnum">
                  {totalLoseCalls}
                </div>
                <div className="font-sans text-xs text-danger font-semibold mt-1">
                  ✕ Invalidation / SL Triggered
                </div>
              </div>
            </div>
          </div>

          {showAdminForm && (
            <form onSubmit={handleAdminPostCall} className="p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* CA Input + Auto-Fill */}
                <div className="md:col-span-5 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Contract Address (CA) *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={formCa}
                      onChange={(e) => setFormCa(e.target.value)}
                      placeholder="Paste SOL / EVM / ROBIN Contract Address..."
                      className="flex-1 h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleAutoFillDexScreener}
                      disabled={fetchingDex}
                      className="h-9 px-3 rounded bg-surface-card hover:bg-surface-3 border border-pump font-sans text-xs font-bold text-pump shrink-0 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{fetchingDex ? 'Fetching...' : 'Auto-Fill'}</span>
                    </button>
                  </div>
                </div>

                {/* Token Name */}
                <div className="md:col-span-3 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Token Name *
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Robinhood Alpha"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-sans text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>

                {/* Ticker */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Ticker *
                  </label>
                  <input
                    type="text"
                    value={formTicker}
                    onChange={(e) => setFormTicker(e.target.value)}
                    placeholder="e.g. $HOOD"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                  />
                </div>

                {/* Blockchain Selector */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Blockchain *
                  </label>
                  <select
                    value={formChain}
                    onChange={(e) => setFormChain(e.target.value as Chain)}
                    className="w-full h-9 px-2.5 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs font-bold text-pump focus:outline-none cursor-pointer"
                  >
                    <option value="SOL">SOL (Solana)</option>
                    <option value="BSC">BSC (BNB Chain)</option>
                    <option value="ETH">ETH (Ethereum)</option>
                    <option value="BASE">BASE (Base L2)</option>
                    <option value="ROBIN">ROBIN (Robinhood Chain)</option>
                    <option value="AVAX">AVAX (Avalanche)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3">
                {/* Current Market Cap */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Current MC *
                  </label>
                  <input
                    type="text"
                    value={formCurrentMc}
                    onChange={(e) => {
                      setFormCurrentMc(e.target.value);
                      setFormEntryMc(e.target.value);
                    }}
                    placeholder="$250K"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-white focus:outline-none"
                  />
                </div>

                {/* Risk Level (1-5) */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Risk Level (1–5)
                  </label>
                  <select
                    value={formRiskLevel}
                    onChange={(e) => setFormRiskLevel(Number(e.target.value))}
                    className="w-full h-9 px-2.5 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-white focus:outline-none cursor-pointer"
                  >
                    <option value={1}>1/5 (Low Risk)</option>
                    <option value={2}>2/5 (Measured)</option>
                    <option value={3}>3/5 (Medium Risk)</option>
                    <option value={4}>4/5 (High Degen)</option>
                    <option value={5}>5/5 (Max Degen)</option>
                  </select>
                </div>

                {/* Risk:Reward Ratio */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Risk:Reward (R:R)
                  </label>
                  <input
                    type="text"
                    value={formRiskRatio}
                    onChange={(e) => setFormRiskRatio(e.target.value)}
                    placeholder="1:5 R:R"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-pump focus:outline-none"
                  />
                </div>

                {/* Stop Loss / Invalidation */}
                <div className="md:col-span-2 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Stop Loss / Risk %
                  </label>
                  <input
                    type="text"
                    value={formStopLoss}
                    onChange={(e) => setFormStopLoss(e.target.value)}
                    placeholder="-25% SL"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-amber focus:outline-none"
                  />
                </div>

                {/* Take Profit Multipliers */}
                <div className="md:col-span-4 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Take Profit Multipliers (e.g. 2x, 5x, 10x)
                  </label>
                  <input
                    type="text"
                    value={formTakeProfits}
                    onChange={(e) => setFormTakeProfits(e.target.value)}
                    placeholder="2x, 5x, 10x"
                    className="w-full h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-pump focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <input
                  type="text"
                  value={formSummary}
                  onChange={(e) => setFormSummary(e.target.value)}
                  placeholder="Optional call thesis / entry note (e.g. Clean breakout on Robinhood Chain, LP locked, take initial at 2x)..."
                  className="flex-1 h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-sans text-xs text-white placeholder:text-dim focus:outline-none"
                />

                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card border border-line" title="Serial experiment tag (e.g. EXP01, EXP02, EXP03)">
                    <span className="font-sans text-[10px] font-bold text-muted uppercase">TAG:</span>
                    <input
                      type="text"
                      value={formSerialTag}
                      onChange={(e) => setFormSerialTag(e.target.value.toUpperCase())}
                      placeholder={nextSerialTag}
                      className="w-16 bg-transparent font-mono text-xs font-black text-pump uppercase focus:outline-none"
                    />
                  </div>

                  <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-white cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formPinned}
                      onChange={(e) => setFormPinned(e.target.checked)}
                      className="accent-[#34D399] w-4 h-4 cursor-pointer"
                    />
                    <Pin className="w-3.5 h-3.5 text-pump" />
                    <span>Pin as Priority Call</span>
                  </label>

                  <button
                    type="submit"
                    disabled={submittingCall}
                    className="h-9 px-5 rounded bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>{submittingCall ? 'Posting...' : 'PUBLISH CALL'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {/* PINNED PRIORITY CALLS SECTION (Admin-Pinned Calls for All Users) */}
      {pinnedCalls.length > 0 && activeFilter === 'ALL' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-pump text-canvas font-mono text-xs font-black uppercase inline-flex items-center gap-1">
                <Pin className="w-3.5 h-3.5" />
                <span>PINNED PRIORITY CALLS ({pinnedCalls.length})</span>
              </span>
              <span className="font-sans text-xs text-muted">
                High-priority trade setups pinned by Admin for all verified $GENESIS holders
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pinnedCalls.map(renderAlphaCard)}
          </div>
        </div>
      )}

      {/* 5. ALL CATEGORIZED ALPHA TRADE CALLS (Filterable by Blockchain: SOL, BSC, ETH, BASE, ROBIN, AVAX) */}
      <div className="space-y-4 pt-2">
        {apiError && (
          <div className="rounded-xl bg-danger/10 border border-danger/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-xs">
            <div className="flex items-center gap-2.5 text-danger font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>RPC / Telemetry Notice: {apiError}</span>
            </div>
            <button
              type="button"
              onClick={() => refreshAll()}
              className="px-3 py-1 rounded bg-surface border border-line hover:border-danger text-white font-mono text-xs font-bold cursor-pointer shrink-0"
            >
              Retry Connection ⟳
            </button>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="font-sans text-lg sm:text-xl font-extrabold text-white">
              All Alpha Trade Calls by Blockchain
            </h2>
            <p className="font-sans text-xs text-muted">
              Showing <strong className="text-pump">{filteredTokens.length}</strong> posted
              calls • Filter by chain (<span className="font-mono text-white">SOL, BSC, ETH, BASE, ROBIN, AVAX</span>)
            </p>
          </div>
        </div>

        {/* Blockchain Category Bar + Filter Pills + Sort + Grid/Table Toggle */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-line">
          {/* Blockchain Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {ALL_CHAINS.map((ch) => {
              const active = selectedChain === ch;
              const label = ch === 'ROBIN' ? 'ROBIN (Robinhood)' : ch;
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setSelectedChain(ch)}
                  className={`px-3 py-1.5 rounded-md font-mono text-xs font-extrabold whitespace-nowrap border cursor-pointer transition-colors ${
                    active
                      ? 'bg-pump text-canvas border-pump'
                      : 'bg-surface hover:bg-surface-card text-white border-line'
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`ml-1.5 text-[10px] ${
                      active ? 'text-canvas' : 'text-pump'
                    }`}
                  >
                    ({chainCounts[ch] ?? 0})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Controls: Filter Tabs + Sort + View Mode */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center bg-surface border border-line rounded-md p-0.5 font-sans text-xs">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'PINNED', label: '📌 Pinned' },
                  { id: 'MOVERS', label: '🔥 Movers' },
                  { id: 'NEW', label: '✨ New' },
                  { id: 'WATCHLIST', label: `⭐ (${watchlist.length})` },
                ] as { id: FilterTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                    activeFilter === tab.id
                      ? 'bg-pump text-canvas'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-surface border border-line font-sans text-xs text-muted">
              <Filter className="w-3 h-3 text-pump" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer text-xs"
              >
                <option value="PRIORITY" className="bg-surface">
                  Sort: Pinned &amp; Newest
                </option>
                <option value="MCAP" className="bg-surface">
                  Sort: Market Cap
                </option>
                <option value="CHANGE" className="bg-surface">
                  Sort: 24h Gain
                </option>
                <option value="NEWEST" className="bg-surface">
                  Sort: Newest Call
                </option>
              </select>
            </div>

            <div className="flex items-center bg-surface border border-line rounded-md p-0.5 font-sans text-xs">
              <button
                type="button"
                onClick={() => setViewMode('GRID')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  viewMode === 'GRID'
                    ? 'bg-pump text-canvas'
                    : 'text-muted hover:text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-semibold cursor-pointer ${
                  viewMode === 'TABLE'
                    ? 'bg-pump text-canvas'
                    : 'text-muted hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Table</span>
              </button>
            </div>
          </div>
        </div>

        {/* VIEW MODE A: TRADE CALL CARDS GRID (3 IN A ROW, EXACT SAME FORMAT AS PINNED CARDS) */}
        {viewMode === 'GRID' ? (
          apiLoading && alphas.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-pulse"
                >
                  <div className="w-full h-12 bg-surface-card rounded-md" />
                  <div className="h-4 bg-surface-card rounded w-3/4" />
                  <div className="h-3 bg-surface-card rounded w-1/2" />
                  <div className="h-10 bg-surface-card rounded w-full" />
                </div>
              ))}
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="rounded-xl bg-surface border border-line p-10 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-surface-card border border-line mx-auto flex items-center justify-center text-muted">
                <Search className="w-4 h-4" />
              </div>
              <h3 className="font-sans text-base font-bold text-white">No trade calls found</h3>
              <p className="font-sans text-xs text-muted max-w-sm mx-auto">
                No alpha calls match your active filter or search query &quot;{searchQuery}&quot;. Try switching blockchains or reset filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedChain('ALL');
                  setActiveFilter('ALL');
                }}
                className="px-4 py-2 rounded-md bg-surface-card hover:bg-surface-3 border border-line text-xs font-mono font-bold text-pump cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredTokens.map(renderAlphaCard)}
            </div>
          )
        ) : (
          /* VIEW MODE B: FULL TRADE CALLS TABLE */
          <div className="rounded-xl bg-surface border border-line overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-card font-sans text-xs text-muted uppercase">
                  <th className="py-3.5 px-4">Token &amp; Chain</th>
                  <th className="py-3.5 px-4">Contract Address (CA)</th>
                  <th className="py-3.5 px-4 text-right">Current MC (Entry)</th>
                  <th className="py-3.5 px-4 text-center">Risk Ratio (Both)</th>
                  <th className="py-3.5 px-4">Take Profit (Multipliers)</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-sans text-sm">
                {filteredTokens.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted font-mono text-xs">
                      No alpha calls match active filters or search query &quot;{searchQuery}&quot;.
                    </td>
                  </tr>
                ) : (
                  filteredTokens.map((token) => {
                    const marketUrl = getPrimaryMarketUrl(token);
                    return (
                      <tr
                        key={token.id}
                        tabIndex={0}
                        role="row"
                        aria-label={`Inspect ${token.name} (${token.ticker})`}
                        onClick={() => setInspectedToken(token)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setInspectedToken(token);
                          }
                        }}
                        className="hover:bg-surface-card transition-colors cursor-pointer focus:outline-none focus:bg-surface-card"
                      >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <TokenArtwork
                            art={token.art}
                            size="sm"
                            chain={token.chain}
                            quoteToken={token.quoteToken}
                          />
                          <div>
                            <div className="flex items-center gap-1.5">
                              {token.pinned && (
                                <Pin className="w-3.5 h-3.5 text-pump shrink-0" />
                              )}
                              <span className="font-bold text-white">{token.name}</span>
                              <span className="font-mono text-xs text-pump font-bold">
                                {token.ticker}
                              </span>
                            </div>
                            <div className="font-mono text-xs text-muted flex items-center gap-2 mt-0.5">
                              <span className="px-1.5 py-0.2 rounded bg-surface-card border border-line text-white font-bold">
                                {token.chain}
                              </span>
                              <span>•</span>
                              <span>{token.age}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">
                        {token.ca && (
                          <button
                            type="button"
                            onClick={(e) =>
                              handleCopyText(
                                token.ca!,
                                `tbl-${token.id}`,
                                token.ticker,
                                e
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-line text-white font-semibold cursor-pointer tnum"
                          >
                            <span>
                              {token.ca.slice(0, 6)}...{token.ca.slice(-4)}
                            </span>
                            {copiedId === `tbl-${token.id}` ? (
                              <Check className="w-3.5 h-3.5 text-pump" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-pump" />
                            )}
                          </button>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tnum">
                        <div className="font-bold text-white text-base">
                          {token.marketCap}
                        </div>
                        <div className="text-xs text-pump">
                          Entry {token.entryMarketCap}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-xs">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card border border-line">
                          <span className="text-white font-bold">
                            Lvl {token.risk}/5
                          </span>
                          <span className="text-dim">•</span>
                          <span className="text-pump font-extrabold">
                            {token.riskRewardRatio}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs">
                        <div className="flex flex-wrap items-center gap-1">
                          {token.takeProfits.map((tp) => (
                            <span
                              key={tp.label}
                              className={`px-2 py-0.5 rounded font-extrabold border ${
                                tp.hit
                                  ? 'bg-pump text-canvas border-pump'
                                  : 'bg-surface-card text-white border-line'
                              }`}
                            >
                              {tp.label}
                              {tp.hit ? ' ✓' : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans text-xs">
                        <div className="inline-flex items-center gap-1.5">
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinCall(token.id, !token.pinned);
                              }}
                              className={`p-1.5 rounded border cursor-pointer ${
                                token.pinned
                                  ? 'bg-pump text-canvas border-pump'
                                  : 'bg-surface-card text-muted border-line'
                              }`}
                              title="Toggle Priority Pin"
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <a
                            href={marketUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-pump hover:bg-pump-hover text-canvas font-extrabold"
                          >
                            <span>Market</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Top Performing Alpha Calls (Clean Full-Width, Top Callers removed) */}
      <div className="rounded-xl bg-surface border border-line p-5 flex flex-col justify-between pt-2">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-line">
              <div>
                <h3 className="font-sans text-lg font-extrabold text-white">
                  Top performing alpha calls
                </h3>
                <p className="font-sans text-xs text-muted">
                  Click any call to inspect Risk Ratio, Take Profit targets, or copy CA
                </p>
              </div>
            </div>

            <div className="divide-y divide-line mt-2">
              {topWinningCoins.map((coin, idx) => {
                const marketUrl = getPrimaryMarketUrl(coin);
                return (
                  <div
                    key={coin.id}
                    onClick={() => setInspectedToken(coin)}
                    className="py-3.5 flex items-center justify-between gap-3 hover:bg-surface-card px-2 rounded cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs text-muted w-4 tnum">
                        {idx + 1}
                      </span>
                      <TokenArtwork
                        art={coin.art}
                        size="sm"
                        chain={coin.chain}
                        quoteToken={coin.quoteToken}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-sans font-bold text-sm text-white truncate">
                            {coin.name}
                          </span>
                          <span className="font-mono text-xs text-pump">
                            {coin.ticker}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-surface-card border border-line font-mono text-[10px] text-white">
                            {coin.chain}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1 font-mono text-xs text-muted">
                          <span className="tnum">
                            MC {coin.marketCap} • {coin.riskRewardRatio} • TP{' '}
                            {coin.takeProfits.map((t) => t.label).join('/')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono tnum shrink-0">
                      <div className="text-sm font-bold text-pump">
                        +{coin.change24hPct.toFixed(0)}%
                      </div>
                      <a
                        href={marketUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs text-pump-pill font-bold hover:text-pump hover:underline mt-1"
                      >
                        <span>Open Market</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      {/* 7. Bottom Utility Bar: Cross-Chain EVM Wallet Binding & Private Syndicate Telegram Key */}
      <div className="rounded-xl bg-surface border border-line p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-7 space-y-1.5">
          <h3 className="font-sans text-base font-extrabold text-white">
            Multi-Chain Wallet Binding &amp; Private Telegram Signal Key
          </h3>
          <p className="font-sans text-sm text-muted leading-relaxed">
            Your Solana wallet (<span className="font-mono text-white">{shortAddress}</span>)
            is verified with{' '}
            <strong className="text-pump">{formattedBalance} $GENESIS</strong>.
            Optionally save a local EVM address for multi-chain notifications or generate
            a simulated Telegram signal key (stored in local browser storage).
          </p>
        </div>

        <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col gap-2.5">
          <form onSubmit={handleSaveEvm} className="flex items-center gap-2">
            <input
              type="text"
              value={evmDraft}
              onChange={(e) => setEvmDraft(e.target.value)}
              placeholder="Bind 0x... wallet for BSC / ETH / BASE / ROBIN / AVAX"
              className="flex-1 h-9 px-3 rounded bg-surface-card border border-line font-mono text-xs text-white placeholder:text-dim focus:outline-none focus:border-pump"
            />
            <button
              type="submit"
              className="h-9 px-3.5 rounded bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-pump cursor-pointer shrink-0"
            >
              {evmSaved ? 'SAVED ✓' : 'BIND 0x'}
            </button>
          </form>

          {tgKey ? (
            <div className="flex items-center justify-between w-full px-3 py-2 rounded bg-surface-card border border-line font-mono text-xs">
              <span className="text-pump font-bold tnum">{tgKey}</span>
              <button
                type="button"
                onClick={(e) => handleCopyText(tgKey, 'tg-key', 'Telegram Key', e)}
                className="text-white hover:text-pump font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                {copiedId === 'tg-key' ? (
                  <Check className="w-3.5 h-3.5 text-pump" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedId === 'tg-key' ? 'COPIED' : 'COPY KEY'}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGenerateTelegramKey}
              className="w-full h-9 rounded bg-surface-card hover:bg-pump hover:text-canvas border border-line font-sans text-xs font-bold text-pump flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Generate Private Syndicate Telegram Key</span>
            </button>
          )}
        </div>
      </div>

      <AlphaInspectorModal
        token={inspectedToken}
        onClose={() => setInspectedToken(null)}
      />
    </div>
  );
};
