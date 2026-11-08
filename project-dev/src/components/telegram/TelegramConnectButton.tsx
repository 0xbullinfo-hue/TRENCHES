'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';

interface VerificationStatusResponse {
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

interface TelegramConnectButtonProps {
  compact?: boolean;
  onConnected?: () => void;
}

export function TelegramConnectButton({
  compact = false,
  onConnected,
}: TelegramConnectButtonProps) {
  const [status, setStatus] = useState<VerificationStatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<boolean>(false);

  const [opening, setOpening] = useState<boolean>(false);
  const [polling, setPolling] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryHelper, setRetryHelper] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const refetchStatus = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    try {
      const res = await fetch('/api/verification/status');
      if (res.ok) {
        const data = (await res.json()) as VerificationStatusResponse;
        setStatus(data);
        return data;
      } else {
        setFetchError(true);
        return null;
      }
    } catch {
      setFetchError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('/api/verification/status')
      .then((res) => {
        if (!res.ok) throw new Error('Status failed');
        return res.json();
      })
      .then((data: VerificationStatusResponse) => {
        if (mounted) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setFetchError(true);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    setPolling(true);
    pollDeadlineRef.current = Date.now() + 5 * 60 * 1000; // 5 minutes

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(async () => {
      if (Date.now() > pollDeadlineRef.current) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setPolling(false);
        setRetryHelper("Didn't see you join. Retry?");
        return;
      }

      try {
        const res = await fetch('/api/verification/status');
        if (res.ok) {
          const data = (await res.json()) as VerificationStatusResponse;
          setStatus(data);
          if (data.telegram.connected) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setPolling(false);
            if (onConnected) onConnected();
          }
        }
      } catch {
        // continue polling
      }
    }, 5000);
  }, [onConnected]);

  const handleConnectClick = async () => {
    if (!status || !status.target_tier || opening || polling) return;

    setOpening(true);
    setErrorMessage(null);
    setRetryHelper(null);

    try {
      const res = await fetch('/api/verification/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_tier: status.target_tier }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setErrorMessage(json.message || 'Too many attempts — wait a minute.');
        } else if (res.status === 403) {
          setErrorMessage(json.reason || 'Not eligible for this Telegram tier.');
        } else {
          setErrorMessage('Failed to start Telegram verification.');
        }
        setOpening(false);
        return;
      }

      if (json.already_in_group) {
        await refetchStatus();
        setOpening(false);
        return;
      }

      const deepLink = json.deep_link;
      if (deepLink) {
        // Create an anchor and trigger click for broad mobile browser compatibility
        const a = document.createElement('a');
        a.href = deepLink;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      setOpening(false);
      startPolling();
    } catch {
      setErrorMessage('Network error initiating Telegram session.');
      setOpening(false);
    }
  };

  // State 4: Loading Skeleton
  if (loading && !status) {
    return (
      <div
        className={`rounded-md bg-surface-card border border-toxic-border/40 animate-pulse ${
          compact ? 'h-9 w-36' : 'h-11 w-48'
        }`}
      />
    );
  }

  // State 4: Error State
  if (fetchError || !status) {
    return (
      <div className="flex items-center gap-2 text-xs font-sans text-danger">
        <span>Couldn&apos;t check Telegram status.</span>
        <button
          onClick={() => refetchStatus()}
          className="text-toxic underline underline-offset-2 hover:text-toxic-bright font-bold"
        >
          [Retry]
        </button>
      </div>
    );
  }

  // State 2: Connected (Quiet status pill, muted green check)
  if (status.telegram.connected) {
    const tierName =
      status.telegram.connected_tier === 'pro'
        ? 'Pro'
        : status.telegram.connected_tier === 'member'
        ? 'Member'
        : '';

    return (
      <a
        href={process.env.NEXT_PUBLIC_BOT_URL || 'https://t.me/Trenchlabs_bot'}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#0d2218] border border-toxic/40 text-toxic hover:border-toxic transition-colors select-none"
      >
        <span>✅ Telegram connected{tierName ? ` (${tierName})` : ''}</span>
      </a>
    );
  }

  // State 1: can_connect = false (Free Tier)
  if (!status.can_connect) {
    return (
      <div className="relative group inline-block">
        <button
          disabled
          className={`rounded-md border border-toxic-border/30 bg-[#161c24] text-muted/60 font-sans text-xs font-semibold cursor-not-allowed select-none ${
            compact ? 'px-3 py-1.5' : 'h-11 px-5'
          }`}
          title="Verify your wallet to unlock Telegram access."
        >
          Connect Telegram — verify wallet first
        </button>
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2.5 py-1 text-xs text-white bg-[#141b24] border border-toxic-border/40 rounded shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-20">
          Verify your wallet to unlock Telegram access.
        </span>
      </div>
    );
  }

  // State 3: can_connect = true, connected = false (Primary CTA / Polling)
  const tierLabel = status.target_tier === 'pro' ? 'Pro' : 'Member';

  return (
    <div className="space-y-1.5">
      <button
        onClick={handleConnectClick}
        disabled={opening || polling}
        className={`rounded-md font-sans font-bold flex items-center justify-center gap-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toxic ${
          compact ? 'h-9 px-4 text-xs' : 'h-11 px-6 text-sm'
        } ${
          opening || polling
            ? 'bg-[#1b2533] border border-toxic-border text-toxic cursor-wait'
            : 'bg-toxic hover:bg-toxic-bright text-canvas font-black cursor-pointer shadow-sm'
        }`}
      >
        {opening ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-toxic" />
            <span>Opening Telegram...</span>
          </>
        ) : polling ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-toxic" />
            <span>Waiting for you in Telegram...</span>
          </>
        ) : (
          <span>Connect Telegram →</span>
        )}
      </button>

      {!compact && !polling && !opening && (
        <p className="font-sans text-xs text-muted">
          Verify in Telegram to receive your {tierLabel} group invite.
        </p>
      )}

      {retryHelper && (
        <p className="font-sans text-xs text-toxic font-semibold">{retryHelper}</p>
      )}

      {errorMessage && (
        <p className="font-sans text-xs text-danger font-medium">{errorMessage}</p>
      )}
    </div>
  );
}
