'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchWorkload } from '@/lib/api';
import type { WorkloadCentreRow, FilterParams } from '@/lib/types';

interface UseWorkloadResult {
  data: WorkloadCentreRow[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useWorkload(filters: FilterParams, enabled = true): UseWorkloadResult {
  const [data, setData] = useState<WorkloadCentreRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWorkload(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workload data');
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
