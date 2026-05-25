'use client';

import { useState, useEffect, useRef } from 'react';
import { fetchBottleneckDrillDown } from '@/lib/api';
import type { BottleneckDrillDownRequest, BottleneckDrillDownResponse } from '@/lib/bottleneckDrillDown';
import type { FilterParams } from '@/lib/types';

function requestKey(request: BottleneckDrillDownRequest): string {
  return JSON.stringify({
    type: request.type,
    drillCentreId: request.drillCentreId,
    weekStart: request.weekStart,
    weekEnd: request.weekEnd,
    severity: request.severity,
  });
}

export function useBottleneckDrillDown(
  request: BottleneckDrillDownRequest | null,
  filters: FilterParams
) {
  const [data, setData] = useState<BottleneckDrillDownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const key = request ? requestKey(request) : null;

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

    fetchBottleneckDrillDown({
      type: request.type,
      centreId: filters.centreId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      drillCentreId: request.drillCentreId,
      weekStart: request.weekStart,
      weekEnd: request.weekEnd,
      severity: request.severity,
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
  }, [key, filters.centreId, filters.dateFrom, filters.dateTo]);

  return { data, loading, error };
}
