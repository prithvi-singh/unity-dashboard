'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchDailyReview } from '@/lib/api';
import type { DailyReviewData } from '@/lib/types';

interface UseDailyReviewResult {
  data: DailyReviewData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDailyReview(
  date: string,
  centreId: number | undefined,
  enabled = true
): UseDailyReviewResult {
  const [data, setData]       = useState<DailyReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const dateRef     = useRef(date);
  const centreIdRef = useRef(centreId);
  dateRef.current     = date;
  centreIdRef.current = centreId;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDailyReview(dateRef.current, centreIdRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load daily review data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
  }, [enabled, doFetch, date, centreId]);

  return { data, loading, error, refetch: doFetch };
}
