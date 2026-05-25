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
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchClinicalPipeline(filtersRef.current)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load clinical pipeline');
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [enabled, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error };
}
