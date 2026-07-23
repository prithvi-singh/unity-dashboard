'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchCentresOverview } from '@/lib/api';
import type { CentresOverviewData, FilterParams } from '@/lib/types';

interface UseCentresOverviewResult {
  data:     CentresOverviewData | null;
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
}

export function useCentresOverview(filters: FilterParams, enabled = true): UseCentresOverviewResult {
  const [data,    setData]    = useState<CentresOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCentresOverview(filtersRef.current, signal);
      setData(result);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load centres data');
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
