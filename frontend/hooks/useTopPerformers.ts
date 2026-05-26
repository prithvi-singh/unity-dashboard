'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchTopPerformers } from '@/lib/api';
import type { TopPerformersResponse, FilterParams } from '@/lib/types';

interface UseTopPerformersResult {
  data:    TopPerformersResponse | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

export interface TopPerformersFilters extends FilterParams {
  limit?: number;
}

export function useTopPerformers(
  filters: TopPerformersFilters,
  enabled = true,
): UseTopPerformersResult {
  const [data, setData]       = useState<TopPerformersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTopPerformers(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load top performers data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
  }, [enabled, doFetch, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error, refetch: doFetch };
}
