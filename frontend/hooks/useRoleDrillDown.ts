'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchRoleDrillDown } from '@/lib/api';
import type { RoleDrillDownRequest, RoleDrillDownResponse } from '@/lib/roleDrillDown';
import type { FilterParams } from '@/lib/types';

export function useRoleDrillDown(
  request: RoleDrillDownRequest | null,
  filters: FilterParams,
) {
  const [data, setData] = useState<RoleDrillDownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!request) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetchRoleDrillDown({
      type: request.type,
      centreId: filters.centreId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      drillCentreId: request.drillCentreId,
      drillUserId: request.drillUserId,
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : 'Failed to load details');
          setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [request, filters.centreId, filters.dateFrom, filters.dateTo, request?.type, request?.drillCentreId, request?.drillUserId]);

  return { data, loading, error };
}
