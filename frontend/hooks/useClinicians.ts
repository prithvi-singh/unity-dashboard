'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchClinicians } from '@/lib/api';
import type { Clinician, FilterParams } from '@/lib/types';

interface UseCliniciansResult {
  data: Clinician[] | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useClinicians(filters: FilterParams, enabled = true): UseCliniciansResult {
  const [data, setData] = useState<Clinician[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchClinicians(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clinician data');
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
