'use client';

import React, { useState } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useGenesisBalance } from '@/context/GenesisContext';
import { BUY_LINKS, GENESIS_MINT, SOLSCAN } from '@/lib/config';
import {
  Check,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

export const LockedTerminal: React.FC = () => {
  const { setVisible: openWalletModal } = useWalletModal();
  const { connected, shortAddress, formattedBalance, setDemoPreset } =
    useGenesisBalance();
  const [copied, setCopied] = useState(false);

  const copyContract = () => {
    navigator.clipboard.writeText(GENESIS_MINT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!connected) {
    return (
      <div className="rounded-xl bg-surface border border-line max-w-2xl mx-auto overflow-hidden">
        <div className="px-6 py-4 bg-surface-card border-b border-line flex items-center justify-between font-sans text-xs font-bold text-muted">
          <div className="flex items-center gap-2 text-white">
            <Lock className="w-4 h-4 text-pump" />
            <span>WALLET AUTHENTICATION REQUIRED</span>
          </div>
          <span className="text-pump">DISCONNECTED</span>
        </div>

        <div className="p-6 sm:p-8 text-center space-y-5">
          <div className="w-12 h-12 rounded-lg bg-surface-card border border-line mx-auto flex items-center justify-center text-pump">
            <Wallet className="w-5 h-5" />
          </div>

          <div className="space-y-2">
            <h3 className="font-sans text-xl font-extrabold uppercase tracking-tight text-white">
              CONNECT WALLET TO VERIFY 1,000,000 $GENESIS
            </h3>
            <p className="font-sans text-sm text-muted max-w-lg mx-auto leading-relaxed">
              Connect Phantom, Solflare, or Backpack to verify that your wallet holds at
              least <strong className="text-pump-pill">1,000,000 $GENESIS</strong> from
              contract <span className="font-mono text-pump">{GENESIS_MINT}</span>.
            </p>
          </div>

          <div className="max-w-lg mx-auto px-4 py-2.5 rounded-lg bg-surface-card border border-line flex items-center justify-between gap-2 font-mono text-xs">
            <span className="text-muted shrink-0">$GENESIS CA:</span>
            <span className="text-white font-semibold truncate tnum">{GENESIS_MINT}</span>
            <button
              type="button"
              onClick={copyContract}
              className="text-pump hover:text-pump-pill font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => openWalletModal(true)}
              className="h-11 px-6 rounded-lg bg-pump hover:bg-pump-hover text-canvas font-sans text-sm font-black uppercase inline-flex items-center gap-2 cursor-pointer"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Solana Wallet</span>
            </button>

            <button
              type="button"
              onClick={() => setDemoPreset('1m')}
              className="h-11 px-5 rounded-lg bg-surface-card hover:bg-surface-3 border border-line font-sans text-sm font-bold text-white cursor-pointer"
            >
              <span>Preview 1M $GENESIS Member</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface border border-line max-w-2xl mx-auto overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-danger/10 flex items-center justify-between font-sans text-xs font-bold text-danger">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          <span>INSUFFICIENT $GENESIS BALANCE</span>
        </div>
        <span>1,000,000 $GENESIS REQUIRED</span>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pb-5 border-b border-line">
          <div className="w-12 h-12 shrink-0 rounded-lg bg-danger/10 border border-danger/40 flex items-center justify-center text-danger">
            <Lock className="w-5 h-5" />
          </div>

          <div className="space-y-1">
            <h3 className="font-sans text-lg sm:text-xl font-extrabold uppercase tracking-tight text-white">
              HOLD 1,000,000 $GENESIS TO ENTER THE LAB
            </h3>
            <p className="font-sans text-sm text-muted leading-relaxed">
              Your wallet currently holds{' '}
              <strong className="text-danger">{formattedBalance} $GENESIS</strong>. All
              users must hold at least{' '}
              <strong className="text-pump-pill">1,000,000 $GENESIS</strong> in their login
              wallet to unlock the incubator dashboard.
            </p>
          </div>
        </div>

        <div className="bg-surface-card border border-line rounded-lg divide-y divide-line font-sans text-xs">
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
              className="h-11 px-5 rounded-lg bg-pump hover:bg-pump-hover text-canvas font-sans text-xs font-black uppercase inline-flex items-center gap-2"
            >
              <span>Buy $GENESIS on Pump.fun</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={() => openWalletModal(true)}
              className="h-11 px-4 rounded-lg bg-surface-card hover:bg-surface-3 border border-line font-sans text-xs font-bold text-white inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-pump" />
              <span>Switch Wallet</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDemoPreset('1m')}
            className="font-sans text-xs text-pump font-bold hover:underline cursor-pointer"
          >
            Preview 1M $GENESIS Member →
          </button>
        </div>
      </div>
    </div>
  );
};
