'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchBottlenecks } from '@/lib/api';
import type { BottleneckData, FilterParams } from '@/lib/types';

interface UseBottlenecksResult {
  data: BottleneckData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useBottlenecks(filters: FilterParams, enabled = true): UseBottlenecksResult {
  const [data, setData] = useState<BottleneckData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBottlenecks(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bottleneck data');
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
