'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchOverview } from '@/lib/api';
import type { OverviewData, FilterParams } from '@/lib/types';

interface UseOverviewResult {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOverview(filters: FilterParams): UseOverviewResult {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; });

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchOverview(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doFetch();
  }, [doFetch, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error, refetch: doFetch };
}
