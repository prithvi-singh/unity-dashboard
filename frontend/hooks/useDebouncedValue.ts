'use client';

import { useState, useEffect } from 'react';

/**
 * useDebouncedValue — returns a debounced copy of value.
 *
 * The returned value only updates after `delayMs` milliseconds have passed
 * without the input changing. Used to prevent rapid-fire API calls when a
 * user adjusts date pickers or filter dropdowns in quick succession.
 *
 * Example:
 *   const debouncedFilters = useDebouncedValue(filters, 300);
 *   // Pass debouncedFilters to data hooks instead of raw filters.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
