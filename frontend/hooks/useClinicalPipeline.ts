'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchClinicalPipeline } from '@/lib/api';
import type { ClinicalPipelineData } from '@/lib/roleDrillDown';
import type { FilterParams } from '@/lib/types';

export function useClinicalPipeline(filters: FilterParams, enabled = true) {
  const [data, setData] = useState<ClinicalPipelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchClinicalPipeline(filtersRef.current, controller.signal)
      .then((result) => setData(result))
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Failed to load clinical pipeline');
        setData(null);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  }, [enabled, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error };
}
