'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { GenesisContext } from '@/context/GenesisContext';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

export interface TelegramVerificationStatus {
  wallet: string;
  tier: 'free' | 'member' | 'pro';
  telegram: {
    connected: boolean;
    connected_tier: 'member' | 'pro' | null;
    connected_at: string | null;
  };
  can_connect: boolean;
  target_tier: 'member' | 'pro' | null;
}

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

  const [statusData, setStatusData] = useState<TelegramVerificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [authRequiredError, setAuthRequiredError] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [startingSession, setStartingSession] = useState(false);
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
    async (silent = false): Promise<TelegramVerificationStatus | null> => {
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

        const data = (await res.json()) as TelegramVerificationStatus;
        if (!mountedRef.current) return null;

        setAuthRequiredError(false);
        setFetchError(null);
        setStatusData(data);
        onStatusChange?.(Boolean(data.telegram?.connected));
        if (data.telegram?.connected) {
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
    [connected, effectiveWallet, effectiveNeedsSig, onStatusChange, stopPolling]
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
            'Verification confirmation timed out. Open @Trenchlabs_bot and press Start, then click Check Status.'
          );
        }
        return;
      }
      await fetchVerificationStatus(true);
    }, POLL_INTERVAL_MS);
  }, [fetchVerificationStatus, stopPolling]);

  const handleStartVerification = async () => {
    if (!statusData?.target_tier || startingSession) return;
    setStartingSession(true);
    setActionError(null);

    try {
      const res = await fetch('/api/verification/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ target_tier: statusData.target_tier }),
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
        const refreshed = await fetchVerificationStatus(false);
        if (!refreshed?.telegram?.connected) {
          setActionError(
            'Account status is refreshing. Click Check Status if your group membership is already active.'
          );
        }
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

  // Derive clear visual state pill + view mode
  const isBackendVerified = Boolean(statusData?.telegram?.connected);
  const isPending = Boolean(!isBackendVerified && pendingDeepLink);
  const isUnauthenticated = !connected || effectiveNeedsSig || authRequiredError;
  const isIneligibleFree = Boolean(
    !isUnauthenticated && statusData && (!statusData.can_connect || statusData.tier === 'free')
  );

  let statusBadgeText = 'NOT CONNECTED';
  let statusBadgeClass = 'bg-amber/10 text-amber border-amber/40';
  if (!connected) {
    statusBadgeText = 'DISCONNECTED';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  } else if (isUnauthenticated) {
    statusBadgeText = 'SIGNATURE REQUIRED';
    statusBadgeClass = 'bg-amber/10 text-amber border-amber/40';
  } else if (loading && !statusData) {
    statusBadgeText = 'CHECKING STATUS';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  } else if (fetchError) {
    statusBadgeText = 'STATUS UNAVAILABLE';
    statusBadgeClass = 'bg-danger/10 text-danger border-danger/40';
  } else if (isBackendVerified) {
    statusBadgeText = 'VERIFIED';
    statusBadgeClass = 'bg-brand-bg text-brand border-brand-border';
  } else if (isPending) {
    statusBadgeText = 'VERIFICATION PENDING';
    statusBadgeClass = 'bg-brand/15 text-brand border-brand/40';
  } else if (isIneligibleFree) {
    statusBadgeText = 'MEMBERSHIP REQUIRED';
    statusBadgeClass = 'bg-surface-card text-muted border-border-default';
  }

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
            {isBackendVerified && <CheckCircle2 className="w-3 h-3" />}
            <span>{statusBadgeText}</span>
          </span>
        </div>

        <div>
          <h3 className="font-sans text-base font-extrabold text-white tracking-tight">
            {isBackendVerified
              ? 'Telegram Account Connected'
              : 'Connect & Verify Telegram'}
          </h3>
          <p className="font-sans text-xs text-muted leading-relaxed mt-1">
            {!connected
              ? 'Connect your Solana wallet to check Telegram verification status and link your account for real-time alerts.'
              : isUnauthenticated
              ? 'Verify wallet ownership first to check your Telegram status and generate a personal verification link.'
              : isBackendVerified
              ? `Your Telegram account is verified for ${
                  statusData?.telegram.connected_tier === 'pro' || isPro
                    ? 'Pro & Max Alpha'
                    : 'Member'
                } private call alerts.`
              : isIneligibleFree
              ? 'Telegram verification requires holding ~$20 in $H42 (Member) or staking $250 via StakePoint (Pro).'
              : isPending
              ? 'Verification is pending. Open @Trenchlabs_bot in Telegram, press Start, and wait for confirmation.'
              : 'Link your Telegram account via @Trenchlabs_bot to verify membership and unlock real-time call notifications.'}
          </p>
        </div>
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
        {connected && !isUnauthenticated && loading && !statusData && (
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

        {/* Verified State */}
        {connected && !isUnauthenticated && isBackendVerified && (
          <div
            data-testid="telegram-verified-state"
            className="rounded-lg bg-brand-bg border border-brand-border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
          >
            <div className="space-y-0.5 min-w-0">
              <div className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-brand uppercase">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  Verified{' '}
                  {statusData?.telegram.connected_tier === 'pro'
                    ? '(Pro Tier)'
                    : statusData?.telegram.connected_tier === 'member'
                    ? '(Member Tier)'
                    : ''}
                </span>
              </div>
              {statusData?.telegram.connected_at && (
                <div className="font-mono text-[11px] text-muted tnum">
                  Linked {new Date(statusData.telegram.connected_at).toLocaleDateString()}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
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

        {/* Pending Session Polling */}
        {connected && !isUnauthenticated && isPending && pendingDeepLink && (
          <div data-testid="telegram-pending-state" className="space-y-2.5">
            <div className="rounded-lg bg-brand/10 border border-brand/30 p-3 space-y-2">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-brand">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span>Waiting for Telegram confirmation...</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={pendingDeepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="telegram-deeplink-anchor"
                  className="h-8 px-3 rounded-md bg-brand hover:bg-brand-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-1 transition-colors"
                >
                  <span>Open @Trenchlabs_bot</span>
                  <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                </a>
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
              </div>
            </div>
          </div>
        )}

        {/* Not Connected -> Primary Verify / Connect Action */}
        {connected &&
          !isUnauthenticated &&
          !fetchError &&
          statusData &&
          statusData.can_connect &&
          !isBackendVerified &&
          !isPending && (
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
                    <span>Connect &amp; Verify Telegram</span>
                    <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
                  </>
                )}
              </Button>
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
