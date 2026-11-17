'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * All dashboard workspaces.
 * Note: 'SOCIAL' maps to the Raid workspace so existing `?tab=SOCIAL` links keep working.
 * 'ADMIN' is restricted exclusively to authorized administrator wallets.
 */
export type DashboardWorkspace = 'OVERVIEW' | 'ALPHA' | 'MAX_ALPHA' | 'SOCIAL' | 'STAKE' | 'ADMIN';

export interface SidebarItemState {
  count?: number;
  locked?: boolean;
}

export type SidebarItemStateMap = Partial<Record<DashboardWorkspace, SidebarItemState>>;

export const DASHBOARD_WORKSPACES: DashboardWorkspace[] = [
  'OVERVIEW',
  'ALPHA',
  'MAX_ALPHA',
  'SOCIAL',
  'STAKE',
  'ADMIN',
];

export const readWorkspaceFromSearch = (search: string): DashboardWorkspace => {
  const tabParam = new URLSearchParams(search).get('tab')?.toUpperCase();
  // Legacy ?tab=WATCHLIST gracefully resolves to Overview where My Pinned Posts lives
  if (tabParam === 'WATCHLIST') return 'OVERVIEW';
  return DASHBOARD_WORKSPACES.includes(tabParam as DashboardWorkspace)
    ? (tabParam as DashboardWorkspace)
    : 'OVERVIEW';
};

export const workspaceHref = (workspace: DashboardWorkspace): string => {
  if (workspace === 'OVERVIEW') return '/dashboard';
  return `/dashboard?tab=${workspace}`;
};

interface DashboardNavigationContextValue {
  activeWorkspace: DashboardWorkspace;
  selectWorkspace: (workspace: DashboardWorkspace) => void;
  itemState: SidebarItemStateMap;
  setItemState: React.Dispatch<React.SetStateAction<SidebarItemStateMap>>;
}

const DashboardNavigationContext = createContext<DashboardNavigationContextValue | undefined>(
  undefined
);

export const DASHBOARD_TAB_EVENT = 'trenchlabs:dashboard-tab';

export function DashboardNavigationProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isStakeRoute = pathname?.startsWith('/dashboard/stake') ?? false;

  // Deterministic SSR initial state avoids hydration mismatch; URL query sync happens on mount.
  const [tabWorkspace, setTabWorkspace] = useState<DashboardWorkspace>('OVERVIEW');
  const [itemState, setItemState] = useState<SidebarItemStateMap>({});

  useEffect(() => {
    const syncFromUrl = () => {
      if (typeof window === 'undefined') return;
      if (window.location.pathname.startsWith('/dashboard/stake')) {
        setTabWorkspace('STAKE');
        return;
      }
      setTabWorkspace(readWorkspaceFromSearch(window.location.search));
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener(DASHBOARD_TAB_EVENT, syncFromUrl);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener(DASHBOARD_TAB_EVENT, syncFromUrl);
    };
  }, [pathname]);

  const activeWorkspace: DashboardWorkspace = isStakeRoute ? 'STAKE' : tabWorkspace;

  const selectWorkspace = useCallback(
    (workspace: DashboardWorkspace) => {
      if (isStakeRoute) {
        if (workspace === 'STAKE') return;
        router.push(workspaceHref(workspace));
        return;
      }

      setTabWorkspace(workspace);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.pathname = '/dashboard';
        if (workspace === 'OVERVIEW') {
          url.searchParams.delete('tab');
        } else {
          url.searchParams.set('tab', workspace);
        }
        window.history.pushState({ tab: workspace }, '', url.toString());
        window.dispatchEvent(new Event(DASHBOARD_TAB_EVENT));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    [isStakeRoute, router]
  );

  const value = useMemo(
    () => ({
      activeWorkspace,
      selectWorkspace,
      itemState,
      setItemState,
    }),
    [activeWorkspace, selectWorkspace, itemState]
  );

  return (
    <DashboardNavigationContext.Provider value={value}>
      {children}
    </DashboardNavigationContext.Provider>
  );
}

export function useDashboardNavigation(): DashboardNavigationContextValue | undefined {
  return useContext(DashboardNavigationContext);
}
