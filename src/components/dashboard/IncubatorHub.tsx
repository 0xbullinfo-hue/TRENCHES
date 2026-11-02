'use client';

import React, { useMemo, useState } from 'react';
import type { AlphaItem, Chain } from '@/lib/types';
import { useGenesisBalance } from '@/context/GenesisContext';
import { BUY_LINKS, GENESIS_MINT, GENESIS_MINT_SHORT, SOLSCAN } from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import { AlphaInspectorModal, getPrimaryMarketUrl } from './AlphaInspectorModal';
import {
  ArrowUpRight,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Filter,
  Flame,
  Globe,
  LayoutGrid,
  List,
  Search,
  Send,
  ShieldCheck,
  Star,
  Unlock,
} from 'lucide-react';

type FilterTab =
  | 'ALL'
  | 'MOVERS'
  | 'NEW'
  | 'HOLDER_REWARDS'
  | 'AI_AGENT'
  | 'WATCHLIST';

type SortKey = 'REWARDS' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';

const LIVE_TAPE_EVENTS = [
  { type: 'CA LIVE', ticker: '$PILL', detail: 'SOL • 1M $GENESIS' },
  { type: 'DISPATCH', ticker: '$BATON', detail: 'SOL • 1M $GENESIS' },
  { type: 'REWARD', ticker: '$BTC', detail: '+$281.4K Pool' },
  { type: 'MOVER', ticker: '$SWORDCAT', detail: '+318% (24h)' },
  { type: 'STEALTH', ticker: '$STEALTH', detail: 'BASE • 1M $GENESIS' },
  { type: 'NEW CA', ticker: '$BABYPUMP', detail: 'SOL • 1M $GENESIS' },
  { type: 'NEW CA', ticker: '$BARRON', detail: 'SOL • 1M $GENESIS' },
  { type: 'NEW CA', ticker: '$coge', detail: 'SOL • 1M $GENESIS' },
];

export const IncubatorHub: React.FC = () => {
  const {
    shortAddress,
    formattedBalance,
    alphas,
    callers,
    watchlist,
    toggleWatchlist,
    boundEvmAddress,
    setBoundEvmAddress,
  } = useGenesisBalance();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [selectedChain, setSelectedChain] = useState<Chain | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('REWARDS');
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [leaderboardWindow, setLeaderboardWindow] = useState<'24h' | '7d'>('24h');

  const [inspectedToken, setInspectedToken] = useState<AlphaItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [followedCallers, setFollowedCallers] = useState<string[]>(['@SolLovingFork']);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [evmDraft, setEvmDraft] = useState(boundEvmAddress);
  const [evmSaved, setEvmSaved] = useState(false);
  const [tgKey, setTgKey] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2600);
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
      showToast(`Copied ${label} Contract Address: ${text}`);
    }
    setTimeout(() => setCopiedId(null), 1800);
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

  const unlockedCount = useMemo(
    () => alphas.filter((a) => !a.locked).length,
    [alphas]
  );

  const spotlightTokens = useMemo(
    () =>
      alphas
        .filter((a) => typeof a.spotlightRank === 'number')
        .sort((a, b) => (a.spotlightRank ?? 99) - (b.spotlightRank ?? 99)),
    [alphas]
  );

  const filteredTokens = useMemo(() => {
    return alphas
      .filter((item) => {
        if (selectedChain !== 'ALL' && item.chain !== selectedChain) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = item.name.toLowerCase().includes(q);
          const matchTicker = item.ticker.toLowerCase().includes(q);
          const matchCaller = item.caller.toLowerCase().includes(q);
          const matchCa = item.ca?.toLowerCase().includes(q) ?? false;
          if (!matchName && !matchTicker && !matchCaller && !matchCa) return false;
        }
        switch (activeFilter) {
          case 'MOVERS':
            return item.change24hPct >= 200;
          case 'NEW':
            return item.ageMinutes <= 180;
          case 'HOLDER_REWARDS':
            return item.category === 'HOLDER_REWARDS';
          case 'AI_AGENT':
            return item.category === 'AI_AGENT' || item.category === 'STEALTH';
          case 'WATCHLIST':
            return watchlist.includes(item.id);
          case 'ALL':
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (sortBy === 'REWARDS') return b.holderRewardsRaw - a.holderRewardsRaw;
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

      {/* 1. Top Search, Watchlist & Verified $GENESIS Contract Bar */}
      <div className="rounded-xl bg-surface border border-line overflow-hidden">
        <div className="p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search incubated coins, tickers, callers, or CA..."
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
                  ? 'bg-surface-card text-pump font-bold'
                  : 'hover:text-white'
              }`}
            >
              <Star className="w-3.5 h-3.5 text-amber fill-amber" />
              <span>Watchlist ({watchlist.length})</span>
            </button>

            <span className="text-dim">|</span>

            {watchlist.length === 0 ? (
              <span className="text-xs text-muted">
                Star an alpha coin below to follow it here.
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
            <span className="text-muted">Access Rule:</span>
            <span className="text-pump font-bold">1,000,000 $GENESIS</span>
          </div>
        </div>
      </div>

      {/* 2. Hero Header Banner + 4-Metric KPI Box */}
      <div className="relative rounded-xl border border-line bg-surface p-5 sm:p-6 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-full bg-surface-card border border-line flex items-center justify-center text-pump">
                <Flame className="w-4 h-4" />
              </span>
              <h1 className="font-sans text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                TrenchLabs Alpha Incubator
              </h1>
            </div>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Verified Lab Members holding{' '}
              <span className="text-pump-pill font-bold">1,000,000+ $GENESIS</span> unlock
              all incubated alpha calls. Copy any Contract Address (CA) or open the
              external market link directly to buy on the market.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$GENESIS', e)}
              className="px-4 py-2 rounded-lg bg-surface-card hover:bg-surface-3 border border-line hover:border-white/20 font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
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
              HOLDER REWARDS DISTRIBUTED
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-pump mt-1 tnum">
              $31,477,140
            </div>
            <div className="font-sans text-xs text-muted mt-1">
              Across incubated cohort tokens
            </div>
          </div>

          <div className="p-5">
            <div className="font-sans text-xs text-muted uppercase tracking-wider font-bold">
              INCUBATED MARKET VOL (24H)
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-white mt-1 tnum">
              $26,630,094
            </div>
            <div className="font-sans text-xs text-muted mt-1">
              Across SOL, Base, ETH &amp; BSC
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
              <span className="px-2 py-0.5 rounded bg-surface-card border border-line text-pump font-bold">
                LAB MEMBER (1M+ PASS)
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between font-sans text-xs text-muted uppercase tracking-wider font-bold">
              <span>ALPHA CAs UNLOCKED</span>
              <span className="text-pump font-bold">100%</span>
            </div>
            <div className="font-sans text-2xl sm:text-3xl font-extrabold text-white mt-1 tnum">
              {unlockedCount} <span className="text-muted text-lg">/ {alphas.length}</span>
            </div>
            <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden mt-2 border border-line">
              <div className="h-full bg-pump w-full" />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Live Incubator Dispatch Tape Bar */}
      <div className="px-4 py-2.5 rounded-lg bg-surface border border-line flex items-center gap-3 overflow-x-auto no-scrollbar font-mono text-xs">
        <div className="inline-flex items-center gap-1.5 text-pump font-bold shrink-0 pr-3 border-r border-line">
          <span className="w-2 h-2 rounded-full bg-pump" />
          <span>LIVE DISPATCH</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {LIVE_TAPE_EVENTS.map((ev, i) => (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-card border border-line tnum"
            >
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-card text-pump">
                {ev.type}
              </span>
              <span className="font-bold text-white">{ev.ticker}</span>
              <span className="text-muted">{ev.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 4. "Top Incubated & Paying Coins" — 5-Card Crown Spotlight */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2 className="font-sans text-lg sm:text-xl font-extrabold text-white">
              Top incubated &amp; paying coins
            </h2>
            <p className="font-sans text-sm text-muted">
              Copy verified Contract Addresses (CA) or open external market links directly
              to trade.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {spotlightTokens.map((coin) => {
            const rank = coin.spotlightRank ?? 5;
            const marketUrl = getPrimaryMarketUrl(coin);

            return (
              <div
                key={coin.id}
                onClick={() => setInspectedToken(coin)}
                className="group relative rounded-xl bg-surface border border-line hover:border-white/20 p-4 flex flex-col justify-between transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <TokenArtwork
                      art={coin.art}
                      size="sm"
                      chain={coin.chain}
                      quoteToken={coin.quoteToken}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-sans font-extrabold text-sm text-white truncate">
                          {coin.name}
                        </span>
                        {coin.ca && (
                          <button
                            type="button"
                            onClick={(e) =>
                              handleCopyText(
                                coin.ca!,
                                `spot-${coin.id}`,
                                coin.ticker,
                                e
                              )
                            }
                            className="text-muted hover:text-pump cursor-pointer"
                            title={`Copy CA: ${coin.ca}`}
                          >
                            {copiedId === `spot-${coin.id}` ? (
                              <Check className="w-3.5 h-3.5 text-pump" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="font-mono text-xs text-pump-pill flex items-center gap-1.5 mt-0.5">
                        <span>{coin.age}</span>
                        <Globe className="w-3 h-3 text-muted" />
                      </div>
                    </div>
                  </div>

                  <div
                    className={`inline-flex items-center gap-1 font-mono text-xs font-bold shrink-0 ${
                      rank === 1
                        ? 'text-pump'
                        : rank <= 3
                        ? 'text-pump-pill'
                        : 'text-muted'
                    }`}
                  >
                    {rank <= 3 && <Crown className="w-3.5 h-3.5" />}
                    <span>{rank}</span>
                  </div>
                </div>

                <div className="my-4">
                  <div className="font-sans text-[11px] text-muted font-semibold uppercase tracking-wider">
                    HOLDER REWARDS
                  </div>
                  <div className="font-sans text-xl sm:text-2xl font-extrabold text-pump tnum mt-0.5">
                    {coin.holderRewardsUsd}
                  </div>
                  <div className="font-sans text-xs text-muted mt-0.5 tnum">
                    Market cap <strong className="text-white">{coin.marketCap}</strong>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-line flex items-center justify-between gap-1.5 font-sans text-xs">
                  <button
                    type="button"
                    onClick={(e) =>
                      handleCopyText(
                        coin.ca || '',
                        `spot-btn-${coin.id}`,
                        coin.ticker,
                        e
                      )
                    }
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-line text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedId === `spot-btn-${coin.id}` ? (
                      <Check className="w-3 h-3 text-pump" />
                    ) : (
                      <Copy className="w-3 h-3 text-pump" />
                    )}
                    <span>{copiedId === `spot-btn-${coin.id}` ? 'COPIED' : 'COPY CA'}</span>
                  </button>

                  <a
                    href={marketUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-pump hover:text-canvas border border-line text-pump font-bold inline-flex items-center gap-1 transition-colors"
                  >
                    <span>MARKET</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. "Explore Incubated Alpha Coins" */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="font-sans text-lg sm:text-xl font-extrabold text-white">
            Explore incubated alpha coins
          </h2>
          <div className="font-sans text-xs text-muted">
            Showing <strong className="text-pump">{filteredTokens.length}</strong> curated
            coins • Copy CA or open external market to buy
          </div>
        </div>

        {/* Filter Pills + Chain Filter + Sort + Grid/Table Toggle */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-2 border-b border-line">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 xl:pb-0">
            {(
              [
                { id: 'ALL', label: '🚀 All Alpha' },
                { id: 'MOVERS', label: '🔥 Movers' },
                { id: 'NEW', label: '✨ New' },
                { id: 'HOLDER_REWARDS', label: '💎 Holder Rewards' },
                { id: 'AI_AGENT', label: '🤖 AI & Stealth' },
                { id: 'WATCHLIST', label: `⭐ Watchlist (${watchlist.length})` },
              ] as { id: FilterTab; label: string }[]
            ).map((tab) => {
              const active = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-3.5 py-1.5 rounded-full font-sans text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    active
                      ? 'bg-pump text-canvas'
                      : 'bg-surface hover:bg-surface-card text-muted hover:text-white border border-line'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center bg-surface border border-line rounded-md p-0.5 font-mono text-xs">
              {(['ALL', 'SOL', 'BASE', 'ETH', 'BSC'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setSelectedChain(ch)}
                  className={`px-2.5 py-1 rounded font-bold cursor-pointer ${
                    selectedChain === ch
                      ? 'bg-pump text-canvas'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {ch}
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
                <option value="REWARDS" className="bg-surface">
                  Sort: Holder rewards
                </option>
                <option value="MCAP" className="bg-surface">
                  Sort: Market cap
                </option>
                <option value="CHANGE" className="bg-surface">
                  Sort: 24h Gain
                </option>
                <option value="NEWEST" className="bg-surface">
                  Sort: Newest
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
                <span>Grid</span>
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

        {/* VIEW MODE A: RICH VISUAL TOKEN CARD GRID */}
        {viewMode === 'GRID' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {filteredTokens.map((token) => {
              const isStarred = watchlist.includes(token.id);
              const marketUrl = getPrimaryMarketUrl(token);

              return (
                <article
                  key={token.id}
                  onClick={() => setInspectedToken(token)}
                  className="group flex flex-col justify-between rounded-xl bg-surface border border-line hover:border-white/20 transition-all cursor-pointer overflow-hidden p-3"
                >
                  <div>
                    <div className="relative">
                      <TokenArtwork
                        art={token.art}
                        sparkline={token.sparkline}
                        chain={token.chain}
                        quoteToken={token.quoteToken}
                        locked={token.locked}
                      />

                      <div className="absolute top-2 left-2 z-10">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-canvas/90 border border-line font-sans text-[10px] font-bold text-pump">
                          <Unlock className="w-2.5 h-2.5" />
                          <span>UNLOCKED</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatchlist(token.id);
                        }}
                        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-canvas/85 hover:bg-canvas border border-line flex items-center justify-center cursor-pointer"
                        title="Toggle Watchlist"
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            isStarred ? 'text-amber fill-amber' : 'text-muted'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="pt-3 space-y-1">
                      <div className="flex items-baseline justify-between gap-1">
                        <h3 className="font-sans font-extrabold text-sm text-white truncate">
                          {token.name}
                        </h3>
                        <span className="font-mono text-xs font-bold text-pump shrink-0 tnum">
                          +{token.change24hPct.toFixed(0)}%
                        </span>
                      </div>

                      <div className="font-mono text-xs text-pump-pill truncate">
                        {token.ticker}
                      </div>

                      <div className="flex items-baseline justify-between pt-0.5">
                        <div className="font-sans text-base font-extrabold text-white tnum">
                          {token.marketCap}{' '}
                          <span className="font-normal text-xs text-muted">MC</span>
                        </div>
                        <div className="font-mono text-[11px] text-pump tnum">
                          Pool {token.holderRewardsUsd}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 pt-1 font-sans text-xs">
                        <span className="w-4 h-4 rounded-full bg-surface-card border border-line flex items-center justify-center text-[9px] text-pump font-bold">
                          {token.caller.slice(1, 2).toUpperCase()}
                        </span>
                        <span className="text-muted truncate">
                          {token.caller.slice(1)}
                        </span>
                        <span className="text-pump-pill font-semibold shrink-0">
                          🌱 {token.age}
                        </span>
                      </div>

                      <p className="font-sans text-xs text-muted line-clamp-2 leading-relaxed pt-1">
                        {token.summary}
                      </p>
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
        ) : (
          /* VIEW MODE B: RANKED HOLDER REWARDS TABLE */
          <div className="rounded-xl bg-surface border border-line overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-card font-sans text-xs text-muted uppercase">
                  <th className="py-3.5 px-4 w-10">#</th>
                  <th className="py-3.5 px-4">Token</th>
                  <th className="py-3.5 px-4">Contract Address (CA)</th>
                  <th className="py-3.5 px-4 text-right text-pump">Holder rewards ↓</th>
                  <th className="py-3.5 px-4 text-right">Market cap</th>
                  <th className="py-3.5 px-4 text-right">External Market</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-sans text-sm">
                {filteredTokens.map((token, idx) => {
                  const marketUrl = getPrimaryMarketUrl(token);
                  return (
                    <tr
                      key={token.id}
                      onClick={() => setInspectedToken(token)}
                      className="hover:bg-surface-card transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4 font-mono text-xs text-muted tnum">
                        {idx + 1}
                      </td>
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
                              <span className="font-bold text-white">{token.name}</span>
                              <span className="font-mono text-xs text-pump-pill">
                                {token.ticker}
                              </span>
                            </div>
                            <div className="font-mono text-xs text-muted flex items-center gap-2 mt-0.5">
                              <span className="text-pump">{token.age}</span>
                              <span>•</span>
                              <span className="text-white font-semibold">
                                {token.quoteToken}
                              </span>
                              <span>•</span>
                              <span>{token.caller}</span>
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
                        <div className="font-bold text-pump text-base">
                          {token.holderRewardsUsd}
                        </div>
                        <div className="text-xs text-muted">
                          {token.holderRewardsQuote}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white tnum">
                        {token.marketCap}
                      </td>
                      <td className="py-3.5 px-4 text-right font-sans text-xs">
                        <a
                          href={marketUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-pump hover:bg-pump-hover text-canvas font-extrabold"
                        >
                          <span>Open Market</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. Split Panels: "Top Syndicate Callers" & "Top Winning Incubated Coins" */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
        <div className="lg:col-span-6 rounded-xl bg-surface border border-line p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-4 border-b border-line">
              <div>
                <h3 className="font-sans text-lg font-extrabold text-white">
                  Top syndicate callers
                </h3>
                <p className="font-sans text-xs text-muted">
                  Private investor group leads feeding curated launches to Lab members
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
                  Top winning incubated coins
                </h3>
                <p className="font-sans text-xs text-muted">
                  Click any coin to copy its CA or open its external market
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
                          <span className="font-mono text-xs text-pump-pill">
                            {coin.ticker}
                          </span>
                          {coin.ca && (
                            <button
                              type="button"
                              onClick={(e) =>
                                handleCopyText(
                                  coin.ca!,
                                  `win-${coin.id}`,
                                  coin.ticker,
                                  e
                                )
                              }
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-card border border-line font-mono text-[10px] text-pump"
                            >
                              {copiedId === `win-${coin.id}` ? (
                                <Check className="w-2.5 h-2.5" />
                              ) : (
                                <Copy className="w-2.5 h-2.5" />
                              )}
                              <span>
                                {coin.ca.slice(0, 4)}..{coin.ca.slice(-4)}
                              </span>
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 font-sans text-xs text-muted">
                          <span className="tnum">
                            Vol {coin.volume24h} • MC {coin.marketCap}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono tnum shrink-0">
                      <div className="text-sm font-bold text-pump">
                        {coin.netInflow24h}
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
            Optionally bind an EVM address for Base/ETH/BSC whitelists and generate your
            private Telegram key.
          </p>
        </div>

        <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col gap-2.5">
          <form onSubmit={handleSaveEvm} className="flex items-center gap-2">
            <input
              type="text"
              value={evmDraft}
              onChange={(e) => setEvmDraft(e.target.value)}
              placeholder="Bind 0x... wallet for Base / ETH / BSC whitelists"
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
