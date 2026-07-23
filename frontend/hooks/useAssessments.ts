'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchAssessments } from '@/lib/api';
import type { AssessmentOverviewData, FilterParams } from '@/lib/types';

interface UseAssessmentsResult {
  data: AssessmentOverviewData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAssessments(filters: FilterParams, enabled = true): UseAssessmentsResult {
  const [data, setData] = useState<AssessmentOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAssessments(filtersRef.current, signal);
      setData(result);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load assessment data');
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
