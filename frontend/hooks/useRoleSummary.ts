'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchRoleSummary } from '@/lib/api';
import type { RoleKind, RoleSummary } from '@/lib/roleDrillDown';
import type { FilterParams } from '@/lib/types';

export function useRoleSummary(role: RoleKind, filters: FilterParams, enabled = true) {
  const [data, setData] = useState<RoleSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchRoleSummary(role, filtersRef.current)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load summary');
          setData(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [enabled, role, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error };
}
