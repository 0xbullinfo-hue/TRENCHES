'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatChainLabel, formatLedgerDate, formatMultiplier, formatTicker, truncateAddress } from '@/lib/ledger/format';
import { Plus, Trash2, Edit, Loader2 } from 'lucide-react';

interface LedgerItem {
  id: string;
  ticker: string;
  chain: string;
  contract_address: string;
  multiplier: string;
  closed_at: string;
  posted_by: string;
  posted_at: string;
  updated_at?: string | null;
  edited: boolean;
}

export function AdminLedgerTable({ initialEntries }: { initialEntries: LedgerItem[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<LedgerItem[]>(initialEntries);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteModalEntry, setDeleteModalEntry] = useState<LedgerItem | null>(null);
  const [confirmTickerInput, setConfirmTickerInput] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteModalEntry) return;

    if (confirmTickerInput.trim().toUpperCase() !== deleteModalEntry.ticker.toUpperCase()) {
      setDeleteError(`Please type ${deleteModalEntry.ticker.toUpperCase()} exactly to confirm`);
      return;
    }

    setDeletingId(deleteModalEntry.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/ledger/${deleteModalEntry.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error(`Failed to delete (${res.status})`);
      }
      setEntries((prev) => prev.filter((e) => e.id !== deleteModalEntry.id));
      setDeleteModalEntry(null);
      setConfirmTickerInput('');
      router.refresh();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-[1360px] mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-neutral-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono px-2 py-0.5 rounded bg-pump/10 text-pump border border-pump/30 uppercase">
              Admin Area
            </span>
            <span className="text-2xs font-mono text-muted">{entries.length} Total Records</span>
          </div>
          <h1 className="font-sans text-2xl sm:text-3xl font-extrabold uppercase text-white tracking-tight mt-1">
            Closed Call Ledger Management
          </h1>
          <p className="font-sans text-sm text-muted mt-1">
            Manage official trade records rendered on the public /ledger and dashboard showcase.
          </p>
        </div>

        <Link
          href="/admin/ledger/new"
          className="h-11 px-5 rounded-md bg-pump hover:bg-pump-hover text-canvas font-sans font-black text-xs uppercase tracking-wider inline-flex items-center gap-2 self-start sm:self-auto transition-colors"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>New Entry</span>
        </Link>
      </div>

      {/* Table Container */}
      <div className="rounded-lg bg-neutral-900 border border-neutral-800 overflow-hidden shadow-sm">
        {entries.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <p className="font-sans text-sm text-muted">No ledger entries posted yet.</p>
            <Link
              href="/admin/ledger/new"
              className="inline-flex items-center gap-1.5 text-xs font-mono text-pump hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create the first ledger entry</span>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-sans text-sm">
              <thead className="bg-neutral-950 text-2xs uppercase tracking-wider font-bold text-muted border-b border-neutral-800">
                <tr>
                  <th className="py-3.5 px-4">Ticker</th>
                  <th className="py-3.5 px-4">Chain</th>
                  <th className="py-3.5 px-4">Multiplier</th>
                  <th className="py-3.5 px-4">Contract (CA)</th>
                  <th className="py-3.5 px-4">Date Closed</th>
                  <th className="py-3.5 px-4">Posted By</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono text-xs">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-neutral-800/30 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                      <span>{formatTicker(entry.ticker)}</span>
                      {entry.edited && (
                        <span className="text-[10px] uppercase font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 rounded">
                          edited
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-muted font-sans capitalize">
                      {formatChainLabel(entry.chain)}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-emerald-400 tnum">
                      {formatMultiplier(entry.multiplier)}
                    </td>
                    <td className="py-3.5 px-4 text-muted/80" title={entry.contract_address}>
                      {truncateAddress(entry.contract_address)}
                    </td>
                    <td className="py-3.5 px-4 text-muted">
                      {formatLedgerDate(entry.closed_at)}
                    </td>
                    <td className="py-3.5 px-4 text-muted/70">
                      {truncateAddress(entry.posted_by)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          href={`/admin/ledger/${entry.id}/edit`}
                          className="p-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-muted hover:text-white transition-colors"
                          title="Edit Entry"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteModalEntry(entry);
                            setConfirmTickerInput('');
                            setDeleteError(null);
                          }}
                          className="p-1.5 rounded bg-neutral-800 hover:bg-rose-500/20 text-muted hover:text-rose-400 transition-colors cursor-pointer"
                          title="Delete Entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal (§1 Acceptance Criteria #7) */}
      {deleteModalEntry && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="font-sans text-lg font-black uppercase text-white tracking-tight">
              Delete Ledger Entry for ${deleteModalEntry.ticker}?
            </h3>
            <p className="font-sans text-xs text-muted leading-relaxed">
              This is a permanent hard delete. To prevent accidental removals, please type{' '}
              <strong className="text-white font-mono">{deleteModalEntry.ticker}</strong> below to confirm.
            </p>

            <input
              type="text"
              autoFocus
              value={confirmTickerInput}
              onChange={(e) => setConfirmTickerInput(e.target.value)}
              placeholder={`Type "${deleteModalEntry.ticker}"`}
              className="w-full h-11 px-3 rounded-md bg-neutral-950 border border-neutral-800 text-white font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
            />

            {deleteError && (
              <p className="font-mono text-xs text-rose-400">{deleteError}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalEntry(null)}
                className="h-10 px-4 rounded-md border border-neutral-800 hover:bg-neutral-800 text-muted font-sans text-xs font-bold uppercase transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletingId !== null}
                className="h-10 px-5 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-black uppercase transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {deletingId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
