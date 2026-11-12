'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';

export const LockedTerminal: React.FC = () => {
  const {
    connected,
    shortAddress,
    formattedBalance,
    needsSignature,
    requestUnlockSignature,
    connectWallet,
    switchWallet,
    apiLoading,
    apiError,
  } = useGenesisBalance();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
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
      setCopyError(false);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopyError(false), 2500);
    }
  };

  // State 1: Wallet Disconnected
  if (!connected) {
    return (
      <div className="rounded-xl border border-border-default bg-surface max-w-2xl mx-auto overflow-hidden shadow-none">
        <div className="px-6 py-4 bg-surface-card border-b border-border-default flex items-center justify-between font-sans text-xs font-bold text-muted">
          <div className="flex items-center gap-2 text-white">
            <Lock className="w-4 h-4 text-toxic" />
            <span>WALLET AUTHENTICATION REQUIRED</span>
          </div>
          <span className="text-toxic font-mono">DISCONNECTED</span>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-lg bg-surface-card border border-border-default mx-auto flex items-center justify-center text-toxic">
            <Wallet className="w-5 h-5" />
          </div>

          <div className="space-y-2">
            <h3 className="font-sans text-xl font-extrabold uppercase tracking-tight text-white">
              CONNECT WALLET TO VERIFY $GENESIS ACCESS
            </h3>
            <p className="font-sans text-sm text-muted max-w-lg mx-auto leading-relaxed">
              Connect Phantom, Solflare, Trust Wallet, or Backpack to verify your wallet holding.
              Holding at least <strong className="text-toxic font-bold">~$20 $GENESIS</strong> unlocks full
              access to live trade calls, contract addresses, and incubator allocations.
            </p>
          </div>

          <div className="bg-canvas border border-border-default rounded-lg p-3 font-mono text-xs flex items-center justify-between gap-2 max-w-md mx-auto">
            <div className="truncate text-left">
              <span className="text-muted block text-[10px] uppercase font-bold">Token Contract</span>
              <span className="text-white font-semibold truncate block tnum">{GENESIS_MINT}</span>
            </div>
            <button
              type="button"
              onClick={copyContract}
              className={`${copyError ? 'text-danger' : 'text-toxic hover:text-toxic-bright'} font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors`}
              aria-label="Copy token contract address"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copyError ? 'FAILED' : copied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>

          {apiError && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/40 text-danger text-xs font-mono text-center max-w-md mx-auto">
              {apiError}
            </div>
          )}

          <div className="max-w-md mx-auto pt-2">
            <button
              type="button"
              onClick={connectWallet}
              className="w-full h-12 min-h-[44px] px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-sm font-black uppercase inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-none"
            >
              <Wallet className="w-4 h-4 stroke-[2.5]" />
              <span>Connect Solana Wallet</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 2: Needs Cryptographic Signature to bind session
  if (needsSignature) {
    return (
      <div className="rounded-xl border border-border-default bg-surface max-w-2xl mx-auto overflow-hidden shadow-none">
        <div className="px-6 py-4 border-b border-border-default bg-toxic-bg flex items-center justify-between font-sans text-xs font-bold text-toxic">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            <span>CRYPTOGRAPHIC VERIFICATION REQUIRED</span>
          </div>
          <span>PROOF OF OWNERSHIP</span>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-lg bg-surface-card border border-border-default mx-auto flex items-center justify-center text-toxic">
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
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/40 text-danger text-xs font-mono text-center max-w-md mx-auto">
              {apiError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={requestUnlockSignature}
              disabled={apiLoading}
              className="h-12 min-h-[44px] px-6 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-sm font-black uppercase inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
            >
              <KeyRound className="w-4 h-4 stroke-[2.5]" />
              <span>{apiLoading ? 'Verifying...' : 'Sign to Unlock Alpha Calls'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // State 3: Connected but Ineligible (Section 7 Detailed Breakdown)
  return (
    <div className="rounded-xl border border-border-default bg-surface max-w-2xl mx-auto overflow-hidden shadow-none">
      <div className="px-6 py-4 border-b border-border-default bg-danger/10 flex items-center justify-between font-sans text-xs font-bold text-danger">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          <span>MEMBERSHIP REQUIREMENT NOT MET</span>
        </div>
        <span>~$20 $GENESIS OR STAKING REQUIRED</span>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-5 border-b border-border-default">
          <div className="w-12 h-12 shrink-0 rounded-lg bg-danger/10 border border-danger/40 flex items-center justify-center text-danger">
            <Lock className="w-5 h-5" />
          </div>

          <div className="space-y-1">
            <h3 className="font-sans text-lg sm:text-xl font-extrabold uppercase tracking-tight text-white">
              HOLD ~$20 WORTH OF $GENESIS TO ENTER THE LAB
            </h3>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Your wallet currently holds{' '}
              <strong className="text-danger tnum">{formattedBalance} $GENESIS</strong>.
              You are currently on the <strong className="text-white">Free tier</strong> with access to community Social Raids, closed calls, and the performance ledger.
            </p>
          </div>
        </div>

        {/* Informative Requirements Breakdown (Section 7) */}
        <div className="bg-surface-card border border-border-default rounded-lg divide-y divide-border-default font-sans text-xs">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Connected Wallet</span>
            <span className="font-mono text-white font-semibold tnum">{shortAddress}</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Current Membership</span>
            <span className="font-mono text-muted uppercase font-bold">Free ($0)</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Verified Wallet Balance</span>
            <span className="font-mono text-danger font-bold tnum">{formattedBalance} $GENESIS</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Member Access</span>
            <span className="font-mono text-toxic font-bold tnum">Hold ≥ $20 $GENESIS in Wallet</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-muted">Pro Access</span>
            <span className="font-mono text-toxic font-bold tnum">Stake ≥ $250 on StakePoint (90d)</span>
          </div>

          <div className="px-4 py-3 flex items-center justify-between gap-2">
            <span className="text-muted shrink-0">$GENESIS Contract</span>
            <div className="flex items-center gap-2 min-w-0">
              <a
                href={SOLSCAN.token(GENESIS_MINT)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-toxic hover:underline truncate tnum"
              >
                {GENESIS_MINT}
              </a>
              <button
                type="button"
                onClick={copyContract}
                className="text-muted hover:text-white cursor-pointer inline-flex items-center gap-1"
                title="Copy token contract"
                aria-label="Copy token contract"
              >
                {copyError ? (
                  <span className="text-[10px] text-danger font-bold">Failed</span>
                ) : copied ? (
                  <Check className="w-3.5 h-3.5 text-toxic" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Available Next Steps (Section 7) */}
        <div className="space-y-3 pt-1">
          <div className="font-sans text-xs font-bold text-muted uppercase tracking-wider">
            AVAILABLE NEXT STEPS:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={BUY_LINKS.pump}
              target="_blank"
              rel="noreferrer"
              className="h-12 min-h-[44px] px-5 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans text-xs font-black uppercase inline-flex items-center justify-center gap-2 transition-colors"
            >
              <span>Buy $GENESIS on Pump.fun</span>
              <ExternalLink className="w-3.5 h-3.5 stroke-[2.5]" />
            </a>

            <Link
              href="/dashboard/stake"
              className="h-12 min-h-[44px] px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-border-default hover:border-toxic text-white font-sans text-xs font-black uppercase inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-toxic" />
              <span>Stake on StakePoint</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={switchWallet}
              className="h-10 min-h-[44px] px-4 rounded-lg bg-surface hover:bg-surface-card border border-border-default font-sans text-xs font-bold text-muted hover:text-white inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-toxic" />
              <span>Switch to Another Wallet</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
