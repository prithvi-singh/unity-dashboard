'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchCentreAdmins } from '@/lib/api';
import type { CentreAdmin, FilterParams } from '@/lib/types';

interface UseCentreAdminsResult {
  data: CentreAdmin[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCentreAdmins(filters: FilterParams, enabled = true): UseCentreAdminsResult {
  const [data, setData] = useState<CentreAdmin[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCentreAdmins(filtersRef.current, signal);
      setData(result);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load centre admin data');
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
