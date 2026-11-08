'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LEDGER_CHAINS, validateContractAddress, validateMultiplier } from '@/lib/ledger/format';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';

interface AdminLedgerFormProps {
  initialData?: {
    id: string;
    ticker: string;
    chain: string;
    contract_address: string;
    multiplier: string;
    closed_at: string;
    entry_price?: string | null;
    exit_price?: string | null;
    proof_url?: string | null;
    notes?: string | null;
  };
  isEdit?: boolean;
}

export function AdminLedgerForm({ initialData, isEdit = false }: AdminLedgerFormProps) {
  const router = useRouter();

  const [ticker, setTicker] = useState(initialData?.ticker || '');
  const [chain, setChain] = useState(initialData?.chain || 'solana');
  const [contractAddress, setContractAddress] = useState(initialData?.contract_address || '');
  const [multiplier, setMultiplier] = useState(initialData?.multiplier || '');
  const [closedAt, setClosedAt] = useState(
    initialData?.closed_at ? initialData.closed_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [entryPrice, setEntryPrice] = useState(initialData?.entry_price || '');
  const [exitPrice, setExitPrice] = useState(initialData?.exit_price || '');
  const [proofUrl, setProofUrl] = useState(initialData?.proof_url || '');
  const [notes, setNotes] = useState(initialData?.notes || '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanTicker = ticker.toUpperCase().replace(/^\$/, '').trim();
    if (!cleanTicker) {
      setError('Ticker is required');
      return;
    }

    const caVal = validateContractAddress(chain, contractAddress);
    if (!caVal.valid) {
      setError(caVal.error || 'Invalid contract address for selected chain');
      return;
    }

    const multVal = validateMultiplier(multiplier);
    if (!multVal.valid) {
      setError(multVal.error || 'Invalid multiplier');
      return;
    }

    if (proofUrl.trim() && !/^https?:\/\//i.test(proofUrl.trim())) {
      setError('Proof URL must start with http:// or https://');
      return;
    }

    if (notes.trim().length > 280) {
      setError('Notes cannot exceed 280 characters');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ticker: cleanTicker,
        chain,
        contract_address: contractAddress.trim(),
        multiplier: multVal.value,
        closed_at: new Date(closedAt).toISOString(),
        entry_price: entryPrice.trim() || null,
        exit_price: exitPrice.trim() || null,
        proof_url: proofUrl.trim() || null,
        notes: notes.trim() || null,
      };

      const url = isEdit ? `/api/admin/ledger/${initialData?.id}` : '/api/admin/ledger';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed to save entry (${res.status})`);
      }

      router.push('/admin/ledger');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/admin/ledger"
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Ledger Entries</span>
        </Link>
        <span className="text-2xs font-mono px-2 py-0.5 rounded bg-pump/10 text-pump border border-pump/30 uppercase">
          Admin Only
        </span>
      </div>

      <div className="rounded-lg bg-neutral-900 border border-neutral-800 p-6 sm:p-8">
        <div className="mb-6 pb-4 border-b border-neutral-800">
          <h1 className="font-sans text-2xl font-black uppercase text-white tracking-tight">
            {isEdit ? `Edit Entry ($${ticker})` : 'New Ledger Entry'}
          </h1>
          <p className="font-sans text-xs text-muted mt-1">
            Record a manually verified closed-call result card for the public ledger.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 font-sans">
          {/* Ticker & Chain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Ticker <span className="text-pump">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-sm">$</span>
                <input
                  type="text"
                  required
                  maxLength={20}
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/^\$/, ''))}
                  placeholder="WIF"
                  className="w-full h-11 pl-7 pr-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Blockchain <span className="text-pump">*</span>
              </label>
              <select
                value={chain}
                onChange={(e) => setChain(e.target.value)}
                className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-sans text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
              >
                {LEDGER_CHAINS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Contract Address */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
              Contract Address (CA) <span className="text-pump">*</span>
            </label>
            <input
              type="text"
              required
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder={chain === 'solana' ? 'EKpQGSJtjMFqKZ9KQanrW...' : '0x...'}
              className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
            />
            <p className="text-2xs font-mono text-muted/70 mt-1">
              {chain === 'solana'
                ? 'Solana: base58 string, 32-44 characters'
                : chain === 'other'
                ? 'Other: 20-100 characters without spaces'
                : 'EVM: 0x followed by exactly 40 hex characters'}
            </p>
          </div>

          {/* Multiplier & Closed Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Multiplier (x-multiple) <span className="text-pump">*</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1000"
                  required
                  value={multiplier}
                  onChange={(e) => setMultiplier(e.target.value)}
                  placeholder="3.4"
                  className="w-full h-11 pl-3 pr-7 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump tnum"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-muted text-sm">x</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Date Closed <span className="text-pump">*</span>
              </label>
              <input
                type="date"
                required
                value={closedAt}
                onChange={(e) => setClosedAt(e.target.value)}
                className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
              >
              </input>
            </div>
          </div>

          {/* Entry & Exit Market Cap (Optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-neutral-800/40">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Entry Market Cap <span className="text-muted/60 text-2xs font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="$100K"
                className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                Exit Market Cap <span className="text-muted/60 text-2xs font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
                placeholder="$340K"
                className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
              />
            </div>
          </div>

          {/* Proof URL (Optional) */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
              Proof URL <span className="text-muted/60 text-2xs font-normal">(Optional)</span>
            </label>
            <input
              type="url"
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder="https://dexscreener.com/solana/..."
              className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump"
            />
          </div>

          {/* Notes (Optional, max 280 chars) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-muted">
                Notes / Thesis Caption <span className="text-muted/60 text-2xs font-normal">(Optional)</span>
              </label>
              <span className="text-2xs font-mono text-muted">
                {notes.length}/280
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={280}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Thesis played out as expected..."
              className="w-full p-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-sans text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pump resize-none"
            />
          </div>

          {/* Non-negotiable honesty disclosure */}
          <div className="p-3 rounded-md bg-neutral-950 border border-neutral-800 text-2xs font-mono text-muted leading-relaxed">
            Non-negotiable disclosure shown on card: <br />
            <span className="text-white">
              &quot;Recorded by the TrenchLabs team · {closedAt ? new Date(closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date'}&quot;
            </span>
          </div>

          {/* Submit button */}
          <div className="pt-3">
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans font-black text-sm uppercase tracking-wide flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Entry...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{isEdit ? 'Update Ledger Entry' : 'Post Ledger Entry'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

