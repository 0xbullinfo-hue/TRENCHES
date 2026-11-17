'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  LayoutDashboard,
  Lock,
  Menu,
  RadioTower,
  Shield,
  Star,
  Target,
  X,
  Zap,
} from 'lucide-react';
import { GenesisContext } from '@/context/GenesisContext';
import {
  useDashboardNavigation,
  workspaceHref,
  type DashboardWorkspace,
  type SidebarItemStateMap,
} from './DashboardNavigationContext';

export type { DashboardWorkspace, SidebarItemState, SidebarItemStateMap } from './DashboardNavigationContext';

interface NavItem {
  id: DashboardWorkspace;
  label: string;
  description: string;
  icon: React.ElementType;
  testId: string;
}

export const DASHBOARD_NAV_ITEMS: NavItem[] = [
  { id: 'OVERVIEW', label: 'Overview', description: 'Account, holdings and membership', icon: LayoutDashboard, testId: 'tab-overview' },
  { id: 'ALPHA', label: 'Alpha Calls', description: 'Curated trade intelligence', icon: Target, testId: 'tab-alpha' },
  { id: 'MAX_ALPHA', label: 'Max Alpha', description: 'Premium high-conviction calls', icon: Zap, testId: 'tab-max-alpha' },
  { id: 'WATCHLIST', label: 'Watchlist', description: 'Saved tokens and curated research', icon: Star, testId: 'tab-watchlist' },
  { id: 'SOCIAL', label: 'Raid', description: 'Community campaigns and raids', icon: RadioTower, testId: 'tab-social' },
  { id: 'STAKE', label: 'Stake', description: 'StakePoint staking and Pro access', icon: Coins, testId: 'tab-stake' },
];

const COLLAPSE_STORAGE_KEY = 'trench_dashboard_sidebar_collapsed';

interface DashboardSidebarProps {
  active?: DashboardWorkspace;
  onSelect?: (workspace: DashboardWorkspace) => void;
  itemState?: SidebarItemStateMap;
}

export function DashboardSidebar({
  active: activeProp,
  onSelect: onSelectProp,
  itemState: itemStateProp,
}: DashboardSidebarProps = {}) {
  const navCtx = useDashboardNavigation();
  const genesis = React.useContext(GenesisContext);

  const active = activeProp ?? navCtx?.activeWorkspace ?? 'OVERVIEW';
  const onSelect = onSelectProp ?? navCtx?.selectWorkspace;

  // Use IncubatorHub-published counts/locks when present; fall back to GenesisContext on /dashboard/stake.
  const derivedFallbackState = useMemo<SidebarItemStateMap>(() => {
    const connected = Boolean(genesis?.connected);
    const isAdmin = Boolean(genesis?.isAdmin);
    const tierId = genesis?.tier?.id;
    const isPro = connected && (isAdmin || tierId === 'PRO');
    const isMember = connected && (isPro || tierId === 'LAB_MEMBER');
    return {
      ALPHA: { locked: !isMember },
      MAX_ALPHA: { locked: !isPro },
      WATCHLIST: { locked: !isMember },
    };
  }, [genesis?.connected, genesis?.isAdmin, genesis?.tier?.id]);

  const itemState = useMemo<SidebarItemStateMap>(
    () => itemStateProp ?? (navCtx && Object.keys(navCtx.itemState).length > 0 ? navCtx.itemState : derivedFallbackState),
    [itemStateProp, navCtx, derivedFallbackState]
  );

  // Desktop defaults expanded; tablet (768..1023) initializes compact rail unless user stored a preference.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
        if (saved === '1') {
          setCollapsed(true);
        } else if (saved === '0') {
          setCollapsed(false);
        } else if (window.innerWidth >= 768 && window.innerWidth < 1024) {
          setCollapsed(true);
        }
      } catch {
        // ignore storage errors
      }
    });
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  const activeItem = DASHBOARD_NAV_ITEMS.find((i) => i.id === active) ?? DASHBOARD_NAV_ITEMS[0];
  const ActiveIcon = activeItem.icon;

  // Labels are always visible inside the mobile drawer; on md+ they follow `collapsed`.
  const labelClass = collapsed ? 'md:hidden' : 'inline';
  const blockClass = collapsed ? 'md:hidden' : 'block';
  const desktopWidthClass = collapsed ? 'md:w-[72px]' : 'md:w-[228px] lg:w-[248px]';

  const renderItem = (item: NavItem) => {
    const isActive = item.id === active;
    const state = itemState[item.id] ?? {};
    const Icon = item.icon;
    const classes = `group relative flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-left font-sans text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
      isActive
        ? 'bg-brand-bg text-white border border-brand-border'
        : 'border border-transparent text-muted hover:bg-surface-card hover:text-white'
    } ${collapsed ? 'md:justify-center md:px-0' : ''}`;

    const content = (
      <>
        {isActive && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand" />}
        <Icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand' : 'text-muted group-hover:text-white'}`} />
        <span className={`min-w-0 flex-1 truncate ${labelClass}`}>{item.label}</span>
        <span className={`ml-auto items-center gap-1.5 ${collapsed ? 'flex md:hidden' : 'flex'}`}>
          {item.id === 'MAX_ALPHA' && (
            <span className="rounded bg-alpha-strong/30 border border-alpha-border px-1.5 py-0.5 font-mono text-[9px] font-black text-white">PRO</span>
          )}
          {state.locked ? (
            <Lock className="h-3.5 w-3.5 text-dim" aria-label="Locked for your tier" />
          ) : typeof state.count === 'number' ? (
            <span className={`min-w-[22px] rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-bold tnum ${isActive ? 'bg-brand text-canvas' : 'bg-surface-card text-muted border border-border-default'}`}>
              {state.count}
            </span>
          ) : null}
        </span>
      </>
    );

    const title = collapsed ? item.label : item.description;
    const ariaLabel = state.locked ? `${item.label} (locked for your tier)` : item.label;

    if (!onSelect) {
      return (
        <Link
          key={item.id}
          href={workspaceHref(item.id)}
          data-testid={item.testId}
          title={title}
          aria-label={ariaLabel}
          aria-current={isActive ? 'page' : undefined}
          onClick={() => setMobileOpen(false)}
          className={classes}
        >
          {content}
        </Link>
      );
    }

    return (
      <button
        key={item.id}
        type="button"
        data-testid={item.testId}
        title={title}
        aria-label={ariaLabel}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => {
          onSelect(item.id);
          setMobileOpen(false);
        }}
        className={classes}
      >
        {content}
      </button>
    );
  };

  return (
    <>
      {/* Mobile workspace header bar: sits above page content inside flex-col md:flex-row */}
      <div className="md:hidden flex items-center justify-between gap-3 px-4 py-3 border-b border-border-default bg-surface/60">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            data-testid="mobile-nav-trigger"
            onClick={() => setMobileOpen(true)}
            aria-label="Open dashboard navigation"
            aria-expanded={mobileOpen}
            aria-controls="dashboard-sidebar"
            className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-lg bg-surface border border-border-default text-white hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex items-center gap-2">
            <ActiveIcon className="h-4 w-4 text-brand shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-dim leading-none">
                Workspace
              </div>
              <div className="font-sans text-sm font-extrabold text-white truncate mt-0.5">
                {activeItem.label}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-[60] bg-black/70"
        />
      )}

      {/* Single sidebar instance: off-canvas drawer on mobile, sticky collapsible sidebar on tablet+desktop */}
      <aside
        id="dashboard-sidebar"
        aria-label="Dashboard navigation"
        className={`flex flex-col bg-surface border-r border-border-default
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[70] max-md:w-[min(84vw,300px)] max-md:transition-transform max-md:duration-200
          ${mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full max-md:invisible'}
          md:sticky md:top-20 md:h-[calc(100vh-5rem)] md:shrink-0 md:transition-[width] md:duration-200
          ${desktopWidthClass}`}
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4 border-b border-border-default">
          <div className={`min-w-0 ${blockClass}`}>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-dim">Workspace</div>
            <div className="font-sans text-sm font-black text-white tracking-tight">Lab Terminal</div>
          </div>
          <Shield className={`h-5 w-5 text-brand shrink-0 hidden ${collapsed ? 'md:block md:mx-auto' : ''}`} aria-hidden="true" />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden h-10 w-10 inline-flex items-center justify-center rounded-lg text-muted hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Dashboard sections" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {DASHBOARD_NAV_ITEMS.map(renderItem)}
        </nav>

        <div className={`px-4 pb-4 ${blockClass}`}>
          <div className="rounded-lg border border-border-default bg-surface-card p-3">
            <div className="flex items-center gap-2 font-sans text-[11px] font-bold text-white">
              <Shield className="h-3.5 w-3.5 text-brand" /> Research responsibly
            </div>
            <p className="mt-1 font-sans text-[10px] leading-relaxed text-muted">
              Independent research terminal. Always DYOR and manage risk.
            </p>
          </div>
        </div>

        <div className="hidden md:block border-t border-border-default p-3">
          <button
            type="button"
            data-testid="sidebar-collapse-toggle"
            onClick={toggleCollapsed}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg font-sans text-xs font-semibold text-muted hover:bg-surface-card hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-pointer"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>
    </>
  );
}
