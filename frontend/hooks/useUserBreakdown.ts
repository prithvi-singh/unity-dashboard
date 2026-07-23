'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchUserBreakdown } from '@/lib/api';
import type { FilterParams, UserBreakdownData } from '@/lib/types';

interface UseUserBreakdownResult {
  data: UserBreakdownData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserBreakdown(filters: FilterParams, enabled = true): UseUserBreakdownResult {
  const [data, setData] = useState<UserBreakdownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUserBreakdown(filtersRef.current, signal);
      setData(result);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load user breakdown');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [enabled, doFetch, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error, refetch: doFetch };
}
