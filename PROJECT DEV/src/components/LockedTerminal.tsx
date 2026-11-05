'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { BUY_LINKS, GENESIS_MINT, SOLSCAN } from '@/lib/config';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

export const LockedTerminal: React.FC = () => {
  const {
    connected,
    shortAddress,
    formattedBalance,
    setDemoPreset,
    demoEnabled,
    needsSignature,
    requestUnlockSignature,
    connectWallet,
    switchWallet,
    apiLoading,
    apiError,
  } = useGenesisBalance();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(GENESIS_MINT);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access denied
    }
  };

  if (!connected) {
    return (
      <div className="rounded border border-line bg-surface max-w-2xl mx-auto overflow-hidden">
        <div className="px-6 py-4 bg-surface-card border-b border-line flex items-center justify-between font-sans text-xs font-bold text-muted">
          <div className="flex items-center gap-2 text-white">
            <Lock className="w-4 h-4 text-pump" />
            <span>WALLET AUTHENTICATION REQUIRED</span>
          </div>
          <span className="text-pump">DISCONNECTED</span>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded bg-surface-card border border-line mx-auto flex items-center justify-center text-pump">
            <Wallet className="w-5 h-5" />
          </div>

          <div className="space-y-2">
            <h3 className="font-sans text-xl font-extrabold uppercase tracking-tight text-white">
              CONNECT WALLET TO VERIFY $GENESIS HODL
            </h3>
            <p className="font-sans text-sm text-muted max-w-lg mx-auto leading-relaxed">
              Connect Phantom, Solflare, Trust Wallet, or Backpack to verify that your wallet holds atleast{' '}
              <strong className="text-pump-pill">$20 $GENESIS</strong>. This unlocks full
              access to live trade calls, contract addresses, and incubator allocations.
            </p>
          </div>

          <div className="bg-canvas border border-line rounded p-3 font-mono text-xs flex items-center justify-between gap-2 max-w-md mx-auto">
            <div className="truncate">
              <span className="text-muted block text-2xs uppercase">Token Contract</span>
              <span className="text-white font-semibold truncate block tnum">{GENESIS_MINT}</span>
            </div>
            <button
              type="button"
              onClick={copyContract}
              className="text-pump hover:text-pump-pill font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>

          {apiError && (
            <div className="p-3 rounded bg-danger/10 border border-danger/40 text-danger text-xs font-mono text-center max-w-md mx-auto">
              {apiError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={connectWallet}
              className="h-11 px-6 rounded bg-pump hover:bg-pump-hover text-canvas font-sans text-sm font-black uppercase inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Solana Wallet</span>
            </button>

            {demoEnabled && (
              <button
                type="button"
                onClick={() => setDemoPreset('1m')}
                className="h-11 px-5 rounded bg-surface-card hover:bg-surface-3 border border-line font-sans text-sm font-bold text-white cursor-pointer transition-colors"
              >
                <span>Preview 1M $GENESIS Member</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (needsSignature) {
    return (
      <div className="rounded border border-line bg-surface max-w-2xl mx-auto overflow-hidden">
        <div className="px-6 py-4 border-b border-line bg-pump/10 flex items-center justify-between font-sans text-xs font-bold text-pump">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            <span>CRYPTOGRAPHIC VERIFICATION REQUIRED</span>
          </div>
          <span>PROOF OF OWNERSHIP</span>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded bg-pump/10 border border-pump/30 mx-auto flex items-center justify-center text-pump">
            <KeyRound className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h3 className="font-sans text-xl font-extrabold uppercase tracking-tight text-white">
              SIGN MESSAGE TO UNLOCK TERMINAL
            </h3>
            <p className="font-sans text-sm text-muted max-w-lg mx-auto leading-relaxed">
              To protect private trade calls and prevent unauthorized spoofing, sign a short-lived
              message in your wallet to verify control of{' '}
              <strong className="text-white tnum">{shortAddress}</strong>. This does not trigger an
              on-chain transaction and costs zero gas.
            </p>
          </div>

          {apiError && (
            <div className="p-3 rounded bg-danger/10 border border-danger/40 text-danger text-xs font-mono text-center max-w-md mx-auto">
              {apiError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={requestUnlockSignature}
              disabled={apiLoading}
              className="h-11 px-6 rounded bg-pump hover:bg-pump-hover text-canvas font-sans text-sm font-black uppercase inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4" />
              <span>{apiLoading ? 'Verifying...' : 'Sign to Unlock Alpha Calls'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-line bg-surface max-w-2xl mx-auto overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-danger/10 flex items-center justify-between font-sans text-xs font-bold text-danger">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          <span>INSUFFICIENT $GENESIS BALANCE</span>
        </div>
        <span>1,000,000 $GENESIS REQUIRED</span>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-5 border-b border-line">
          <div className="w-12 h-12 shrink-0 rounded bg-danger/10 border border-danger/40 flex items-center justify-center text-danger">
            <Lock className="w-5 h-5" />
          </div>

          <div className="space-y-1">
            <h3 className="font-sans text-lg sm:text-xl font-extrabold uppercase tracking-tight text-white">
              HOLD 1,000,000 $GENESIS TO ENTER THE LAB
            </h3>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Your wallet currently holds{' '}
              <strong className="text-danger tnum">{formattedBalance} $GENESIS</strong>. All
              users must hold at least{' '}
              <strong className="text-pump-pill">1,000,000 $GENESIS</strong> in their login
              wallet to unlock the incubator dashboard.
            </p>
          </div>
        </div>

        <div className="bg-surface-card border border-line rounded divide-y divide-line font-sans text-xs">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Connected Wallet</span>
            <span className="font-mono text-white font-semibold tnum">{shortAddress}</span>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <span className="text-muted shrink-0">$GENESIS Contract</span>
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={SOLSCAN.token(GENESIS_MINT)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-pump hover:underline truncate tnum"
              >
                {GENESIS_MINT}
              </a>
              <button
                type="button"
                onClick={copyContract}
                className="text-muted hover:text-white cursor-pointer"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-pump" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Required Balance</span>
            <span className="font-mono text-pump font-bold tnum">
              1,000,000 $GENESIS
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={BUY_LINKS.pump}
              target="_blank"
              rel="noreferrer"
              className="h-11 px-5 rounded bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-2"
            >
              <span>Buy $GENESIS on Pump.fun</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={switchWallet}
              className="h-11 px-4 rounded bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-pump" />
              <span>Switch Wallet</span>
            </button>
          </div>

          {demoEnabled && (
            <button
              type="button"
              onClick={() => setDemoPreset('1m')}
              className="font-sans text-xs text-pump font-bold hover:underline cursor-pointer"
            >
              Preview 1M $GENESIS Member →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
