'use client';

interface TabNavProps {
  tabs: string[];
  activeTab: number;
  onTabChange: (index: number) => void;
  /** Indices to hide completely from the nav (tab still exists internally). */
  hiddenTabs?: ReadonlySet<number>;
}

export default function TabNav({ tabs, activeTab, onTabChange, hiddenTabs }: TabNavProps) {
  const visibleTabs = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(({ index }) => !hiddenTabs?.has(index));

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
      className="flex gap-0.5 bg-white border-b border-gray-200 overflow-x-auto scrollbar-thin px-5 shadow-sm"
    >
      {visibleTabs.map(({ tab, index }, pos) => (
        <button
          key={tab}
          role="tab"
          aria-selected={activeTab === index}
          aria-controls={`tabpanel-${index}`}
          id={`tab-${index}`}
          tabIndex={activeTab === index ? 0 : -1}
          onClick={() => onTabChange(index)}
          onKeyDown={(e) => handleKeyDown(e, pos)}
          className={[
            'px-4 py-2.5 text-[13px] font-semibold tracking-[-0.01em] whitespace-nowrap border-b-2 transition-all',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
            activeTab === index
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
          ].join(' ')}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}
