'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { AlphaItem, Campaign, Chain, FavoritePostKind } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TabularValue } from '@/components/primitives/TabularValue';
import { TradeWorkspaceSkeleton } from '@/components/skeletons/TradeWorkspaceSkeleton';
import { toast } from '@/lib/ui/toast';
import {
  MembershipRestrictionScreen,
  type UserMembershipTier,
  type RestrictedCategory,
} from './MembershipRestrictionScreen';
import { useGenesisBalance } from '@/context/GenesisContext';
import { canFetchSessionEndpoints } from '@/lib/auth/sessionGate';
import { GENESIS_MINT } from '@/lib/config';
import { TokenArtwork } from './TokenArtwork';
import { AlphaCallCard } from './AlphaCallCard';
import { MarketDataBadge, compareChangeDesc, formatChangePct } from './MarketDataBadge';
import { DashboardStakingCard } from '@/components/stake/DashboardStakingCard';
import { NextStepCard } from '@/components/dashboard/NextStepCard';
import { resolveUserState, stateMeta } from '@/lib/state/resolveUserState';
import { StakeClientView, type InitialStakeData } from '@/components/stake/StakeClientView';
import { LockedTerminal } from '@/components/LockedTerminal';
import { AlphaInspectorModal, getPrimaryMarketUrl } from './AlphaInspectorModal';
import { CampaignSection } from '@/components/campaigns/CampaignSection';
import { AdminWorkspace } from '@/components/admin/AdminWorkspace';
import { DashboardOverview } from './DashboardOverview';
import {
  useDashboardNavigation,
  type DashboardWorkspace,
} from './DashboardNavigationContext';
import {
  FILTER_CHAINS,
  WorkspaceFilterBar,
  createDefaultFilterState,
  type WorkspaceFilterState,
} from './WorkspaceFilterBar';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  Pin,
  RefreshCw,
  ShieldAlert,
  Star,
} from 'lucide-react';

export type DashboardTab = DashboardWorkspace;
type FilterableWorkspace = 'ALPHA' | 'MAX_ALPHA';

const DASHBOARD_TABS: DashboardTab[] = [
  'OVERVIEW',
  'ALPHA',
  'SOCIAL',
  'MAX_ALPHA',
  'STAKE',
  'ADMIN',
];

/** Reads `?tab=` from the current URL. Missing/unknown/legacy Watchlist values resolve to Overview. */
const readTabFromUrl = (): DashboardTab => {
  if (typeof window === 'undefined') return 'OVERVIEW';
  const tabParam = new URLSearchParams(window.location.search).get('tab')?.toUpperCase();
  if (tabParam === 'WATCHLIST') return 'OVERVIEW';
  return DASHBOARD_TABS.includes(tabParam as DashboardTab) ? (tabParam as DashboardTab) : 'OVERVIEW';
};

const WORKSPACE_TITLES: Record<DashboardTab, { title: string; subtitle: string }> = {
  OVERVIEW: { title: 'Overview', subtitle: 'Account summary, pinned posts, membership and call history' },
  ALPHA: { title: 'Alpha Calls', subtitle: 'Curated multi-chain trade setups with entry, TP and SL telemetry' },
  MAX_ALPHA: { title: 'Max Alpha', subtitle: 'High-conviction Pro setups restricted to StakePoint & Pro members' },
  SOCIAL: { title: 'Raid', subtitle: 'Community X reward campaigns and proof submissions' },
  STAKE: { title: 'Stake $H42', subtitle: 'StakePoint 90-day staking, transaction verification and Pro access' },
  ADMIN: { title: 'Admin Desk', subtitle: 'Centralized content publishing, drafts, archive and Raid management' },
};

const FILTER_PLACEHOLDERS: Record<FilterableWorkspace, string> = {
  ALPHA: 'Search Alpha Calls (token, ticker, CA, caller)...',
  MAX_ALPHA: 'Search Max Alpha calls (token, ticker, CA, caller)...',
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
    adminAlphas,
    adminActionError,
    watchlist,
    toggleWatchlist,
    favorites = [],
    toggleFavorite,
    favoriteError,
    clearFavoriteError,
    portfolio,
    boundEvmAddress,
    setBoundEvmAddress,
    createAlphaCall,
    updateAlphaCall,
    togglePinCall,
    deleteAlphaCall,
    setCallOutcome,
    getAdminHeaders,
    apiLoading,
    apiError,
    needsSignature,
    verificationState,
    demoEnabled,
    demoPreset,
    refreshAll,
    requestUnlockSignature,
  } = useGenesisBalance();

  const [fallbackTab, setFallbackTab] = useState<DashboardTab>('OVERVIEW');
  const currentTab: DashboardTab = navCtx ? navCtx.activeWorkspace : fallbackTab;

  // Strictly isolated per-workspace filter states (Section 10)
  const [filtersByWorkspace, setFiltersByWorkspace] = useState<
    Record<FilterableWorkspace, WorkspaceFilterState>
  >(() => ({
    ALPHA: createDefaultFilterState(),
    MAX_ALPHA: createDefaultFilterState(),
  }));

  const updateWorkspaceFilter = useCallback(
    (ws: FilterableWorkspace, patch: Partial<WorkspaceFilterState>) => {
      setFiltersByWorkspace((prev) => ({
        ...prev,
        [ws]: { ...prev[ws], ...patch },
      }));
    },
    []
  );

  const resetWorkspaceFilters = useCallback((ws: FilterableWorkspace) => {
    setFiltersByWorkspace((prev) => ({
      ...prev,
      [ws]: createDefaultFilterState(),
    }));
  }, []);

  const handleSelectTab = useCallback(
    (tab: DashboardTab) => {
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

  // Sync fallback URL state when running standalone without DashboardLayout
  useEffect(() => {
    if (navCtx) return;
    const handlePopState = () => {
      setFallbackTab(readTabFromUrl());
    };
    queueMicrotask(handlePopState);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navCtx]);

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
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

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

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    if (type === 'error') {
      toast.error(msg);
    } else {
      toast.success(msg);
    }
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  useEffect(() => {
    if (!favoriteError) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    showToast(favoriteError, 'error');
    clearFavoriteError?.();
  }, [favoriteError, clearFavoriteError, showToast]);

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
      showToast('Failed to copy to clipboard. Please copy manually.', 'error');
    }
  };

  const handleSaveEvm = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = setBoundEvmAddress(evmDraft.trim());
    if (ok) {
      setEvmSaved(true);
      if (evmTimeoutRef.current) clearTimeout(evmTimeoutRef.current);
      evmTimeoutRef.current = setTimeout(() => setEvmSaved(false), 2000);
      showToast('EVM address bound successfully.');
    } else {
      showToast('Invalid EVM address format: must start with 0x followed by 40 hex chars.', 'error');
    }
  };

  const isWalletVerified = canFetchSessionEndpoints(
    {
      connected,
      publicKeyBase58,
      needsSignature,
      verificationState,
      demoEnabled,
      demoPreset,
    },
    false
  );

  // Legacy ?tab=WATCHLIST links redirect cleanly onto Overview and focus My Pinned Posts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const rawTab = new URLSearchParams(window.location.search).get('tab')?.toUpperCase();
    if (rawTab === 'WATCHLIST' && currentTab === 'OVERVIEW') {
      const timer = setTimeout(() => {
        document.getElementById('pinned-posts')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentTab]);

  const fetchStakeStatus = useCallback(async () => {
    if (!isWalletVerified) {
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
  }, [connected, isWalletVerified]);

  useEffect(() => {
    if (currentTab !== 'STAKE') return;
    let active = true;
    const run = async () => {
      if (!isWalletVerified) {
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
      case 'MAX_ALPHA':
        return currentMembershipTier === 'PRO';
      case 'ADMIN':
        return Boolean(isAdmin);
      default:
        return false;
    }
  }, [currentTab, currentMembershipTier, isAdmin]);

  // Strictly scoped workspace datasets
  const alphaCallsList = useMemo(() => {
    if (currentMembershipTier === 'FREE') return [];
    return alphas.filter((a) => {
      if (a.callType === 'WATCHLIST') return false;
      const isAlphaFeed =
        a.callType === 'ALPHA' ||
        (!a.callType && !a.isMaxAlpha) ||
        (isProOrAdmin && Boolean(a.destinations?.includes('ALPHA')));
      if (!isAlphaFeed) return false;
      if (!isProOrAdmin && (a.isMaxAlpha || a.callType === 'MAX_ALPHA')) return false;
      return true;
    });
  }, [alphas, currentMembershipTier, isProOrAdmin]);

  const maxAlphaCallsList = useMemo(() => {
    if (currentMembershipTier !== 'PRO') return [];
    return alphas.filter(
      (a) =>
        a.callType === 'MAX_ALPHA' ||
        Boolean(a.isMaxAlpha) ||
        Boolean(a.destinations?.includes('MAX_ALPHA'))
    );
  }, [alphas, currentMembershipTier]);

  const totalPinnedCount = useMemo(() => {
    const savedCallCount =
      currentMembershipTier === 'FREE'
        ? 0
        : alphas.filter(
            (a) =>
              watchlist.includes(a.id) &&
              a.callType !== 'WATCHLIST' &&
              (isProOrAdmin || (!a.isMaxAlpha && a.callType !== 'MAX_ALPHA'))
          ).length;
    const savedRaidCount = favorites.filter(
      (f) => f.kind === 'RAID' && campaigns.some((c) => c.id === f.id)
    ).length;
    return savedCallCount + savedRaidCount;
  }, [currentMembershipTier, alphas, watchlist, isProOrAdmin, favorites, campaigns]);

  const alphaCallsCount = alphaCallsList.length;
  const maxAlphaCallsCount = maxAlphaCallsList.length;

  const activeRaidsCount = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    return campaigns.filter(
      (c) => c.status === 'ACTIVE' && (!c.expiresAt || new Date(c.expiresAt).getTime() > now)
    ).length;
  }, [campaigns]);

  const newCallsCount = useMemo(() => {
    return alphaCallsList.filter((a) => a.ageMinutes <= 180).length;
  }, [alphaCallsList]);

  // Publish live counts & locks to DashboardSidebar (Overview, Alpha Calls, Max Alpha, Raid, Stake + Admin)
  const setSidebarItemState = navCtx?.setItemState;
  useEffect(() => {
    if (!setSidebarItemState) return;
    setSidebarItemState({
      OVERVIEW: {
        count: totalPinnedCount > 0 ? totalPinnedCount : undefined,
      },
      ALPHA: {
        locked: currentMembershipTier === 'FREE',
        count: currentMembershipTier === 'FREE' ? undefined : alphaCallsCount,
      },
      MAX_ALPHA: {
        locked: currentMembershipTier !== 'PRO',
        count: currentMembershipTier !== 'PRO' ? undefined : maxAlphaCallsCount,
      },
      SOCIAL: {
        count: campaigns.length,
      },
      ...(isAdmin
        ? {
          ADMIN: {
            locked: false,
            count: adminAlphas?.length ?? alphas.length,
          },
        }
        : {}),
    });
  }, [
    setSidebarItemState,
    totalPinnedCount,
    currentMembershipTier,
    alphaCallsCount,
    maxAlphaCallsCount,
    campaigns.length,
    isAdmin,
    adminAlphas?.length,
    alphas.length,
  ]);

  const activeFilterableWorkspace: FilterableWorkspace | null =
    currentTab === 'ALPHA' || currentTab === 'MAX_ALPHA' ? currentTab : null;

  const activeFilterState = useMemo(
    () =>
      activeFilterableWorkspace
        ? filtersByWorkspace[activeFilterableWorkspace]
        : createDefaultFilterState(),
    [activeFilterableWorkspace, filtersByWorkspace]
  );

  const currentTabBaseAlphas = useMemo(() => {
    if (!isCurrentTabAuthorized) return [];
    if (currentTab === 'ALPHA') return alphaCallsList;
    if (currentTab === 'MAX_ALPHA') return maxAlphaCallsList;
    return [];
  }, [isCurrentTabAuthorized, currentTab, alphaCallsList, maxAlphaCallsList]);

  const chainCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: currentTabBaseAlphas.length };
    for (const ch of FILTER_CHAINS) {
      if (ch === 'ALL') continue;
      counts[ch] = currentTabBaseAlphas.filter((a) => a.chain === ch).length;
    }
    return counts;
  }, [currentTabBaseAlphas]);

  const filteredTokens = useMemo(() => {
    const q = activeFilterState.searchQuery.trim().toLowerCase();
    return currentTabBaseAlphas
      .filter((item) => {
        if (activeFilterState.selectedChain !== 'ALL' && item.chain !== activeFilterState.selectedChain) {
          return false;
        }
        if (q) {
          const matchName = item.name.toLowerCase().includes(q);
          const matchTicker = item.ticker.toLowerCase().includes(q);
          const matchCaller = item.caller.toLowerCase().includes(q);
          const matchChain = item.chain.toLowerCase().includes(q);
          const matchCa = item.ca?.toLowerCase().includes(q) ?? false;
          if (!matchName && !matchTicker && !matchCaller && !matchChain && !matchCa) {
            return false;
          }
        }
        switch (activeFilterState.activeFilter) {
          case 'PINNED':
            return item.pinned;
          case 'MOVERS':
            return item.change24hPct !== null && item.change24hPct >= 200;
          case 'NEW':
            return item.ageMinutes <= 180;
          case 'ALL':
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (activeFilterState.sortBy === 'PRIORITY') {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return a.ageMinutes - b.ageMinutes;
        }
        if (activeFilterState.sortBy === 'MCAP') return b.marketCapUsd - a.marketCapUsd;
        if (activeFilterState.sortBy === 'CHANGE') return compareChangeDesc(a, b);
        return a.ageMinutes - b.ageMinutes;
      });
  }, [currentTabBaseAlphas, activeFilterState]);

  const pinnedCalls = useMemo(() => {
    if (!isCurrentTabAuthorized) return [];
    if (currentTab !== 'ALPHA' && currentTab !== 'MAX_ALPHA') return [];
    if (
      activeFilterState.activeFilter !== 'ALL' ||
      activeFilterState.selectedChain !== 'ALL' ||
      activeFilterState.searchQuery.trim()
    ) {
      return [];
    }
    return currentTabBaseAlphas.filter((a) => a.pinned);
  }, [isCurrentTabAuthorized, currentTab, currentTabBaseAlphas, activeFilterState]);

  const topAlphaMovers = useMemo(
    () => alphaCallsList.filter((a) => a.change24hPct !== null).sort(compareChangeDesc).slice(0, 4),
    [alphaCallsList]
  );

  // User-facing call card renderer (admin controls intentionally excluded outside AdminWorkspace)
  const renderUserAlphaCard = (coin: AlphaItem) => {
    if (coin.isMaxAlpha && !isProOrAdmin) return null;
    return (
      <AlphaCallCard
        key={coin.id}
        coin={coin}
        isAdmin={false}
        isStarred={watchlist.includes(coin.id)}
        onInspect={setInspectedToken}
        onToggleWatchlist={toggleWatchlist}
      />
    );
  };

  if (!connected) {
    return (
      <div className="space-y-8">
        <LockedTerminal />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg bg-surface border font-sans text-xs font-semibold flex items-center gap-2.5 shadow-none ${toastType === 'error' ? 'border-danger text-danger' : 'border-brand text-white'
            }`}
        >
          {toastType === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-brand shrink-0" />
          )}
          <span className="truncate max-w-md">{toastMessage}</span>
        </div>
      )}

      {/* WALLET SIGNATURE / VERIFICATION BANNER (Rendered inside Overview Alerts when on Overview) */}
      {currentTab !== 'OVERVIEW' &&
        connected &&
        (needsSignature ||
          verificationState === 'CONNECTED_UNVERIFIED' ||
          verificationState === 'VERIFICATION_FAILED') && (
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
                  Sign a one-time message in your wallet to verify ownership of <strong className="text-white tnum">{shortAddress}</strong> and unlock your membership access &amp; trade calls. No transaction fee.
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

      {/* CONSISTENT LAB ANALYSIS DESTINATION HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border-default">
        <div>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-dim mb-1">
            Lab Analysis / {WORKSPACE_TITLES[currentTab].title}
          </div>
          <h2 className="font-sans text-xl sm:text-2xl font-black text-white tracking-tight">
            {WORKSPACE_TITLES[currentTab].title}
          </h2>
          <p className="font-sans text-xs text-muted mt-0.5">
            {WORKSPACE_TITLES[currentTab].subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {currentTab === 'OVERVIEW' && (
            <Link
              href="/dashboard?tab=STAKE"
              onClick={(e) => {
                e.preventDefault();
                handleSelectTab('STAKE');
              }}
              className="h-9 px-3.5 rounded-lg bg-surface hover:bg-surface-card border border-border-default hover:border-brand font-mono text-xs font-bold text-brand inline-flex items-center gap-1.5 transition-colors"
            >
              <span>Manage Staking</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {(currentTab === 'ALPHA' || currentTab === 'MAX_ALPHA') && isCurrentTabAuthorized && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface border border-border-default font-mono text-[11px] text-muted">
              <AlertTriangle className="w-3.5 h-3.5 text-brand shrink-0" />
              <span>Research only (DYOR)</span>
            </span>
          )}
        </div>
      </div>

      {/* OVERVIEW */}
      {currentTab === 'OVERVIEW' && (
        <DashboardOverview
          connected={connected}
          walletAddress={publicKeyBase58}
          shortAddress={shortAddress}
          tier={tier}
          formattedBalance={formattedBalance}
          alphasCount={alphaCallsCount}
          newCallsCount={newCallsCount}
          raidsCount={activeRaidsCount}
          isUnlocked={isUnlocked}
          isAdmin={isAdmin}
          isVerified={isWalletVerified}
          needsVerification={
            needsSignature ||
            verificationState === 'CONNECTED_UNVERIFIED' ||
            verificationState === 'VERIFICATION_FAILED'
          }
          favorites={favorites}
          alphas={alphas}
          campaigns={campaigns}
          portfolio={portfolio}
          onCopyGenesisCa={(e) => handleCopyText(GENESIS_MINT, 'hero-gen-ca', '$H42', e)}
          copiedGenesisCa={copiedId === 'hero-gen-ca'}
          onConnectWallet={connectWallet}
          onVerifyWallet={() => requestUnlockSignature()}
          onOpenAlpha={(coin, destination) => {
            handleSelectTab(destination);
            setInspectedToken(coin);
          }}
          onOpenRaid={(campaignId) => {
            handleSelectTab('SOCIAL');
            setTimeout(() => {
              document
                .querySelector(`[data-testid="favorite-raid-${campaignId}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 90);
          }}
          onUnpinPost={(kind: FavoritePostKind, id: string) => {
            toggleFavorite?.(kind, id);
            showToast('Removed post from My Pinned Posts.');
          }}
          onSelectFilter={(f) => {
            if (f === 'all') updateWorkspaceFilter('ALPHA', { activeFilter: 'ALL' });
            else if (f === 'new') updateWorkspaceFilter('ALPHA', { activeFilter: 'NEW' });
          }}
          onSelectTab={(tab) => {
            if (tab === 'ALPHA') handleSelectTab('ALPHA');
            else if (tab === 'SOCIAL') handleSelectTab('SOCIAL');
            else if (tab === 'MAX_ALPHA') handleSelectTab('MAX_ALPHA');
            else if (tab === 'STAKE') handleSelectTab('STAKE');
          }}
        >
          {/* Multi-Chain EVM Wallet Binding sits directly beside Telegram Verification inside Overview Connected Services */}
          <div className="rounded-xl bg-surface border border-border-default hover:border-brand/50 transition-colors p-4 sm:p-5 flex flex-col justify-between h-full">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-surface-card border border-border-default font-mono text-[11px] font-bold uppercase text-muted">
                  CROSS-CHAIN ALERTS
                </span>
                <span className="font-mono text-[11px] text-dim uppercase tnum">
                  {boundEvmAddress ? 'EVM MAPPED' : 'OPTIONAL'}
                </span>
              </div>

              <div>
                <h3 className="font-sans text-base font-extrabold text-white tracking-tight">
                  Multi-Chain EVM Binding
                </h3>
                <p className="font-sans text-xs text-muted leading-relaxed mt-1">
                  Verified Solana wallet <span className="font-mono text-white tnum">{shortAddress}</span> holds{' '}
                  <strong className="text-brand tnum">{formattedBalance} $H42</strong>. Optionally bind a local 0x address for ETH, Base, BSC, and AVAX call notifications.
                </p>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-border-default/60">
              {!boundEvmAddress ? (
                <form onSubmit={handleSaveEvm} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={evmDraft}
                    onChange={(e) => setEvmDraft(e.target.value)}
                    placeholder="0x... (EVM address)"
                    className="flex-1 h-9 px-3 rounded-lg bg-surface-card border border-border-default font-mono text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus:border-brand"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="h-9 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default font-sans text-xs font-bold text-brand shrink-0"
                  >
                    {evmSaved ? 'MAPPED ✓' : 'MAP 0x'}
                  </Button>
                </form>
              ) : (
                <div className="flex items-center justify-between w-full px-3.5 py-2 rounded-lg bg-brand-bg border border-brand-border font-mono text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-brand font-bold uppercase text-xs">MAPPED:</span>
                    <span className="text-white truncate font-medium tnum">{boundEvmAddress}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setBoundEvmAddress('');
                      setEvmDraft('');
                    }}
                    className="h-auto p-0 text-muted hover:text-danger ml-2 text-xs underline shrink-0 hover:bg-transparent"
                  >
                    Change
                  </Button>
                </div>
              )}
            </div>
          </div>
        </DashboardOverview>
      )}

      {/* DEDICATED ADMIN WORKSPACE (Strictly fail-closed on client + cryptographically enforced on API) */}
      {currentTab === 'ADMIN' && (
        <div
          role="tabpanel"
          id="tabpanel-admin"
          aria-labelledby="tab-admin"
          tabIndex={0}
          className="focus:outline-none"
        >
          {!isAdmin ? (
            <div
              data-testid="admin-unauthorized-panel"
              className="rounded-xl bg-surface border border-danger/50 p-8 text-center space-y-4 max-w-xl mx-auto"
            >
              <div className="w-12 h-12 rounded-xl bg-danger/10 border border-danger/40 text-danger flex items-center justify-center mx-auto">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-sans text-lg font-black text-white uppercase tracking-tight">
                  Administrator Access Required
                </h3>
                <p className="font-sans text-xs text-muted leading-relaxed">
                  Only the authorized Master Admin wallet can access centralized publishing, drafts, archive controls, and Raid campaign approvals.
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => handleSelectTab('OVERVIEW')}
                className="text-xs font-black uppercase"
              >
                Return to Overview
              </Button>
            </div>
          ) : (
            <ErrorBoundary panelName="Admin Desk">
              <AdminWorkspace
                items={adminAlphas && adminAlphas.length > 0 ? adminAlphas : alphas}
                campaigns={campaigns}
                adminActionError={adminActionError}
                onCreateCall={createAlphaCall}
                onUpdateCall={updateAlphaCall}
                onDeleteCall={deleteAlphaCall}
                onTogglePin={togglePinCall}
                onSetOutcome={setCallOutcome}
                onInspect={setInspectedToken}
                onToast={showToast}
                getAdminHeaders={getAdminHeaders}
              />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* OTHER FEATURE WORKSPACES */}
      {currentTab !== 'OVERVIEW' && currentTab !== 'ADMIN' && (
        <div id="feed-tabs" className="space-y-5">
          <div
            role="tabpanel"
            id={`tabpanel-${currentTab.toLowerCase()}`}
            aria-labelledby={`tab-${currentTab.toLowerCase()}`}
            tabIndex={0}
            className="min-h-[480px] focus:outline-none"
          >
            {currentTab === 'STAKE' ? (
              <div data-testid="stake-workspace" className="space-y-6">
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
                    {(() => {
                      const resolvedTier =
                        tier.id === 'PRO' || isAdmin
                          ? 'pro'
                          : tier.id === 'LAB_MEMBER'
                            ? 'member'
                            : 'free';
                      const stakeState = resolveUserState({
                        connected,
                        needsSignature,
                        hasActiveSession: isWalletVerified,
                        tier: resolvedTier,
                        telegramConnected: resolvedTier === 'pro' || resolvedTier === 'member',
                        stakeUsd: stakeStatusData?.stake?.amount_usd ?? 0,
                      });
                      const meta = stateMeta[stakeState];
                      if (stakeState === 'pro_active') return null;
                      return (
                        <NextStepCard
                          state={stakeState}
                          meta={meta}
                          onAction={(actKey) => {
                            if (actKey === 'connect') connectWallet();
                            else if (actKey === 'sign') void requestUnlockSignature();
                            else if (actKey === 'retry') void refreshAll();
                          }}
                        />
                      );
                    })()}
                    <ErrorBoundary panelName="StakePoint Pool Card">
                      <DashboardStakingCard showTelegram={false} />
                    </ErrorBoundary>
                  </div>

                  <div className="lg:col-span-7">
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
                      <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 space-y-4">
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
                        <ErrorBoundary panelName="Stake Verification">
                          <StakeClientView
                            key={`${stakeStatusData.wallet}-${stakeStatusData.stake.amount_raw}-${stakeStatusData.stake.status}`}
                            initialData={stakeStatusData}
                            embedded
                          />
                        </ErrorBoundary>
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
              <div className="space-y-4">
                <ErrorBoundary panelName="Raid Campaigns">
                  <CampaignSection
                    userWallet={publicKeyBase58}
                    isAdmin={false}
                    campaigns={campaigns}
                    loading={campaignsLoading}
                    favoritedIds={favorites.filter((f) => f.kind === 'RAID').map((f) => f.id)}
                    onToggleFavorite={connected && toggleFavorite ? (campaignId) => toggleFavorite('RAID', campaignId) : undefined}
                    onRefresh={fetchCampaigns}
                  />
                </ErrorBoundary>
              </div>
            ) : !isCurrentTabAuthorized ? (
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
              <ErrorBoundary
                panelName={currentTab === 'MAX_ALPHA' ? 'Max Alpha Feed' : 'Alpha Calls Feed'}
              >
                <div className="space-y-5">
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

                {/* Pinned Priority Section (Alpha & Max Alpha unfiltered view only) */}
                {pinnedCalls.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 rounded-md bg-surface border border-border-default text-white font-mono text-xs font-black uppercase inline-flex items-center gap-1.5">
                        <Pin className="w-3.5 h-3.5 text-brand" />
                        <span>PINNED PRIORITY ({pinnedCalls.length})</span>
                      </span>
                      <span className="font-sans text-xs text-muted">
                        High-priority setups highlighted for this workspace
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {pinnedCalls.map(renderUserAlphaCard)}
                    </div>
                  </div>
                )}

                {/* Page-Specific Isolated Filter Bar */}
                {activeFilterableWorkspace && (
                  <WorkspaceFilterBar
                    workspaceId={activeFilterableWorkspace}
                    searchPlaceholder={FILTER_PLACEHOLDERS[activeFilterableWorkspace]}
                    state={activeFilterState}
                    chainCounts={chainCounts}
                    totalFilteredCount={filteredTokens.length}
                    onChange={(patch) => updateWorkspaceFilter(activeFilterableWorkspace, patch)}
                    onReset={() => resetWorkspaceFilters(activeFilterableWorkspace)}
                  />
                )}

                {/* Grid vs Table View */}
                {activeFilterState.viewMode === 'GRID' ? (
                  apiLoading && alphas.length === 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="rounded-xl bg-surface border border-border-default p-4 space-y-3">
                          <Skeleton className="w-full h-12 rounded-md" />
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : filteredTokens.length === 0 ? (
                    <EmptyState
                      message="No calls match active filters in this workspace."
                      actionLabel="Clear filters"
                      onAction={() =>
                        activeFilterableWorkspace && resetWorkspaceFilters(activeFilterableWorkspace)
                      }
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-stretch">
                      {filteredTokens.map(renderUserAlphaCard)}
                    </div>
                  )
                ) : apiLoading && alphas.length === 0 ? (
                  <TradeWorkspaceSkeleton rows={6} />
                ) : (
                  <div className="rounded-xl bg-surface border border-border-default overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[740px]">
                      <thead>
                        <tr className="border-b border-border-default bg-surface-card font-mono text-[11px] text-muted uppercase tracking-wider">
                          <th className="py-3.5 px-4 font-bold">Token &amp; Chain</th>
                          <th className="py-3.5 px-4 font-bold">Contract Address (CA)</th>
                          <th className="py-3.5 px-4 text-right font-bold">Entry MC</th>
                          <th className="py-3.5 px-4 text-right font-bold">Current MC</th>
                          <th className="py-3.5 px-4 text-center font-bold">Risk Ratio</th>
                          <th className="py-3.5 px-4 font-bold">Take Profit</th>
                          <th className="py-3.5 px-4 text-right font-bold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default font-sans text-xs">
                        {filteredTokens.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-10 text-center space-y-3">
                              <p className="text-muted font-mono text-xs">
                                No calls match active filters in this workspace.
                              </p>
                              {activeFilterableWorkspace && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => resetWorkspaceFilters(activeFilterableWorkspace)}
                                >
                                  Clear filters
                                </Button>
                              )}
                            </td>
                          </tr>
                        ) : (
                          filteredTokens.map((token) => {
                            const marketUrl = getPrimaryMarketUrl(token);
                            const starred = watchlist.includes(token.id);
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
                                className="hover:bg-surface-card/70 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
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
                                        {token.outcome === 'PROFIT' && (
                                          <span className="px-1.5 py-0.2 rounded bg-brand text-canvas font-mono text-[10px] font-black uppercase">
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
                                        <span>&bull;</span>
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
                                      className="h-7 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-card hover:bg-surface-3 border border-border-default text-white font-semibold tnum text-xs"
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

                                <td className="py-3.5 px-4 text-right font-mono tnum">
                                  <div className="font-bold text-white text-sm">
                                    <TabularValue value={token.entryMarketCap || null} />
                                  </div>
                                </td>

                                <td className="py-3.5 px-4 text-right font-mono tnum">
                                  <div className="font-black text-brand-bright text-sm">
                                    <TabularValue value={token.marketCap || null} />
                                  </div>
                                </td>

                                <td className="py-3.5 px-4 text-center font-mono text-xs">
                                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-card border border-border-default">
                                    <span className="text-white font-bold">Lvl {token.risk}/5</span>
                                    <span className="text-dim">&bull;</span>
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
                                        className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold border ${tp.hit
                                          ? 'bg-brand text-canvas border-brand'
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
                                    <button
                                      type="button"
                                      aria-label={starred ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleWatchlist(token.id);
                                      }}
                                      className="h-8 w-8 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default inline-flex items-center justify-center cursor-pointer"
                                      title="Toggle Watchlist"
                                    >
                                      <Star
                                        className={`w-3.5 h-3.5 ${starred ? 'text-amber fill-amber' : 'text-muted'
                                          }`}
                                      />
                                    </button>
                                    <a
                                      href={marketUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="h-8 inline-flex items-center gap-1 px-3 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand text-white font-extrabold"
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

                {/* Top Performing Alpha Calls (exclusive to Alpha Calls workspace — avoids duplication) */}
                {currentTab === 'ALPHA' && topAlphaMovers.length > 0 && (
                  <div className="rounded-xl bg-surface border border-border-default p-5 space-y-4">
                    <div className="pb-3 border-b border-border-default">
                      <h3 className="font-sans text-base font-extrabold text-white">
                        Top Performing Alpha Calls
                      </h3>
                      <p className="font-sans text-xs text-muted">
                        Click any call to inspect setup telemetry or open external market links
                      </p>
                    </div>

                    <div className="divide-y divide-border-default">
                      {topAlphaMovers.map((coin, idx) => {
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
                                logoUrl={coin.logoUrl}
                                ticker={coin.ticker}
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
                                    MC {coin.marketCap} &bull; {coin.riskRewardRatio} &bull; TP{' '}
                                    {coin.takeProfits.map((t) => t.label).join('/')}
                                  </span>
                                  <MarketDataBadge item={coin} />
                                </div>
                              </div>
                            </div>

                            <div className="text-right font-mono tnum shrink-0">
                              <div
                                className={`text-sm font-bold ${coin.change24hPct !== null && coin.change24hPct < 0 ? 'text-danger' : 'text-brand'
                                  }`}
                              >
                                <TabularValue value={formatChangePct(coin.change24hPct)} />
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
                )}
              </div>
              </ErrorBoundary>
            )}
          </div>
        </div>
      )}

      {/* INSPECTOR MODAL */}
      <ErrorBoundary panelName="Call Inspector">
        <AlphaInspectorModal
          token={inspectedToken}
          onClose={() => setInspectedToken(null)}
          showAdminControls={currentTab === 'ADMIN'}
        />
      </ErrorBoundary>
    </div>
  );
};
