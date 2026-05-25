'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchMonitoring } from '@/lib/api';
import type { MonitoringData } from '@/lib/types';

interface UseMonitoringResult {
  data: MonitoringData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMonitoring(date: string, enabled = true): UseMonitoringResult {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateRef = useRef(date);
  dateRef.current = date;

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMonitoring(dateRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
  }, [enabled, doFetch, date]);

  return { data, loading, error, refetch: doFetch };
}
