'use client';

import { useRef, useState, useEffect } from 'react';

interface UseLazyLoadOptions {
  /** How far outside the viewport to start loading (default: 200px). */
  rootMargin?: string;
  /** Intersection threshold 0–1 (default: 0). */
  threshold?: number;
}

interface UseLazyLoadResult {
  /** Attach to the wrapper element of the lazy section. */
  ref: React.RefObject<HTMLDivElement>;
  /**
   * True once the element has intersected the viewport.
   * Stays true permanently — once loaded, never unloads.
   */
  isVisible: boolean;
}

/**
 * useLazyLoad — defer rendering of below-fold content until the user scrolls near.
 *
 * Usage:
 *   const { ref, isVisible } = useLazyLoad();
 *   return (
 *     <div ref={ref}>
 *       {isVisible ? <ExpensiveChart /> : <Skeleton />}
 *     </div>
 *   );
 *
 * Apply to:
 *   - Centre Breakdown table (below pipeline cards)
 *   - Clinician / Manager Detail tables (below metric cards)
 *   - Recent Actions on profile pages
 *   - Activity heatmap on Daily Monitoring
 *   - Turnaround Trend chart on Issues tab
 */
export function useLazyLoad(options: UseLazyLoadOptions = {}): UseLazyLoadResult {
  const { rootMargin = '200px', threshold = 0 } = options;
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // SSR safety: IntersectionObserver is browser-only.
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    // Already visible — nothing to observe.
    if (isVisible) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMargin, threshold]);

  return { ref, isVisible };
}
