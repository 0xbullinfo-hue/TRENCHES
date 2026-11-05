'use client';

import React, { useState, useMemo } from 'react';
import { Lock } from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import { cleanNumericInput, formatTokenDisplay, getUnlockDate } from '@/lib/stake/format';
import { useStakeTransaction } from '@/lib/stake/useStakeTransaction';

interface StakeFormProps {
  walletPublicKey: PublicKey | null;
  walletBalanceTokens: number;
  genesisPriceUsd: number;
  initialAmountUsd?: number;
  onStakeSuccess: () => void;
}

type ButtonState = 'idle' | 'wallet_confirm' | 'tx_confirm' | 'error' | 'cancelled';

export function StakeForm({
  walletPublicKey,
  walletBalanceTokens,
  genesisPriceUsd,
  initialAmountUsd = 250,
  onStakeSuccess,
}: StakeFormProps) {
  const [amountStr, setAmountStr] = useState<string>(initialAmountUsd.toFixed(2));
  const [buttonState, setButtonState] = useState<ButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { stake } = useStakeTransaction();

  const numericAmount = parseFloat(amountStr) || 0;
  const tokenPrice = genesisPriceUsd > 0 ? genesisPriceUsd : 0.0000164;

  // Compute equivalent GENESIS tokens
  const equivalentTokens = numericAmount / tokenPrice;
  const walletBalanceUsd = walletBalanceTokens * tokenPrice;

  // Validation
  const isBelowMinimum = numericAmount < 250;
  const isAboveBalance = walletBalanceTokens > 0 && numericAmount > walletBalanceUsd;
  const isWalletConnected = Boolean(walletPublicKey);

  let validationError: string | null = null;
  if (!isWalletConnected) {
    validationError = 'Connect wallet to stake';
  } else if (isBelowMinimum) {
    validationError = 'Minimum stake is $250';
  } else if (isAboveBalance) {
    validationError = 'Insufficient $GENESIS balance';
  }

  const isFormDisabled = buttonState === 'wallet_confirm' || buttonState === 'tx_confirm';
  const isButtonDisabled = !isWalletConnected || isBelowMinimum || isAboveBalance || isFormDisabled;

  const unlockDateFormatted = useMemo(() => getUnlockDate(90), []);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isButtonDisabled || !walletPublicKey) return;

    setErrorMessage(null);
    setButtonState('wallet_confirm');

    try {
      // Step a: "Confirming in wallet..."
      // Step b & c: Call stubbed stake handler
      const rawTokens = BigInt(Math.floor(equivalentTokens * 1e9));

      const timer = setTimeout(() => {
        setButtonState('tx_confirm');
      }, 1000);

      await stake({
        wallet: walletPublicKey,
        amountRaw: rawTokens,
        lockDays: 90,
      });

      clearTimeout(timer);
      setButtonState('idle');
      onStakeSuccess();
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '';
      if (/cancel|reject/i.test(msg)) {
        setButtonState('cancelled');
        setErrorMessage('Transaction cancelled.');
      } else {
        setButtonState('error');
        setErrorMessage('Transaction failed — please try again.');
      }
      setTimeout(() => {
        setButtonState('idle');
      }, 3000);
    }
  };

  // Button label determination
  let buttonLabel = 'Stake $GENESIS';
  if (buttonState === 'wallet_confirm') {
    buttonLabel = 'Confirming in wallet...';
  } else if (buttonState === 'tx_confirm') {
    buttonLabel = 'Confirming transaction...';
  } else if (buttonState === 'cancelled') {
    buttonLabel = 'Transaction cancelled';
  } else if (buttonState === 'error') {
    buttonLabel = 'Transaction failed';
  }

  return (
    <div className="rounded-lg bg-surface border border-toxic-border/60 p-6 sm:p-8 shadow-sm space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Amount Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label
              htmlFor="stake-amount"
              className="block font-sans text-xs font-bold uppercase tracking-wider text-muted"
            >
              AMOUNT TO STAKE
            </label>
            {walletBalanceTokens > 0 && !isFormDisabled && (
              <button
                type="button"
                onClick={handleMaxClick}
                className="font-sans text-xs text-toxic hover:text-toxic-bright font-bold uppercase tracking-wider cursor-pointer transition-colors"
              >
                MAX ({formatTokenDisplay(walletBalanceTokens)} $GENESIS)
              </button>
            )}
          </div>

          <div className="relative rounded-md border border-toxic-border/80 bg-canvas/60 focus-within:border-toxic focus-within:ring-1 focus-within:ring-toxic transition-all">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted font-sans text-xl">
              $
            </div>
            <input
              id="stake-amount"
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={handleInputChange}
              disabled={isFormDisabled}
              placeholder="250.00"
              className="w-full h-12 pl-8 pr-16 bg-transparent text-white font-sans text-xl font-semibold placeholder:text-muted/40 focus:outline-none tnum disabled:opacity-50"
            />
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-muted font-sans text-xs font-bold uppercase tracking-wider">
              USD
            </div>
          </div>

          {/* Dynamic GENESIS Equivalent */}
          <div className="flex items-center justify-between text-xs font-sans">
            <span className="font-mono text-toxic tnum">
              ≈ {formatTokenDisplay(equivalentTokens)} $GENESIS
            </span>
            {validationError && (
              <span className="text-danger font-medium">{validationError}</span>
            )}
          </div>
        </div>

        {/* Lock Period Info */}
        <div className="pt-4 border-t border-toxic-border/30 space-y-2">
          <div className="flex items-center justify-between text-sm font-sans">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <Lock className="w-3.5 h-3.5 text-toxic" />
              Lock period
            </span>
            <span className="text-white font-semibold">90 days</span>
          </div>

          <div className="flex items-center justify-between text-sm font-sans">
            <span className="text-muted">Unlocks</span>
            <span className="text-white font-semibold tnum">{unlockDateFormatted}</span>
          </div>
        </div>

        {/* Stake Button */}
        <div className="space-y-3">
          <button
            type="submit"
            disabled={isButtonDisabled}
            className={`w-full h-12 rounded-md font-sans text-base font-bold flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toxic ${
              isButtonDisabled
                ? 'bg-[#1e2732] text-muted/50 cursor-not-allowed border border-transparent'
                : 'bg-toxic hover:bg-toxic-bright text-canvas font-black cursor-pointer shadow-sm'
            }`}
          >
            {buttonLabel}
          </button>

          {errorMessage && (
            <p className="text-center font-sans text-xs text-danger font-medium">
              {errorMessage}
            </p>
          )}

          {/* Static Disclaimer */}
          <p className="text-center font-sans text-xs text-muted/70 leading-relaxed">
            Minimum: $250 staked for 90 days. Your stake is locked and cannot be withdrawn until unlock.
          </p>
        </div>
      </form>
    </div>
  );
}

