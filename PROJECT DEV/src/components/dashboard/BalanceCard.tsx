'use client';

import React, { useState } from 'react';
import { useGenesisBalance } from '@/context/GenesisContext';
import { GENESIS_MINT, SOLSCAN } from '@/lib/config';
import {
  Award,
  Check,
  ExternalLink,
  Info,
  Link2,
  ShieldCheck,
  X,
} from 'lucide-react';

export const BalanceCard: React.FC = () => {
  const {
    balance,
    formattedBalance,
    tier,
    multiplier,
    capSol,
    points,
    shortAddress,
    publicKeyBase58,
    boundEvmAddress,
    setBoundEvmAddress,
    portfolio,
  } = useGenesisBalance();

  const [evmInput, setEvmInput] = useState<string>(boundEvmAddress);
  const [evmSaved, setEvmSaved] = useState<boolean>(false);
  const [portfolioOpen, setPortfolioOpen] = useState<boolean>(false);

  const handleBindEvm = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = evmInput.trim();
    setBoundEvmAddress(trimmed);
    setEvmSaved(true);
    setTimeout(() => setEvmSaved(false), 2000);
  };

  return (
    <>
      <div className="card flex flex-col justify-between h-full">
        <div>
          {/* Card Header */}
          <div className="card-head">
            <div className="flex items-center gap-1.5">
              <span className="text-accent font-semibold">COL_01</span>
              <span>:: GENESIS_BALANCE</span>
            </div>
            <span className="text-accent font-semibold">SPL VERIFIED</span>
          </div>

          <div className="p-4 space-y-4">
            {/* Large Tabular Balance Readout */}
            <div>
              <div className="label mb-1">LIQUID HOLDING BALANCE</div>
              <div className="font-mono text-2xl sm:text-3xl font-bold text-ink tnum tracking-tight flex items-baseline gap-2">
                <span>{formattedBalance}</span>
                <span className="text-sm font-semibold text-accent">$GENESIS</span>
              </div>
            </div>

            {/* Tier Indicator Pill + Multiplier Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-accent/10 border border-accent/40 text-accent font-mono text-xs font-semibold uppercase">
                <Award className="w-3.5 h-3.5" />
                <span>{tier.label}</span>
              </span>

              <span className="inline-flex items-center px-2.5 py-1 rounded-sm bg-surface-2 border border-line text-ink font-mono text-xs font-semibold tnum">
                {multiplier}x Allocation Boost
              </span>
            </div>

            {/* Tier Ladder Reference (<50k Lab Tech | 50k-149k Researcher | 150k+ Lead Chemist) */}
            <div className="bg-surface-2 border border-line rounded-sm divide-y divide-line font-mono text-2xs">
              {[
                { id: 'LAB_TECH', name: 'Lab Tech', range: '< 50k', mult: '1.0x' },
                { id: 'RESEARCHER', name: 'Researcher', range: '50k – 149k', mult: '2.5x' },
                { id: 'LEAD_CHEMIST', name: 'Lead Chemist', range: '150k+', mult: '6.0x' },
              ].map((row) => {
                const active = tier.id === row.id;
                return (
                  <div
                    key={row.id}
                    className={`px-2.5 py-1.5 flex items-center justify-between ${
                      active ? 'bg-accent/10 text-accent font-semibold' : 'text-muted'
                    }`}
                  >
                    <span>
                      {active ? '▸ ' : ''}
                      {row.name} ({row.range})
                    </span>
                    <span className="tnum">{row.mult}</span>
                  </div>
                );
              })}
            </div>

            {/* Longevity / Points Metric ("Diamond Whiskers" hold tracker) */}
            <div className="bg-surface-2 border border-line rounded-sm p-3 flex items-center justify-between font-mono">
              <div>
                <div className="text-2xs text-dim uppercase">DIAMOND WHISKERS TRACKER</div>
                <div className="text-base font-bold text-ink tnum mt-0.5">
                  {new Intl.NumberFormat('en-US').format(points)}{' '}
                  <span className="text-xs text-accent font-semibold">pts</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xs text-dim uppercase">MAX DROP CAP</div>
                <div className="text-sm font-bold text-accent tnum mt-0.5">{capSol} SOL</div>
              </div>
            </div>

            {/* Secondary Address Mapping (Bind EVM/Base address to Solana profile) */}
            <form onSubmit={handleBindEvm} className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-2xs">
                <label htmlFor="evm-bind-input" className="text-muted flex items-center gap-1">
                  <Link2 className="w-3 h-3 text-accent" />
                  <span>EVM / BASE AIRDROP BINDING</span>
                </label>
                {boundEvmAddress && (
                  <span className="text-accent tnum">
                    {boundEvmAddress.slice(0, 6)}...{boundEvmAddress.slice(-4)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  id="evm-bind-input"
                  type="text"
                  value={evmInput}
                  onChange={(e) => setEvmInput(e.target.value)}
                  placeholder="0x... Base / ETH payout address"
                  className="input flex-1"
                />
                <button
                  type="submit"
                  className="btn btn-secondary h-8 px-2.5 text-2xs shrink-0 cursor-pointer"
                >
                  {evmSaved ? (
                    <>
                      <Check className="w-3 h-3 text-accent" />
                      <span className="text-accent">Bound</span>
                    </>
                  ) : (
                    <span>Bind</span>
                  )}
                </button>
              </div>
            </form>

            {/* Strict Capital Rule Notice: NO STAKING */}
            <div className="p-2.5 rounded-sm bg-surface-2 border border-line flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
              <p className="text-xs text-muted leading-snug">
                <strong className="text-ink font-medium">
                  Liquid Solana wallet balance verified — no staking required.
                </strong>{' '}
                Your tokens never leave self-custody.
              </p>
            </div>
          </div>
        </div>

        {/* Action: [View Portfolio] */}
        <div className="p-4 pt-3 border-t border-line">
          <button
            type="button"
            onClick={() => setPortfolioOpen(true)}
            className="btn btn-secondary w-full h-9 text-xs cursor-pointer"
          >
            <span>[View Portfolio]</span>
          </button>
        </div>
      </div>

      {/* Institutional Portfolio Snapshot Modal */}
      {portfolioOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Solana Portfolio Snapshot"
        >
          <div className="card w-full max-w-md">
            <div className="card-head">
              <div className="flex items-center gap-1.5 text-ink font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                <span>PORTFOLIO_SNAPSHOT : SOLANA_SPL</span>
              </div>
              <button
                type="button"
                onClick={() => setPortfolioOpen(false)}
                className="text-muted hover:text-ink p-1 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="p-4 space-y-3 font-mono text-xs">
              <div className="bg-surface-2 border border-line rounded-sm divide-y divide-line">
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">SOLANA WALLET</span>
                  <span className="text-ink font-semibold tnum">{shortAddress}</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">LIQUID $GENESIS</span>
                  <span className="text-accent font-bold tnum">
                    {new Intl.NumberFormat('en-US').format(balance)} $GENESIS
                  </span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">ACTIVE TIER</span>
                  <span className="text-ink font-semibold">
                    {tier.label} ({multiplier}x)
                  </span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">DIAMOND WHISKERS</span>
                  <span className="text-ink font-semibold tnum">{points} pts</span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">BOUND EVM ADDRESS</span>
                  <span className="text-muted tnum">
                    {boundEvmAddress
                      ? `${boundEvmAddress.slice(0, 8)}...${boundEvmAddress.slice(-6)}`
                      : 'NOT BOUND'}
                  </span>
                </div>
                <div className="px-3 py-2 flex justify-between">
                  <span className="text-dim">CLAIMED DROPS</span>
                  <span className="text-ink font-semibold tnum">
                    0{portfolio?.claimedCount ?? 4} ({portfolio?.totalRealizedPnl ?? '+42.50 SOL'})
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                {publicKeyBase58 && (
                  <a
                    href={SOLSCAN.account(publicKeyBase58)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary h-8 px-3 text-2xs"
                  >
                    <span>Solscan Account</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={SOLSCAN.token(GENESIS_MINT)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary h-8 px-3 text-2xs"
                >
                  <span>$GENESIS Mint</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => setPortfolioOpen(false)}
                  className="btn btn-primary h-8 px-4 text-2xs ml-auto cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
