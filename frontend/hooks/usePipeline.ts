'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchPipeline } from '@/lib/api';
import type { PipelineData, FilterParams } from '@/lib/types';

interface UsePipelineResult {
  data: PipelineData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePipeline(filters: FilterParams, enabled = true): UsePipelineResult {
  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPipeline(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline data');
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
