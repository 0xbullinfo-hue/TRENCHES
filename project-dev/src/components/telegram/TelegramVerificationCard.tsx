'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { GenesisContext } from '@/context/GenesisContext';
import type {
  GroupStatus,
  NotificationStatus,
  TelegramIdentityStatus,
  UserTier,
  VerificationStatusResponse,
} from '@/lib/telegram-types';
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';

export type TelegramVerificationStatus = VerificationStatusResponse;

export interface TelegramVerificationCardProps {
  connected: boolean;
  isPro?: boolean;
  isVerified?: boolean;
  needsVerification?: boolean;
  walletAddress?: string | null;
  onVerifyWallet?: () => void;
  onConnectWallet?: () => void;
  onStatusChange?: (connected: boolean) => void;
}

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_MS = 5 * 60 * 1000;
const BOT_URL = process.env.NEXT_PUBLIC_BOT_URL || 'https://t.me/Trenchlabs_bot';

interface NormalizedViewModel {
  entitlementTier: UserTier;
  entitlementVerified: boolean;
  entitlementReason?: string;
  identityStatus: TelegramIdentityStatus;
  communityTier: 'member' | 'pro' | null;
  communityStatus: GroupStatus;
  joinedAt: string | null;
  notificationStatus: NotificationStatus;
  canConnect: boolean;
  canJoinCommunity: boolean;
  canEnableNotifications: boolean;
  targetTier: 'member' | 'pro' | null;
}

function normalizeStatusData(
  data: Partial<VerificationStatusResponse> | null,
  fallbackIsPro: boolean
): NormalizedViewModel | null {
  if (!data) return null;

  const rawTier = data.entitlement?.tier ?? data.tier ?? 'free';
  const entitlementTier: UserTier =
    rawTier === 'admin' ||
    rawTier === 'pro' ||
    rawTier === 'member' ||
    rawTier === 'free' ||
    rawTier === 'unknown'
      ? rawTier
      : 'free';

  const entitlementVerified =
    data.entitlement?.verified ?? (entitlementTier !== 'free' && entitlementTier !== 'unknown');

  const legacyConnected = Boolean(data.telegram?.connected);
  const identityStatus: TelegramIdentityStatus =
    data.telegram?.identity?.status ?? (legacyConnected ? 'connected' : 'not_connected');

  const communityStatus: GroupStatus =
    data.telegram?.community?.status ?? (legacyConnected ? 'joined' : 'not_joined');

  let communityTier: 'member' | 'pro' | null =
    data.telegram?.community?.tier ?? data.telegram?.connected_tier ?? null;
  if (!communityTier && entitlementVerified) {
    communityTier =
      entitlementTier === 'admin' || entitlementTier === 'pro' || fallbackIsPro
        ? 'pro'
        : 'member';
  }
  // Never show Pro community to Member/Free users
  if (entitlementTier === 'member' || entitlementTier === 'free') {
    if (communityTier === 'pro') {
      communityTier = entitlementTier === 'member' ? 'member' : null;
    }
  }

  const notificationStatus: NotificationStatus =
    data.telegram?.notifications?.status ?? (legacyConnected ? 'enabled' : 'disabled');

  const canConnect = Boolean(data.actions?.canConnect ?? data.can_connect);
  const canJoinCommunity = Boolean(
    data.actions?.canJoinCommunity ?? (entitlementVerified && communityStatus !== 'joined')
  );
  const canEnableNotifications = Boolean(
    data.actions?.canEnableNotifications ?? (entitlementVerified && identityStatus === 'connected')
  );

  const targetTier: 'member' | 'pro' | null =
    data.target_tier !== undefined
      ? data.target_tier
      : entitlementTier === 'admin' || entitlementTier === 'pro'
      ? 'pro'
      : entitlementTier === 'member'
      ? 'member'
      : null;

  return {
    entitlementTier,
    entitlementVerified,
    entitlementReason: data.entitlement?.reason,
    identityStatus,
    communityTier,
    communityStatus,
    joinedAt: data.telegram?.community?.joinedAt ?? data.telegram?.connected_at ?? null,
    notificationStatus,
    canConnect,
    canJoinCommunity,
    canEnableNotifications,
    targetTier,
  };
}

function entitlementDisplayLabel(tier: UserTier): { text: string; toneClass: string } {
  switch (tier) {
    case 'admin':
      return { text: 'ADMIN — Verified', toneClass: 'text-brand' };
    case 'pro':
      return { text: 'PRO — Verified', toneClass: 'text-brand' };
    case 'member':
      return { text: 'MEMBER — Verified', toneClass: 'text-brand' };
    case 'unknown':
      return { text: 'Temporarily Unavailable', toneClass: 'text-amber' };
    default:
      return { text: 'FREE — Not Qualified', toneClass: 'text-muted' };
  }
}

function identityDisplayLabel(
  status: TelegramIdentityStatus,
  hasLocalPending: boolean
): { text: string; toneClass: string } {
  if (status === 'connected') return { text: 'Connected', toneClass: 'text-brand' };
  if (status === 'blocked') return { text: 'Blocked (Unblock Bot)', toneClass: 'text-danger' };
  if (status === 'disconnected') return { text: 'Disconnected', toneClass: 'text-muted' };
  if (status === 'pending' || hasLocalPending) return { text: 'Pending Confirmation', toneClass: 'text-amber' };
  return { text: 'Not Connected', toneClass: 'text-muted' };
}

function communityDisplayLabel(
  status: GroupStatus,
  tier: 'member' | 'pro' | null,
  entitlementUnknown: boolean
): { text: string; toneClass: string } {
  if (entitlementUnknown) {
    return { text: 'Status Requires Recheck', toneClass: 'text-amber' };
  }
  const tierPrefix = tier === 'pro' ? 'Pro Community' : 'Member Community';
  switch (status) {
    case 'joined':
      return { text: `${tierPrefix} — Joined`, toneClass: 'text-brand' };
    case 'invite_pending':
      return { text: 'Invitation Pending', toneClass: 'text-amber' };
    case 'left':
      return { text: 'Left Group', toneClass: 'text-amber' };
    case 'kicked':
      return { text: 'Removed from Group', toneClass: 'text-danger' };
    case 'revoked':
      return { text: 'Access Revoked', toneClass: 'text-danger' };
    default:
      return { text: 'Not Joined', toneClass: 'text-muted' };
  }
}

function notificationDisplayLabel(
  status: NotificationStatus,
  entitlementUnknown: boolean
): { text: string; toneClass: string } {
  if (entitlementUnknown) {
    return {
      text: status === 'enabled' ? 'Enabled (Current State)' : 'Disabled (Current State)',
      toneClass: 'text-muted',
    };
  }
  switch (status) {
    case 'enabled':
      return { text: 'Enabled', toneClass: 'text-brand' };
    case 'pending':
      return { text: 'Pending', toneClass: 'text-amber' };
    case 'blocked':
      return { text: 'Blocked', toneClass: 'text-danger' };
    default:
      return { text: 'Disabled', toneClass: 'text-muted' };
  }
}

export function TelegramVerificationCard({
  connected,
  isPro = false,
  isVerified,
  needsVerification,
  walletAddress,
  onVerifyWallet,
  onConnectWallet,
  onStatusChange,
}: TelegramVerificationCardProps) {
  const genesis = React.useContext(GenesisContext);
  const effectiveWallet = walletAddress !== undefined ? walletAddress : genesis?.publicKeyBase58 ?? null;
  const effectiveNeedsSig =
    needsVerification !== undefined
      ? needsVerification
      : Boolean(connected && (genesis?.needsSignature ?? false));
  const handleConnect = onConnectWallet ?? genesis?.connectWallet;
  const handleVerify = onVerifyWallet ?? genesis?.requestUnlockSignature;

  const [statusData, setStatusData] = useState<Partial<VerificationStatusResponse> | null>(null);
  const [loading, setLoading] = useState(false);
  const [authRequiredError, setAuthRequiredError] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [startingSession, setStartingSession] = useState(false);
  const [togglingNotif, setTogglingNotif] = useState(false);
  const [pendingDeepLink, setPendingDeepLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollGenRef = useRef(0);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    pollGenRef.current += 1;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const fetchVerificationStatus = useCallback(
    async (silent = false): Promise<Partial<VerificationStatusResponse> | null> => {
      if (!connected || !effectiveWallet || effectiveNeedsSig) {
        return null;
      }

      if (!silent) {
        setLoading(true);
      }
      setFetchError(null);

      try {
        const res = await fetch('/api/verification/status', {
          credentials: 'same-origin',
          cache: 'no-store',
        });

        if (!mountedRef.current) return null;

        if (res.status === 401) {
          setStatusData(null);
          setAuthRequiredError(true);
          onStatusChange?.(false);
          return null;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => null);
          const msg =
            (errJson as { message?: string } | null)?.message ||
            'Could not retrieve Telegram verification status.';
          setFetchError(msg);
          return null;
        }

        const data = (await res.json()) as Partial<VerificationStatusResponse>;
        if (!mountedRef.current) return null;

        const vm = normalizeStatusData(data, isPro);
        setAuthRequiredError(false);
        setFetchError(null);
        setStatusData(data);

        const confirmedConnected = Boolean(
          vm && vm.identityStatus === 'connected' && vm.communityStatus === 'joined'
        );
        onStatusChange?.(confirmedConnected);
        if (confirmedConnected) {
          setPendingDeepLink(null);
          stopPolling();
        }
        return data;
      } catch {
        if (!mountedRef.current) return null;
        setFetchError('Network error checking Telegram verification status.');
        return null;
      } finally {
        if (mountedRef.current && !silent) {
          setLoading(false);
        }
      }
    },
    [connected, effectiveWallet, effectiveNeedsSig, isPro, onStatusChange, stopPolling]
  );

  // Sync status whenever wallet connection / signature verification changes
  useEffect(() => {
    stopPolling();
    queueMicrotask(() => {
      setPendingDeepLink(null);
      setActionError(null);
      setFetchError(null);
    });

    if (!connected || !effectiveWallet) {
      queueMicrotask(() => {
        setStatusData(null);
        setAuthRequiredError(false);
        setLoading(false);
      });
      return;
    }

    if (effectiveNeedsSig) {
      queueMicrotask(() => {
        setStatusData(null);
        setAuthRequiredError(true);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void fetchVerificationStatus(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [connected, effectiveWallet, effectiveNeedsSig, isVerified, fetchVerificationStatus, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    const myGen = pollGenRef.current;
    const deadline = Date.now() + POLL_MAX_MS;

    pollTimerRef.current = setInterval(async () => {
      if (!mountedRef.current || pollGenRef.current !== myGen) {
        stopPolling();
        return;
      }
      if (Date.now() > deadline) {
        stopPolling();
        if (mountedRef.current) {
          setActionError(
            'Confirmation timed out. Open @Trenchlabs_bot in Telegram, complete verification, then click Check Status.'
          );
        }
        return;
      }
      await fetchVerificationStatus(true);
    }, POLL_INTERVAL_MS);
  }, [fetchVerificationStatus, stopPolling]);

  const vm = normalizeStatusData(statusData, isPro);

  const handleStartVerification = async () => {
    if (!vm?.targetTier || startingSession) return;
    setStartingSession(true);
    setActionError(null);

    try {
      const res = await fetch('/api/verification/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ target_tier: vm.targetTier }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        deep_link?: string;
        already_in_group?: boolean;
        message?: string;
        reason?: string;
      };

      if (!mountedRef.current) return;

      if (res.status === 401) {
        setAuthRequiredError(true);
        setActionError('Session expired or unsigned. Verify your wallet first.');
        return;
      }

      if (!res.ok) {
        setActionError(
          json.message || json.reason || 'Failed to initiate Telegram verification session.'
        );
        return;
      }

      if (json.already_in_group) {
        await fetchVerificationStatus(false);
        return;
      }

      if (!json.deep_link) {
        setActionError('Verification service did not return a Telegram bot link.');
        return;
      }

      setPendingDeepLink(json.deep_link);
      try {
        window.open(json.deep_link, '_blank', 'noopener,noreferrer');
      } catch {
        // Fallback link remains directly clickable in card UI
      }
      startPolling();
    } catch {
      if (!mountedRef.current) return;
      setActionError('Network error initiating Telegram verification. Retry shortly.');
    } finally {
      if (mountedRef.current) {
        setStartingSession(false);
      }
    }
  };

  const handleToggleNotifications = async (nextEnabled: boolean) => {
    if (togglingNotif) return;
    setTogglingNotif(true);
    setActionError(null);
    try {
      const res = await fetch('/api/verification/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      if (!mountedRef.current) return;
      if (res.status === 401) {
        setAuthRequiredError(true);
        setActionError('Session expired. Verify your wallet first.');
        return;
      }
      if (!res.ok) {
        setActionError(json.message || 'Could not update private notification preference.');
        return;
      }
      await fetchVerificationStatus(false);
    } catch {
      if (!mountedRef.current) return;
      setActionError('Network error updating private notification preference.');
    } finally {
      if (mountedRef.current) {
        setTogglingNotif(false);
      }
    }
  };

  // Derive overall header pill accurately without conflating states
  const isUnauthenticated = !connected || effectiveNeedsSig || authRequiredError;
  const isUnknownEntitlement = Boolean(!isUnauthenticated && vm && vm.entitlementTier === 'unknown');
  const isIneligibleFree = Boolean(!isUnauthenticated && vm && vm.entitlementTier === 'free');
  const isConfirmedJoined = Boolean(
    !isUnauthenticated && vm && vm.identityStatus === 'connected' && vm.communityStatus === 'joined'
  );
  const isInvitePending = Boolean(
    !isUnauthenticated && vm && vm.communityStatus === 'invite_pending'
  );
  const isPending = Boolean(
    !isConfirmedJoined &&
      !isUnknownEntitlement &&
      !isIneligibleFree &&
      (pendingDeepLink || isInvitePending || vm?.identityStatus === 'pending')
  );

  let statusBadgeText = 'NOT CONNECTED';
  let statusBadgeClass = 'bg-amber/10 text-amber border-amber/40';
  if (!connected) {
    statusBadgeText = 'DISCONNECTED';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  } else if (isUnauthenticated) {
    statusBadgeText = 'SIGNATURE REQUIRED';
    statusBadgeClass = 'bg-amber/10 text-amber border-amber/40';
  } else if (loading && !vm) {
    statusBadgeText = 'CHECKING STATUS';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  } else if (fetchError) {
    statusBadgeText = 'STATUS UNAVAILABLE';
    statusBadgeClass = 'bg-danger/10 text-danger border-danger/40';
  } else if (isUnknownEntitlement) {
    statusBadgeText = 'RECHECK REQUIRED';
    statusBadgeClass = 'bg-amber/10 text-amber border-amber/40';
  } else if (isConfirmedJoined) {
    statusBadgeText = 'VERIFIED';
    statusBadgeClass = 'bg-brand-bg text-brand border-brand-border';
  } else if (isPending) {
    statusBadgeText = 'VERIFICATION PENDING';
    statusBadgeClass = 'bg-brand/15 text-brand border-brand/40';
  } else if (isIneligibleFree) {
    statusBadgeText = 'MEMBERSHIP REQUIRED';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  }

  const entitlementDisplay = vm ? entitlementDisplayLabel(vm.entitlementTier) : null;
  const identityDisplay = vm ? identityDisplayLabel(vm.identityStatus, Boolean(pendingDeepLink)) : null;
  const communityDisplay = vm
    ? communityDisplayLabel(vm.communityStatus, vm.communityTier, vm.entitlementTier === 'unknown')
    : null;
  const notifDisplay = vm
    ? notificationDisplayLabel(vm.notificationStatus, vm.entitlementTier === 'unknown')
    : null;

  return (
    <div
      data-testid="telegram-verification-card"
      className="rounded-xl bg-surface border border-border-default hover:border-brand/50 p-4 sm:p-5 transition-colors flex flex-col justify-between h-full"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand/15 text-brand border border-brand/30 font-mono text-[11px] font-black uppercase">
            <Send className="w-3 h-3 text-brand" />
            <span>Telegram Verification</span>
          </span>

          <span
            data-testid="telegram-verification-status-badge"
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md border font-mono text-[11px] font-bold uppercase ${statusBadgeClass}`}
          >
            {isConfirmedJoined && <CheckCircle2 className="w-3 h-3" />}
            <span>{statusBadgeText}</span>
          </span>
        </div>

        <div>
          <h3 className="font-sans text-base font-extrabold text-white tracking-tight">
            {isConfirmedJoined
              ? 'Telegram Verification Active'
              : 'Connect & Verify Telegram'}
          </h3>
          {(!connected || isUnauthenticated || isIneligibleFree) && (
            <p className="font-sans text-xs text-muted leading-relaxed mt-1">
              {!connected
                ? 'Connect your Solana wallet to check entitlement, connect Telegram, and unlock community access.'
                : isUnauthenticated
                ? 'Sign with your wallet first to verify ownership and inspect your Telegram status.'
                : 'Telegram community access requires holding ~$20 in $H42 (Member) or staking $250 for 90 days via StakePoint (Pro).'}
            </p>
          )}
        </div>

        {/* Four Independent State Indicators (Section 14) */}
        {connected && !isUnauthenticated && vm && (
          <dl
            data-testid="telegram-four-states"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1"
          >
            <div
              data-testid="tg-row-entitlement"
              className="rounded-lg bg-surface-card border border-border-default/70 px-3 py-2 space-y-0.5"
            >
              <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <ShieldCheck className="w-3 h-3 text-brand shrink-0" />
                <span>Wallet Entitlement</span>
              </dt>
              <dd className={`font-sans text-xs font-bold ${entitlementDisplay?.toneClass}`}>
                {entitlementDisplay?.text}
              </dd>
            </div>

            <div
              data-testid="tg-row-identity"
              className="rounded-lg bg-surface-card border border-border-default/70 px-3 py-2 space-y-0.5"
            >
              <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <Send className="w-3 h-3 text-brand shrink-0" />
                <span>Telegram Identity</span>
              </dt>
              <dd className={`font-sans text-xs font-bold ${identityDisplay?.toneClass}`}>
                {identityDisplay?.text}
              </dd>
            </div>

            <div
              data-testid="tg-row-community"
              className="rounded-lg bg-surface-card border border-border-default/70 px-3 py-2 space-y-0.5"
            >
              <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <Users className="w-3 h-3 text-brand shrink-0" />
                <span>Community Access</span>
              </dt>
              <dd className={`font-sans text-xs font-bold ${communityDisplay?.toneClass}`}>
                {communityDisplay?.text}
              </dd>
            </div>

            <div
              data-testid="tg-row-notifications"
              className="rounded-lg bg-surface-card border border-border-default/70 px-3 py-2 space-y-0.5"
            >
              <dt className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                <Bell className="w-3 h-3 text-brand shrink-0" />
                <span>Private Notifications</span>
              </dt>
              <dd className={`font-sans text-xs font-bold ${notifDisplay?.toneClass}`}>
                {notifDisplay?.text}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="pt-4 mt-4 border-t border-border-default/60 space-y-2.5">
        {/* Disconnected Wallet */}
        {!connected && (
          <div data-testid="telegram-disconnected-state" className="flex flex-wrap items-center gap-2">
            {handleConnect ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleConnect}
                className="w-full sm:w-auto h-9 px-4 font-sans text-xs font-black uppercase gap-1.5"
              >
                <Wallet className="w-3.5 h-3.5 text-brand" />
                <span>Connect Wallet</span>
              </Button>
            ) : (
              <span className="font-mono text-xs text-muted">
                Wallet connection required before verifying Telegram.
              </span>
            )}
          </div>
        )}

        {/* Connected Wallet without Signed Session */}
        {connected && isUnauthenticated && (
          <div data-testid="telegram-unauthenticated-state" className="flex flex-wrap items-center gap-2">
            {handleVerify && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => handleVerify()}
                className="w-full sm:w-auto h-9 px-4 font-sans text-xs font-black uppercase gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Verify Wallet First</span>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void fetchVerificationStatus(false)}
              className="h-9 px-3 text-xs font-mono text-muted hover:text-white gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry Check</span>
            </Button>
          </div>
        )}

        {/* Initial Loading */}
        {connected && !isUnauthenticated && loading && !vm && (
          <div data-testid="telegram-loading-state" role="status" className="space-y-2">
            <Skeleton className="h-9 w-44 rounded-lg" />
            <span className="sr-only">Checking Telegram verification status</span>
          </div>
        )}

        {/* Status Fetch Error */}
        {connected && !isUnauthenticated && !loading && fetchError && (
          <div
            data-testid="telegram-verify-error"
            role="alert"
            className="rounded-lg bg-danger/10 border border-danger/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="flex items-start gap-2 text-xs text-danger font-medium">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{fetchError}</span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void fetchVerificationStatus(false)}
              className="h-8 px-3 text-xs font-mono font-bold shrink-0 gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </Button>
          </div>
        )}

        {/* Unknown Entitlement (RPC/Oracle Unavailable) -> Retry Verification */}
        {connected && !isUnauthenticated && !fetchError && isUnknownEntitlement && (
          <div
            data-testid="telegram-unknown-state"
            className="rounded-lg bg-amber/10 border border-amber/40 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="flex items-start gap-2 text-xs text-amber font-medium">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                On-chain entitlement check is temporarily unavailable. Existing access is protected pending recheck.
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="telegram-retry-btn"
              onClick={() => void fetchVerificationStatus(false)}
              disabled={loading}
              className="h-8 px-3 text-xs font-mono font-bold shrink-0 gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Retry Verification</span>
            </Button>
          </div>
        )}

        {/* Free Tier Ineligible */}
        {connected && !isUnauthenticated && !fetchError && isIneligibleFree && (
          <div data-testid="telegram-ineligible-state" className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard?tab=STAKE"
              className="w-full sm:w-auto h-9 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-brand font-mono text-xs font-bold text-brand inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>View Staking &amp; Access Tiers</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Confirmed Community Joined State (Never renders a Join button) */}
        {connected && !isUnauthenticated && !isUnknownEntitlement && isConfirmedJoined && vm && (
          <div
            data-testid="telegram-verified-state"
            className="rounded-lg bg-brand-bg border border-brand-border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-brand uppercase">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {vm.communityTier === 'pro' ? 'Pro Community Joined' : 'Member Community Joined'}
                </span>
              </div>
              {vm.joinedAt && (
                <div className="font-mono text-[11px] text-muted tnum">
                  Joined {new Date(vm.joinedAt).toLocaleDateString()}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {vm.canEnableNotifications && (
                <Button
                  type="button"
                  variant={vm.notificationStatus === 'enabled' ? 'ghost' : 'secondary'}
                  size="sm"
                  data-testid="tg-toggle-notifications-btn"
                  disabled={togglingNotif}
                  onClick={() => void handleToggleNotifications(vm.notificationStatus !== 'enabled')}
                  className="h-8 px-3 border border-border-default text-xs font-mono font-bold gap-1.5"
                >
                  {vm.notificationStatus === 'enabled' ? (
                    <>
                      <BellOff className="w-3.5 h-3.5 text-muted" />
                      <span>Disable Alerts</span>
                    </>
                  ) : (
                    <>
                      <Bell className="w-3.5 h-3.5 text-brand" />
                      <span>Enable Notifications</span>
                    </>
                  )}
                </Button>
              )}
              <a
                href={BOT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="h-8 px-3 rounded-md bg-surface border border-border-default hover:border-brand font-mono text-xs font-bold text-white inline-flex items-center gap-1 transition-colors"
              >
                <span>Open Bot</span>
                <ArrowUpRight className="w-3 h-3 text-brand" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void fetchVerificationStatus(false)}
                aria-label="Refresh Telegram verification status"
                className="h-8 w-8 p-0 border border-border-default text-muted hover:text-white"
                title="Refresh status"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Pending Verification / Pending Group Invite State */}
        {connected && !isUnauthenticated && !isConfirmedJoined && isPending && vm && (
          <div data-testid="telegram-pending-state" className="space-y-2.5">
            <div className="rounded-lg bg-brand/10 border border-brand/30 p-3 space-y-2">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-brand">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>
                  {isInvitePending
                    ? 'Invitation sent in Telegram — open your personal single-use link to join.'
                    : 'Waiting for Telegram confirmation...'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={pendingDeepLink || BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="telegram-deeplink-anchor"
                  className="h-8 px-3 rounded-md bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1 transition-colors"
                >
                  <span>{pendingDeepLink ? 'Open Telegram' : 'Open @Trenchlabs_bot'}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                </a>
                {isInvitePending && vm.targetTier && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="telegram-connect-btn"
                    onClick={handleStartVerification}
                    disabled={startingSession}
                    className="h-8 px-3 text-xs font-mono font-bold"
                  >
                    <span>New Invite</span>
                  </Button>
                )}
                {vm.canEnableNotifications && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="tg-toggle-notifications-btn"
                    disabled={togglingNotif}
                    onClick={() =>
                      void handleToggleNotifications(vm.notificationStatus !== 'enabled')
                    }
                    className="h-8 px-3 border border-border-default text-xs font-mono font-bold gap-1"
                  >
                    {vm.notificationStatus === 'enabled' ? (
                      <>
                        <BellOff className="w-3 h-3" />
                        <span>Disable Alerts</span>
                      </>
                    ) : (
                      <>
                        <Bell className="w-3 h-3 text-brand" />
                        <span>Enable Alerts</span>
                      </>
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="telegram-check-status-btn"
                  onClick={() => void fetchVerificationStatus(false)}
                  className="h-8 px-3 text-xs font-mono font-bold gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Check Status</span>
                </Button>
                {pendingDeepLink && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      stopPolling();
                      setPendingDeepLink(null);
                    }}
                    className="h-8 px-2.5 text-xs font-mono text-muted hover:text-white"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Not Connected / Left / Kicked / Revoked -> Primary Connect Telegram Action */}
        {connected &&
          !isUnauthenticated &&
          !fetchError &&
          !isUnknownEntitlement &&
          !isIneligibleFree &&
          !isConfirmedJoined &&
          !isPending &&
          vm &&
          vm.canConnect && (
            <div data-testid="telegram-not-connected-state" className="flex flex-wrap items-center gap-2.5">
              <Button
                type="button"
                variant="primary"
                size="md"
                data-testid="telegram-connect-btn"
                onClick={handleStartVerification}
                disabled={startingSession}
                className="w-full sm:w-auto h-10 px-5 text-xs uppercase tracking-wider font-black gap-2"
              >
                {startingSession ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Starting Verification...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {vm.identityStatus === 'connected'
                        ? 'Get Community Invite'
                        : 'Connect Telegram'}
                    </span>
                    <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                  </>
                )}
              </Button>
              {vm.canEnableNotifications && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="tg-toggle-notifications-btn"
                  disabled={togglingNotif}
                  onClick={() =>
                    void handleToggleNotifications(vm.notificationStatus !== 'enabled')
                  }
                  className="h-9 px-3 text-xs font-mono font-bold gap-1.5"
                >
                  {vm.notificationStatus === 'enabled' ? (
                    <>
                      <BellOff className="w-3.5 h-3.5" />
                      <span>Disable Alerts</span>
                    </>
                  ) : (
                    <>
                      <Bell className="w-3.5 h-3.5 text-brand" />
                      <span>Enable Notifications</span>
                    </>
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void fetchVerificationStatus(false)}
                className="h-9 px-3 text-xs font-mono text-muted hover:text-white gap-1"
                title="Re-check Telegram verification status"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </Button>
            </div>
          )}

        {/* Session Initiation / Action Failure Alert */}
        {actionError && (
          <div
            data-testid="telegram-verify-error"
            role="alert"
            className="rounded-lg bg-danger/10 border border-danger/40 p-2.5 flex items-start gap-2 text-xs text-danger font-medium"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        <p className="font-mono text-[11px] text-dim pt-1">
          Direct bot verification via @Trenchlabs_bot • Member &amp; Pro channels
        </p>
      </div>
    </div>
  );
}
