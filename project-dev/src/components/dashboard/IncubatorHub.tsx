'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AlphaItem, Chain, Campaign, CallType } from '@/lib/types';
import {
  MembershipRestrictionScreen,
  type UserMembershipTier,
  type RestrictedCategory,
} from './MembershipRestrictionScreen';
import { useGenesisBalance } from '@/context/GenesisContext';
import {
  BUY_LINKS,
  CHAIN_METADATA,
  GENESIS_MINT,
} from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import { AlphaCallCard } from './AlphaCallCard';
import { MarketDataBadge, compareChangeDesc, formatChangePct } from './MarketDataBadge';
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
import { DashboardOverview } from './DashboardOverview';
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
  Lock,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';

export type DashboardTab = 'ALPHA' | 'SOCIAL' | 'WATCHLIST' | 'MAX_ALPHA';
type FilterTab = 'ALL' | 'PINNED' | 'MAX_ALPHA' | 'MOVERS' | 'NEW' | 'WATCHLIST';
type SortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';

const ALL_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

export const IncubatorHub: React.FC = () => {
  const router = useRouter();
  const {
    connected,
    connectWallet,
    isUnlocked,
    publicKeyBase58,
    shortAddress,
    formattedBalance,
    tier,
    isAdmin,
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
    requestUnlockSignature,
    searchQuery,
    setSearchQuery,
  } = useGenesisBalance();

  const [activeFilter, setActiveFilter] = useState<FilterTab>('ALL');
  const [selectedChain, setSelectedChain] = useState<Chain | 'ALL'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('PRIORITY');
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [adminDeskTab, setAdminDeskTab] = useState<'CALLS' | 'CAMPAIGNS'>('CALLS');
  const [currentTab, setCurrentTab] = useState<DashboardTab>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab')?.toUpperCase();
      if (
        tabParam === 'ALPHA' ||
        tabParam === 'SOCIAL' ||
        tabParam === 'WATCHLIST' ||
        tabParam === 'MAX_ALPHA'
      ) {
        return tabParam as DashboardTab;
      }
    }
    return 'ALPHA';
  });

  const handleSelectTab = (tab: DashboardTab) => {
    setCurrentTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState({ tab }, '', url.toString());
    }
  };

  // Synchronize tab state on browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get('tab')?.toUpperCase();
      if (
        tabParam === 'ALPHA' ||
        tabParam === 'SOCIAL' ||
        tabParam === 'WATCHLIST' ||
        tabParam === 'MAX_ALPHA'
      ) {
        setCurrentTab(tabParam as DashboardTab);
      } else {
        setCurrentTab('ALPHA');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
  const [formCallType, setFormCallType] = useState<CallType>('ALPHA');
  const [formMaxAlpha, setFormMaxAlpha] = useState(false);
  const [formSummary, setFormSummary] = useState('');
  const [formSerialTag, setFormSerialTag] = useState('');
  const [fetchingDex, setFetchingDex] = useState(false);
  const [submittingCall, setSubmittingCall] = useState(false);

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
    setFormCurrentMc(call.marketCap && call.marketCap !== '—' ? call.marketCap : '');
    setFormEntryMc(call.entryMarketCap || '');
    setFormRiskLevel(call.risk || 3);
    setFormStopLoss(call.stopLoss || '-25% SL');
    setFormTakeProfits(
      call.takeProfits && call.takeProfits.length > 0
        ? call.takeProfits.map((tp) => `${tp.multiple}x`).join(', ')
        : '2x, 5x, 10x'
    );
    setFormPinned(call.pinned || false);
    const initialCallType: CallType = call.callType || (call.isMaxAlpha ? 'MAX_ALPHA' : 'ALPHA');
    setFormCallType(initialCallType);
    setFormMaxAlpha(initialCallType === 'MAX_ALPHA' || Boolean(call.isMaxAlpha));
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
    setFormCallType('ALPHA');
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
        callType: formCallType,
        isMaxAlpha: formCallType === 'MAX_ALPHA',
        minTier: formCallType === 'ALPHA' ? 'LAB_MEMBER' : 'PRO',
        summary: formSummary.trim(),
        logoUrl: formLogoUrl.trim() || undefined,
      });
      setSubmittingCall(false);
      if (ok) {
        showToast(`Saved changes: moved ${formTicker.toUpperCase()} to ${formCallType}`);
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
      callType: formCallType,
      isMaxAlpha: formCallType === 'MAX_ALPHA',
      minTier: formCallType === 'ALPHA' ? 'LAB_MEMBER' : 'PRO',
      summary: formSummary.trim(),
      serialTag: formSerialTag.trim() || nextSerialTag,
      logoUrl: formLogoUrl.trim() || undefined,
    });
    setSubmittingCall(false);
    if (ok) {
      showToast(
        `Published ${formTicker.toUpperCase()} (${formChain}) to ${formCallType}${formPinned ? ' as PINNED PRIORITY' : ''}`
      );
      handleCancelEdit();
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

  const currentMembershipTier: UserMembershipTier = useMemo(() => {
    if (!connected) return 'FREE';
    if (isAdmin || tier.id === 'PRO') return 'PRO';
    if (tier.id === 'LAB_MEMBER') return 'MEMBER';
    return 'FREE';
  }, [connected, isAdmin, tier.id]);

  const isCurrentTabAuthorized = useMemo(() => {
    switch (currentTab) {
      case 'SOCIAL':
        return true;
      case 'ALPHA':
        return currentMembershipTier === 'MEMBER' || currentMembershipTier === 'PRO';
      case 'WATCHLIST':
      case 'MAX_ALPHA':
        return currentMembershipTier === 'PRO';
      default:
        return false;
    }
  }, [currentTab, currentMembershipTier]);

  const alphaCallsCount = useMemo(() => {
    if (currentMembershipTier === 'FREE') return 0;
    return alphas.filter((a) => a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha)).length;
  }, [alphas, currentMembershipTier]);

  const watchlistCallsCount = useMemo(() => {
    if (currentMembershipTier !== 'PRO') return 0;
    return alphas.filter((a) => a.callType === 'WATCHLIST').length;
  }, [alphas, currentMembershipTier]);

  const maxAlphaCallsCount = useMemo(() => {
    if (currentMembershipTier !== 'PRO') return 0;
    return alphas.filter((a) => a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha)).length;
  }, [alphas, currentMembershipTier]);

  const isProOrAdmin = currentMembershipTier === 'PRO';

  const pinnedCalls = useMemo(
    () =>
      isCurrentTabAuthorized
        ? alphas.filter((a) => {
            if (!a.pinned) return false;
            if (selectedChain !== 'ALL' && a.chain !== selectedChain) return false;
            if (currentTab === 'ALPHA') return a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha);
            if (currentTab === 'MAX_ALPHA') return a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha);
            if (currentTab === 'WATCHLIST') return a.callType === 'WATCHLIST';
            return true;
          })
        : [],
    [alphas, selectedChain, isCurrentTabAuthorized, currentTab]
  );

  const pinnedCampaigns = useMemo(
    () => campaigns.filter((c) => Boolean(c.pinned)),
    [campaigns]
  );

  const totalPinned = pinnedCalls.length + pinnedCampaigns.length;

  const currentTabBaseAlphas = useMemo(() => {
    if (!isCurrentTabAuthorized) return [];
    if (currentTab === 'ALPHA') {
      return alphas.filter((a) => a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha));
    }
    if (currentTab === 'MAX_ALPHA') {
      return alphas.filter((a) => a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha));
    }
    if (currentTab === 'WATCHLIST') {
      return alphas.filter((a) => a.callType === 'WATCHLIST' || watchlist.includes(a.id));
    }
    return alphas;
  }, [alphas, currentTab, isCurrentTabAuthorized, watchlist]);

  const visibleAlphas = useMemo(
    () => currentTabBaseAlphas,
    [currentTabBaseAlphas]
  );

  const newCallsCount = useMemo(
    () => visibleAlphas.filter((a) => a.ageMinutes <= 180).length,
    [visibleAlphas]
  );

  const chainCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: visibleAlphas.length };
    for (const ch of ['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX']) {
      counts[ch] = visibleAlphas.filter((a) => a.chain === ch).length;
    }
    return counts;
  }, [visibleAlphas]);

  const filteredTokens = useMemo(() => {
    return visibleAlphas
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
          case 'MAX_ALPHA':
            return Boolean(item.isMaxAlpha || item.callType === 'MAX_ALPHA');
          case 'MOVERS':
            return item.change24hPct !== null && item.change24hPct >= 200;
          case 'NEW':
            return item.ageMinutes <= 180;
          case 'WATCHLIST':
            return watchlist.includes(item.id) || item.callType === 'WATCHLIST';
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
        if (sortBy === 'CHANGE') return compareChangeDesc(a, b);
        return a.ageMinutes - b.ageMinutes;
      });
  }, [visibleAlphas, selectedChain, searchQuery, activeFilter, watchlist, sortBy]);

  const topWinningCoins = useMemo(
    () =>
      alphas
        .filter((a) => (!a.isMaxAlpha || isProOrAdmin) && a.change24hPct !== null)
        .sort(compareChangeDesc)
        .slice(0, 4),
    [alphas, isProOrAdmin]
  );

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedChain('ALL');
    setActiveFilter('ALL');
    setSortBy('PRIORITY');
  };

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

  if (!connected) {
    return <LockedTerminal />;
  }

  return (
    <div className="space-y-6 pb-10">
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg bg-surface border border-toxic text-white font-sans text-xs font-semibold flex items-center gap-2.5 shadow-none">
          <Check className="w-4 h-4 text-toxic shrink-0" />
          <span className="truncate max-w-md">{toastMessage}</span>
        </div>
      )}

      {/* 1. DISCLAIMER BANNER */}
      <div className="rounded-xl bg-surface border border-border-default p-3.5 sm:p-4 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-toxic shrink-0" />
        <p className="font-sans text-xs text-muted leading-relaxed">
          <strong className="text-white uppercase tracking-wider mr-1.5">
            ALPHA CALLS DISCLAIMER:
          </strong>
          All users execute trades independently at their own risk (DYOR). Information provided here is for research purposes only and digital assets carry severe volatility.
        </p>
      </div>

      {/* 2. DASHBOARD OVERVIEW SECTION (Section 4.2) */}
      <DashboardOverview
        connected={connected}
        shortAddress={shortAddress}
        tier={tier}
        formattedBalance={formattedBalance}
        alphasCount={alphaCallsCount}
        newCallsCount={newCallsCount}
        raidsCount={campaigns.length}
        watchlistCount={watchlistCallsCount}
        isUnlocked={isUnlocked}
        onCopyGenesisCa={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$GENESIS', e)}
        copiedGenesisCa={copiedId === 'hero-gen-ca'}
        onSelectFilter={(f) => {
          if (f === 'all') setActiveFilter('ALL');
          else if (f === 'new') setActiveFilter('NEW');
          else if (f === 'watchlist') {
            handleSelectTab('WATCHLIST');
          }
        }}
        onSelectTab={(tab) => {
          if (tab === 'ALPHA' || tab === 'alphas') handleSelectTab('ALPHA');
          else if (tab === 'SOCIAL' || tab === 'raids') handleSelectTab('SOCIAL');
          else if (tab === 'WATCHLIST') handleSelectTab('WATCHLIST');
          else if (tab === 'MAX_ALPHA') handleSelectTab('MAX_ALPHA');
          const listEl = document.getElementById('feed-tabs');
          if (listEl) listEl.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      {/* 3. STAKING & TELEGRAM SUMMARY ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch">
        <div className="lg:col-span-6 flex flex-col h-full">
          <TelegramVerificationCard connected={connected} isPro={isUnlocked} />
        </div>
        <div className="lg:col-span-6 flex flex-col h-full">
          <DashboardStakingCard showTelegram={false} />
        </div>
      </div>

      {/* 4. ADMIN COMMAND DESK (Authoritative Admin Only) */}
      {isAdmin && (
        <div className="rounded-xl bg-surface border-2 border-toxic overflow-hidden">
          <div className="px-5 py-3.5 bg-surface-card border-b border-border-default flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded bg-toxic text-canvas font-mono text-xs font-black uppercase">
                MASTER ADMIN DESK
              </span>
              {adminDeskTab === 'CALLS' && (
                <button
                  type="button"
                  onClick={() => setShowAdminForm(!showAdminForm)}
                  className="px-3.5 py-1.5 rounded-lg bg-surface border border-toxic font-sans text-xs font-bold text-toxic hover:bg-surface-3 cursor-pointer transition-colors"
                >
                  {showAdminForm ? 'Hide Post Form' : '+ Post New Alpha Call'}
                </button>
              )}
            </div>

            {/* Admin Desk Navigation Tabs */}
            <div className="flex items-center bg-surface border border-border-default rounded-lg p-0.5 font-sans text-xs">
              <button
                type="button"
                onClick={() => setAdminDeskTab('CALLS')}
                className={`px-3 py-1.5 rounded-md font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  adminDeskTab === 'CALLS'
                    ? 'bg-alpha-strong text-white border border-alpha-border'
                    : 'text-muted hover:text-white'
                }`}
              >
                <Target className="w-3.5 h-3.5" />
                <span>Alpha Calls Desk</span>
              </button>
              <button
                type="button"
                onClick={() => setAdminDeskTab('CAMPAIGNS')}
                className={`px-3 py-1.5 rounded-md font-bold transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                  adminDeskTab === 'CAMPAIGNS'
                    ? 'bg-raid-strong text-white border border-raid-border'
                    : 'text-muted hover:text-white'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>⚡ X Raid Campaigns &amp; Airdrops</span>
              </button>
            </div>
          </div>

          {adminDeskTab === 'CAMPAIGNS' ? (
            <AdminCampaignManager onToast={showToast} getAdminHeaders={getAdminHeaders} />
          ) : (
            <>
              {/* ADMIN POST/EDIT FORM */}
              {showAdminForm && (
                <form
                  onSubmit={handleAdminPostCall}
                  className="p-5 bg-surface-card border-t border-border-default space-y-4"
                >
                  <div className="flex items-center justify-between font-sans text-xs font-bold text-white">
                    <span>{editingCall ? `EDITING: ${editingCall.ticker}` : 'PUBLISH NEW ALPHA CALL'}</span>
                    {editingCall && (
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="text-xs text-muted hover:text-danger underline"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-6 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Contract Address (CA) *
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={formCa}
                          onChange={(e) => setFormCa(e.target.value)}
                          placeholder="Paste token contract address..."
                          className="flex-1 h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => handleAutoFillDexScreener()}
                          disabled={fetchingDex}
                          className="h-10 px-3 rounded-lg bg-surface border border-border-default hover:border-toxic text-toxic font-sans text-xs font-bold cursor-pointer shrink-0"
                        >
                          {fetchingDex ? 'Fetching...' : 'Auto-fill'}
                        </button>
                      </div>
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Token Name *
                      </label>
                      <input
                        type="text"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Synapse Labs"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-sans text-xs text-white placeholder:text-dim focus:outline-none"
                        required
                      />
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Ticker *
                      </label>
                      <input
                        type="text"
                        value={formTicker}
                        onChange={(e) => setFormTicker(e.target.value)}
                        placeholder="e.g. $SYN"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white placeholder:text-dim focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Chain
                      </label>
                      <select
                        value={formChain}
                        onChange={(e) => setFormChain(e.target.value as Chain)}
                        className="w-full h-10 px-2 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none cursor-pointer"
                      >
                        {['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Entry MC
                      </label>
                      <input
                        type="text"
                        value={formEntryMc}
                        onChange={(e) => setFormEntryMc(e.target.value)}
                        placeholder="$250K"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Current MC
                      </label>
                      <input
                        type="text"
                        value={formCurrentMc}
                        onChange={(e) => setFormCurrentMc(e.target.value)}
                        placeholder="$250K"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Risk (1-5)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        value={formRiskLevel}
                        onChange={(e) => setFormRiskLevel(Number(e.target.value))}
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Stop Loss (SL)
                      </label>
                      <input
                        type="text"
                        value={formStopLoss}
                        onChange={(e) => setFormStopLoss(e.target.value)}
                        placeholder="-25% SL"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                        Take Profits
                      </label>
                      <input
                        type="text"
                        value={formTakeProfits}
                        onChange={(e) => setFormTakeProfits(e.target.value)}
                        placeholder="2x, 5x, 10x"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-mono text-xs text-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-sans text-[11px] font-bold text-muted uppercase">
                      Thesis / Research Summary
                    </label>
                    <input
                      type="text"
                      value={formSummary}
                      onChange={(e) => setFormSummary(e.target.value)}
                      placeholder="Solana AI infrastructure play with growing holder distribution..."
                      className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-toxic font-sans text-xs text-white placeholder:text-dim focus:outline-none"
                    />
                  </div>

                  {/* Section 5: Admin Post Classification — Single Source of Truth */}
                  <div className="space-y-1.5 pt-1">
                    <label className="block font-sans text-[11px] font-bold text-muted uppercase tracking-wider">
                      Destination Tab Classification * (Single Source of Truth)
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormCallType('ALPHA');
                          setFormMaxAlpha(false);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          formCallType === 'ALPHA'
                            ? 'bg-purple-950/40 border-purple-500 text-white'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-purple-400">ALPHA</span>
                          <span className="text-[10px] font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">MEMBER+</span>
                        </div>
                        <p className="text-[11px] text-muted mt-1 leading-snug">Curated Alpha trade calls with TP/SL risk telemetry.</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormCallType('MAX_ALPHA');
                          setFormMaxAlpha(true);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          formCallType === 'MAX_ALPHA'
                            ? 'bg-amber-950/40 border-amber-500 text-white'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-amber-400">MAX ALPHA</span>
                          <span className="text-[10px] font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">PRO ONLY</span>
                        </div>
                        <p className="text-[11px] text-muted mt-1 leading-snug">High-conviction premium Alpha reserved for PRO members.</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFormCallType('WATCHLIST');
                          setFormMaxAlpha(false);
                        }}
                        className={`p-3 rounded-lg border text-left transition-all cursor-pointer ${
                          formCallType === 'WATCHLIST'
                            ? 'bg-emerald-950/40 border-emerald-500 text-white'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-emerald-400">WATCHLIST</span>
                          <span className="text-[10px] font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">PRO ONLY</span>
                        </div>
                        <p className="text-[11px] text-muted mt-1 leading-snug">Curated long-term projects for ongoing research.</p>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-white cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formPinned}
                        onChange={(e) => setFormPinned(e.target.checked)}
                        className="w-4 h-4 rounded border-border-default text-toxic"
                      />
                      <Pin className="w-3.5 h-3.5 text-toxic" />
                      <span>Pin Priority to Top</span>
                    </label>

                    <button
                      type="submit"
                      disabled={submittingCall}
                      className="h-10 px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-2 cursor-pointer transition-colors"
                    >
                      {submittingCall ? 'Processing...' : editingCall ? 'Save Changes' : '+ Publish Call'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* 5. PINNED PRIORITY OPPORTUNITIES (Section 4.2 D) */}
      {pinnedCalls.length > 0 && activeFilter === 'ALL' && currentTab === 'ALPHA' && isUnlocked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-md bg-surface border border-border-default text-white font-mono text-xs font-black uppercase inline-flex items-center gap-1.5 shadow-none">
              <Pin className="w-3.5 h-3.5 text-toxic" />
              <span>PINNED PRIORITY ({pinnedCalls.length})</span>
            </span>
            <span className="font-sans text-xs text-muted">
              High-priority trade setups pinned by Admin
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
            {pinnedCalls.map(renderAlphaCard)}
          </div>
        </div>
      )}

      {/* 6. MAIN FEED TABS: ALPHA CALLS (PURPLE) VS SOCIAL RAIDS (ORANGE) */}
      <div id="feed-tabs" className="space-y-4 pt-2">
        <div
          role="tablist"
          aria-label="Dashboard Content Categories"
          className="flex items-center gap-2 p-1.5 rounded-xl bg-surface border border-border-default overflow-x-auto no-scrollbar scroll-smooth"
        >
          {/* TAB 1: ALPHA */}
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'ALPHA'}
            data-testid="tab-alpha"
            onClick={() => handleSelectTab('ALPHA')}
            className={`flex-1 min-w-[130px] sm:min-w-0 min-h-[44px] py-3 px-3 sm:px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'ALPHA'
                ? 'bg-alpha-strong text-white border border-alpha-border'
                : 'text-muted hover:text-white hover:bg-surface-card border border-transparent'
            }`}
          >
            <Target className="w-4 h-4 text-alpha-primary shrink-0" />
            <span>ALPHA</span>
            {currentMembershipTier === 'FREE' ? (
              <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-surface-card text-muted flex items-center gap-1 border border-border-default">
                <Lock className="w-3 h-3 text-toxic" />
                <span>MEMBER</span>
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-xs ${
                  currentTab === 'ALPHA'
                    ? 'bg-alpha-bg text-alpha-text border border-alpha-border'
                    : 'bg-surface-card text-muted'
                }`}
              >
                {alphaCallsCount}
              </span>
            )}
          </button>

          {/* TAB 2: SOCIAL */}
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'SOCIAL'}
            data-testid="tab-social"
            onClick={() => handleSelectTab('SOCIAL')}
            className={`flex-1 min-w-[130px] sm:min-w-0 min-h-[44px] py-3 px-3 sm:px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'SOCIAL'
                ? 'bg-raid-strong text-white border border-raid-border'
                : 'text-muted hover:text-white hover:bg-surface-card border border-transparent'
            }`}
          >
            <Sparkles className="w-4 h-4 text-raid-primary shrink-0" />
            <span>SOCIAL</span>
            <span
              className={`px-2 py-0.5 rounded-md font-mono text-xs ${
                currentTab === 'SOCIAL'
                  ? 'bg-raid-bg text-raid-text border border-raid-border'
                  : 'bg-surface-card text-muted'
              }`}
            >
              {campaigns.length}
            </span>
          </button>

          {/* TAB 3: WATCHLIST */}
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'WATCHLIST'}
            data-testid="tab-watchlist"
            onClick={() => handleSelectTab('WATCHLIST')}
            className={`flex-1 min-w-[130px] sm:min-w-0 min-h-[44px] py-3 px-3 sm:px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'WATCHLIST'
                ? 'bg-surface-card text-white border border-border-muted ring-1 ring-amber/50'
                : 'text-muted hover:text-white hover:bg-surface-card border border-transparent'
            }`}
          >
            <Star className="w-4 h-4 text-amber shrink-0" />
            <span>WATCHLIST</span>
            {currentMembershipTier !== 'PRO' ? (
              <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-surface-card text-muted flex items-center gap-1 border border-border-default">
                <Lock className="w-3 h-3 text-alpha-primary" />
                <span>PRO</span>
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-xs ${
                  currentTab === 'WATCHLIST'
                    ? 'bg-surface-card text-amber border border-border-muted'
                    : 'bg-surface-card text-muted'
                }`}
              >
                {watchlistCallsCount}
              </span>
            )}
          </button>

          {/* TAB 4: MAX ALPHA */}
          <button
            type="button"
            role="tab"
            aria-selected={currentTab === 'MAX_ALPHA'}
            data-testid="tab-max-alpha"
            onClick={() => handleSelectTab('MAX_ALPHA')}
            className={`flex-1 min-w-[130px] sm:min-w-0 min-h-[44px] py-3 px-3 sm:px-4 rounded-lg font-sans text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
              currentTab === 'MAX_ALPHA'
                ? 'bg-alpha-strong text-white border border-alpha-border ring-1 ring-alpha-primary/50'
                : 'text-muted hover:text-white hover:bg-surface-card border border-transparent'
            }`}
          >
            <Flame className="w-4 h-4 text-alpha-primary shrink-0" />
            <span>MAX ALPHA</span>
            {currentMembershipTier !== 'PRO' ? (
              <span className="px-2 py-0.5 rounded-md font-mono text-[10px] font-bold bg-surface-card text-muted flex items-center gap-1 border border-border-default">
                <Lock className="w-3 h-3 text-alpha-primary" />
                <span>PRO</span>
              </span>
            ) : (
              <span
                className={`px-2 py-0.5 rounded-md font-mono text-xs ${
                  currentTab === 'MAX_ALPHA'
                    ? 'bg-alpha-bg text-alpha-text border border-alpha-border'
                    : 'bg-surface-card text-muted'
                }`}
              >
                {maxAlphaCallsCount}
              </span>
            )}
          </button>
        </div>

        {/* TAB CONTENT ROUTING */}
        {currentTab === 'SOCIAL' ? (
          <div className="space-y-4 pt-2">
            <CampaignSection
              userWallet={publicKeyBase58}
              isAdmin={isAdmin}
              campaigns={campaigns}
              loading={campaignsLoading}
              onRefresh={fetchCampaigns}
              onTogglePin={handleTogglePinCampaign}
            />
          </div>
        ) : !isCurrentTabAuthorized ? (
          <MembershipRestrictionScreen
            category={currentTab as RestrictedCategory}
            userTier={currentMembershipTier}
            onUpgradeClick={() => {
              if (!connected) {
                connectWallet();
              } else {
                router.push('/dashboard/stake');
              }
            }}
          />
        ) : (
          <div className="space-y-6">
            {/* 7. ALL CATEGORIZED ALPHA / WATCHLIST / MAX ALPHA CALLS */}
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
                    className="px-3 py-1 rounded bg-surface border border-border-default hover:border-danger text-white font-mono text-xs font-bold cursor-pointer shrink-0"
                  >
                    Retry Connection ⟳
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-sans text-lg sm:text-xl font-extrabold text-white">
                    {currentTab === 'ALPHA'
                      ? 'Curated Alpha Trade Calls'
                      : currentTab === 'WATCHLIST'
                      ? 'Curated Watchlist & Research Projects'
                      : 'Max Alpha Premium High-Conviction Calls'}
                  </h2>
                  <p className="font-sans text-xs text-muted">
                    Showing <strong className="text-toxic font-mono">{filteredTokens.length}</strong> calls
                    • Multi-chain coverage across SOL, BSC, ETH, BASE, ROBIN, AVAX
                  </p>
                </div>

                {(searchQuery || selectedChain !== 'ALL' || activeFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="self-start sm:self-auto h-8 px-3 rounded-lg bg-surface border border-border-default hover:border-toxic text-xs font-mono font-bold text-toxic inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Filters</span>
                  </button>
                )}
              </div>

              {/* Blockchain Filter Bar + Filter Pills + Sort + Grid/Table Toggle */}
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 pb-3 border-b border-border-default">
                {/* Blockchain Tabs */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ALL_CHAINS.map((ch) => {
                    const active = selectedChain === ch;
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setSelectedChain(ch)}
                        className={`h-8 px-2.5 rounded-md font-mono text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors inline-flex items-center justify-center ${
                          active
                            ? 'bg-toxic text-canvas border-toxic'
                            : 'bg-surface hover:bg-surface-card text-white border-border-default'
                        }`}
                      >
                        <span>{ch}</span>
                        <span className={`ml-1 text-[10px] ${active ? 'text-canvas' : 'text-toxic'}`}>
                          ({chainCounts[ch] ?? 0})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Controls: Filter Pills, Sort, View Mode */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {/* Filter Pills (Section 5.2) */}
                  <div className="h-8 inline-flex items-center bg-surface border border-border-default rounded-md p-0.5 font-sans text-xs">
                    {(
                      [
                        { id: 'ALL', label: 'All' },
                        ...(isProOrAdmin ? [{ id: 'MAX_ALPHA', label: '⚡ Max Alpha' } as { id: FilterTab; label: string }] : []),
                        { id: 'PINNED', label: '📌 Pinned' },
                        { id: 'MOVERS', label: '🔥 Movers' },
                        { id: 'NEW', label: '✨ New' },
                        { id: 'WATCHLIST', label: '⭐ Watchlist' },
                      ] as { id: FilterTab; label: string }[]
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveFilter(tab.id)}
                        className={`h-[26px] px-2 rounded font-bold cursor-pointer transition-colors inline-flex items-center justify-center text-xs ${
                          activeFilter === tab.id
                            ? tab.id === 'MAX_ALPHA'
                              ? 'bg-alpha-strong text-white'
                              : 'bg-toxic text-canvas'
                            : tab.id === 'MAX_ALPHA'
                            ? 'text-alpha-primary hover:text-white'
                            : 'text-muted hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Sort Selector */}
                  <div className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-surface border border-border-default font-sans text-xs text-muted">
                    <Filter className="w-3.5 h-3.5 text-toxic shrink-0" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortKey)}
                      className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer text-xs"
                    >
                      <option value="PRIORITY" className="bg-surface">Sort: Pinned &amp; Newest</option>
                      <option value="MCAP" className="bg-surface">Sort: Market Cap</option>
                      <option value="CHANGE" className="bg-surface">Sort: 24h Gain</option>
                      <option value="NEWEST" className="bg-surface">Sort: Newest Call</option>
                    </select>
                  </div>

                  {/* View Mode Toggle */}
                  <div className="h-8 inline-flex items-center bg-surface border border-border-default rounded-md p-0.5 font-sans text-xs">
                    <button
                      type="button"
                      onClick={() => setViewMode('GRID')}
                      className={`h-[26px] inline-flex items-center gap-1 px-2 rounded font-semibold cursor-pointer text-xs ${
                        viewMode === 'GRID' ? 'bg-toxic text-canvas font-black' : 'text-muted hover:text-white'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Cards</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('TABLE')}
                      className={`h-[26px] inline-flex items-center gap-1 px-2 rounded font-semibold cursor-pointer text-xs ${
                        viewMode === 'TABLE' ? 'bg-toxic text-canvas font-black' : 'text-muted hover:text-white'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                      <span>Table</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* View Mode A: Grid */}
              {viewMode === 'GRID' ? (
                apiLoading && alphas.length === 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-surface border border-border-default p-4 space-y-3 animate-pulse"
                      >
                        <div className="w-full h-12 bg-surface-card rounded-md" />
                        <div className="h-4 bg-surface-card rounded w-3/4" />
                        <div className="h-3 bg-surface-card rounded w-1/2" />
                        <div className="h-10 bg-surface-card rounded w-full" />
                      </div>
                    ))}
                  </div>
                ) : filteredTokens.length === 0 ? (
                  <div className="rounded-xl bg-surface border border-border-default p-10 text-center space-y-3">
                    <div className="w-10 h-10 rounded-full bg-surface-card border border-border-default mx-auto flex items-center justify-center text-muted">
                      <Search className="w-4 h-4" />
                    </div>
                    <h3 className="font-sans text-base font-bold text-white">
                      {currentTab === 'ALPHA'
                        ? 'No Alpha Calls Found'
                        : currentTab === 'WATCHLIST'
                        ? 'No Watchlist Projects Found'
                        : 'No Max Alpha Calls Found'}
                    </h3>
                    <p className="font-sans text-xs text-muted max-w-sm mx-auto">
                      {currentTab === 'ALPHA'
                        ? 'No active Alpha trade calls match your active filter or search query. Try switching blockchains or reset filters.'
                        : currentTab === 'WATCHLIST'
                        ? 'No curated Watchlist research projects match your active filter. Check back shortly for new team research.'
                        : 'No premium Max Alpha calls currently match your active filter.'}
                    </p>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="px-4 py-2 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default text-xs font-mono font-bold text-toxic cursor-pointer"
                    >
                      Reset All Filters
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                    {filteredTokens.map(renderAlphaCard)}
                  </div>
                )
              ) : (
                /* View Mode B: Table */
                <div className="rounded-xl bg-surface border border-border-default overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr className="border-b border-border-default bg-surface-card font-sans text-xs text-muted uppercase">
                        <th className="py-3.5 px-4 font-bold">Token &amp; Chain</th>
                        <th className="py-3.5 px-4 font-bold">Contract Address (CA)</th>
                        <th className="py-3.5 px-4 text-right font-bold">Entry MC</th>
                        <th className="py-3.5 px-4 text-right font-bold">Current MC</th>
                        <th className="py-3.5 px-4 text-center font-bold">Risk Ratio</th>
                        <th className="py-3.5 px-4 font-bold">Take Profit</th>
                        <th className="py-3.5 px-4 text-right font-bold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default font-sans text-xs">
                      {filteredTokens.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-muted font-mono text-xs">
                            No alpha calls match active filters.
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
                                      <span className="font-mono text-xs text-toxic font-bold">
                                        {token.ticker}
                                      </span>
                                      {token.outcome === 'PROFIT' && (
                                        <span className="px-1.5 py-0.2 rounded bg-toxic text-canvas font-mono text-[10px] font-black uppercase">
                                          PROFIT ✓
                                        </span>
                                      )}
                                      {token.outcome === 'LOSS' && (
                                        <span className="px-1.5 py-0.2 rounded bg-danger text-white font-mono text-[10px] font-black uppercase">
                                          LOSS ✕
                                        </span>
                                      )}
                                    </div>
                                    <div className="font-mono text-[11px] text-muted flex items-center gap-2 mt-0.5">
                                      <span className="px-1.5 py-0.2 rounded bg-surface-card border border-border-default text-white font-bold">
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
                                      handleCopyText(token.ca!, `tbl-${token.id}`, token.ticker, e)
                                    }
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default text-white font-semibold cursor-pointer tnum"
                                  >
                                    <span>
                                      {token.ca.slice(0, 6)}...{token.ca.slice(-4)}
                                    </span>
                                    {copiedId === `tbl-${token.id}` ? (
                                      <Check className="w-3.5 h-3.5 text-toxic" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5 text-toxic" />
                                    )}
                                  </button>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-right font-mono tnum">
                                <div className="font-bold text-white text-sm">
                                  {token.entryMarketCap || '—'}
                                </div>
                              </td>

                              <td className="py-3.5 px-4 text-right font-mono tnum">
                                <div className="font-black text-toxic-bright text-sm">
                                  {token.marketCap || '—'}
                                </div>
                              </td>

                              <td className="py-3.5 px-4 text-center font-mono text-xs">
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card border border-border-default">
                                  <span className="text-white font-bold">
                                    Lvl {token.risk}/5
                                  </span>
                                  <span className="text-dim">•</span>
                                  <span className="text-alpha-primary font-bold">
                                    {token.riskRewardRatio || '2.5:1'}
                                  </span>
                                </div>
                              </td>

                              <td className="py-3.5 px-4 font-mono text-xs">
                                <div className="flex flex-wrap items-center gap-1">
                                  {token.takeProfits.map((tp) => (
                                    <span
                                      key={tp.label}
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold border ${
                                        tp.hit
                                          ? 'bg-toxic text-canvas border-toxic'
                                          : 'bg-surface-card text-white border-border-default'
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
                                        className="p-1.5 rounded-md border border-border-default bg-surface-card text-muted hover:text-toxic hover:border-toxic cursor-pointer transition-colors"
                                        title="Edit Call"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          togglePinCall(token.id, !token.pinned);
                                        }}
                                        className={`p-1.5 rounded-md border cursor-pointer ${
                                          token.pinned
                                            ? 'bg-toxic text-canvas border-toxic'
                                            : 'bg-surface-card text-muted border-border-default'
                                        }`}
                                        title="Toggle Pin"
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
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic text-white font-extrabold"
                                  >
                                    <span>Market</span>
                                    <ExternalLink className="w-3.5 h-3.5 text-toxic" />
                                  </a>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 8. TOP PERFORMING ALPHA CALLS (Section 3.5 & 4.2) */}
            <div className="rounded-xl bg-surface border border-border-default p-5 space-y-4">
              <div className="pb-3 border-b border-border-default flex items-center justify-between">
                <div>
                  <h3 className="font-sans text-base sm:text-lg font-extrabold text-white">
                    Top Performing Alpha Calls
                  </h3>
                  <p className="font-sans text-xs text-muted">
                    Click any call to inspect full trade setup parameters or copy CA
                  </p>
                </div>
              </div>

              <div className="divide-y divide-border-default">
                {topWinningCoins.map((coin, idx) => {
                  const marketUrl = getPrimaryMarketUrl(coin);
                  return (
                    <div
                      key={coin.id}
                      onClick={() => setInspectedToken(coin)}
                      className="py-3 flex items-center justify-between gap-3 hover:bg-surface-card/60 px-2 rounded-lg cursor-pointer transition-colors"
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
                            <span className="font-mono text-xs text-toxic font-bold">
                              {coin.ticker}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-card border border-border-default font-mono text-[10px] text-white">
                              {coin.chain}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mt-1 font-mono text-xs text-muted">
                            <span className="tnum">
                              MC {coin.marketCap} • {coin.riskRewardRatio} • TP{' '}
                              {coin.takeProfits.map((t) => t.label).join('/')}
                            </span>
                            <MarketDataBadge item={coin} />
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono tnum shrink-0">
                        <div
                          className={`text-sm font-bold ${
                            coin.change24hPct !== null && coin.change24hPct < 0 ? 'text-danger' : 'text-toxic'
                          }`}
                        >
                          {formatChangePct(coin.change24hPct)}
                        </div>
                        <a
                          href={marketUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-toxic hover:underline mt-1 font-bold"
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
        )}
      </div>

      {/* 9. BOTTOM UTILITY BAR: EVM MAPPING & TELEGRAM ALERTS */}
      {isUnlocked && (
        <div className="rounded-xl bg-surface border border-border-default p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          <div className="lg:col-span-7 space-y-1.5">
            <h3 className="font-sans text-base font-extrabold text-white">
              Multi-Chain Wallet Binding &amp; Telegram Call Alerts
            </h3>
            <p className="font-sans text-xs text-muted leading-relaxed">
              Your Solana wallet (<span className="font-mono text-white">{shortAddress}</span>)
              is verified with{' '}
              <strong className="text-toxic">{formattedBalance} $GENESIS</strong>.
              Optionally map a local EVM address for multi-chain notifications.
            </p>
          </div>

          <div className="lg:col-span-5 flex flex-col gap-2.5">
            {!boundEvmAddress ? (
              <form onSubmit={handleSaveEvm} className="flex items-center gap-2">
                <input
                  type="text"
                  value={evmDraft}
                  onChange={(e) => setEvmDraft(e.target.value)}
                  placeholder="0x... (EVM address for Base/ETH/BSC/AVAX)"
                  className="flex-1 h-10 px-3 rounded-lg bg-surface-card border border-border-default font-mono text-xs text-white placeholder:text-dim focus:outline-none focus:border-toxic"
                />
                <button
                  type="submit"
                  className="h-10 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default font-sans text-xs font-bold text-toxic cursor-pointer shrink-0 transition-colors"
                >
                  {evmSaved ? 'MAPPED ✓' : 'MAP 0x'}
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-toxic-bg border border-toxic-border font-mono text-xs">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-toxic font-bold uppercase text-[10px]">MAPPED:</span>
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
            <TelegramAlerts />
          </div>
        </div>
      )}

      {/* INSPECTOR MODAL */}
      <AlphaInspectorModal
        token={inspectedToken}
        onClose={() => setInspectedToken(null)}
        onEdit={handleStartEditCall}
      />
    </div>
  );
};
