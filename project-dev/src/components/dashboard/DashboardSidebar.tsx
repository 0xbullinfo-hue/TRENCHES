'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity, ChevronLeft, ChevronRight, Coins, Command, LayoutDashboard,
  Menu, RadioTower, Search, Shield, Star, Target, X, Zap,
} from 'lucide-react';
import type { DashboardTab } from '@/components/dashboard/IncubatorHub';

type NavItem = {
  id: DashboardTab | 'STAKE';
  label: string;
  icon: React.ElementType;
  href?: string;
  description: string;
};

const items: NavItem[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard, description: 'Your dashboard and holdings' },
  { id: 'ALPHA', label: 'Alpha Calls', icon: Target, description: 'Curated trade intelligence' },
  { id: 'MAX_ALPHA', label: 'Max Alpha', icon: Zap, description: 'Premium high-conviction calls' },
  { id: 'WATCHLIST', label: 'Watchlist', icon: Star, description: 'Projects you are tracking' },
  { id: 'SOCIAL', label: 'Raid', icon: RadioTower, description: 'Community campaigns and raids' },
  { id: 'STAKE', label: 'Stake', icon: Coins, href: '/dashboard/stake', description: 'Staking and rewards' },
];

export function DashboardSidebar() {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<DashboardTab>('OVERVIEW');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get('tab')?.toUpperCase();
      const valid: DashboardTab[] = ['OVERVIEW', 'ALPHA', 'MAX_ALPHA', 'WATCHLIST', 'SOCIAL'];
      setActiveTab(valid.includes(value as DashboardTab) ? value as DashboardTab : 'OVERVIEW');
    };
    sync();
    window.addEventListener('popstate', sync);
    window.addEventListener('trenchlabs:dashboard-tab', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('trenchlabs:dashboard-tab', sync);
    };
  }, [pathname]);

  const selectTab = (tab: DashboardTab) => {
    const url = new URL(window.location.href);
    url.pathname = '/dashboard';
    if (tab === 'OVERVIEW') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.pushState({ tab }, '', url.toString());
    setActiveTab(tab);
    window.dispatchEvent(new Event('trenchlabs:dashboard-tab'));
    setMobileOpen(false);
  };

  const nav = (
    <>
      <div className="flex h-16 items-center justify-between px-5 border-b border-white/5">
        <Link href="/dashboard" onClick={() => selectTab('OVERVIEW')} className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand">
            <Activity className="h-5 w-5" />
          </div>
          {!collapsed && <div className="min-w-0"><div className="text-sm font-black tracking-[0.16em] text-white">TRENCHLABS</div><div className="text-[10px] font-semibold tracking-[0.22em] text-muted">HQ TERMINAL</div></div>}
        </Link>
        <button type="button" onClick={() => setMobileOpen(false)} className="md:hidden rounded-lg p-2 text-muted hover:text-white" aria-label="Close navigation"><X className="h-5 w-5" /></button>
      </div>

      {!collapsed && <div className="px-4 pt-5 pb-2"><div className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-xs text-muted"><Search className="h-4 w-4" /><span>Workspace navigation</span><Command className="ml-auto h-3.5 w-3.5" /></div></div>}

      <div className="px-3 pt-5">
        {!collapsed && <p className="px-3 pb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-dim">Workspace</p>}
        <nav aria-label="Dashboard sections" className="space-y-1">
          {items.map((item) => {
            const active = item.id === 'STAKE' ? pathname.startsWith('/dashboard/stake') : pathname === '/dashboard' && activeTab === item.id;
            const Icon = item.icon;
            const content = <><Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-brand' : 'text-muted group-hover:text-white'}`} />{!collapsed && <><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.id === 'MAX_ALPHA' && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-black text-amber-300">PRO</span>}</>}</>;
            const classes = `group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] font-semibold transition-colors ${active ? 'border border-brand/20 bg-brand/10 text-white shadow-[inset_2px_0_0_0_var(--color-brand)]' : 'border border-transparent text-muted hover:bg-white/[0.04] hover:text-white'} ${collapsed ? 'justify-center' : ''}`;
            return item.href ? <a key={item.id} href={item.href} title={collapsed ? item.label : item.description} onClick={() => setMobileOpen(false)} className={classes}>{content}</a> :
              <button key={item.id} type="button" title={collapsed ? item.label : item.description} onClick={() => selectTab(item.id as DashboardTab)} aria-current={active ? 'page' : undefined} className={classes}>{content}</button>;
          })}
        </nav>
      </div>

      {!collapsed && <div className="mt-auto px-4 pb-5 pt-8"><div className="rounded-xl border border-white/5 bg-white/[0.025] p-3"><div className="flex items-center gap-2 text-[11px] font-bold text-white"><Shield className="h-4 w-4 text-brand" /> Research responsibly</div><p className="mt-1.5 text-[10px] leading-relaxed text-muted">Independent research terminal. Always verify information and manage risk.</p></div></div>}
      <div className="hidden border-t border-white/5 p-3 md:block"><button type="button" onClick={() => setCollapsed(!collapsed)} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold text-muted hover:bg-white/[0.04] hover:text-white" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /><span>Collapse sidebar</span></>}</button></div>
    </>
  );

  return <>
    <button type="button" onClick={() => setMobileOpen(true)} className="fixed left-4 top-[5.25rem] z-40 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#111214] text-white shadow-xl md:hidden" aria-label="Open dashboard navigation"><Menu className="h-5 w-5" /></button>
    <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-white/5 bg-[#101113] transition-[width] duration-200 md:flex ${collapsed ? 'w-[76px]' : 'w-[252px]'}`}>{nav}</aside>
    {mobileOpen && <div className="fixed inset-0 z-[70] md:hidden"><button type="button" className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} aria-label="Close navigation overlay" /><aside className="relative flex h-full w-[min(84vw,300px)] flex-col border-r border-white/10 bg-[#101113] shadow-2xl">{nav}</aside></div>}
  </>;
}
