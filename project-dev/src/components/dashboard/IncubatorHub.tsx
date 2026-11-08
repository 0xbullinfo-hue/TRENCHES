'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlphaItem, Chain, Campaign } from '@/lib/types';
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
import { AlphaCallCard } from './AlphaCallCard';
import { SinceCallChip } from './SinceCallChip';
import { TelegramAlerts } from './TelegramAlerts';
import { TelegramConnectButton } from '@/components/telegram/TelegramConnectButton';
import {
  DashboardStakingCard,
  TelegramVerificationCard,
} from '@/components/stake/DashboardStakingCard';
import { LockedTerminal } from '@/components/LockedTerminal';
import { AlphaInspectorModal, getPrimaryMarketUrl } from './AlphaInspectorModal';
import { CampaignSection } from '@/components/campaigns/CampaignSection';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import { AdminCampaignManager } from '@/components/admin/AdminCampaignManager';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Filter,
  Flame,
  LayoutGrid,
  List,
  Pencil,
  Pin,
  Plus,
  Radio,
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

type FilterTab = 'ALL' | 'PINNED' | 'MAX_ALPHA' | 'MOVERS' | 'NEW' | 'WATCHLIST';
type SortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';

const ALL_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

export const IncubatorHub: React.FC = () => {
  const {
    connected,
    isUnlocked,
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
    updateAlphaCall,
    togglePinCall,
    toggleMaxAlpha,
    toggleTpHit,
    deleteAlphaCall,
    setCallOutcome,
    getAdminHeaders,
    verifiedUsersCount,
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
  const [adminDeskTab, setAdminDeskTab] = useState<'CALLS' | 'CAMPAIGNS'>('CALLS');
  const [feedTab, setFeedTab] = useState<'CALLS' | 'RAIDS'>('CALLS');

  // Community Campaigns State
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  const [inspectedToken, setInspectedToken] = useState<AlphaItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Admin Create/Edit Call Form State
  const [showAdminForm, setShowAdminForm] = useState<boolean>(true);
  const [editingCall, setEditingCall] = useState<AlphaItem | null>(null);
  const [formCa, setFormCa] = useState('');
  const [formName, setFormName] = useState('');
  const [formTicker, setFormTicker] = useState('');
  const [formLogoUrl, setFormLogoUrl] = useState('');
  const [formChain, setFormChain] = useState<Chain>('SOL');
  const [formCurrentMc, setFormCurrentMc] = useState('$250K');
  const [formEntryMc, setFormEntryMc] = useState('$250K');
  const [formRiskLevel, setFormRiskLevel] = useState<number>(3);
  const [formStopLoss, setFormStopLoss] = useState('-25% SL');
  const [formTakeProfits, setFormTakeProfits] = useState('2x, 5x, 10x');
  const [formPinned, setFormPinned] = useState(true);
  const [formMaxAlpha, setFormMaxAlpha] = useState(false);
  const [formSummary, setFormSummary] = useState('');
  const [formSerialTag, setFormSerialTag] = useState('');
  const [fetchingDex, setFetchingDex] = useState(false);
  const [submittingCall, setSubmittingCall] = useState(false);

  const deskWinRate = useMemo(() => {
    const n = alphas.length;
    if (n < 5) return { label: '—', pct: 0 };
    const wins = alphas.filter((a) => a.outcome === 'PROFIT').length;
    const pct = (wins / n) * 100;
    return { label: `${pct.toFixed(0)}% (${wins}/${n})`, pct: Math.round(pct) };
  }, [alphas]);

  const nextSerialTag = `EXP${String(alphas.length + 1).padStart(2, '0')}`;

  const [evmDraft, setEvmDraft] = useState(boundEvmAddress);
  const [evmSaved, setEvmSaved] = useState(false);

  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const evmTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      if (evmTimeoutRef.current) clearTimeout(evmTimeoutRef.current);
    };
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 2800);
  };

  const fetchCampaigns = useCallback(async () => {
    try {
      const url = publicKeyBase58
        ? `/api/campaigns?wallet=${encodeURIComponent(publicKeyBase58)}`
        : '/api/campaigns';
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.ok && Array.isArray(json.campaigns)) {
        setCampaigns(json.campaigns);
      }
    } catch (err) {
      console.error('[IncubatorHub] fetch campaigns error:', err);
    } finally {
      setCampaignsLoading(false);
    }
  }, [publicKeyBase58]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const url = publicKeyBase58
          ? `/api/campaigns?wallet=${encodeURIComponent(publicKeyBase58)}`
          : '/api/campaigns';
        const res = await fetch(url);
        const json = await res.json();
        if (active && res.ok && json.ok && Array.isArray(json.campaigns)) {
          setCampaigns(json.campaigns);
        }
      } catch (err) {
        console.error('[IncubatorHub] fetch campaigns error:', err);
      } finally {
        if (active) setCampaignsLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [publicKeyBase58]);

  const handleTogglePinCampaign = async (campaignId: string, pinned: boolean) => {
    try {
      const bodyStr = JSON.stringify({ pinned });
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (getAdminHeaders) {
        try {
          headers = await getAdminHeaders('PATCH', `/api/campaigns/${campaignId}`, bodyStr);
        } catch {
          // fallback
        }
      }
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers,
        body: bodyStr,
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        showToast(`${pinned ? 'Pinned' : 'Unpinned'} raid campaign priority`);
        fetchCampaigns();
      }
    } catch (err) {
      showToast(`Failed to update pin: ${(err as Error).message}`);
    }
  };

  const handleCopyText = async (
    text: string,
    id: string,
    label?: string,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      if (label) {
        showToast(`Copied ${label} CA: ${text}`);
      }
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 1800);
    } catch {
      showToast('Failed to copy to clipboard. Please select and copy manually.');
    }
  };

  const handleAutoFillDexScreener = async (customCa?: string) => {
    const cleanCa = (typeof customCa === 'string' ? customCa : formCa).trim();
    if (!cleanCa) {
      if (!customCa) showToast('Paste a Contract Address (CA) first to auto-fill.');
      return;
    }
    setFetchingDex(true);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(cleanCa)}`
      );
      if (!res.ok) {
        if (!customCa) {
          if (res.status === 429) {
            showToast('DexScreener rate limit reached (HTTP 429). Please retry in a few seconds.');
          } else {
            showToast(`DexScreener request failed (HTTP ${res.status}). Enter details manually.`);
          }
        }
        return;
      }
      const data = await res.json();
      const pair = data?.pairs?.[0];
      if (pair) {
        if (pair.baseToken?.name) setFormName(pair.baseToken.name);
        if (pair.baseToken?.symbol) setFormTicker(`$${pair.baseToken.symbol}`);
        if (pair.info?.imageUrl) setFormLogoUrl(pair.info.imageUrl);
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
          if (!editingCall) {
            setFormEntryMc(formatted);
          }
        }
        showToast(`Auto-filled live telemetry for ${pair.baseToken?.symbol || cleanCa}`);
      } else if (!customCa) {
        showToast('No active DEX trading pair found for this CA. Enter details manually.');
      }
    } catch (err) {
      if (!customCa) showToast(`Network error reaching DexScreener: ${(err as Error).message || 'offline'}`);
    } finally {
      setFetchingDex(false);
    }
  };

  const handleStartEditCall = (call: AlphaItem) => {
    setEditingCall(call);
    setFormName(call.name);
    setFormTicker(call.ticker);
    setFormCa(call.ca || '');
    setFormLogoUrl(call.logoUrl || '');
    setFormChain(call.chain);
    setFormCurrentMc(call.marketCap || '');
    setFormEntryMc(call.entryMarketCap || '');
    setFormRiskLevel(call.risk || 3);
    setFormStopLoss(call.stopLoss || '-25% SL');
    setFormTakeProfits(
      call.takeProfits && call.takeProfits.length > 0
        ? call.takeProfits.map((tp) => `${tp.multiple}x`).join(', ')
        : '2x, 5x, 10x'
    );
    setFormPinned(call.pinned || false);
    setFormMaxAlpha(call.isMaxAlpha || false);
    setFormSummary(call.summary || '');
    setFormSerialTag(call.serialTag || '');
    setShowAdminForm(true);
    showToast(`Loaded ${call.ticker} into Editor`);
  };

  const handleCancelEdit = () => {
    setEditingCall(null);
    setFormCa('');
    setFormLogoUrl('');
    setFormName('');
    setFormTicker('');
    setFormCurrentMc('$250K');
    setFormEntryMc('$250K');
    setFormSummary('');
    setFormSerialTag('');
    setFormMaxAlpha(false);
    setFormPinned(true);
  };

  const handleAdminPostCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formTicker.trim() || !formCa.trim()) {
      showToast('Token Name, Ticker, and Contract Address (CA) are required.');
      return;
    }
    setSubmittingCall(true);

    if (editingCall) {
      const ok = await updateAlphaCall(editingCall.id, {
        name: formName.trim(),
        ticker: formTicker.trim(),
        ca: formCa.trim(),
        chain: formChain,
        marketCap: formCurrentMc.trim(),
        entryMarketCap: formEntryMc.trim(),
        risk: formRiskLevel,
        stopLoss: formStopLoss.trim(),
        takeProfitInput: formTakeProfits.trim(),
        pinned: formPinned,
        isMaxAlpha: formMaxAlpha,
        summary: formSummary.trim(),
        logoUrl: formLogoUrl.trim() || undefined,
      });
      setSubmittingCall(false);
      if (ok) {
        showToast(`Saved changes to live call for ${formTicker.toUpperCase()}`);
        handleCancelEdit();
        if (inspectedToken?.id === editingCall.id) {
          setInspectedToken(null);
        }
      } else {
        showToast('Failed to update call — ensure Admin Wallet is active.');
      }
      return;
    }

    const ok = await createAlphaCall({
      name: formName.trim(),
      ticker: formTicker.trim(),
      ca: formCa.trim(),
      chain: formChain,
      marketCap: formCurrentMc.trim() || '$250K',
      entryMarketCap: formEntryMc.trim() || formCurrentMc.trim() || '$250K',
      risk: formRiskLevel,
      stopLoss: formStopLoss.trim() || '-25% SL',
      takeProfitInput: formTakeProfits.trim() || '2x, 5x, 10x',
      pinned: formPinned,
      isMaxAlpha: formMaxAlpha,
      summary: formSummary.trim(),
      serialTag: formSerialTag.trim() || nextSerialTag,
      logoUrl: formLogoUrl.trim() || undefined,
    });
    setSubmittingCall(false);
    if (ok) {
      showToast(
        `Posted ${formTicker.toUpperCase()} (${formChain}) [${
          formSerialTag.trim() || nextSerialTag
        }]${formMaxAlpha ? ' [MAX ALPHA 🔥]' : ''}${formPinned ? ' as PINNED PRIORITY CALL' : ''}`
      );
      handleCancelEdit();
      setTimeout(() => {
        fetch('/api/telegram/dispatch-delayed', { method: 'POST' }).catch(() => {});
      }, 5 * 60 * 1000);
    } else {
      showToast('Failed to post call — ensure Admin Wallet is active.');
    }
  };

  const handleSaveEvm = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = setBoundEvmAddress(evmDraft.trim());
    if (ok) {
      setEvmSaved(true);
      if (evmTimeoutRef.current) clearTimeout(evmTimeoutRef.current);
      evmTimeoutRef.current = setTimeout(() => setEvmSaved(false), 2000);
      showToast('EVM Address bound successfully.');
    } else {
      showToast('Invalid EVM address format: must be 0x followed by 40 hex characters.');
    }
  };

  const isProOrAdmin = tier.id === 'PRO' || isAdmin;

  const pinnedCalls = useMemo(
    () =>
      isUnlocked
        ? alphas.filter(
            (a) =>
              a.pinned &&
              (selectedChain === 'ALL' || a.chain === selectedChain) &&
              (!a.isMaxAlpha || isProOrAdmin)
          )
        : [],
    [alphas, selectedChain, isUnlocked, isProOrAdmin]
  );

  const pinnedCampaigns = useMemo(
    () => campaigns.filter((c) => Boolean(c.pinned)),
    [campaigns]
  );

  const totalPinned = pinnedCalls.length + pinnedCampaigns.length;

  const visibleAlphas = useMemo(
    () => alphas.filter((a) => !a.isMaxAlpha || isProOrAdmin),
    [alphas, isProOrAdmin]
  );

  const chainCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: visibleAlphas.length };
    for (const ch of ['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX']) {
      counts[ch] = visibleAlphas.filter((a) => a.chain === ch).length;
    }
    return counts;
  }, [visibleAlphas]);

  const filteredTokens = useMemo(() => {
    return alphas
      .filter((item) => {
        // Only Admin and Pro users can see MAX ALPHA cards
        if (item.isMaxAlpha && !isProOrAdmin) return false;
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
          case 'MAX_ALPHA':
            return Boolean(item.isMaxAlpha);
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
  }, [alphas, selectedChain, searchQuery, activeFilter, watchlist, sortBy, isProOrAdmin]);

  const topWinningCoins = useMemo(
    () =>
      alphas
        .filter((a) => !a.isMaxAlpha || isProOrAdmin)
        .sort((a, b) => b.change24hPct - a.change24hPct)
        .slice(0, 4),
    [alphas, isProOrAdmin]
  );

  const renderAlphaCard = (coin: AlphaItem) => {
    if (coin.isMaxAlpha && !isProOrAdmin) return null;
    return (
      <AlphaCallCard
        key={coin.id}
        coin={coin}
        isAdmin={isAdmin}
        isStarred={watchlist.includes(coin.id)}
        onInspect={setInspectedToken}
        onEdit={handleStartEditCall}
        onDelete={(c) => {
          if (!window.confirm(`Are you sure you want to delete alpha call ${c.ticker}?`)) {
            return;
          }
          deleteAlphaCall(c.id);
          showToast(`Deleted call ${c.ticker}`);
        }}
        onToggleWatchlist={toggleWatchlist}
        onSetOutcome={(id, outcome) => {
          setCallOutcome(id, outcome);
          showToast(`Marked ${coin.ticker} as ${outcome === 'PROFIT' ? 'PROFIT ACHIEVED' : 'AT LOSS'}`);
        }}
      />
    );
  };

  // Admin Telemetry & Performance Calculations
  const totalCallsMade = alphas.length;
  const totalProfitCalls = alphas.filter((a) => a.outcome === 'PROFIT').length;
  const totalLoseCalls = alphas.filter((a) => a.outcome === 'LOSS').length;
  const totalVerifiedUsers = verifiedUsersCount ?? 0;

  if (!connected) {
    return <LockedTerminal />;
  }

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
          All Users are to take all trades at their own risk (DYOR). You are not subject to take any trade by the admins. All Information provided here are for research purposes only and can lose value.
        </p>
      </div>

      {/* 2-Column Hero & Staking Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        {/* LEFT COLUMN: Welcome Card (top) + Telegram Alerts Card (bottom) */}
        <div className="lg:col-span-7 flex flex-col gap-5 sm:gap-6 justify-between">
          {/* WELCOME TO THE LAB CARD */}
          <div className="relative rounded-xl border border-line bg-surface p-5 sm:p-6 overflow-hidden flex flex-col justify-between h-full">
            <div className="space-y-4 mb-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-surface-card border border-line flex items-center justify-center text-pump">
                    <Flame className="w-4 h-4" />
                  </span>
                  <h1 className="font-sans text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                    Welcome To The Lab
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$GENESIS', e)}
                    className="px-3 py-1.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedId === 'hero-gen-ca' ? (
                      <Check className="w-3.5 h-3.5 text-pump" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-pump" />
                    )}
                    <span>
                      {copiedId === 'hero-gen-ca' ? 'Copied CA' : 'Copy $GENESIS CA'}
                    </span>
                  </button>

                  <a
                    href={BUY_LINKS.pump}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-1.5 rounded-lg bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-extrabold inline-flex items-center gap-1.5 transition-all"
                  >
                    <span>Buy $GENESIS</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              <p className="font-sans text-xs sm:text-sm text-muted leading-relaxed">
                Exclusive multi-chain trade calls for verified{' '}
                <span className="text-pump font-bold">$GENESIS</span> holders
                across <strong className="text-white">SOL, BSC, ETH, BASE, ROBIN (Robinhood Chain), &amp; AVAX</strong>.
                Every card displays live Market Cap, dual Risk Ratio, and Take Profit multipliers (<span className="font-mono text-pump">2x / 5x / 10x</span>).
              </p>
            </div>

            {/* 3-Column KPI Stat Box */}
            <div className="grid grid-cols-1 sm:grid-cols-3 rounded-xl bg-surface-card border border-line divide-y sm:divide-y-0 sm:divide-x divide-line mt-auto">
              <div className="p-4 sm:p-5">
                <div className="font-sans text-2xs sm:text-xs text-muted uppercase tracking-wider font-bold">
                  ACTIVE ALPHA CALLS
                </div>
                <div className="font-sans text-xl sm:text-2xl font-extrabold text-pump mt-1 tnum">
                  {alphas.length} CALLS
                </div>
                <div className="font-sans text-2xs sm:text-xs text-muted mt-1 truncate">
                  {pinnedCalls.length} Pinned • 6 Chains
                </div>
              </div>

              {/* Supported Blockchains */}
              <div className="p-4 sm:p-5">
                <div className="font-sans text-2xs sm:text-xs text-muted uppercase tracking-wider font-bold">
                  SUPPORTED BLOCKCHAINS
                </div>
                <div className="font-mono text-xs sm:text-sm font-extrabold text-white mt-1.5 space-y-0.5">
                  <div>SOL • BSC • ETH</div>
                  <div className="text-pump">BASE • ROBIN • AVAX</div>
                </div>
                <div className="font-sans text-[10px] sm:text-[11px] text-muted mt-1">
                  Includes Robinhood Chain
                </div>
              </div>

              <div className="p-4 sm:p-5">
                <div className="flex items-center justify-between font-sans text-2xs sm:text-xs text-muted uppercase tracking-wider font-bold">
                  <span>ADMIN HIT RATE</span>
                  <span className="text-pump font-bold">COUNTED</span>
                </div>
                <div className="font-sans text-xl sm:text-2xl font-extrabold text-white mt-1 tnum">
                  {deskWinRate.label}
                </div>
                <div className="w-full h-1.5 bg-canvas rounded-full overflow-hidden mt-2 border border-line">
                  <div className="h-full bg-pump" style={{ width: `${deskWinRate.pct}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* TELEGRAM GET VERIFIED CARD */}
          <TelegramVerificationCard connected={connected} isPro={isUnlocked} />
        </div>

        {/* RIGHT COLUMN: Combined Staking & Upgrade Card */}
        <div className="lg:col-span-5 flex flex-col h-full">
          <DashboardStakingCard showTelegram={false} />
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
                • Full access to post calls &amp; run raid campaigns
              </span>
            </div>

            {/* Admin Desk Navigation Tabs */}
            <div className="flex items-center bg-surface border border-line rounded-lg p-0.5 font-sans text-xs">
              <button
                type="button"
                onClick={() => setAdminDeskTab('CALLS')}
                className={`px-3 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                  adminDeskTab === 'CALLS'
                    ? 'bg-pump text-canvas shadow-sm'
                    : 'text-muted hover:text-white'
                }`}
              >
                Alpha Calls Desk
              </button>
              <button
                type="button"
                onClick={() => setAdminDeskTab('CAMPAIGNS')}
                className={`px-3 py-1 rounded-md font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  adminDeskTab === 'CAMPAIGNS'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-purple-400 hover:text-purple-300'
                }`}
              >
                <span>⚡ X Raid Campaigns &amp; Airdrops</span>
              </button>
            </div>

            {adminDeskTab === 'CALLS' && (
              <button
                type="button"
                onClick={() => setShowAdminForm(!showAdminForm)}
                className="px-3.5 py-1.5 rounded bg-surface border border-pump font-sans text-xs font-black text-pump hover:bg-surface-3 cursor-pointer transition-colors"
              >
                {showAdminForm ? 'Hide Post Form' : '+ Post New Alpha Call'}
              </button>
            )}
          </div>

          {adminDeskTab === 'CAMPAIGNS' ? (
            <AdminCampaignManager onToast={showToast} getAdminHeaders={getAdminHeaders} />
          ) : (
            <>
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
                  ACHIEVED (IN PROFIT)
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
                  CALLS AT LOSS
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
              {editingCall && (
                <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 flex items-center justify-between gap-3 font-sans text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                    <span className="font-bold text-orange-400 uppercase tracking-wide">
                      EDITING LIVE CALL: {editingCall.ticker} ({editingCall.name})
                    </span>
                    <span className="font-mono text-[10px] text-muted">[{editingCall.id}]</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-2.5 py-1 rounded bg-surface-card hover:bg-surface-3 border border-line text-muted hover:text-white font-mono text-xs cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                </div>
              )}
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
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormCa(val);
                        const trimmed = val.trim();
                        if (trimmed.length >= 32 && !trimmed.includes(' ')) {
                          handleAutoFillDexScreener(trimmed);
                        }
                      }}
                      onBlur={() => {
                        if (formCa.trim().length >= 32) {
                          handleAutoFillDexScreener(formCa.trim());
                        }
                      }}
                      placeholder="Paste SOL / EVM / ROBIN Contract Address..."
                      className="flex-1 h-9 px-3 rounded bg-surface-card border border-line focus:border-pump font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAutoFillDexScreener()}
                      disabled={fetchingDex}
                      className="h-9 px-3 rounded bg-surface-card hover:bg-surface-3 border border-pump font-sans text-xs font-bold text-pump shrink-0 cursor-pointer inline-flex items-center gap-1"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{fetchingDex ? 'Fetching...' : 'Auto-Fill'}</span>
                    </button>
                  </div>
                  {formLogoUrl && (
                    <div className="flex items-center gap-2 pt-1 text-xs font-mono text-pump">
                      <img
                        src={formLogoUrl}
                        alt="Onchain Logo Preview"
                        className="w-5 h-5 rounded-md object-cover border border-pump/40"
                      />
                      <span className="text-[11px] text-muted truncate">
                        Onchain Logo verified from DEX
                      </span>
                    </div>
                  )}
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
                {/* Entry Market Cap */}
                <div className="md:col-span-3 space-y-1">
                  <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                    Entry MC *
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
                <div className="md:col-span-3 space-y-1">
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

                  <label className="inline-flex items-center gap-1.5 font-sans text-xs font-bold text-orange-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formMaxAlpha}
                      onChange={(e) => setFormMaxAlpha(e.target.checked)}
                      className="accent-orange-500 w-4 h-4 cursor-pointer"
                    />
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    <span>Max Alpha (Orange Outline)</span>
                  </label>

                  <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-white cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formPinned}
                      onChange={(e) => setFormPinned(e.target.checked)}
                      className="accent-[#34D399] w-4 h-4 cursor-pointer"
                    />
                    <Pin className="w-3.5 h-3.5 text-pump" />
                    <span>Pin Priority</span>
                  </label>

                  <button
                    type="submit"
                    disabled={submittingCall}
                    className="h-9 px-5 rounded bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {submittingCall ? (
                      <span>Processing...</span>
                    ) : editingCall ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                        <span>SAVE CHANGES</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4 stroke-[2.5]" />
                        <span>PUBLISH CALL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          )}
            </>
          )}
        </div>
      )}

      {/* PINNED PRIORITY CALLS & RAIDS SECTION (Admin-Pinned Items for All Users) */}
      {totalPinned > 0 && activeFilter === 'ALL' && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded bg-pump text-canvas font-mono text-xs font-black uppercase inline-flex items-center gap-1 shadow-sm">
                <Pin className="w-3.5 h-3.5" />
                <span>PINNED PRIORITY ({totalPinned})</span>
              </span>
              <span className="font-sans text-xs text-muted">
                High-priority trade setups &amp; community raid campaigns pinned by Admin
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pinnedCalls.map(renderAlphaCard)}
            {pinnedCampaigns.map((camp) => (
              <CampaignCard
                key={camp.id}
                campaign={camp}
                userWallet={publicKeyBase58}
                isAdmin={isAdmin}
                onTogglePin={handleTogglePinCampaign}
              />
            ))}
          </div>
        </div>
      )}

      {/* MAIN FEED TABS: CALLS OR RAIDS (For verified users with $GENESIS holding) */}
      <div className="space-y-4 pt-2">
        {isUnlocked && (
          <div className="flex items-center gap-2 p-1.5 rounded-xl bg-surface border border-line">
            <button
              type="button"
              onClick={() => setFeedTab('CALLS')}
              className={`flex-1 py-3 px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                feedTab === 'CALLS'
                  ? 'bg-pump text-canvas shadow-md'
                  : 'text-muted hover:text-white hover:bg-surface-card'
              }`}
            >
              <Target className="w-4 h-4" />
              <span>ALPHA TRADE CALLS</span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-xs ${
                  feedTab === 'CALLS'
                    ? 'bg-canvas text-pump font-black'
                    : 'bg-surface-card text-muted'
                }`}
              >
                {alphas.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFeedTab('RAIDS')}
              className={`flex-1 py-3 px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                feedTab === 'RAIDS'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-purple-400 hover:text-purple-300 hover:bg-surface-card'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>⚡ X RAID CAMPAIGNS &amp; REWARDS</span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-xs ${
                  feedTab === 'RAIDS'
                    ? 'bg-white text-purple-700 font-black'
                    : 'bg-surface-card text-purple-400'
                }`}
              >
                {campaigns.length}
              </span>
            </button>
          </div>
        )}

        {!isUnlocked ? (
          <div className="space-y-6 pt-2">
            <LockedTerminal />
            <div className="space-y-3 pt-2">
              <CampaignSection
                userWallet={publicKeyBase58}
                isAdmin={isAdmin}
                campaigns={campaigns}
                loading={campaignsLoading}
                onRefresh={fetchCampaigns}
                onTogglePin={handleTogglePinCampaign}
              />
            </div>
          </div>
        ) : feedTab === 'CALLS' ? (
          <div className="space-y-6">
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
                  className={`h-9 px-3 rounded-md font-mono text-xs font-extrabold whitespace-nowrap border cursor-pointer transition-colors inline-flex items-center justify-center ${
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
            <div className="h-9 flex items-center bg-surface border border-line rounded-md p-1 font-sans text-xs">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  ...(isProOrAdmin ? [{ id: 'MAX_ALPHA', label: '⚡ Max Alpha' } as { id: FilterTab; label: string }] : []),
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
                  className={`h-7 px-2.5 rounded font-bold cursor-pointer transition-colors inline-flex items-center justify-center ${
                    activeFilter === tab.id
                      ? tab.id === 'MAX_ALPHA'
                        ? 'bg-orange-500 text-black'
                        : 'bg-pump text-canvas'
                      : tab.id === 'MAX_ALPHA'
                      ? 'text-orange-400 hover:text-orange-300'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="h-9 flex items-center gap-1.5 px-3 rounded-md bg-surface border border-line font-sans text-xs text-muted">
              <Filter className="w-3.5 h-3.5 text-pump" />
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

            <div className="h-9 flex items-center bg-surface border border-line rounded-md p-1 font-sans text-xs">
              <button
                type="button"
                onClick={() => setViewMode('GRID')}
                className={`h-7 inline-flex items-center gap-1 px-2.5 rounded font-semibold cursor-pointer ${
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
                className={`h-7 inline-flex items-center gap-1 px-2.5 rounded font-semibold cursor-pointer ${
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
                  <th className="py-3.5 px-4 text-right">Entry MC</th>
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
                            logoUrl={token.logoUrl}
                            ticker={token.ticker}
                            size="sm"
                            chain={token.chain}
                            quoteToken={token.quoteToken}
                          />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-white">{token.name}</span>
                              <span className="font-mono text-xs text-pump font-bold">
                                {token.ticker}
                              </span>
                              {token.outcome === 'PROFIT' && (
                                <span className="px-1.5 py-0.2 rounded bg-pump text-canvas font-mono text-[10px] font-black uppercase">
                                  ACHIEVED ✓
                                </span>
                              )}
                              {token.outcome === 'LOSS' && (
                                <span className="px-1.5 py-0.2 rounded bg-danger text-white font-mono text-[10px] font-black uppercase">
                                  LOSS ✕
                                </span>
                              )}
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
                          {token.entryMarketCap || token.marketCap}
                        </div>
                        <div className="text-[10px] text-muted uppercase">
                          ENTRY MC
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
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEditCall(token);
                                }}
                                className="p-1.5 rounded border border-line bg-surface-card text-muted hover:text-pump hover:border-pump cursor-pointer transition-colors"
                                title="Edit Live Call"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleMaxAlpha(token.id, !token.isMaxAlpha);
                                  showToast(`${token.isMaxAlpha ? 'Removed Max Alpha from' : 'Marked as Max Alpha:'} ${token.ticker}`);
                                }}
                                className={`p-1.5 rounded border cursor-pointer transition-colors ${
                                  token.isMaxAlpha
                                    ? 'bg-orange-500 text-black border-orange-500 shadow-sm'
                                    : 'bg-surface-card text-muted hover:text-orange-400 border-line'
                                }`}
                                title="Toggle Max Alpha"
                              >
                                <Flame className="w-3.5 h-3.5" />
                              </button>
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
                            </>
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
      </div>
    ) : (
      <CampaignSection
        userWallet={publicKeyBase58}
        isAdmin={isAdmin}
        campaigns={campaigns}
        loading={campaignsLoading}
        onRefresh={fetchCampaigns}
        onTogglePin={handleTogglePinCampaign}
      />
    )}
  </div>

      {/* 7. Bottom Utility Bar: Cross-Chain EVM Wallet Binding & Private Syndicate Telegram Key */}
      {isUnlocked && (
        <div className="rounded-xl bg-surface border border-line p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-7 space-y-1.5">
            <h3 className="font-sans text-base font-extrabold text-white">
              Multi-Chain Wallet Binding &amp; Telegram Call Alerts
            </h3>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Your Solana wallet (<span className="font-mono text-white">{shortAddress}</span>)
              is verified with{' '}
              <strong className="text-pump">{formattedBalance} $GENESIS</strong>.
              Optionally save a local EVM address for multi-chain notifications, and get
              every new call pushed to Telegram.
            </p>
          </div>

          <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col gap-2.5">
            {!boundEvmAddress ? (
              <form onSubmit={handleSaveEvm} className="flex items-center gap-2">
                <input
                  type="text"
                  value={evmDraft}
                  onChange={(e) => setEvmDraft(e.target.value)}
                  placeholder="0x... (EVM address for Base/ETH/BSC/AVAX)"
                  className="flex-1 h-9 px-3 rounded bg-surface-card border border-line font-mono text-xs text-white placeholder:text-dim focus:outline-none focus:border-pump"
                />
                <button
                  type="submit"
                  className="h-9 px-3.5 rounded bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-pump cursor-pointer shrink-0 transition-colors"
                >
                  {evmSaved ? 'MAPPED ✓' : 'MAP 0x'}
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between w-full px-3 py-2 rounded bg-toxic-bg border border-toxic-border font-mono text-xs">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-pump font-bold uppercase text-[10px]">MAPPED:</span>
                  <span className="text-white truncate font-medium">{boundEvmAddress}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBoundEvmAddress('');
                    setEvmDraft('');
                  }}
                  className="text-muted hover:text-danger ml-2 text-[11px] underline cursor-pointer shrink-0"
                  title="Change mapped address"
                >
                  Change
                </button>
              </div>
            )}

            {/* Telegram Access Card (§7.3) */}
            <div className="rounded-lg bg-surface border border-toxic-border/60 p-5 shadow-sm space-y-3">
              <div className="font-sans text-xs font-bold uppercase tracking-wider text-muted">
                TELEGRAM ACCESS
              </div>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Verify your wallet in Telegram to join your exclusive group and receive signals.
              </p>
              <TelegramConnectButton />
            </div>

            <TelegramAlerts />
          </div>
        </div>
      )}

      <AlphaInspectorModal
        token={inspectedToken}
        onClose={() => setInspectedToken(null)}
        onEdit={handleStartEditCall}
      />
    </div>
  );
};
