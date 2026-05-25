'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Max-height Tailwind class, e.g. "max-h-[560px]". Defaults to max-h-[520px]. */
  maxHeightClass?: string;
  /** Label shown in the inactive hint. */
  label?: string;
}

/**
 * A scroll container that only captures wheel events after the user clicks
 * inside it. This lets the page scroll normally when the mouse just passes
 * over the card.
 *
 * Click inside  → activates (blue ring, card scrolls)
 * Escape / click outside → deactivates (page scrolls)
 */
export default function ScrollRegion({
  children,
  className = '',
  maxHeightClass = 'max-h-[520px]',
  label = 'table',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);

  // Detect whether content overflows so we can show the hint
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => setHasOverflow(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Click outside → deactivate
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActive(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [active]);

  // Escape → deactivate
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active]);

  const activate = useCallback(() => setActive(true), []);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseDown={activate}
        className={[
          maxHeightClass,
          'overflow-x-auto',
          active ? 'overflow-y-auto' : 'overflow-y-hidden',
          active
            ? 'ring-2 ring-blue-400 ring-inset rounded-b-2xl'
            : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>

      {/* Inactive overflow hint — bottom gradient + label */}
      {!active && hasOverflow && (
        <div
          className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none rounded-b-2xl"
          style={{
            background:
              'linear-gradient(to bottom, transparent, rgba(255,255,255,0.96))',
          }}
        >
          <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] font-semibold text-gray-400 tracking-wide select-none">
            ↕ Click {label} to scroll · Esc to release
          </p>
        </div>
      )}

      {/* Active badge — top right corner */}
      {active && (
        <div className="absolute top-1.5 right-2 z-10 pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white shadow-sm">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Scrolling · Esc to exit
          </span>
        </div>
      )}
    </div>
  );
}
