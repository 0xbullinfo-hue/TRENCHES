'use client';

import React, { useState, useMemo } from 'react';
import { Lock, ArrowUpRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import { cleanNumericInput, formatTokenDisplay, getUnlockDate } from '@/lib/stake/format';

interface StakeFormProps {
  walletPublicKey: PublicKey | null;
  walletBalanceTokens: number;
  genesisPriceUsd: number;
  initialAmountUsd?: number;
  onStakeSuccess: () => void;
}

type ButtonState = 'idle' | 'verifying' | 'error' | 'success';

export function StakeForm({
  walletPublicKey,
  walletBalanceTokens,
  genesisPriceUsd,
  initialAmountUsd = 250,
  onStakeSuccess,
}: StakeFormProps) {
  const [amountStr, setAmountStr] = useState<string>(initialAmountUsd.toFixed(2));
  const [txSignature, setTxSignature] = useState<string>('');
  const [isVerifyingSignature, setIsVerifyingSignature] = useState<boolean>(false);
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
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
    if (!txSignature.trim()) {
      setErrorMessage('Please enter your StakePoint transaction signature');
      return;
    }

    setErrorMessage(null);
    setIsVerifyingSignature(true);
    setButtonState('verifying');

    try {
      const rawTokens = BigInt(Math.floor(equivalentTokens * 1e9)).toString();
      const res = await fetch('/api/stake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      setButtonState('success');
      onStakeSuccess();
    } catch (err: unknown) {
      setButtonState('error');
      setErrorMessage((err as Error)?.message || 'Failed to verify transaction. Ensure the transaction is confirmed on Solana.');
    } finally {
      setIsVerifyingSignature(false);
    }
  };

  return (
    <div className="rounded-xl bg-surface border border-toxic/40 p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-line">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-toxic" />
          <h2 className="font-sans text-base sm:text-lg font-extrabold text-white uppercase tracking-tight">
            Stake on StakePoint
          </h2>
        </div>
        <span className="text-2xs font-mono text-toxic font-bold bg-toxic/10 border border-toxic/30 px-2.5 py-0.5 rounded-full uppercase">
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
            className="w-full h-12 pl-8 pr-16 rounded-lg bg-surface-card border border-line focus:border-toxic font-mono text-lg text-white font-bold transition-colors outline-none"
          />
          <button
            type="button"
            onClick={handleMaxClick}
            className="absolute right-3 px-2.5 py-1 rounded bg-surface hover:bg-surface-3 border border-line font-sans text-2xs font-bold text-toxic cursor-pointer uppercase transition-colors"
          >
            Max
          </button>
        </div>

        <div className="flex items-center justify-between text-2xs font-mono pt-1 text-muted">
          <span>≈ {formatTokenDisplay(equivalentTokens)} $GENESIS</span>
          {walletBalanceTokens > 0 && (
            <span>Balance: {formatTokenDisplay(walletBalanceTokens)} $GENESIS</span>
          )}
        </div>
      </div>

      {/* Lock Duration Info */}
      <div className="rounded-lg bg-surface-card border border-line p-4 space-y-2 font-sans text-xs">
        <div className="flex justify-between items-center text-muted">
          <span>Lock Period</span>
          <span className="font-mono text-white font-bold">90 Days</span>
        </div>
        <div className="flex justify-between items-center text-muted">
          <span>Unlock Date</span>
          <span className="font-mono text-white font-bold">{unlockDateFormatted}</span>
        </div>
        <div className="flex justify-between items-center text-muted">
          <span>Primary Staking Tool</span>
          <span className="font-mono text-toxic font-bold">StakePoint</span>
        </div>
      </div>

      {/* Primary CTA: Stake on StakePoint */}
      <div className="space-y-3">
        <a
          href={stakepointUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full h-12 rounded-lg bg-toxic hover:bg-toxic-bright text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
        >
          <span>Stake $GENESIS on StakePoint →</span>
          <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
        </a>
        <p className="text-center font-sans text-2xs text-muted">
          Opens the official $GENESIS pool on StakePoint. Lock for 90 days to qualify for Pro.
        </p>
      </div>

      {/* Manual Signature Verification Form */}
      <form onSubmit={handleVerifyTx} className="pt-4 border-t border-line space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="tx-sig" className="block font-sans text-xs font-bold text-white uppercase">
            Already Staked? Verify Transaction
          </label>
          <p className="font-sans text-2xs text-muted">
            Paste your Solana transaction signature from StakePoint to immediately activate Pro status.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="tx-sig"
            type="text"
            value={txSignature}
            onChange={(e) => setTxSignature(e.target.value)}
            placeholder="Paste transaction signature..."
            className="flex-1 h-10 px-3 rounded-lg bg-surface-card border border-line focus:border-toxic font-mono text-xs text-white outline-none"
          />
          <button
            type="submit"
            disabled={isVerifyingSignature || !txSignature.trim()}
            className="h-10 px-4 rounded-lg bg-surface hover:bg-surface-3 border border-toxic/50 hover:border-toxic text-toxic font-sans text-xs font-extrabold uppercase disabled:opacity-50 cursor-pointer transition-colors shrink-0"
          >
            {isVerifyingSignature ? 'Verifying...' : 'Verify Stake'}
          </button>
        </div>

        {errorMessage && (
          <p className="font-sans text-2xs text-danger pt-1">{errorMessage}</p>
        )}
      </form>

      {/* Disclaimer */}
      <p className="font-sans text-2xs text-dim text-center leading-relaxed">
        Your $GENESIS is locked for 90 days in the StakePoint contract. • Powered by StakePoint
      </p>
    </div>
  );
}
