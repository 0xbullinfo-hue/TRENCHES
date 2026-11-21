'use client';

import React, { useState, useEffect, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { GenesisContext } from '@/context/GenesisContext';
import { canFetchSessionEndpoints } from '@/lib/auth/sessionGate';
import { TelegramConnectButton } from './TelegramConnectButton';

const DISMISS_STORAGE_KEY = 'trench_tg_banner_dismissed';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface VerificationStatus {
  tier: 'free' | 'member' | 'pro' | 'unknown';
  entitlement?: {
    tier: 'free' | 'member' | 'pro' | 'admin' | 'unknown';
    verified: boolean;
  };
  telegram: {
    connected: boolean;
    community?: {
      status?: string;
    };
  };
}

export function TelegramStatusBanner() {
  const pathname = usePathname();
  const genesis = useContext(GenesisContext);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = sessionStorage.getItem(DISMISS_STORAGE_KEY);
      if (stored) {
        const timestamp = Number(stored);
        if (Date.now() - timestamp < DISMISS_TTL_MS) {
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  });

  // Do not render on /dashboard/stake per §7.2
  const isStakeRoute = pathname === '/dashboard/stake';
  const canFetchStatus = canFetchSessionEndpoints(genesis, true);

  useEffect(() => {
    if (isStakeRoute || dismissed || !canFetchStatus) {
      return;
    }
    let active = true;

    fetch('/api/verification/status', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json) setStatus(json);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isStakeRoute, dismissed, canFetchStatus]);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  };

  if (isStakeRoute || dismissed || !canFetchStatus || !status) return null;

  // Hidden when confirmed joined OR when tier=free / unknown
  if (
    status.telegram?.connected ||
    status.telegram?.community?.status === 'joined' ||
    status.tier === 'free' ||
    status.tier === 'unknown' ||
    status.entitlement?.tier === 'unknown' ||
    status.entitlement?.tier === 'free'
  ) {
    return null;
  }

  const isProOrAdmin = status.tier === 'pro' || status.entitlement?.tier === 'pro' || status.entitlement?.tier === 'admin';
  const bannerText = isProOrAdmin
    ? '📱 Connect to Telegram — your Pro signals are waiting.'
    : '📱 Connect to Telegram — join the Member community.';

  return (
    <div className="w-full bg-surface-card border-b border-brand-border/60 px-4 py-3 sm:px-6">
      <div className="max-w-[1360px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        {/* Left Copy */}
        <div className="flex items-center gap-2">
          <span className="font-sans text-sm font-semibold text-white tracking-tight">
            {bannerText}
          </span>
        </div>

        {/* Right CTA + Dismiss */}
        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <TelegramConnectButton compact onConnected={() => setStatus((prev) => prev ? { ...prev, telegram: { connected: true } } : null)} />
          <button
            onClick={handleDismiss}
            className="text-muted hover:text-white p-1 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
            aria-label="Dismiss Telegram banner"
            title="Dismiss banner for this session"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
