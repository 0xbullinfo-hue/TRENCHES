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
} from 'lucide-react';

type FilterTab = 'ALL' | 'PINNED' | 'MOVERS' | 'NEW' | 'WATCHLIST';
type SortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';

const ALL_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

export const IncubatorHub: React.FC = () => {
  const {
    shortAddress,
    formattedBalance,
    isAdmin,
    demoPreset,
    setDemoPreset,
    alphas,
    callers,
    watchlist,
    toggleWatchlist,
    boundEvmAddress,
    setBoundEvmAddress,
    createAlphaCall,
    togglePinCall,
    toggleTpHit,
    deleteAlphaCall,
    apiLoading,
    apiError,
    refreshAll,
  } = useGenesisBalance();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [selectedChain, setSelectedChain] = useState<Chain | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('PRIORITY');
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [leaderboardWindow, setLeaderboardWindow] = useState<'24h' | '7d'>('24h');

  const [inspectedToken, setInspectedToken] = useState<AlphaItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [followedCallers, setFollowedCallers] = useState<string[]>(['@TrenchLabsAdmin']);
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
  const [fetchingDex, setFetchingDex] = useState(false);
  const [submittingCall, setSubmittingCall] = useState(false);

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
    });
    setSubmittingCall(false);
    if (ok) {
      showToast(
        `Posted ${formTicker.toUpperCase()} (${formChain})${
          formPinned ? ' as PINNED PRIORITY CALL' : ''
        }`
      );
      setFormCa('');
      setFormName('');
      setFormTicker('');
      setFormSummary('');
    } else {
      showToast('Failed to post call — ensure Admin Wallet is active.');
    }
  };

  const toggleFollowCaller = (handle: string) => {
    setFollowedCallers((prev) =>
      prev.includes(handle) ? prev.filter((h) => h !== handle) : [...prev, handle]
    );
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

  return (
    <div className="space-y-6 pb-10">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg bg-surface border border-pump text-white font-sans text-xs font-semibold flex items-center gap-2.5">
          <Check className="w-4 h-4 text-pump shrink-0" />
          <span className="truncate max-w-md">{toastMessage}</span>
        </div>
      )}

      {/* 0. Trade-At-Your-Own-Risk Disclaimer & Admin Mode Switcher Bar */}
      <div className="rounded-xl bg-surface border border-line px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 font-sans text-xs text-muted">
          <AlertTriangle className="w-4 h-4 text-pump shrink-0" />
          <span>
            <strong className="text-white uppercase">ALPHA CALLS DISCLAIMER:</strong> Admin
            posts trade calls for verified{' '}
            <strong className="text-pump">1,000,000+ $GENESIS</strong> holders. Users take
            all trades at their own risk (DYOR).
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 font-mono text-xs">
          <span className="text-muted">Admin Wallet:</span>
          <span className="px-2 py-0.5 rounded bg-surface-card border border-line text-white">
            {ADMIN_WALLET_SHORT}
          </span>
          <button
            type="button"
            onClick={() => setDemoPreset(isAdmin ? '1m' : 'admin')}
            className={`px-3 py-1 rounded border font-sans text-xs font-extrabold cursor-pointer transition-colors ${
              isAdmin
                ? 'bg-pump text-canvas border-pump'
                : 'bg-surface-card hover:bg-surface-3 text-pump border-line'
            }`}
            title={`Simulate Master Admin Wallet (${ADMIN_WALLET})`}
          >
            {isAdmin ? 'ADMIN MODE ACTIVE ✓' : 'Preview Admin Desk'}
          </button>
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
              className="px-3 py-1 rounded bg-surface border border-line hover:border-pump font-sans text-xs font-bold text-pump cursor-pointer"
            >
              {showAdminForm ? 'Hide Post Form' : '+ Post New Alpha Call'}
            </button>
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

      {/* 2. Top Search, Watchlist & Verified $GENESIS Contract Bar */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        <div className="p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search calls by token name, ticker, chain (SOL, ROBIN, BSC...), or CA..."
              className="w-full h-9 pl-9 pr-10 rounded-md bg-surface-card border border-line focus:border-pump text-xs text-white placeholder:text-dim focus:outline-none font-sans"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-surface-card text-[10px] font-mono text-pump">
              ⌘K
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-card border border-line font-mono text-xs">
              <ShieldCheck className="w-4 h-4 text-pump shrink-0" />
              <span className="text-muted hidden sm:inline">GATE TOKEN:</span>
              <span className="text-white font-bold">$GENESIS</span>
              <span className="text-pump tnum">({GENESIS_MINT_SHORT})</span>
              <button
                type="button"
                onClick={(e) => handleCopyText(GENESIS_MINT, 'header-mint', '$GENESIS', e)}
                className="text-muted hover:text-pump cursor-pointer"
                title={`Copy $GENESIS Mint: ${GENESIS_MINT}`}
              >
                {copiedId === 'header-mint' ? (
                  <Check className="w-3.5 h-3.5 text-pump" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <a
                href={SOLSCAN.token(GENESIS_MINT)}
                target="_blank"
                rel="noreferrer"
                className="text-muted hover:text-pump"
                title="View $GENESIS on Solscan"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 bg-surface-card flex items-center justify-between gap-2 font-sans text-xs text-muted">
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() =>
                setActiveFilter(activeFilter === 'WATCHLIST' ? 'ALL' : 'WATCHLIST')
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded transition-colors cursor-pointer ${
                activeFilter === 'WATCHLIST'
                  ? 'bg-surface text-pump font-bold border border-line'
                  : 'hover:text-white'
              }`}
            >
              <Star className="w-3.5 h-3.5 text-amber fill-amber" />
              <span>Watchlist ({watchlist.length})</span>
            </button>

            <span className="text-dim">|</span>

            {watchlist.length === 0 ? (
              <span className="text-xs text-muted">
                Star any trade call below to pin it to your personal watchlist.
              </span>
            ) : (
              <div className="flex items-center gap-2">
                {alphas
                  .filter((a) => watchlist.includes(a.id))
                  .map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setInspectedToken(w)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-surface hover:bg-surface-3 border border-line text-xs font-mono text-white cursor-pointer"
                    >
                      <span className="font-bold">{w.ticker}</span>
                      <span className="text-pump">{w.marketCap}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="hidden lg:flex items-center gap-2 font-sans text-xs shrink-0">
            <span className="text-muted">Access Gate:</span>
            <span className="text-pump font-bold">1,000,000 $GENESIS</span>
          </div>
        </div>
      </div>

      {/* 3. Hero Header Banner + 4-Metric KPI Box */}
      <div className="relative rounded-xl border border-line bg-surface p-5 sm:p-6 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-surface-card border border-line flex items-center justify-center text-pump">
                <Flame className="w-4 h-4" />
              </span>
              <h1 className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                TrenchLabs Alpha Trade Calls Hub
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

        {/* 4-Column KPI Stat Box */}
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

          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              SUPPORTED BLOCKCHAINS
            </div>
            <div className="font-mono text-lg sm:text-xl font-extrabold text-white mt-1.5">
              SOL • BSC • ETH • BASE • ROBIN • AVAX
            </div>
            <div className="font-sans text-xs text-pump mt-1">
              Includes Robinhood Chain (ROBIN)
            </div>
          </div>

          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              YOUR VERIFIED $GENESIS
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-pump mt-1 tnum">
              {formattedBalance}
            </div>
            <div className="font-sans text-xs text-white mt-1 flex items-center gap-1.5">
              <span className="px-2 py-0.5 rounded bg-surface border border-line text-pump font-bold">
                {isAdmin ? 'MASTER ADMIN (FULL ACCESS)' : 'LAB MEMBER (1M+ PASS)'}
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

      {/* 4. PINNED PRIORITY CALLS SECTION (Admin-Pinned Calls for All Users) */}
      {pinnedCalls.length > 0 && (
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pinnedCalls.map((coin) => {
              const marketUrl = getPrimaryMarketUrl(coin);
              const chainMeta = CHAIN_METADATA[coin.chain] || CHAIN_METADATA.SOL;

              return (
                <div
                  key={`pinned-${coin.id}`}
                  onClick={() => setInspectedToken(coin)}
                  className="group relative rounded-xl bg-surface border-2 border-pump p-4 flex flex-col justify-between cursor-pointer"
                >
                  <div>
                    {/* Top Row: Pin Badge + Chain Badge + Admin Unpin */}
                    <div className="flex items-center justify-between gap-2 pb-3 border-b border-line">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-pump text-canvas font-mono text-[10px] font-black uppercase">
                          <Pin className="w-2.5 h-2.5" />
                          <span>PRIORITY PIN</span>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-surface-card border border-line font-mono text-[10px] font-bold text-pump">
                          {coin.chain === 'ROBIN' ? 'ROBIN (Robinhood)' : coin.chain}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-muted">{coin.age}</span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinCall(coin.id, false);
                              showToast(`Unpinned ${coin.ticker}`);
                            }}
                            className="px-2 py-0.5 rounded bg-surface-card hover:bg-surface-3 border border-line text-[10px] font-mono text-muted hover:text-white cursor-pointer"
                            title="Unpin Priority Call"
                          >
                            UNPIN
                          </button>
                        )}
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
                      <span className="text-white truncate tnum">{coin.ca}</span>
                      <button
                        type="button"
                        onClick={(e) =>
                          handleCopyText(
                            coin.ca || '',
                            `pin-ca-${coin.id}`,
                            coin.ticker,
                            e
                          )
                        }
                        className="text-pump hover:text-white font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        {copiedId === `pin-ca-${coin.id}` ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span className="text-[11px]">
                          {copiedId === `pin-ca-${coin.id}` ? 'COPIED' : 'COPY'}
                        </span>
                      </button>
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

                  {/* Card Footer */}
                  <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-2 font-sans text-xs">
                    <button
                      type="button"
                      onClick={(e) =>
                        handleCopyText(
                          coin.ca || '',
                          `pin-btn-${coin.id}`,
                          coin.ticker,
                          e
                        )
                      }
                      className="flex-1 py-1.5 px-3 rounded bg-surface-card hover:bg-surface-3 border border-line text-white font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copiedId === `pin-btn-${coin.id}` ? (
                        <Check className="w-3.5 h-3.5 text-pump" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-pump" />
                      )}
                      <span>
                        {copiedId === `pin-btn-${coin.id}` ? 'COPIED CA' : 'COPY CA'}
                      </span>
                    </button>

                    <a
                      href={marketUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="py-1.5 px-3.5 rounded bg-pump hover:bg-pump-hover text-canvas font-extrabold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <span>TRADE ON MARKET</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
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

        {/* VIEW MODE A: TRADE CALL CARDS GRID */}
        {viewMode === 'GRID' ? (
          apiLoading && alphas.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="rounded-xl bg-surface border border-line p-4 space-y-3 animate-pulse"
                >
                  <div className="w-full aspect-square bg-surface-card rounded-md" />
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTokens.map((token) => {
                const isStarred = watchlist.includes(token.id);
                const marketUrl = getPrimaryMarketUrl(token);

                return (
                  <article
                    key={token.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect ${token.name} (${token.ticker}) call`}
                    onClick={() => setInspectedToken(token)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setInspectedToken(token);
                      }
                    }}
                    className={`group flex flex-col justify-between rounded-xl bg-surface border transition-all cursor-pointer overflow-hidden p-4 focus:outline-none focus:border-pump ${
                      token.pinned ? 'border-pump' : 'border-line hover:border-pump'
                    }`}
                  >
                  <div className="space-y-3">
                    {/* Artwork + Top Overlays */}
                    <div className="relative">
                      <TokenArtwork
                        art={token.art}
                        sparkline={token.sparkline}
                        chain={token.chain}
                        quoteToken={token.quoteToken}
                        locked={token.locked}
                      />

                      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
                        {token.pinned ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-pump text-canvas font-mono text-[10px] font-black uppercase">
                            <Pin className="w-2.5 h-2.5" />
                            <span>PINNED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-canvas border border-line font-sans text-[10px] font-bold text-pump">
                            <Unlock className="w-2.5 h-2.5" />
                            <span>UNLOCKED</span>
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-canvas border border-line font-mono text-[10px] font-bold text-white">
                          {token.chain}
                        </span>
                      </div>

                      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePinCall(token.id, !token.pinned);
                              showToast(
                                `${token.pinned ? 'Unpinned' : 'Pinned'} ${token.ticker}`
                              );
                            }}
                            className={`w-6 h-6 rounded bg-canvas border flex items-center justify-center cursor-pointer ${
                              token.pinned
                                ? 'border-pump text-pump'
                                : 'border-line text-muted hover:text-white'
                            }`}
                            title={token.pinned ? 'Unpin Call' : 'Pin Call as Priority'}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAlphaCall(token.id);
                              showToast(`Deleted call ${token.ticker}`);
                            }}
                            className="w-6 h-6 rounded bg-canvas border border-line hover:border-danger text-muted hover:text-danger flex items-center justify-center cursor-pointer"
                            title="Delete Call"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatchlist(token.id);
                          }}
                          className="w-6 h-6 rounded bg-canvas border border-line flex items-center justify-center cursor-pointer"
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

                    {/* 1. Token Name, Ticker & Age */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-sans font-extrabold text-base text-white truncate">
                          {token.name}
                        </h3>
                        <div className="font-mono text-xs text-pump font-bold flex items-center gap-1.5">
                          <span>{token.ticker}</span>
                          <span className="text-dim">•</span>
                          <span className="text-muted font-normal">{token.age}</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-surface-card border border-line font-mono text-xs font-bold text-pump shrink-0 tnum">
                        +{token.change24hPct.toFixed(0)}%
                      </span>
                    </div>

                    {/* 2. Contract Address (CA) Box */}
                    <div className="px-2.5 py-1.5 rounded bg-surface-card border border-line flex items-center justify-between gap-2 font-mono text-xs">
                      <span className="text-muted text-[10px] uppercase shrink-0">CA</span>
                      <span className="text-white truncate tnum">
                        {token.ca
                          ? `${token.ca.slice(0, 8)}...${token.ca.slice(-6)}`
                          : 'Locked'}
                      </span>
                      {token.ca && (
                        <button
                          type="button"
                          onClick={(e) =>
                            handleCopyText(
                              token.ca!,
                              `card-ca-${token.id}`,
                              token.ticker,
                              e
                            )
                          }
                          className="text-pump hover:text-white font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                          title={`Copy CA: ${token.ca}`}
                        >
                          {copiedId === `card-ca-${token.id}` ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span className="text-[10px]">
                            {copiedId === `card-ca-${token.id}` ? 'COPIED' : 'COPY'}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* 3. Current Market Cap + Entry Market Cap */}
                    <div className="p-2.5 rounded bg-surface-card border border-line flex items-center justify-between font-mono">
                      <div>
                        <div className="text-[10px] text-muted uppercase">
                          CURRENT MARKET CAP
                        </div>
                        <div className="text-base font-extrabold text-white tnum">
                          {token.marketCap}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted uppercase">ENTRY MC</div>
                        <div className="text-xs font-bold text-pump tnum">
                          {token.entryMarketCap}
                        </div>
                      </div>
                    </div>

                    {/* 4. Risk Ratio (Both: Risk Level 1-5 + R:R Ratio) */}
                    <div className="p-2.5 rounded bg-surface-card border border-line space-y-1.5 font-mono">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-muted uppercase font-sans font-bold">
                          RISK RATIO
                        </span>
                        <span className="text-amber font-bold">{token.stopLoss}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">
                          Risk {token.risk}/5
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-surface border border-line text-pump font-extrabold text-[11px]">
                          {token.riskRewardRatio}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <span
                            key={lvl}
                            className={`h-1 flex-1 rounded-sm ${
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

                    {/* 5. Take Profit Multipliers (2x / 5x / 10x) */}
                    <div className="p-2.5 rounded bg-surface-card border border-line space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-sans font-bold text-muted uppercase">
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3 text-pump" />
                          <span>TAKE PROFIT MULTIPLIERS</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 font-mono">
                        {token.takeProfits.map((tp, idx) => (
                          <button
                            key={tp.label}
                            type="button"
                            onClick={(e) => {
                              if (isAdmin) {
                                e.stopPropagation();
                                toggleTpHit(token.id, idx);
                              }
                            }}
                            className={`px-2 py-0.5 rounded text-xs font-extrabold border inline-flex items-center gap-1 ${
                              tp.hit
                                ? 'bg-pump text-canvas border-pump'
                                : 'bg-surface text-white border-line'
                            } ${isAdmin ? 'cursor-pointer hover:border-pump' : ''}`}
                            title={
                              tp.targetMc ? `Target MC: ${tp.targetMc}` : tp.label
                            }
                          >
                            <span>{tp.label}</span>
                            {tp.hit && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Card Footer: Copy CA or Open Market Link */}
                  <div className="mt-3 pt-2.5 border-t border-line flex items-center justify-between gap-1.5 font-sans text-xs">
                    <button
                      type="button"
                      onClick={(e) =>
                        handleCopyText(
                          token.ca || '',
                          `grid-${token.id}`,
                          token.ticker,
                          e
                        )
                      }
                      className="flex-1 py-1.5 px-2 rounded bg-surface-card hover:bg-surface-3 border border-line text-white font-bold inline-flex items-center justify-center gap-1 truncate cursor-pointer"
                      title={`Copy CA: ${token.ca}`}
                    >
                      {copiedId === `grid-${token.id}` ? (
                        <Check className="w-3 h-3 text-pump shrink-0" />
                      ) : (
                        <Copy className="w-3 h-3 text-pump shrink-0" />
                      )}
                      <span>
                        {copiedId === `grid-${token.id}` ? 'COPIED' : 'COPY CA'}
                      </span>
                    </button>

                    <a
                      href={marketUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="py-1.5 px-2.5 rounded bg-pump hover:bg-pump-hover text-canvas font-extrabold inline-flex items-center gap-1 shrink-0 transition-colors"
                      title={`Open ${token.ticker} on Market`}
                    >
                      <span>MARKET</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </article>
              );
            })}
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

      {/* 6. Split Panels: "Top Syndicate Callers" & "Top Performing Calls" */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
        <div className="lg:col-span-6 rounded-xl bg-surface border border-line p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-line">
              <div>
                <h3 className="font-sans text-lg font-extrabold text-white">
                  Top syndicate callers
                </h3>
                <p className="font-sans text-xs text-muted">
                  Verified callers feeding curated multi-chain setups to Lab members
                </p>
              </div>

              <div className="flex items-center gap-1 bg-surface-card border border-line rounded-md p-0.5 font-mono text-xs">
                {(['24h', '7d'] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setLeaderboardWindow(w)}
                    className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                      leaderboardWindow === w
                        ? 'bg-pump text-canvas'
                        : 'text-muted hover:text-white'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-line mt-2">
              {callers.map((caller) => {
                const isFollowing = followedCallers.includes(caller.handle);
                return (
                  <div
                    key={caller.handle}
                    className="py-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-xs text-muted w-4 tnum">
                        {caller.rank}
                      </span>
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center font-mono text-xs font-bold text-white border border-line shrink-0"
                        style={{ backgroundColor: caller.avatarBg }}
                      >
                        {caller.avatarText}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-sans font-bold text-sm text-white truncate">
                            {caller.handle}
                          </span>
                          <span className="font-mono text-xs text-pump-pill">
                            {caller.winRate}
                          </span>
                        </div>
                        <div className="font-sans text-xs text-muted mt-0.5">
                          Top call:{' '}
                          <strong className="text-pump">
                            {caller.topCallTicker}
                          </strong>{' '}
                          ({caller.callsCount} dispatches)
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right font-mono tnum">
                        <div className="text-sm font-bold text-pump">
                          {caller.pnl24h}
                        </div>
                        <div className="text-xs text-muted">{caller.pnl7d}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleFollowCaller(caller.handle)}
                        className={`px-3 py-1.5 rounded-full font-sans text-xs font-semibold border transition-colors cursor-pointer ${
                          isFollowing
                            ? 'bg-surface-card border-line text-pump'
                            : 'bg-surface-card hover:bg-surface-3 border-line text-white'
                        }`}
                      >
                        {isFollowing ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl bg-surface border border-line p-5 flex flex-col justify-between">
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
