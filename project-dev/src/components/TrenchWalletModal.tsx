'use client';

import React, { useEffect, useRef } from 'react';
import type { Wallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wallet as WalletIcon,
  X,
} from 'lucide-react';
import type { DemoPreset } from '@/context/GenesisContext';

interface TrenchWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallets: Wallet[];
  onSelectWallet: (wallet: Wallet) => Promise<void>;
  connectingWalletName?: string | null;
  connectError?: string | null;
  onCancelConnecting?: () => void;
  demoEnabled?: boolean;
  onSelectDemoPreset?: (preset: DemoPreset) => void;
}

function canonicalWalletKey(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower === 'trust' || lower === 'trust wallet' || lower === 'trustwallet') {
    return 'trust-wallet';
  }
  return lower;
}

export const TrenchWalletModal: React.FC<TrenchWalletModalProps> = ({
  isOpen,
  onClose,
  wallets,
  onSelectWallet,
  connectingWalletName = null,
  connectError = null,
  onCancelConnecting,
  demoEnabled = false,
  onSelectDemoPreset,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap / auto-focus close button
  useEffect(() => {
    if (isOpen) {
      closeBtnRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Deduplicate wallets by canonical key (e.g., 'Trust' from Wallet Standard vs 'Trust Wallet' adapter),
  // preferring Installed/Loadable entries.
  const dedupedMap = new Map<string, Wallet>();
  for (const w of wallets) {
    const key = canonicalWalletKey(w.adapter.name);
    const existing = dedupedMap.get(key);
    if (!existing) {
      dedupedMap.set(key, w);
    } else {
      const existingInstalled =
        existing.readyState === WalletReadyState.Installed ||
        existing.readyState === WalletReadyState.Loadable;
      const candidateInstalled =
        w.readyState === WalletReadyState.Installed ||
        w.readyState === WalletReadyState.Loadable;
      if (candidateInstalled && !existingInstalled) {
        dedupedMap.set(key, w);
      }
    }
  }

  // Prioritize installed/detected wallets at the top
  const sortedWallets = Array.from(dedupedMap.values()).sort((a, b) => {
    const aInstalled =
      a.readyState === WalletReadyState.Installed ||
      a.readyState === WalletReadyState.Loadable;
    const bInstalled =
      b.readyState === WalletReadyState.Installed ||
      b.readyState === WalletReadyState.Loadable;
    if (aInstalled && !bInstalled) return -1;
    if (!aInstalled && bInstalled) return 1;
    return a.adapter.name.localeCompare(b.adapter.name);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="trench-wallet-modal-title"
      containerClassName="bg-black/80 backdrop-blur-sm"
      className="w-full max-w-md p-0 overflow-hidden shadow-none animate-in zoom-in-95 duration-150"
    >
      <div ref={modalRef}>
        {/* Header */}
        <div className="px-5 py-4 bg-surface-card border-b border-toxic-border flex items-center justify-between">
          <div className="flex items-center gap-2 text-white font-mono text-sm font-bold tracking-wide">
            <div className="w-7 h-7 rounded-lg bg-toxic/10 border border-toxic/30 flex items-center justify-center text-toxic">
              <WalletIcon className="w-4 h-4" />
            </div>
            <span id="trench-wallet-modal-title">CONNECT SOLANA WALLET</span>
          </div>

          <Button
            ref={closeBtnRef}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close modal dialog"
            className="w-7 h-7 p-0 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border text-muted hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Error Banner */}
        {connectError && (
          <div className="mx-5 mt-4 p-3 rounded-lg bg-danger/10 border border-danger/40 flex items-start gap-2.5 text-xs font-mono text-danger">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{connectError}</span>
          </div>
        )}

        {/* Active Connecting Notice with Cancel */}
        {connectingWalletName && (
          <div className="mx-5 mt-4 p-3 rounded-lg bg-toxic/10 border border-toxic/40 flex items-center justify-between gap-2.5 text-xs font-mono text-white">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 text-toxic animate-spin" />
              <span>Connecting to {connectingWalletName}...</span>
            </div>
            {onCancelConnecting && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancelConnecting}
                className="h-auto text-xs font-bold text-danger hover:underline px-1.5 py-0.5 rounded bg-surface border border-danger/30 hover:bg-surface"
              >
                Cancel
              </Button>
            )}
          </div>
        )}

        {/* Wallet List */}
        <div className="p-5 space-y-2.5 max-h-[60vh] overflow-y-auto">
          {sortedWallets.length > 0 ? (
            sortedWallets.map((w) => {
              const isDetected =
                w.readyState === WalletReadyState.Installed ||
                (typeof window !== 'undefined' &&
                  ((w.adapter.name === 'Solflare' && 'solflare' in window) ||
                    (w.adapter.name === 'Phantom' && ('phantom' in window || 'solana' in window))));
              const isConnectingThis = connectingWalletName === w.adapter.name;

              return (
                <Button
                  key={w.adapter.name}
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={Boolean(connectingWalletName)}
                  onClick={() => onSelectWallet(w)}
                  className="w-full h-auto px-4 py-3 rounded-lg bg-surface-card hover:bg-surface border border-toxic-border hover:border-toxic disabled:opacity-60 flex items-center justify-between gap-3 transition-all group text-left font-normal"
                >
                  <div className="flex items-center gap-3">
                    {w.adapter.icon ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={w.adapter.icon}
                        alt={`${w.adapter.name} icon`}
                        className="w-6 h-6 rounded object-contain shrink-0"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded bg-surface border border-toxic-border flex items-center justify-center text-toxic shrink-0">
                        <WalletIcon className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <span className="font-mono text-xs font-bold text-white group-hover:text-toxic transition-colors">
                      {w.adapter.name === 'Trust' ? 'Trust Wallet' : w.adapter.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isConnectingThis ? (
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-toxic/20 text-toxic border border-toxic/40 inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>CONNECTING</span>
                      </span>
                    ) : isDetected ? (
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-toxic/20 text-toxic border border-toxic/40">
                        DETECTED
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-medium text-dim border border-toxic-border flex items-center gap-1">
                        <span>Install</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                </Button>
              );
            })
          ) : (
            <div className="py-6 text-center text-xs text-muted font-mono">
              Detecting Solana wallets...
            </div>
          )}
        </div>

        {/* Local Dev / Quick Connect Presets (Only visible when demoEnabled is true) */}
        {demoEnabled && (
          <div className="px-5 pb-4 pt-3 border-t border-toxic-border/40 bg-surface-card/30 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-toxic uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-toxic" />
                <span>Localhost Quick Connect</span>
              </span>
              <span className="text-xs font-mono text-muted bg-surface px-1.5 py-0.2 rounded border border-toxic-border/30">
                Dev Mode
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => onSelectDemoPreset?.('admin')}
                className="h-auto p-2.5 rounded-lg bg-surface hover:bg-surface-card border border-toxic/50 hover:border-toxic text-white font-mono text-xs transition-colors text-left flex flex-col justify-between items-start"
              >
                <span className="text-toxic font-black">⚡ Master Admin</span>
                <span className="text-xs text-muted mt-0.5">Admin Desk &amp; Pro</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => onSelectDemoPreset?.('1m')}
                className="h-auto p-2.5 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-mono text-xs transition-colors text-left flex flex-col justify-between items-start"
              >
                <span className="text-white font-black">🛡️ Member Tier</span>
                <span className="text-xs text-muted mt-0.5">1M+ $H42</span>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => onSelectDemoPreset?.('0')}
                className="h-auto p-2.5 rounded-lg bg-surface hover:bg-surface-card border border-toxic-border hover:border-toxic text-white font-mono text-xs transition-colors text-left flex flex-col justify-between items-start"
              >
                <span className="text-muted font-black">🆓 Free Tier</span>
                <span className="text-xs text-muted mt-0.5">0 Tokens</span>
              </Button>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="px-5 py-3.5 bg-surface-card/60 border-t border-toxic-border flex items-center justify-between text-2xs font-mono text-muted">
          <div className="flex items-center gap-1.5 text-toxic">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Encrypted Web3 Authentication</span>
          </div>
          <span>Solana Mainnet</span>
        </div>
      </div>
    </Modal>
  );
};
