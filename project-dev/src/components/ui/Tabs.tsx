import React, { useRef } from 'react';
import { cn } from './cn';

export interface TabItem {
  id: string;
  label: string;
  count?: number | string;
  locked?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onTabChange,
  className,
  id,
  'aria-label': ariaLabel = 'Navigation tabs',
}) => {
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const count = tabs.length;
    let nextIndex = -1;

    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % count;
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + count) % count;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = count - 1;
    }

    if (nextIndex !== -1) {
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      onTabChange(nextTab.id);
      const nextEl = tabRefs.current.get(nextTab.id);
      if (nextEl) {
        nextEl.focus();
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      id={id}
      className={cn('flex items-center gap-1 border-b border-border-default', className)}
    >
      {tabs.map((tab, idx) => {
        const isActive = activeTab === tab.id;
        const panelId = `tabpanel-${tab.id.toLowerCase()}`;
        const tabId = `tab-${tab.id.toLowerCase()}`;

        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            data-testid={tab['data-testid']}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={cn(
              'group relative inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              isActive ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            <span>{tab.label}</span>

            {/* Fixed-width slot for lock icon so width never changes between locked states */}
            <span
              className={cn(
                'inline-flex items-center justify-center w-3.5 h-3.5 text-dim shrink-0',
                !tab.locked && 'invisible'
              )}
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>

            {tab.count !== undefined && (
              <span className="text-2xs sm:text-xs font-mono text-muted tabular-nums">
                ({tab.count})
              </span>
            )}

            {/* 2px bottom active indicator */}
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
};

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tabId: string;
  activeTab: string;
}

export const TabPanel: React.FC<TabPanelProps> = ({
  tabId,
  activeTab,
  children,
  className,
  ...props
}) => {
  const isActive = activeTab === tabId;
  const panelId = `tabpanel-${tabId.toLowerCase()}`;
  const labelledBy = `tab-${tabId.toLowerCase()}`;

  if (!isActive) return null;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={cn('focus:outline-none focus-visible:ring-2 focus-visible:ring-brand', className)}
      {...props}
    >
      {children}
    </div>
  );
};
