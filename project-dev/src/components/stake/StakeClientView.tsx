'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { CurrentStakeCard } from './CurrentStakeCard';
import { StakeForm } from './StakeForm';
import { StakeSuccessToast } from './StakeSuccessToast';
import { TelegramConnectButton } from '@/components/telegram/TelegramConnectButton';

interface InitialStakeData {
  wallet: string;
  current_tier: 'free' | 'member' | 'pro' | 'unknown';
  stake: {
    amount_raw: string;
    amount_genesis: number;
    amount_usd: number;
    staked_at: string | null;
    unlocks_at: string | null;
    days_remaining: number;
    status: 'active' | 'expired' | 'none';
  };
  thresholds: {
    pro: {
      genesis_usd_price: number;
      token_amount: string;
    };
    twap_source?: string;
    recalculated_at?: string;
    stale?: boolean;
  };
  eligible_for_pro: boolean;
  gap_to_pro_usd: number;
}

export function StakeClientView({ initialData }: { initialData: InitialStakeData }) {
  const { publicKey } = useWallet();
  const { balance: genesisTokenBalance, signRequestHeaders } = useGenesisBalance();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [stakeData, setStakeData] = useState<InitialStakeData>(initialData);
  const [showAdditionalForm, setShowAdditionalForm] = useState<boolean>(false);
  const [showSuccessToast, setShowSuccessToast] = useState<boolean>(false);

  const fetchStatus = useCallback(async () => {
    try {
      // First use the existing httpOnly session cookie. If the page was opened
      // before the wallet session finished minting, request a path-bound wallet
      // signature and retry instead of silently leaving the Stake page empty.
      let res = await fetch('/api/stake/status', { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        const headers = await signRequestHeaders('GET', '/api/stake/status');
        if (!headers) {
          setStatusMessage('Connect a Solana wallet that supports message signing to load your staking status.');
          return;
        }
        res = await fetch('/api/stake/status', { headers, cache: 'no-store', credentials: 'same-origin' });
      }

      const json = await res.json().catch(() => null);
      if (res.ok && json) {
        setStakeData(json);
        setStatusMessage(null);
      } else if (res.status === 401) {
        setStatusMessage('Wallet verification is required to load your staking status. Please reconnect and verify your wallet.');
      } else {
        setStatusMessage(json?.message || 'Unable to load staking status right now. Please retry.');
      }
    } catch (e) {
      console.error('Failed to refresh stake status:', e);
      setStatusMessage('Unable to connect to the staking service. Please retry.');
    }
  }, [signRequestHeaders]);

  useEffect(() => {
    if (publicKey) void fetchStatus();
  }, [publicKey, fetchStatus]);

  const handleStakeSuccess = async () => {
    setShowSuccessToast(true);
    await fetchStatus();
    setShowAdditionalForm(false);
  };

  const isActivePro = stakeData.current_tier === 'pro' && stakeData.stake.status === 'active';
  const showForm = !isActivePro || showAdditionalForm;
  const initialPrefill = stakeData.gap_to_pro_usd > 0 ? stakeData.gap_to_pro_usd : 250;

  return (
    <div className="w-full max-w-[560px] mx-auto px-4 py-12 sm:py-16 space-y-8">
      {/* Page Header */}
      <div className="space-y-2 text-center">
        <h1 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase tracking-tight text-white">
          Stake $H42 to unlock Pro
        </h1>
        <p className="font-sans text-sm text-muted leading-relaxed max-w-md mx-auto">
          Real-time signals, push alerts, and full terminal access. Stake for 90 days to qualify.
        </p>
      </div>

      {statusMessage && (
        <div role="status" aria-live="polite" className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-xs text-muted">
          {statusMessage}
          <button type="button" onClick={() => void fetchStatus()} className="ml-2 font-bold text-brand underline underline-offset-2">Retry</button>
        </div>
      )}

      {/* Secondary Card: Current Stake (Visible if user has a stake record) */}
      <CurrentStakeCard
        amountUsd={stakeData.stake.amount_usd}
        unlocksAt={stakeData.stake.unlocks_at}
        daysRemaining={stakeData.stake.days_remaining}
        status={stakeData.stake.status}
        showStakeAdditionalLink={isActivePro && !showAdditionalForm}
        onStakeAdditional={() => setShowAdditionalForm(true)}
        provenance={stakeData.thresholds}
      />

      {/* Primary Card: Stake Form OR Active Pro Summary */}
      {showForm ? (
        <StakeForm
          walletPublicKey={publicKey}
          walletBalanceTokens={genesisTokenBalance}
          genesisPriceUsd={stakeData.thresholds?.pro?.genesis_usd_price ?? 0.0000164}
          initialAmountUsd={initialPrefill}
          onStakeSuccess={handleStakeSuccess}
        />
      ) : (
        <div className="rounded-xl bg-surface border border-brand p-6 sm:p-8 shadow-none text-center space-y-6">
          <div className="space-y-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-brand/15 text-brand border border-brand/30">
              PRO MEMBERSHIP ACTIVE
            </span>
            <h2 className="font-sans text-xl font-bold text-white">
              Full Terminal Access Unlocked
            </h2>
            <p className="font-sans text-sm text-muted">
              Connect to Telegram below to start receiving real-time signals and instant alerts.
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <TelegramConnectButton />
          </div>
        </div>
      )}

      {/* Success Toast */}
      {showSuccessToast && (
        <StakeSuccessToast onClose={() => setShowSuccessToast(false)} />
      )}
    </div>
  );
}
