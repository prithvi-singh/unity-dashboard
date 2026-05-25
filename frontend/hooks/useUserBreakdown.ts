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

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUserBreakdown(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user breakdown');
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
