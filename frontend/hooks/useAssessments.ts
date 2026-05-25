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

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAssessments(filtersRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assessment data');
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
