'use client';

import React from 'react';
import type { Chain } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Filter, LayoutGrid, List, RotateCcw, Search, X } from 'lucide-react';

export type WorkspaceFilterTab = 'ALL' | 'PINNED' | 'MOVERS' | 'NEW';
export type WorkspaceSortKey = 'PRIORITY' | 'MCAP' | 'CHANGE' | 'NEWEST';
export type WorkspaceViewMode = 'GRID' | 'TABLE';

export interface WorkspaceFilterState {
  searchQuery: string;
  selectedChain: Chain | 'ALL';
  activeFilter: WorkspaceFilterTab;
  sortBy: WorkspaceSortKey;
  viewMode: WorkspaceViewMode;
}

export const createDefaultFilterState = (): WorkspaceFilterState => ({
  searchQuery: '',
  selectedChain: 'ALL',
  activeFilter: 'ALL',
  sortBy: 'PRIORITY',
  viewMode: 'GRID',
});

export const FILTER_CHAINS: (Chain | 'ALL')[] = ['ALL', 'SOL', 'BSC', 'ETH', 'BASE', 'ROBIN', 'AVAX'];

interface WorkspaceFilterBarProps {
  workspaceId: string;
  searchPlaceholder: string;
  state: WorkspaceFilterState;
  chainCounts: Record<string, number>;
  totalFilteredCount: number;
  onChange: (patch: Partial<WorkspaceFilterState>) => void;
  onReset: () => void;
}

export const WorkspaceFilterBar: React.FC<WorkspaceFilterBarProps> = ({
  workspaceId,
  searchPlaceholder,
  state,
  chainCounts,
  totalFilteredCount,
  onChange,
  onReset,
}) => {
  const hasActiveFilters =
    Boolean(state.searchQuery.trim()) ||
    state.selectedChain !== 'ALL' ||
    state.activeFilter !== 'ALL' ||
    state.sortBy !== 'PRIORITY';

  const filterPills: { id: WorkspaceFilterTab; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'PINNED', label: 'Pinned' },
    { id: 'MOVERS', label: 'Movers' },
    { id: 'NEW', label: 'New' },
  ];

  return (
    <div
      data-testid={`filter-bar-${workspaceId.toLowerCase()}`}
      className="rounded-xl bg-surface border border-border-default p-4 space-y-3"
    >
      {/* Row 1: Search Input + Status Pills + Sort + View Mode */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            data-testid={`search-input-${workspaceId.toLowerCase()}`}
            aria-label={searchPlaceholder}
            value={state.searchQuery}
            onChange={(e) => onChange({ searchQuery: e.target.value })}
            placeholder={searchPlaceholder}
            className="w-full h-9 pl-9 pr-8 rounded-lg bg-surface-card border border-border-default focus:border-brand font-sans text-xs text-white placeholder:text-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
          {state.searchQuery && (
            <button
              type="button"
              onClick={() => onChange({ searchQuery: '' })}
              aria-label="Clear search query"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Segmented Category Pills */}
          <div className="h-9 inline-flex items-center bg-surface-card border border-border-default rounded-lg p-1 font-sans text-xs">
            {filterPills.map((pill) => {
              const isActive = state.activeFilter === pill.id;
              return (
                <button
                  key={pill.id}
                  type="button"
                  data-testid={`filter-pill-${workspaceId.toLowerCase()}-${pill.id.toLowerCase()}`}
                  onClick={() => onChange({ activeFilter: pill.id })}
                  className={`h-7 px-2.5 rounded-md font-bold cursor-pointer transition-colors text-xs ${
                    isActive
                      ? 'bg-brand text-canvas'
                      : 'text-muted hover:text-white'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {/* Sort Dropdown */}
          <div className="h-9 inline-flex items-center gap-1.5 px-2.5 rounded-lg bg-surface-card border border-border-default font-sans text-xs text-muted">
            <Filter className="w-3.5 h-3.5 text-brand shrink-0" />
            <select
              data-testid={`sort-select-${workspaceId.toLowerCase()}`}
              aria-label="Sort calls"
              value={state.sortBy}
              onChange={(e) => onChange({ sortBy: e.target.value as WorkspaceSortKey })}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer text-xs"
            >
              <option value="PRIORITY" className="bg-surface">Pinned &amp; Newest</option>
              <option value="MCAP" className="bg-surface">Market Cap</option>
              <option value="CHANGE" className="bg-surface">24h Gain</option>
              <option value="NEWEST" className="bg-surface">Newest First</option>
            </select>
          </div>

          {/* View Mode Toggle */}
          <div className="h-9 inline-flex items-center bg-surface-card border border-border-default rounded-lg p-1 font-sans text-xs">
            <button
              type="button"
              data-testid={`view-grid-${workspaceId.toLowerCase()}`}
              onClick={() => onChange({ viewMode: 'GRID' })}
              aria-pressed={state.viewMode === 'GRID'}
              className={`h-7 inline-flex items-center gap-1 px-2.5 rounded-md font-bold cursor-pointer transition-colors text-xs ${
                state.viewMode === 'GRID'
                  ? 'bg-brand text-canvas'
                  : 'text-muted hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Cards</span>
            </button>
            <button
              type="button"
              data-testid={`view-table-${workspaceId.toLowerCase()}`}
              onClick={() => onChange({ viewMode: 'TABLE' })}
              aria-pressed={state.viewMode === 'TABLE'}
              className={`h-7 inline-flex items-center gap-1 px-2.5 rounded-md font-bold cursor-pointer transition-colors text-xs ${
                state.viewMode === 'TABLE'
                  ? 'bg-brand text-canvas'
                  : 'text-muted hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid={`reset-filters-${workspaceId.toLowerCase()}`}
              onClick={onReset}
              className="h-9 px-2.5 font-mono text-xs font-bold text-brand hover:text-white border border-border-default hover:border-brand"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Chain Filter Strip + Count Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border-default">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_CHAINS.map((ch) => {
            const active = state.selectedChain === ch;
            return (
              <button
                key={ch}
                type="button"
                data-testid={`chain-${workspaceId.toLowerCase()}-${ch.toLowerCase()}`}
                onClick={() => onChange({ selectedChain: ch })}
                className={`h-7 px-2.5 rounded-md font-mono text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors inline-flex items-center gap-1 tnum ${
                  active
                    ? 'bg-brand text-canvas border-brand'
                    : 'bg-surface-card hover:bg-surface-3 text-white border-border-default'
                }`}
              >
                <span>{ch}</span>
                <span className={`text-[11px] ${active ? 'text-canvas/80' : 'text-brand'}`}>
                  ({chainCounts[ch] ?? 0})
                </span>
              </button>
            );
          })}
        </div>

        <span className="font-mono text-xs text-muted tnum">
          Showing <strong className="text-brand">{totalFilteredCount}</strong> calls
        </span>
      </div>
    </div>
  );
};
