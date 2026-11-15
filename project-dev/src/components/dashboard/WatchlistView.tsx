'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { GenesisContext } from '@/context/GenesisContext';
import type { AlphaItem } from '@/lib/types';

export interface WatchlistViewProps {
  watchlistIds: string[];
  allCalls: AlphaItem[];
  onToggleWatchlist: (id: string) => void;
  walletAddress?: string;
  isTelegramLinked?: boolean;
  className?: string;
}

const getAlertsStorageKey = (wallet: string) => `trenchlabs_watchlist_alerts_v1:${wallet || 'anon'}`;

function readAlertsFromStorage(wallet: string): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(getAlertsStorageKey(wallet));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const WatchlistView: React.FC<WatchlistViewProps> = ({
  watchlistIds,
  allCalls,
  onToggleWatchlist,
  walletAddress,
  isTelegramLinked = false,
  className,
}) => {
  const context = React.useContext(GenesisContext);
  const activeWallet = walletAddress ?? context?.publicKeyBase58 ?? 'default';
  const effectiveLinked = isTelegramLinked || Boolean(context?.isUnlocked);

  // State: map of callId -> boolean (opted-in to alerts)
  const [alertsMap, setAlertsMap] = useState<Record<string, boolean>>(() =>
    readAlertsFromStorage(activeWallet)
  );

  // Synchronize when wallet address changes
  useEffect(() => {
    queueMicrotask(() => {
      setAlertsMap(readAlertsFromStorage(activeWallet));
    });
  }, [activeWallet]);

  // Toggle alert preference for a specific token
  const toggleAlert = useCallback(
    (callId: string) => {
      setAlertsMap((prev) => {
        const next = { ...prev, [callId]: !prev[callId] };
        try {
          window.localStorage.setItem(getAlertsStorageKey(activeWallet), JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [activeWallet]
  );

  const watchlistedTokens = allCalls.filter((c) => watchlistIds.includes(c.id));

  if (watchlistedTokens.length === 0) {
    return (
      <div
        data-testid="watchlist-empty-view"
        className={cn(
          'p-8 text-center rounded-xl bg-surface-card border border-border-default space-y-3',
          className
        )}
      >
        <div className="w-10 h-10 mx-auto rounded-full bg-surface border border-border-default flex items-center justify-center text-amber">
          <Star className="w-5 h-5 fill-amber/20" />
        </div>
        <div className="space-y-1">
          <h3 className="font-sans text-sm font-bold text-white uppercase tracking-wider">
            Your Personal Watchlist is Empty
          </h3>
          <p className="font-sans text-xs text-muted max-w-md mx-auto">
            Star any Alpha Call or research project to pin it here. You can configure instant Telegram TP/SL alerts for each pinned token.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="watchlist-view-panel"
      className={cn('space-y-4 rounded-xl bg-surface-card border border-border-default p-4 sm:p-5', className)}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border-default">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-amber fill-amber" />
          <h3 className="font-sans text-sm font-bold uppercase tracking-wider text-white">
            Personal Watchlist &amp; Opt-In Alerts
          </h3>
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-surface border border-border-default text-amber font-bold">
            {watchlistedTokens.length} Pinned
          </span>
        </div>

        <div className="font-mono text-xs text-muted flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', effectiveLinked ? 'bg-brand' : 'bg-amber')} />
          <span>{effectiveLinked ? 'Telegram Alerts Linked' : 'Telegram Not Connected (Connect to receive alerts)'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {watchlistedTokens.map((token) => {
          const isAlertEnabled = Boolean(alertsMap[token.id]);
          const shortCa = token.ca
            ? `${token.ca.slice(0, 4)}...${token.ca.slice(-4)}`
            : 'No CA';

          return (
            <div
              key={token.id}
              className="p-3.5 rounded-lg bg-surface border border-border-default hover:border-brand/40 transition-colors space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-bold text-white truncate">
                      {token.name}
                    </span>
                    <span className="font-mono text-xs px-1.5 py-0.2 rounded bg-surface-card border border-border-default text-brand font-bold">
                      ${token.ticker}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-muted truncate mt-0.5">
                    {token.chain} &bull; {shortCa}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleWatchlist(token.id)}
                  className="w-7 h-7 p-0 text-muted hover:text-danger hover:bg-surface-card"
                  title="Remove from Watchlist"
                  aria-label={`Remove ${token.ticker} from watchlist`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Alert Toggle */}
              <div className="pt-2 border-t border-border-default flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  {isAlertEnabled ? (
                    <Bell className="w-3.5 h-3.5 text-brand" />
                  ) : (
                    <BellOff className="w-3.5 h-3.5 text-muted" />
                  )}
                  <span className={isAlertEnabled ? 'text-brand font-bold' : 'text-muted'}>
                    {isAlertEnabled ? 'Alerts Active' : 'Alerts Muted'}
                  </span>
                </div>

                <Button
                  type="button"
                  variant={isAlertEnabled ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => toggleAlert(token.id)}
                  className="h-7 px-2.5 text-xs font-mono font-bold"
                  aria-label={`${isAlertEnabled ? 'Disable' : 'Enable'} alerts for ${token.ticker}`}
                >
                  {isAlertEnabled ? 'Opted In' : 'Opt In'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
