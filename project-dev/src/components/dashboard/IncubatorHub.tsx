'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { AlphaItem, Chain, Campaign, CallType } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
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
import {
  DashboardStakingCard,
  TelegramVerificationCard,
} from '@/components/stake/DashboardStakingCard';
import { StakeClientView, type InitialStakeData } from '@/components/stake/StakeClientView';
import { LockedTerminal } from '@/components/LockedTerminal';
import { AlphaInspectorModal, getPrimaryMarketUrl } from './AlphaInspectorModal';
import { CampaignSection } from '@/components/campaigns/CampaignSection';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import { AdminCampaignManager } from '@/components/admin/AdminCampaignManager';
import { DashboardOverview } from './DashboardOverview';
import { DashboardLedgerEmbed } from '@/components/ledger/DashboardLedgerEmbed';
import {
  useDashboardNavigation,
  type DashboardWorkspace,
} from './DashboardNavigationContext';
import { WatchlistView } from './WatchlistView';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Filter,
  Flame,
  KeyRound,
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

export type DashboardTab = DashboardWorkspace;
type FilterTab = 'ALL' | 'PINNED' | 'MAX_ALPHA' | 'MOVERS' | 'NEW' | 'WATCHLIST';
type SortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
type ViewMode = 'GRID' | 'TABLE';
/** Watchlist workspace source: the user's saved (starred) IDs, or Lab-curated callType WATCHLIST posts. */
type WatchlistMode = 'SAVED' | 'PLATFORM';

const ALL_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

const DASHBOARD_TABS: DashboardTab[] = ['OVERVIEW', 'ALPHA', 'SOCIAL', 'WATCHLIST', 'MAX_ALPHA', 'STAKE'];

/** Reads `?tab=` from the current URL. Missing/unknown values resolve to the Overview landing workspace. */
const readTabFromUrl = (): DashboardTab => {
  if (typeof window === 'undefined') return 'OVERVIEW';
  const tabParam = new URLSearchParams(window.location.search).get('tab')?.toUpperCase();
  return DASHBOARD_TABS.includes(tabParam as DashboardTab) ? (tabParam as DashboardTab) : 'OVERVIEW';
};

const WORKSPACE_TITLES: Record<DashboardTab, { title: string; subtitle: string }> = {
  OVERVIEW: { title: 'Overview', subtitle: 'Account, holdings, membership and verified activity' },
  ALPHA: { title: 'Alpha Calls', subtitle: 'Curated multi-chain trade intelligence' },
  MAX_ALPHA: { title: 'Max Alpha', subtitle: 'Premium high-conviction calls for Pro members' },
  WATCHLIST: { title: 'Watchlist', subtitle: 'Your saved tokens and Lab-curated research projects' },
  SOCIAL: { title: 'Raid', subtitle: 'Community campaigns, submissions and rewards' },
  STAKE: { title: 'Stake $H42', subtitle: 'StakePoint 90-day staking, transaction verification and Pro access' },
};

export const IncubatorHub: React.FC = () => {
  const navCtx = useDashboardNavigation();
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
    needsSignature,
    verificationState,
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
  const [watchlistMode, setWatchlistMode] = useState<WatchlistMode>('SAVED');
  const [fallbackTab, setFallbackTab] = useState<DashboardTab>('OVERVIEW');

  const currentTab: DashboardTab = navCtx ? navCtx.activeWorkspace : fallbackTab;

  const handleSelectTab = useCallback(
    (tab: DashboardTab) => {
      if (tab === 'SOCIAL') setAdminDeskTab('CAMPAIGNS');
      else if (tab !== 'OVERVIEW' && tab !== 'STAKE') setAdminDeskTab('CALLS');

      if (navCtx) {
        navCtx.selectWorkspace(tab);
        return;
      }

      setFallbackTab(tab);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (tab === 'OVERVIEW') url.searchParams.delete('tab');
        else url.searchParams.set('tab', tab);
        window.history.pushState({ tab }, '', url.toString());
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [navCtx]
  );

  // Sync admin desk mode & fallback URL state when running standalone without DashboardLayout
  useEffect(() => {
    if (navCtx) return;
    const handlePopState = () => {
      setFallbackTab(readTabFromUrl());
    };
    queueMicrotask(handlePopState);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navCtx]);

  useEffect(() => {
    const nextDesk =
      currentTab === 'SOCIAL'
        ? 'CAMPAIGNS'
        : currentTab === 'ALPHA' || currentTab === 'MAX_ALPHA' || currentTab === 'WATCHLIST'
        ? 'CALLS'
        : null;
    if (!nextDesk) return;
    queueMicrotask(() => setAdminDeskTab(nextDesk));
  }, [currentTab]);

  // Community Campaigns State
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  // Stake Workspace State (/api/stake/status, session-authenticated)
  const [stakeStatusData, setStakeStatusData] = useState<InitialStakeData | null>(null);
  const [stakeStatusLoading, setStakeStatusLoading] = useState(false);
  const [stakeStatusError, setStakeStatusError] = useState<string | null>(null);
  const [stakeRequiresAuth, setStakeRequiresAuth] = useState(false);

  const [inspectedToken, setInspectedToken] = useState<AlphaItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Admin Create/Edit Call Form State (collapsed to a compact desk bar until opened or editing)
  const [showAdminForm, setShowAdminForm] = useState<boolean>(false);
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
      console.error('Failed to update pin:', err);
      showToast('Could not update campaign priority. Please try again.');
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
            console.error('DexScreener rate limit reached (HTTP 429)');
            showToast('Rate limit reached. Please wait a few seconds and try again.');
          } else {
            console.error(`DexScreener request failed (HTTP ${res.status})`);
            showToast('Could not retrieve token data. Please enter details manually.');
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
      console.error('Network error reaching DexScreener:', err);
      if (!customCa) showToast('Could not connect to DexScreener. Please enter details manually.');
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
        console.error('Failed to update call — ensure Admin Wallet is active.');
        showToast('Could not update call. Please ensure your admin wallet is connected.');
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
      console.error('Failed to post call — ensure Admin Wallet is active.');
      showToast('Could not publish call. Please ensure your admin wallet is connected.');
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

  const isWalletVerified =
    connected &&
    !needsSignature &&
    verificationState !== 'CONNECTED_UNVERIFIED' &&
    verificationState !== 'VERIFICATION_FAILED';

  const fetchStakeStatus = useCallback(async () => {
    if (!connected || !publicKeyBase58 || !isWalletVerified) {
      setStakeStatusData(null);
      setStakeStatusError(null);
      setStakeRequiresAuth(connected);
      return;
    }

    setStakeStatusLoading(true);
    setStakeStatusError(null);
    setStakeRequiresAuth(false);
    try {
      const res = await fetch('/api/stake/status', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.status === 401) {
        setStakeStatusData(null);
        setStakeRequiresAuth(true);
        return;
      }
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message || 'Unable to load stake status.');
      }
      const json = (await res.json()) as InitialStakeData;
      setStakeStatusData(json);
    } catch (err: unknown) {
      setStakeStatusError((err as Error)?.message || 'Failed to load staking status.');
    } finally {
      setStakeStatusLoading(false);
    }
  }, [connected, publicKeyBase58, isWalletVerified]);

  useEffect(() => {
    if (currentTab !== 'STAKE') return;
    let active = true;
    const run = async () => {
      if (!connected || !publicKeyBase58 || !isWalletVerified) {
        if (active) {
          setStakeStatusData(null);
          setStakeStatusError(null);
          setStakeRequiresAuth(connected);
        }
        return;
      }

      if (active) {
        setStakeStatusLoading(true);
        setStakeStatusError(null);
        setStakeRequiresAuth(false);
      }
      try {
        const res = await fetch('/api/stake/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!active) return;
        if (res.status === 401) {
          setStakeStatusData(null);
          setStakeRequiresAuth(true);
          return;
        }
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.message || 'Unable to load stake status.');
        }
        const json = (await res.json()) as InitialStakeData;
        if (active) setStakeStatusData(json);
      } catch (err: unknown) {
        if (active) {
          setStakeStatusError((err as Error)?.message || 'Failed to load staking status.');
        }
      } finally {
        if (active) setStakeStatusLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [currentTab, connected, publicKeyBase58, isWalletVerified]);

  const currentMembershipTier: UserMembershipTier = useMemo(() => {
    if (!connected) return 'FREE';
    if (isAdmin || tier.id === 'PRO') return 'PRO';
    if (tier.id === 'LAB_MEMBER') return 'MEMBER';
    return 'FREE';
  }, [connected, isAdmin, tier.id]);

  const isProOrAdmin = currentMembershipTier === 'PRO';

  const isCurrentTabAuthorized = useMemo(() => {
    switch (currentTab) {
      case 'OVERVIEW':
      case 'SOCIAL':
      case 'STAKE':
        return true;
      case 'ALPHA':
        return currentMembershipTier === 'MEMBER' || currentMembershipTier === 'PRO';
      case 'WATCHLIST':
        if (currentMembershipTier === 'PRO') return true;
        if (currentMembershipTier === 'MEMBER') return watchlistMode === 'SAVED';
        return false;
      case 'MAX_ALPHA':
        return currentMembershipTier === 'PRO';
      default:
        return false;
    }
  }, [currentTab, currentMembershipTier, watchlistMode]);

  const alphaCallsCount = useMemo(() => {
    if (currentMembershipTier === 'FREE') return 0;
    return alphas.filter((a) => a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha)).length;
  }, [alphas, currentMembershipTier]);

  // Platform (Lab-curated) watchlist: admin-classified research posts.
  const watchlistCallsCount = useMemo(() => {
    if (currentMembershipTier !== 'PRO') return 0;
    return alphas.filter((a) => a.callType === 'WATCHLIST').length;
  }, [alphas, currentMembershipTier]);

  // Personal watchlist: the user's actual saved IDs (never inferred from callType).
  const savedWatchlistItems = useMemo(
    () =>
      alphas.filter(
        (a) =>
          watchlist.includes(a.id) &&
          (isProOrAdmin || (!a.isMaxAlpha && a.callType !== 'MAX_ALPHA' && a.callType !== 'WATCHLIST'))
      ),
    [alphas, watchlist, isProOrAdmin]
  );

  const savedWatchlistCount = savedWatchlistItems.length;

  const maxAlphaCallsCount = useMemo(() => {
    if (currentMembershipTier !== 'PRO') return 0;
    return alphas.filter((a) => a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha)).length;
  }, [alphas, currentMembershipTier]);

  const matchesWatchlistWorkspace = useCallback(
    (a: AlphaItem) =>
      watchlistMode === 'SAVED'
        ? watchlist.includes(a.id) &&
          (isProOrAdmin || (!a.isMaxAlpha && a.callType !== 'MAX_ALPHA' && a.callType !== 'WATCHLIST'))
        : isProOrAdmin && a.callType === 'WATCHLIST',
    [watchlistMode, watchlist, isProOrAdmin]
  );

  const pinnedCalls = useMemo(
    () =>
      isCurrentTabAuthorized
        ? alphas.filter((a) => {
            if (!a.pinned) return false;
            if (selectedChain !== 'ALL' && a.chain !== selectedChain) return false;
            if (currentTab === 'ALPHA') return a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha);
            if (currentTab === 'MAX_ALPHA') return a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha);
            if (currentTab === 'WATCHLIST') return matchesWatchlistWorkspace(a);
            return true;
          })
        : [],
    [alphas, selectedChain, isCurrentTabAuthorized, currentTab, matchesWatchlistWorkspace]
  );

  const pinnedCampaigns = useMemo(
    () => campaigns.filter((c) => Boolean(c.pinned)),
    [campaigns]
  );

  const totalPinned = pinnedCalls.length + pinnedCampaigns.length;

  const activeRaidsCount = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return campaigns.filter(
      (c) => c.status === 'ACTIVE' && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)
    ).length;
  }, [campaigns]);

  const currentTabBaseAlphas = useMemo(() => {
    if (!isCurrentTabAuthorized) return [];
    if (currentTab === 'ALPHA') {
      return alphas.filter((a) => a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha));
    }
    if (currentTab === 'MAX_ALPHA') {
      return alphas.filter((a) => a.callType === 'MAX_ALPHA' || Boolean(a.isMaxAlpha));
    }
    if (currentTab === 'WATCHLIST') {
      return alphas.filter(matchesWatchlistWorkspace);
    }
    return alphas;
  }, [alphas, currentTab, isCurrentTabAuthorized, matchesWatchlistWorkspace]);

  const visibleAlphas = useMemo(
    () => currentTabBaseAlphas,
    [currentTabBaseAlphas]
  );

  const newCallsCount = useMemo(() => {
    if (currentMembershipTier === 'FREE') return 0;
    return alphas.filter(
      (a) => (a.callType === 'ALPHA' || (!a.callType && !a.isMaxAlpha)) && a.ageMinutes <= 180
    ).length;
  }, [alphas, currentMembershipTier]);

  // Publish live counts & tier locks to DashboardSidebar via DashboardNavigationContext
  const setSidebarItemState = navCtx?.setItemState;
  useEffect(() => {
    if (!setSidebarItemState) return;
    setSidebarItemState({
      ALPHA: {
        locked: currentMembershipTier === 'FREE',
        count: currentMembershipTier === 'FREE' ? undefined : alphaCallsCount,
      },
      MAX_ALPHA: {
        locked: currentMembershipTier !== 'PRO',
        count: currentMembershipTier !== 'PRO' ? undefined : maxAlphaCallsCount,
      },
      WATCHLIST: {
        locked: currentMembershipTier === 'FREE',
        count: currentMembershipTier === 'FREE' ? undefined : savedWatchlistCount,
      },
      SOCIAL: {
        count: campaigns.length,
      },
    });
  }, [
    setSidebarItemState,
    currentMembershipTier,
    alphaCallsCount,
    maxAlphaCallsCount,
    savedWatchlistCount,
    campaigns.length,
  ]);

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
        if (sortBy === 'CHANGE') return compareChangeDesc(a, b);
        return a.ageMinutes - b.ageMinutes;
      });
  }, [visibleAlphas, selectedChain, searchQuery, activeFilter, watchlist, sortBy]);

  const topWinningCoins = useMemo(
    () =>
      alphas
        .filter(
          (a) =>
            a.callType !== 'WATCHLIST' &&
            (!a.isMaxAlpha || isProOrAdmin) &&
            a.change24hPct !== null
        )
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
    return (
      <div className="space-y-8">
        <LockedTerminal />
        {currentTab === 'OVERVIEW' && <DashboardLedgerEmbed />}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg bg-surface border border-brand text-white font-sans text-xs font-semibold flex items-center gap-2.5 shadow-none"
        >
          <Check className="w-4 h-4 text-brand shrink-0" />
          <span className="truncate max-w-md">{toastMessage}</span>
        </div>
      )}

      {/* 1. DISCLAIMER BANNER */}
      <div className="rounded-xl bg-surface border border-border-default p-3.5 sm:p-4 flex items-center gap-3">
        <AlertTriangle className="w-4 h-4 text-brand shrink-0" />
        <p className="font-sans text-xs text-muted leading-relaxed">
          <strong className="text-white uppercase tracking-wider mr-1.5">
            ALPHA CALLS DISCLAIMER:
          </strong>
          All users execute trades independently at their own risk (DYOR). Information provided here is for research purposes only and digital assets carry severe volatility.
        </p>
      </div>

      {/* WALLET SIGNATURE / VERIFICATION BANNER */}
      {connected && (needsSignature || verificationState === 'CONNECTED_UNVERIFIED' || verificationState === 'VERIFICATION_FAILED') && (
        <div className="rounded-xl bg-surface border-2 border-brand p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-none">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-surface-card border border-brand flex items-center justify-center text-brand shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-sans text-xs font-black uppercase text-brand tracking-wide">
                  CRYPTOGRAPHIC VERIFICATION REQUIRED
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-brand/15 text-brand border border-brand/30 font-bold">
                  {verificationState === 'VERIFICATION_FAILED' ? 'SIGNATURE FAILED' : 'ACTION REQUIRED'}
                </span>
              </div>
              <p className="font-sans text-xs text-muted leading-relaxed">
                Sign a one-time message in your wallet to verify ownership of <strong className="text-white tnum">{shortAddress}</strong> and unlock your membership access & trade calls. No transaction fee.
              </p>
              {apiError && verificationState === 'VERIFICATION_FAILED' && (
                <p role="alert" className="font-mono text-xs text-danger font-semibold">{apiError}</p>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => requestUnlockSignature()}
            disabled={apiLoading || verificationState === 'VERIFYING'}
            loading={apiLoading || verificationState === 'VERIFYING'}
            className="min-h-[44px] px-6 text-xs font-black uppercase shrink-0"
          >
            <KeyRound className="w-4 h-4 mr-2" />
            <span>VERIFY WALLET</span>
          </Button>
        </div>
      )}

      {/* WORKSPACE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border-default">
        <div>
          <h2 className="font-sans text-xl sm:text-2xl font-black text-white tracking-tight">
            {WORKSPACE_TITLES[currentTab].title}
          </h2>
          <p className="font-sans text-xs text-muted mt-0.5">
            {WORKSPACE_TITLES[currentTab].subtitle}
          </p>
        </div>

        {searchQuery.trim() && (currentTab === 'OVERVIEW' || currentTab === 'SOCIAL' || currentTab === 'STAKE') && (
          <div className="flex items-center gap-2 rounded-lg bg-surface border border-brand/40 px-3 py-1.5 font-sans text-xs">
            <Search className="w-3.5 h-3.5 text-brand shrink-0" />
            <span className="text-muted">
              Search active: <strong className="text-white">{searchQuery}</strong>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleSelectTab('ALPHA')}
              className="h-7 px-2.5 text-xs font-bold text-brand"
            >
              View in Alpha
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="h-7 px-2 text-xs text-muted hover:text-white"
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* 2. OVERVIEW WORKSPACE — Account, Holdings, Membership & Verified Activity */}
      {currentTab === 'OVERVIEW' && (
        <DashboardOverview
          connected={connected}
          shortAddress={shortAddress}
          tier={tier}
          formattedBalance={formattedBalance}
          alphasCount={alphaCallsCount}
          newCallsCount={newCallsCount}
          raidsCount={activeRaidsCount}
          watchlistCount={watchlistCallsCount}
          isUnlocked={isUnlocked}
          onCopyGenesisCa={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$H42', e)}
          copiedGenesisCa={copiedId === 'hero-gen-ca'}
          onSelectFilter={(f) => {
            if (f === 'all') setActiveFilter('ALL');
            else if (f === 'new') setActiveFilter('NEW');
            else if (f === 'watchlist') {
              setWatchlistMode('PLATFORM');
              setActiveFilter('ALL');
            }
          }}
          onSelectTab={(tab) => {
            if (tab === 'ALPHA' || tab === 'alphas') handleSelectTab('ALPHA');
            else if (tab === 'SOCIAL' || tab === 'raids') handleSelectTab('SOCIAL');
            else if (tab === 'WATCHLIST') handleSelectTab('WATCHLIST');
            else if (tab === 'MAX_ALPHA') handleSelectTab('MAX_ALPHA');
          }}
        >
          {/* Telegram Verification & Live StakePoint Staking Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            <TelegramVerificationCard connected={connected} isPro={isUnlocked} />
            <DashboardStakingCard showTelegram={false} />
          </div>

          {/* Historical Verified Multipliers Ledger */}
          <DashboardLedgerEmbed />

          {/* Multi-Chain Wallet Binding & Telegram Call Alerts Utility Bar */}
          {isUnlocked && (
            <div className="rounded-xl bg-surface border border-border-default p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              <div className="lg:col-span-7 space-y-1.5">
                <h3 className="font-sans text-base font-extrabold text-white">
                  Multi-Chain Wallet Binding &amp; Telegram Call Alerts
                </h3>
                <p className="font-sans text-xs text-muted leading-relaxed">
                  Your Solana wallet (<span className="font-mono text-white">{shortAddress}</span>)
                  is verified with{' '}
                  <strong className="text-brand">{formattedBalance} $H42</strong>.
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
                      className="flex-1 h-10 px-3 rounded-lg bg-surface-card border border-border-default font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus:border-brand"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="md"
                      className="h-10 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default font-sans text-xs font-bold text-brand cursor-pointer shrink-0 transition-colors"
                    >
                      {evmSaved ? 'MAPPED ✓' : 'MAP 0x'}
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-brand-bg border border-brand-border font-mono text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-brand font-bold uppercase text-xs">MAPPED:</span>
                      <span className="text-white truncate font-medium">{boundEvmAddress}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setBoundEvmAddress('');
                        setEvmDraft('');
                      }}
                      className="h-auto p-0 text-muted hover:text-danger ml-2 text-xs underline cursor-pointer shrink-0 hover:bg-transparent"
                      title="Change mapped address"
                    >
                      Change
                    </Button>
                  </div>
                )}
                <TelegramAlerts />
              </div>
            </div>
          )}
        </DashboardOverview>
      )}

      {/* 4. ADMIN COMMAND DESK (Authoritative Admin Only) */}
      {isAdmin && currentTab !== 'STAKE' && (
        <div className="rounded-xl bg-surface border-2 border-brand overflow-hidden">
          <div className="px-5 py-3.5 bg-surface-card border-b border-border-default flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded bg-brand text-canvas font-mono text-xs font-black uppercase">
                MASTER ADMIN DESK
              </span>
              {adminDeskTab === 'CALLS' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAdminForm(!showAdminForm)}
                  className="font-sans font-bold text-brand border-brand hover:bg-surface-3"
                >
                  {showAdminForm ? 'Hide Post Form' : '+ Post New Alpha Call'}
                </Button>
              )}
            </div>

            {/* Admin Desk Navigation Tabs */}
            <div className="flex items-center bg-surface border border-border-default rounded-lg p-0.5 font-sans text-xs">
              <Button
                type="button"
                variant={adminDeskTab === 'CALLS' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setAdminDeskTab('CALLS')}
                className={adminDeskTab === 'CALLS' ? 'bg-alpha-strong text-white border border-alpha-border' : 'text-muted hover:text-white'}
              >
                <Target className="w-3.5 h-3.5 mr-1.5" />
                <span>Alpha Calls Desk</span>
              </Button>
              <Button
                type="button"
                variant={adminDeskTab === 'CAMPAIGNS' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setAdminDeskTab('CAMPAIGNS')}
                className={adminDeskTab === 'CAMPAIGNS' ? 'bg-raid-strong text-white border border-raid-border' : 'text-muted hover:text-white'}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                <span>⚡ X Raid Campaigns &amp; Airdrops</span>
              </Button>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        className="text-xs text-muted hover:text-danger underline h-auto p-0"
                      >
                        Cancel Edit
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-6 space-y-1">
                      <label htmlFor="alpha-form-ca" className="block font-sans text-xs font-bold text-muted uppercase">
                        Contract Address (CA) *
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="alpha-form-ca"
                          type="text"
                          value={formCa}
                          onChange={(e) => setFormCa(e.target.value)}
                          placeholder="Paste token contract address..."
                          className="flex-1 h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                          required
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          onClick={() => handleAutoFillDexScreener()}
                          disabled={fetchingDex}
                          loading={fetchingDex}
                          className="h-10 px-3 text-brand hover:border-brand shrink-0"
                        >
                          {fetchingDex ? 'Fetching...' : 'Auto-fill'}
                        </Button>
                      </div>
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label htmlFor="alpha-form-name" className="block font-sans text-xs font-bold text-muted uppercase">
                        Token Name *
                      </label>
                      <input
                        id="alpha-form-name"
                        type="text"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Synapse Labs"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        required
                      />
                    </div>

                    <div className="md:col-span-3 space-y-1">
                      <label htmlFor="alpha-form-ticker" className="block font-sans text-xs font-bold text-muted uppercase">
                        Ticker *
                      </label>
                      <input
                        id="alpha-form-ticker"
                        type="text"
                        value={formTicker}
                        onChange={(e) => setFormTicker(e.target.value)}
                        placeholder="e.g. $SYN"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-12 gap-3">
                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-chain" className="block font-sans text-xs font-bold text-muted uppercase">
                        Chain
                      </label>
                      <select
                        id="alpha-form-chain"
                        value={formChain}
                        onChange={(e) => setFormChain(e.target.value as Chain)}
                        className="w-full h-10 px-2 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer"
                      >
                        {['SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-entry-mc" className="block font-sans text-xs font-bold text-muted uppercase">
                        Entry MC
                      </label>
                      <input
                        id="alpha-form-entry-mc"
                        type="text"
                        value={formEntryMc}
                        onChange={(e) => setFormEntryMc(e.target.value)}
                        placeholder="$250K"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-current-mc" className="block font-sans text-xs font-bold text-muted uppercase">
                        Current MC
                      </label>
                      <input
                        id="alpha-form-current-mc"
                        type="text"
                        value={formCurrentMc}
                        onChange={(e) => setFormCurrentMc(e.target.value)}
                        placeholder="$250K"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-risk" className="block font-sans text-xs font-bold text-muted uppercase">
                        Risk (1-5)
                      </label>
                      <input
                        id="alpha-form-risk"
                        type="number"
                        min="1"
                        max="5"
                        value={formRiskLevel}
                        onChange={(e) => setFormRiskLevel(Number(e.target.value))}
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-stop-loss" className="block font-sans text-xs font-bold text-muted uppercase">
                        Stop Loss (SL)
                      </label>
                      <input
                        id="alpha-form-stop-loss"
                        type="text"
                        value={formStopLoss}
                        onChange={(e) => setFormStopLoss(e.target.value)}
                        placeholder="-25% SL"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-1">
                      <label htmlFor="alpha-form-take-profits" className="block font-sans text-xs font-bold text-muted uppercase">
                        Take Profits
                      </label>
                      <input
                        id="alpha-form-take-profits"
                        type="text"
                        value={formTakeProfits}
                        onChange={(e) => setFormTakeProfits(e.target.value)}
                        placeholder="2x, 5x, 10x"
                        className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-mono text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="alpha-form-summary" className="block font-sans text-xs font-bold text-muted uppercase">
                      Thesis / Research Summary
                    </label>
                    <input
                      id="alpha-form-summary"
                      type="text"
                      value={formSummary}
                      onChange={(e) => setFormSummary(e.target.value)}
                      placeholder="Solana AI infrastructure play with growing holder distribution..."
                      className="w-full h-10 px-3 rounded-lg bg-surface border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    />
                  </div>

                  {/* Section 5: Admin Post Classification — Single Source of Truth */}
                  <div className="space-y-1.5 pt-1">
                    <span className="block font-sans text-xs font-bold text-muted uppercase tracking-wider">
                      Destination Tab Classification * (Single Source of Truth)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFormCallType('ALPHA');
                          setFormMaxAlpha(false);
                        }}
                        aria-pressed={formCallType === 'ALPHA'}
                        className={`h-auto p-3 rounded-lg border text-left block w-full transition-colors duration-150 cursor-pointer ${
                          formCallType === 'ALPHA'
                            ? 'bg-purple-950/40 border-purple-500 text-white hover:bg-purple-950/50'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted hover:bg-surface'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-purple-400">ALPHA</span>
                          <span className="text-xs font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">MEMBER+</span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-snug">Curated Alpha trade calls with TP/SL risk telemetry.</p>
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFormCallType('MAX_ALPHA');
                          setFormMaxAlpha(true);
                        }}
                        aria-pressed={formCallType === 'MAX_ALPHA'}
                        className={`h-auto p-3 rounded-lg border text-left block w-full transition-colors duration-150 cursor-pointer ${
                          formCallType === 'MAX_ALPHA'
                            ? 'bg-amber-950/40 border-amber-500 text-white hover:bg-amber-950/50'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted hover:bg-surface'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-amber-400">MAX ALPHA</span>
                          <span className="text-xs font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">PRO ONLY</span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-snug">High-conviction premium Alpha reserved for PRO members.</p>
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFormCallType('WATCHLIST');
                          setFormMaxAlpha(false);
                        }}
                        aria-pressed={formCallType === 'WATCHLIST'}
                        className={`h-auto p-3 rounded-lg border text-left block w-full transition-colors duration-150 cursor-pointer ${
                          formCallType === 'WATCHLIST'
                            ? 'bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500/60 text-white hover:bg-emerald-950/50'
                            : 'bg-surface border-border-default text-foreground-muted hover:border-border-muted hover:bg-surface'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-sans text-xs font-black uppercase text-emerald-400">WATCHLIST</span>
                          <span className="text-xs font-mono font-bold text-muted px-1.5 py-0.5 rounded bg-surface-card border border-border-default">
                            {formCallType === 'WATCHLIST' ? 'SELECTED · PRO' : 'PRO ONLY'}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 leading-snug">Curated long-term projects for ongoing research.</p>
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <label className="inline-flex items-center gap-2 font-sans text-xs font-bold text-white cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formPinned}
                        onChange={(e) => setFormPinned(e.target.checked)}
                        className="w-4 h-4 rounded border-border-default text-brand"
                      />
                      <Pin className="w-3.5 h-3.5 text-brand" />
                      <span>Pin Priority to Top</span>
                    </label>

                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      disabled={submittingCall}
                      loading={submittingCall}
                      className="px-6 text-xs font-black uppercase"
                    >
                      {submittingCall ? 'Processing...' : editingCall ? 'Save Changes' : '+ Publish Call'}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}

      {/* 5. PINNED PRIORITY OPPORTUNITIES (Alpha & Max Alpha Workspaces) */}
      {pinnedCalls.length > 0 && activeFilter === 'ALL' && (currentTab === 'ALPHA' || currentTab === 'MAX_ALPHA') && isUnlocked && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-md bg-surface border border-border-default text-white font-mono text-xs font-black uppercase inline-flex items-center gap-1.5 shadow-none">
              <Pin className="w-3.5 h-3.5 text-brand" />
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

      {/* 6. DEDICATED FEATURE WORKSPACES (Driven by DashboardSidebar) */}
      {currentTab !== 'OVERVIEW' && (
      <div id="feed-tabs" className="space-y-4">
        <div
          role="tabpanel"
          id={`tabpanel-${currentTab.toLowerCase()}`}
          aria-labelledby={`tab-${currentTab.toLowerCase()}`}
          tabIndex={0}
          className="min-h-[500px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
        {currentTab === 'STAKE' ? (
          <div data-testid="stake-workspace" className="space-y-6 pt-1">
            {(!isWalletVerified || stakeRequiresAuth) && (
              <div className="rounded-xl bg-surface border border-brand/50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-brand shrink-0" />
                    <span className="font-sans text-xs font-black uppercase text-brand tracking-wide">
                      Verify Wallet to Load &amp; Confirm Stakes
                    </span>
                  </div>
                  <p className="font-sans text-xs text-muted leading-relaxed">
                    Sign a one-time verification message in <strong className="text-white tnum">{shortAddress}</strong> to load your on-chain stake status and confirm StakePoint transactions. No gas fee.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => requestUnlockSignature()}
                  disabled={apiLoading || verificationState === 'VERIFYING'}
                  loading={apiLoading || verificationState === 'VERIFYING'}
                  className="min-h-[44px] px-5 text-xs font-black uppercase shrink-0"
                >
                  <KeyRound className="w-4 h-4 mr-1.5" />
                  <span>VERIFY WALLET</span>
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5 space-y-4">
                <DashboardStakingCard showTelegram={false} />
              </div>

              <div className="lg:col-span-7 space-y-4">
                {stakeStatusLoading ? (
                  <div className="rounded-xl bg-surface border border-border-default p-6 space-y-4">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-40 w-full" />
                  </div>
                ) : stakeStatusError ? (
                  <div role="alert" className="rounded-xl bg-danger/10 border border-danger/40 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-danger text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{stakeStatusError}</span>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={fetchStakeStatus}
                      className="font-mono text-xs font-bold shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                      Retry
                    </Button>
                  </div>
                ) : stakeStatusData ? (
                  <div className="rounded-xl bg-surface/50 border border-border-default p-5 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between gap-2 pb-3 border-b border-border-default">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted">
                        Verify &amp; Confirm StakePoint Transaction
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={fetchStakeStatus}
                          className="h-8 px-2.5 text-xs font-mono text-muted hover:text-white"
                        >
                          <RefreshCw className="w-3.5 h-3.5 mr-1" />
                          Refresh
                        </Button>
                        <Link
                          href="/dashboard/stake"
                          className="inline-flex items-center gap-1 text-xs font-mono font-bold text-brand hover:underline"
                        >
                          <span>Full view</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                    <StakeClientView
                      key={`${stakeStatusData.wallet}-${stakeStatusData.stake.amount_raw}-${stakeStatusData.stake.status}`}
                      initialData={stakeStatusData}
                      embedded
                    />
                  </div>
                ) : (
                  <div className="rounded-xl bg-surface border border-border-default p-6 space-y-3 text-center">
                    <Lock className="w-6 h-6 text-brand mx-auto" />
                    <h3 className="font-sans text-base font-extrabold text-white uppercase tracking-tight">
                      Wallet Signature Required for Stake Confirmation
                    </h3>
                    <p className="font-sans text-xs text-muted max-w-md mx-auto leading-relaxed">
                      Staking position status and StakePoint transaction verification are tied to your signed wallet session. Verify wallet ownership above to proceed.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : currentTab === 'SOCIAL' ? (
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
        ) : (
          <div className="space-y-6">
            {/* Watchlist Mode Switcher: Actual Saved Watchlist vs. Lab Curated Research */}
            {currentTab === 'WATCHLIST' && currentMembershipTier !== 'FREE' && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface border border-border-default p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="watchlist-mode-saved"
                    onClick={() => setWatchlistMode('SAVED')}
                    className={`min-h-[40px] px-4 rounded-lg font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition-colors cursor-pointer ${
                      watchlistMode === 'SAVED'
                        ? 'bg-brand text-canvas font-black'
                        : 'bg-surface-card text-muted hover:text-white border border-border-default'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" />
                    <span>My Saved Watchlist</span>
                    <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] tnum ${watchlistMode === 'SAVED' ? 'bg-canvas/20 text-canvas' : 'bg-surface text-white'}`}>
                      {savedWatchlistCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="watchlist-mode-platform"
                    onClick={() => setWatchlistMode('PLATFORM')}
                    className={`min-h-[40px] px-4 rounded-lg font-sans text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 transition-colors cursor-pointer ${
                      watchlistMode === 'PLATFORM'
                        ? 'bg-brand text-canvas font-black'
                        : 'bg-surface-card text-muted hover:text-white border border-border-default'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Lab Curated Research</span>
                    {currentMembershipTier === 'PRO' ? (
                      <span className={`px-1.5 py-0.5 rounded font-mono text-[10px] tnum ${watchlistMode === 'PLATFORM' ? 'bg-canvas/20 text-canvas' : 'bg-surface text-white'}`}>
                        {watchlistCallsCount}
                      </span>
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                    )}
                  </button>
                </div>

                <span className="px-2 font-mono text-[11px] text-muted">
                  {watchlistMode === 'SAVED'
                    ? 'Tokens you starred across Alpha & Max Alpha calls'
                    : 'Long-term projects curated by the Lab (Pro)'}
                </span>
              </div>
            )}

            {!isCurrentTabAuthorized ? (
              <MembershipRestrictionScreen
                category={currentTab as RestrictedCategory}
                userTier={currentMembershipTier}
                needsVerification={needsSignature || verificationState === 'CONNECTED_UNVERIFIED' || verificationState === 'VERIFICATION_FAILED'}
                onVerifyClick={requestUnlockSignature}
                onUpgradeClick={() => {
                  if (!connected) {
                    connectWallet();
                  } else {
                    handleSelectTab('STAKE');
                  }
                }}
              />
            ) : (
          <div className="space-y-6">
            {/* 7. ALL CATEGORIZED ALPHA / WATCHLIST / MAX ALPHA CALLS */}
            <div className="space-y-4 pt-2">
              {apiError && (
                <div role="alert" className="rounded-xl bg-danger/10 border border-danger/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans text-xs">
                  <div className="flex items-center gap-2.5 text-danger font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>RPC / Telemetry Notice: {apiError}</span>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => refreshAll()}
                    className="font-mono text-xs font-bold border-border-default hover:border-danger text-white shrink-0"
                  >
                    Retry Connection ⟳
                  </Button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="font-sans text-lg sm:text-xl font-extrabold text-white">
                    {currentTab === 'ALPHA'
                      ? 'Curated Alpha Trade Calls'
                      : currentTab === 'WATCHLIST'
                      ? watchlistMode === 'SAVED'
                        ? 'Your Saved Watchlist Tokens'
                        : 'Curated Watchlist & Research Projects'
                      : 'Max Alpha Premium High-Conviction Calls'}
                  </h2>
                  <p className="font-sans text-xs text-muted">
                    Showing <strong className="text-brand font-mono">{filteredTokens.length}</strong> calls
                    • Multi-chain coverage across SOL, BSC, ETH, BASE, ROBIN, AVAX
                  </p>
                </div>

                {(searchQuery || selectedChain !== 'ALL' || activeFilter !== 'ALL') && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={resetFilters}
                    className="self-start sm:self-auto font-mono text-xs font-bold text-brand border-border-default hover:border-brand inline-flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Filters</span>
                  </Button>
                )}
              </div>

              {/* Blockchain Filter Bar + Filter Pills + Sort + Grid/Table Toggle */}
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 pb-3 border-b border-border-default">
                {/* Blockchain Tabs */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ALL_CHAINS.map((ch) => {
                    const active = selectedChain === ch;
                    return (
                      <Button
                        key={ch}
                        type="button"
                        variant={active ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setSelectedChain(ch)}
                        className={`h-8 px-2.5 rounded-md font-mono text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors inline-flex items-center justify-center ${
                          active
                            ? 'bg-brand text-canvas border-brand hover:bg-brand'
                            : 'bg-surface hover:bg-surface-card text-white border-border-default'
                        }`}
                      >
                        <span>{ch}</span>
                        <span className={`ml-1 text-xs ${active ? 'text-canvas' : 'text-brand'}`}>
                          ({chainCounts[ch] ?? 0})
                        </span>
                      </Button>
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
                      <Button
                        key={tab.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveFilter(tab.id)}
                        className={`h-[26px] px-2 rounded font-bold cursor-pointer transition-colors inline-flex items-center justify-center text-xs ${
                          activeFilter === tab.id
                            ? tab.id === 'MAX_ALPHA'
                              ? 'bg-alpha-strong text-white hover:bg-alpha-strong'
                              : 'bg-brand text-canvas hover:bg-brand'
                            : tab.id === 'MAX_ALPHA'
                            ? 'text-alpha-primary hover:text-white'
                            : 'text-muted hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </Button>
                    ))}
                  </div>

                  {/* Sort Selector */}
                  <div className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md bg-surface border border-border-default font-sans text-xs text-muted">
                    <Filter className="w-3.5 h-3.5 text-brand shrink-0" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortKey)}
                      className="bg-transparent text-white font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer text-xs"
                    >
                      <option value="PRIORITY" className="bg-surface">Sort: Pinned &amp; Newest</option>
                      <option value="MCAP" className="bg-surface">Sort: Market Cap</option>
                      <option value="CHANGE" className="bg-surface">Sort: 24h Gain</option>
                      <option value="NEWEST" className="bg-surface">Sort: Newest Call</option>
                    </select>
                  </div>

                  {/* View Mode Toggle */}
                  <div className="h-8 inline-flex items-center bg-surface border border-border-default rounded-md p-0.5 font-sans text-xs">
                    <Button
                      type="button"
                      variant={viewMode === 'GRID' ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('GRID')}
                      className={`h-[26px] inline-flex items-center gap-1 px-2 rounded font-semibold cursor-pointer text-xs ${
                        viewMode === 'GRID' ? 'bg-brand text-canvas font-black hover:bg-brand' : 'text-muted hover:text-white'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5 mr-1" />
                      <span>Cards</span>
                    </Button>
                    <Button
                      type="button"
                      variant={viewMode === 'TABLE' ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('TABLE')}
                      className={`h-[26px] inline-flex items-center gap-1 px-2 rounded font-semibold cursor-pointer text-xs ${
                        viewMode === 'TABLE' ? 'bg-brand text-canvas font-black hover:bg-brand' : 'text-muted hover:text-white'
                      }`}
                    >
                      <List className="w-3.5 h-3.5 mr-1" />
                      <span>Table</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Personal Watchlist Management with Opt-In Alerts (Instruction 34) */}
              {(activeFilter === 'WATCHLIST' || (currentTab === 'WATCHLIST' && watchlistMode === 'SAVED')) && (
                <WatchlistView
                  watchlistIds={watchlist}
                  allCalls={alphas}
                  onToggleWatchlist={toggleWatchlist}
                  className="mb-4"
                />
              )}

              {/* View Mode A: Grid */}
              {viewMode === 'GRID' ? (
                apiLoading && alphas.length === 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-surface border border-border-default p-4 space-y-3"
                      >
                        <Skeleton className="w-full h-12 rounded-md" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ))}
                  </div>
                ) : filteredTokens.length === 0 ? (
                  currentTab === 'WATCHLIST' && watchlistMode === 'SAVED' && savedWatchlistCount === 0 ? (
                    <div className="flex justify-center pt-1">
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={() => handleSelectTab('ALPHA')}
                        className="font-sans text-xs font-black uppercase"
                      >
                        Browse Alpha Calls to Star Tokens →
                      </Button>
                    </div>
                  ) : (
                    <EmptyState
                      message="No calls match these filters."
                      actionLabel="Clear filters"
                      onAction={resetFilters}
                    />
                  )
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
                        {(currentTab !== 'WATCHLIST' || watchlistMode === 'SAVED') && (
                          <th className="py-3.5 px-4 text-right font-bold">Entry MC</th>
                        )}
                        <th className="py-3.5 px-4 text-right font-bold">Current MC</th>
                        {(currentTab !== 'WATCHLIST' || watchlistMode === 'SAVED') && (
                          <>
                            <th className="py-3.5 px-4 text-center font-bold">Risk Ratio</th>
                            <th className="py-3.5 px-4 font-bold">Take Profit</th>
                          </>
                        )}
                        <th className="py-3.5 px-4 text-right font-bold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default font-sans text-xs">
                      {filteredTokens.length === 0 ? (
                        <tr>
                          <td colSpan={currentTab === 'WATCHLIST' && watchlistMode === 'PLATFORM' ? 4 : 7} className="py-8 text-center text-muted font-mono text-xs">
                            No alpha calls match active filters.
                          </td>
                        </tr>
                      ) : (
                        filteredTokens.map((token) => {
                          const marketUrl = getPrimaryMarketUrl(token);
                          const isRowWatchlist = token.callType === 'WATCHLIST';
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
                              className="hover:bg-surface-card transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus:bg-surface-card"
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
                                      <span className="font-mono text-xs text-brand font-bold">
                                        {token.ticker}
                                      </span>
                                      {isRowWatchlist ? (
                                        <span className="px-1.5 py-0.2 rounded bg-surface-card border border-border-default text-emerald-400 font-mono text-xs font-black uppercase">
                                          RESEARCH
                                        </span>
                                      ) : (
                                        <>
                                          {token.outcome === 'PROFIT' && (
                                            <span className="px-1.5 py-0.2 rounded bg-brand text-canvas font-mono text-xs font-black uppercase">
                                              PROFIT ✓
                                            </span>
                                          )}
                                          {token.outcome === 'LOSS' && (
                                            <span className="px-1.5 py-0.2 rounded bg-danger text-white font-mono text-xs font-black uppercase">
                                              LOSS ✕
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    <div className="font-mono text-xs text-muted flex items-center gap-2 mt-0.5">
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
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={(e) =>
                                      handleCopyText(token.ca!, `tbl-${token.id}`, token.ticker, e)
                                    }
                                    className="h-7 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default text-white font-semibold cursor-pointer tnum text-xs"
                                  >
                                    <span>
                                      {token.ca.slice(0, 6)}...{token.ca.slice(-4)}
                                    </span>
                                    {copiedId === `tbl-${token.id}` ? (
                                      <Check className="w-3.5 h-3.5 text-brand shrink-0" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5 text-brand shrink-0" />
                                    )}
                                  </Button>
                                )}
                              </td>

                              {(currentTab !== 'WATCHLIST' || watchlistMode === 'SAVED') && (
                                <td className="py-3.5 px-4 text-right font-mono tnum">
                                  <div className="font-bold text-white text-sm">
                                    {isRowWatchlist ? '—' : token.entryMarketCap || '—'}
                                  </div>
                                </td>
                              )}

                              <td className="py-3.5 px-4 text-right font-mono tnum">
                                <div className="font-black text-brand-bright text-sm">
                                  {token.marketCap || '—'}
                                </div>
                              </td>

                              {(currentTab !== 'WATCHLIST' || watchlistMode === 'SAVED') && (
                                <>
                                  <td className="py-3.5 px-4 text-center font-mono text-xs">
                                    {isRowWatchlist ? (
                                      <span className="text-muted">—</span>
                                    ) : (
                                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card border border-border-default">
                                        <span className="text-white font-bold">
                                          Lvl {token.risk}/5
                                        </span>
                                        <span className="text-dim">•</span>
                                        <span className="text-alpha-primary font-bold">
                                          {token.riskRewardRatio || '2.5:1'}
                                        </span>
                                      </div>
                                    )}
                                  </td>

                                  <td className="py-3.5 px-4 font-mono text-xs">
                                    {isRowWatchlist ? (
                                      <span className="text-muted">—</span>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-1">
                                        {token.takeProfits.map((tp) => (
                                          <span
                                            key={tp.label}
                                            className={`px-1.5 py-0.5 rounded text-xs font-extrabold border ${
                                              tp.hit
                                                ? 'bg-brand text-canvas border-brand'
                                                : 'bg-surface-card text-white border-border-default'
                                            }`}
                                          >
                                            {tp.label}
                                            {tp.hit ? ' ✓' : ''}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </>
                              )}

                              <td className="py-3.5 px-4 text-right font-sans text-xs">
                                <div className="inline-flex items-center gap-1.5">
                                  {isAdmin && (
                                    <>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        aria-label="Edit Call"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleStartEditCall(token);
                                        }}
                                        className="h-7 w-7 p-0 rounded-md border border-border-default bg-surface-card text-muted hover:text-brand hover:border-brand cursor-pointer transition-colors"
                                        title="Edit Call"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        aria-label="Toggle Pin"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          togglePinCall(token.id, !token.pinned);
                                        }}
                                        className={`h-7 w-7 p-0 rounded-md border cursor-pointer ${
                                          token.pinned
                                            ? 'bg-brand text-canvas border-brand hover:bg-brand'
                                            : 'bg-surface-card text-muted border-border-default'
                                        }`}
                                        title="Toggle Pin"
                                      >
                                        <Pin className="w-3.5 h-3.5" />
                                      </Button>
                                    </>
                                  )}
                                  <a
                                    href={marketUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand text-white font-extrabold"
                                  >
                                    <span>Market</span>
                                    <ExternalLink className="w-3.5 h-3.5 text-brand" />
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
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect ${coin.name} (${coin.ticker})`}
                      onClick={() => setInspectedToken(coin)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setInspectedToken(coin);
                        }
                      }}
                      className="py-3 flex items-center justify-between gap-3 hover:bg-surface-card/60 px-2 rounded-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
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
                            <span className="font-mono text-xs text-brand font-bold">
                              {coin.ticker}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-card border border-border-default font-mono text-xs text-white">
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
                            coin.change24hPct !== null && coin.change24hPct < 0 ? 'text-danger' : 'text-brand'
                          }`}
                        >
                          {formatChangePct(coin.change24hPct)}
                        </div>
                        <a
                          href={marketUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-brand hover:underline mt-1 font-bold"
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
        )}
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
