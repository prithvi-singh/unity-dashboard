'use client';

import { useRef } from 'react';

// Tab icon map — displayed instead of text on mobile (< sm)
const TAB_ICONS: Record<string, React.ReactNode> = {
  Overview: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  Live: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  Team: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  Issues: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
};

export interface TabBadge {
  count: number;
  /** 'red' if critical issues present, 'amber' if only warnings */
  variant: 'red' | 'amber';
}

interface TabNavProps {
  tabs: string[];
  activeTab: number;
  onTabChange: (index: number) => void;
  /** Indices to hide completely from the nav (tab still exists internally). */
  hiddenTabs?: ReadonlySet<number>;
  /** Map of tab index → badge to display on that tab */
  badges?: ReadonlyMap<number, TabBadge>;
  /**
   * Called when a tab has been hovered for 300ms without clicking.
   * Parent should use this to prefetch that tab's data before the click.
   */
  onTabHoverIntent?: (index: number) => void;
}

export default function TabNav({ tabs, activeTab, onTabChange, hiddenTabs, badges, onTabHoverIntent }: TabNavProps) {
  const visibleTabs = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ index }) => !hiddenTabs?.has(index));

  // Prefetch-on-hover: fire onTabHoverIntent after 300ms of continuous hover.
  // Cancelled immediately if the user moves away — prevents wasted prefetches.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = (index: number) => {
    if (!onTabHoverIntent || index === activeTab) return;
    hoverTimer.current = setTimeout(() => {
      onTabHoverIntent(index);
    }, 300);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, pos: number) => {
    const len = visibleTabs.length;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onTabChange(visibleTabs[(pos + 1) % len].index);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onTabChange(visibleTabs[(pos - 1 + len) % len].index);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onTabChange(visibleTabs[0].index);
    } else if (e.key === 'End') {
      e.preventDefault();
      onTabChange(visibleTabs[len - 1].index);
    }
  };

  return (
    <nav
      role="tablist"
      aria-label="Dashboard sections"
      className="flex bg-white border-b border-gray-200 overflow-x-auto scrollbar-none px-1 sm:px-5 shadow-sm"
    >
      {visibleTabs.map(({ tab, index }, pos) => {
        const icon = TAB_ICONS[tab];
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === index}
            aria-controls={`tabpanel-${index}`}
            id={`tab-${index}`}
            tabIndex={activeTab === index ? 0 : -1}
            onClick={() => onTabChange(index)}
            onKeyDown={(e) => handleKeyDown(e, pos)}
            onMouseEnter={() => handleMouseEnter(index)}
            onMouseLeave={handleMouseLeave}
            className={[
              'px-4 sm:px-4 py-2 sm:py-2.5 text-[11px] sm:text-[13px] font-semibold tracking-[-0.01em] whitespace-nowrap border-b-2 transition-all',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
              'min-h-[52px] sm:min-h-[44px] flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 flex-1 sm:flex-none',
              activeTab === index
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {icon && <span className="opacity-90">{icon}</span>}
            <span className="relative inline-flex items-center gap-1.5">
              {tab}
              {(() => {
                const badge = badges?.get(index);
                if (!badge || badge.count === 0) return null;
                const cls = badge.variant === 'red'
                  ? 'bg-red-500 text-white'
                  : 'bg-amber-400 text-white';
                return (
                  <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold leading-none ${cls}`} aria-label={`${badge.count} open issues`}>
                    {badge.count}
                  </span>
                );
              })()}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
