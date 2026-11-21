'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Command, Compass, Flame, Search, X } from 'lucide-react';
import { GenesisContext } from '@/context/GenesisContext';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import type { AlphaItem } from '@/lib/types';

export interface CommandPaletteItem {
  id: string;
  label: string;
  subtitle: string;
  category: 'Navigation' | 'Alpha Call' | 'Search Filter';
  href?: string;
  searchFilter?: string;
}

const STATIC_NAV_ITEMS: CommandPaletteItem[] = [
  {
    id: 'nav-dashboard',
    label: 'Lab Analysis — Overview',
    subtitle: 'Account, pinned posts, connected services & call history',
    category: 'Navigation',
    href: '/dashboard',
  },
  {
    id: 'nav-alpha',
    label: 'Alpha Calls',
    subtitle: 'Lab Analysis — Curated multi-chain trade calls & setup telemetry',
    category: 'Navigation',
    href: '/dashboard?tab=ALPHA',
  },
  {
    id: 'nav-max-alpha',
    label: 'Max Alpha',
    subtitle: 'Lab Analysis — High-conviction Pro calls',
    category: 'Navigation',
    href: '/dashboard?tab=MAX_ALPHA',
  },
  {
    id: 'nav-pinned-posts',
    label: 'My Pinned Posts (Overview)',
    subtitle: 'Your unified favourites from Alpha Calls, Max Alpha & Raid',
    category: 'Navigation',
    href: '/dashboard#pinned-posts',
  },
  {
    id: 'nav-raid',
    label: 'Raid Campaigns',
    subtitle: 'Lab Analysis — Community X campaigns & reward submissions',
    category: 'Navigation',
    href: '/dashboard?tab=SOCIAL',
  },
  {
    id: 'nav-stake',
    label: 'Stake $H42 (Pro Access)',
    subtitle: 'Verify 90-day StakePoint position for instant alerts',
    category: 'Navigation',
    href: '/dashboard?tab=STAKE',
  },
  {
    id: 'nav-ledger',
    label: 'Public Performance Ledger',
    subtitle: 'Verified historical calls, win rate & multipliers',
    category: 'Navigation',
    href: '/ledger',
  },
  {
    id: 'nav-home',
    label: 'TrenchLabs Landing Page',
    subtitle: 'Platform overview, tiers & tokenomics',
    category: 'Navigation',
    href: '/',
  },
];

export function filterCommandPaletteItems(
  query: string,
  alphas: AlphaItem[] = [],
  includeAdmin = false
): CommandPaletteItem[] {
  const q = query.trim().toLowerCase();

  const alphaItems: CommandPaletteItem[] = alphas
    .filter((a) => {
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.ticker.toLowerCase().includes(q) ||
        (a.ca && a.ca.toLowerCase().includes(q)) ||
        a.chain.toLowerCase().includes(q)
      );
    })
    .slice(0, 6)
    .map((a) => ({
      id: `alpha-${a.id}`,
      label: `${a.name} ($${a.ticker})`,
      subtitle: `${a.chain} • ${a.ca ? `${a.ca.slice(0, 6)}...${a.ca.slice(-4)}` : 'Pending CA'}`,
      category: 'Alpha Call' as const,
      searchFilter: a.ticker,
      href: '/dashboard?tab=ALPHA',
    }));

  const baseNav = includeAdmin
    ? [
      ...STATIC_NAV_ITEMS,
      {
        id: 'nav-admin',
        label: 'Admin Desk',
        subtitle: 'Lab Analysis — Content publishing, drafts, archive & campaign management',
        category: 'Navigation' as const,
        href: '/dashboard?tab=ADMIN',
      },
    ]
    : STATIC_NAV_ITEMS;

  const navItems = baseNav.filter((item) => {
    if (!q) return true;
    return (
      item.label.toLowerCase().includes(q) ||
      item.subtitle.toLowerCase().includes(q)
    );
  });

  const filterAction: CommandPaletteItem[] = q
    ? [
      {
        id: `filter-${q}`,
        label: `Filter terminal calls for "${query.trim()}"`,
        subtitle: 'Apply search filter in TerminalHeader',
        category: 'Search Filter',
        searchFilter: query.trim(),
        href: '/dashboard?tab=ALPHA',
      },
    ]
    : [];

  return [...filterAction, ...alphaItems, ...navItems];
}

export interface CommandPaletteProps {
  /** Optional controlled initial state for testing */
  defaultOpen?: boolean;
  /** Optional injected alphas for isolated unit tests */
  initialAlphas?: AlphaItem[];
  /** Optional navigation handler override */
  onNavigate?: (href: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  defaultOpen = false,
  initialAlphas,
  onNavigate,
}) => {
  const genesis = React.useContext(GenesisContext);

  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
  const [localQuery, setLocalQuery] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const alphas = useMemo(
    () => initialAlphas ?? genesis?.alphas ?? [],
    [initialAlphas, genesis?.alphas]
  );

  const items = useMemo(
    () => filterCommandPaletteItems(localQuery, alphas, Boolean(genesis?.isAdmin)),
    [localQuery, alphas, genesis?.isAdmin]
  );

  const openPalette = useCallback(() => {
    setLocalQuery(genesis?.searchQuery ?? '');
    setSelectedIndex(0);
    setIsOpen(true);
  }, [genesis?.searchQuery]);

  const closePalette = useCallback(() => {
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) {
          closePalette();
        } else {
          openPalette();
        }
        return;
      }

      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (items.length > 0 ? (prev + 1) % items.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          items.length > 0 ? (prev - 1 + items.length) % items.length : 0
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, items.length, openPalette, closePalette]);

  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => {
        inputRef.current?.focus();
      }, 10);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  const handleSelectItem = useCallback(
    (item: CommandPaletteItem) => {
      if (typeof item.searchFilter === 'string' && genesis?.setSearchQuery) {
        genesis.setSearchQuery(item.searchFilter);
      }
      closePalette();
      if (item.href) {
        if (onNavigate) {
          onNavigate(item.href);
        } else if (typeof window !== 'undefined') {
          const targetUrl = new URL(item.href, window.location.origin);
          if (window.location.pathname === '/dashboard' && targetUrl.pathname === '/dashboard') {
            window.history.pushState({}, '', targetUrl.toString());
            window.dispatchEvent(new Event('trenchlabs:dashboard-tab'));
          } else {
            window.location.assign(item.href);
          }
        }
      }
    },
    [genesis, closePalette, onNavigate]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && items[selectedIndex]) {
      e.preventDefault();
      handleSelectItem(items[selectedIndex]);
    }
  };

  return (
    <>
      {/* Screen-reader / focusable quick-launch trigger (visual trigger lives in TerminalHeader without overlapping content) */}
      <div className="fixed bottom-4 right-4 z-40 sr-only focus-within:not-sr-only">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={openPalette}
          data-testid="command-palette-trigger"
          aria-label="Open command palette (Ctrl+K or Command+K)"
          className="h-9 px-3 rounded-lg bg-surface-card border border-border-default hover:border-brand text-muted hover:text-white font-mono text-xs inline-flex items-center gap-2 shadow-sm"
        >
          <Command className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
          <span>Search &amp; jump</span>
          <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border-default text-[10px] text-white font-mono">
            ⌘K
          </kbd>
        </Button>
      </div>

      {isOpen && (
        <div
          data-testid="command-palette-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-canvas/80 backdrop-blur-sm"
        >
          <div className="w-full max-w-xl rounded-xl bg-surface border border-brand/40 shadow-lg overflow-hidden">
            {/* Search Input Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-default bg-surface-card">
              <Search className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={localQuery}
                onChange={(e) => {
                  setLocalQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search calls (token, CA, chain) or jump to page..."
                aria-label="Command palette search"
                data-testid="command-palette-input"
                className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder:text-dim focus:outline-none focus-visible:ring-1 focus-visible:ring-brand/60 rounded font-sans"
              />
              {localQuery && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLocalQuery('');
                    setSelectedIndex(0);
                  }}
                  aria-label="Clear palette query"
                  className="h-7 w-7 p-0 text-muted hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closePalette}
                aria-label="Close command palette"
                data-testid="command-palette-close"
                className="h-7 px-2 font-mono text-[11px] text-muted hover:text-white border border-border-default rounded"
              >
                ESC
              </Button>
            </div>

            {/* Results List */}
            <div className="max-h-80 overflow-y-auto p-2 space-y-1" role="listbox" aria-label="Command results">
              {items.length === 0 ? (
                <div className="py-8 text-center font-mono text-xs text-muted">
                  No matching calls or destinations found.
                </div>
              ) : (
                items.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <Button
                      key={item.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectItem(item)}
                      className={cn(
                        'w-full h-auto py-2.5 px-3 rounded-lg flex items-center justify-between gap-3 text-left transition-colors',
                        isSelected
                          ? 'bg-surface-card border border-brand/40 text-white'
                          : 'border border-transparent hover:bg-surface-card text-muted hover:text-white'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {item.category === 'Alpha Call' ? (
                          <Flame className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
                        ) : item.category === 'Search Filter' ? (
                          <Search className="w-4 h-4 text-brand shrink-0" aria-hidden="true" />
                        ) : (
                          <Compass className="w-4 h-4 text-muted shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0">
                          <div className="font-sans text-xs font-bold text-white truncate">
                            {item.label}
                          </div>
                          <div className="font-mono text-[11px] text-muted truncate">
                            {item.subtitle}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-muted">
                        <span className="px-1.5 py-0.5 rounded bg-surface border border-border-default">
                          {item.category}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                      </div>
                    </Button>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-border-default bg-surface-card flex items-center justify-between font-mono text-[11px] text-muted">
              <span>Use ↑↓ arrows to navigate, Enter to select</span>
              <span>ESC to dismiss</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
