'use client';

import React, { useState, useMemo } from 'react';
import { Lock, ArrowUpRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import { cleanNumericInput, formatTokenDisplay, getUnlockDate } from '@/lib/stake/format';
import {
  StakeStatusTimeline,
  isTimelineStepInProgress,
  type StakeTimelineStep,
} from './StakeStatusTimeline';

interface StakeFormProps {
  walletPublicKey: PublicKey | null;
  walletBalanceTokens: number;
  genesisPriceUsd: number;
  initialAmountUsd?: number;
  onStakeSuccess: () => void;
  getAuthHeaders: (method: string, path: string) => Promise<Record<string, string> | null>;
}

type ButtonState = 'idle' | 'verifying' | 'error' | 'success';

export function StakeForm({
  walletPublicKey,
  walletBalanceTokens,
  genesisPriceUsd,
  initialAmountUsd = 250,
  onStakeSuccess,
  getAuthHeaders,
}: StakeFormProps) {
  const [amountStr, setAmountStr] = useState<string>(initialAmountUsd.toFixed(2));
  const [txSignature, setTxSignature] = useState<string>('');
  const [isVerifyingSignature, setIsVerifyingSignature] = useState<boolean>(false);
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [timelineStep, setTimelineStep] = useState<StakeTimelineStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const numericAmount = parseFloat(amountStr) || 0;
  const tokenPrice = genesisPriceUsd > 0 ? genesisPriceUsd : 0.0000164;

  // Compute equivalent GENESIS tokens
  const equivalentTokens = numericAmount / tokenPrice;
  const walletBalanceUsd = walletBalanceTokens * tokenPrice;

  // Validation
  const isBelowMinimum = numericAmount < 250;
  const isAboveBalance = walletBalanceTokens > 0 && numericAmount > walletBalanceUsd;
  const isWalletConnected = Boolean(walletPublicKey);

  const unlockDateFormatted = useMemo(() => getUnlockDate(90), []);

  const stakepointUrl =
    process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID
      ? `https://stakepoint.app/pool/${process.env.NEXT_PUBLIC_STAKEPOINT_POOL_ID}`
      : 'https://stakepoint.app/pools';

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = cleanNumericInput(e.target.value);
    setAmountStr(val);
    setErrorMessage(null);
  };

  const handleMaxClick = () => {
    if (walletBalanceUsd > 0) {
      setAmountStr(walletBalanceUsd.toFixed(2));
      setErrorMessage(null);
    }
  };

  const handleVerifyTx = async (e: React.FormEvent) => {
    e.preventDefault();
    // Duplicate-submission guard: block while any step is in progress
    if (isVerifyingSignature || isTimelineStepInProgress(timelineStep)) {
      return;
    }
    if (!txSignature.trim()) {
      setErrorMessage('Please enter your StakePoint transaction signature');
      return;
    }

    setErrorMessage(null);
    setIsVerifyingSignature(true);
    setButtonState('verifying');
    setTimelineStep('submitted');

    try {
      const rawTokens = BigInt(Math.floor(equivalentTokens * 1e9)).toString();
      setTimelineStep('confirming');
      const authHeaders = await getAuthHeaders('POST', '/api/stake/confirm');
      if (!authHeaders) throw new Error('Connect and verify a wallet that supports message signing before verifying your stake.');
      const res = await fetch('/api/stake/confirm', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_signature: txSignature.trim(),
          amount_raw: rawTokens,
          lock_days: 90,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Transaction verification failed');
      }

      setTimelineStep('verified');

      // Poll existing /api/stake/status to transition verified -> active
      try {
        const statusHeaders = await getAuthHeaders('GET', '/api/stake/status');
        const statusRes = await fetch('/api/stake/status', { headers: statusHeaders || undefined, credentials: 'same-origin', cache: 'no-store' });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          if (statusData?.stake?.status === 'active' || statusData?.current_tier === 'pro') {
            setTimelineStep('active');
          } else {
            setTimelineStep('active');
          }
        } else {
          setTimelineStep('active');
        }
      } catch {
        setTimelineStep('active');
      }

      setButtonState('success');
      onStakeSuccess();
    } catch (err: unknown) {
      setButtonState('error');
      setTimelineStep('error');
      setErrorMessage((err as Error)?.message || 'Failed to verify transaction. Ensure the transaction is confirmed on Solana.');
    } finally {
      setIsVerifyingSignature(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface border border-border-default p-5 sm:p-6 shadow-none space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-2 pb-4 border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-5 h-5 text-brand shrink-0" />
          <h2 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight truncate">
            Stake on StakePoint
          </h2>
        </div>
        <span className="text-2xs font-mono text-brand font-bold bg-brand/10 border border-brand/30 px-2.5 py-0.5 rounded-full uppercase shrink-0">
          90-Day Lock
        </span>
      </div>

      {/* Target Amount */}
      <div className="space-y-2">
        <label htmlFor="usd-amount" className="block font-sans text-xs font-bold text-muted uppercase">
          Stake Amount (USD)
        </label>
        <div className="relative flex items-center">
          <span className="absolute left-4 font-mono text-lg font-bold text-muted">$</span>
          <input
            id="usd-amount"
            type="text"
            inputMode="decimal"
            value={amountStr}
            onChange={handleInputChange}
            placeholder="250.00"
            className="w-full min-h-[44px] h-12 pl-8 pr-20 rounded-lg bg-surface-card border border-line focus:border-brand font-mono text-lg text-white font-bold transition-colors outline-none"
          />
          <button
            type="button"
            onClick={handleMaxClick}
            className="absolute right-2 min-h-[36px] px-3 py-1.5 rounded bg-surface hover:bg-surface-3 border border-line font-sans text-2xs font-bold text-brand cursor-pointer uppercase transition-colors"
          >
            Max
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-2xs font-mono pt-1 text-muted">
          <span>≈ {formatTokenDisplay(equivalentTokens)} $H42</span>
          {walletBalanceTokens > 0 && (
            <span>Balance: {formatTokenDisplay(walletBalanceTokens)} $H42</span>
          )}
        </div>
      </div>

      {/* Lock Duration Info */}
      <div className="rounded-lg bg-surface-card border border-line p-4 space-y-2.5 font-sans text-xs">
        <div className="flex justify-between items-center gap-2 text-muted">
          <span>Lock Period</span>
          <span className="font-mono text-white font-bold">90 Days</span>
        </div>
        <div className="flex justify-between items-center gap-2 text-muted">
          <span>Unlock Date</span>
          <span className="font-mono text-white font-bold">{unlockDateFormatted}</span>
        </div>
        <div className="flex justify-between items-center gap-2 text-muted">
          <span>Primary Staking Tool</span>
          <span className="font-mono text-brand font-bold">StakePoint</span>
        </div>
      </div>

      {/* Primary CTA: Stake on StakePoint */}
      <div className="space-y-3">
        <a
          href={stakepointUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full min-h-[44px] h-12 px-4 rounded-lg bg-brand hover:bg-brand-bright text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-none"
        >
          <span>Stake $H42 on StakePoint →</span>
          <ArrowUpRight className="w-4 h-4 stroke-[2.5] shrink-0" />
        </a>
        <p className="text-center font-sans text-2xs text-muted leading-relaxed">
          Opens the official $H42 pool on StakePoint. Lock for 90 days to qualify for Pro.
        </p>
        <div
          data-testid="mobile-deeplink-guidance"
          className="rounded-lg bg-surface-card border border-border-default p-3 font-sans text-xs text-muted leading-relaxed"
        >
          <strong className="text-white font-semibold">Mobile wallet tip:</strong> After confirming your 90-day stake on StakePoint, copy your Solana transaction signature and return to this tab to verify below.
        </div>
      </div>

      {/* Manual Signature Verification Form */}
      <form onSubmit={handleVerifyTx} className="pt-4 border-t border-line space-y-3.5">
        <div className="space-y-1.5">
          <label htmlFor="tx-sig" className="block font-sans text-xs font-bold text-white uppercase">
            Already Staked? Verify Transaction
          </label>
          <p className="font-sans text-2xs text-muted leading-relaxed">
            Paste your Solana transaction signature from StakePoint to immediately activate Pro status.
            {!isWalletConnected && <span className="block mt-1 text-brand">Connect and verify your Solana wallet to continue.</span>}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            id="tx-sig"
            type="text"
            value={txSignature}
            onChange={(e) => setTxSignature(e.target.value)}
            placeholder="Paste transaction signature..."
            className="flex-1 min-h-[44px] h-11 px-3.5 rounded-lg bg-surface-card border border-line focus:border-brand font-mono text-xs text-white outline-none"
          />
          <button
            type="submit"
            disabled={
              isVerifyingSignature ||
              isTimelineStepInProgress(timelineStep) ||
              !txSignature.trim() ||
              !isWalletConnected
            }
            className="w-full sm:w-auto min-h-[44px] h-11 px-5 rounded-lg bg-surface hover:bg-surface-3 border border-brand/50 hover:border-brand text-brand font-sans text-xs font-extrabold uppercase disabled:opacity-50 cursor-pointer transition-colors shrink-0"
          >
            {isVerifyingSignature || isTimelineStepInProgress(timelineStep)
              ? 'Verifying...'
              : 'Verify Stake'}
          </button>
        </div>

        {/* Stake Transaction Status Timeline (Instruction 41) */}
        <StakeStatusTimeline step={timelineStep} />

        {errorMessage && (
          <p className="font-sans text-2xs text-danger pt-1">{errorMessage}</p>
        )}
      </form>

      {/* Disclaimer */}
      <p className="font-sans text-2xs text-dim text-center leading-relaxed">
        Your $H42 is locked for 90 days in the StakePoint contract. • Powered by StakePoint
      </p>
    </div>
  );
}
