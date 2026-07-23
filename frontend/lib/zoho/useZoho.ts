'use client';

// Zoho data hooks — same pattern as hooks/useOverview.ts, kept inside
// lib/zoho/ so the module stays self-contained.

import { useState, useCallback, useEffect } from 'react';
import { fetchZohoSummary, fetchZohoModule } from './api';
import type { ZohoListResponse, ZohoModuleKey, ZohoSummaryResponse } from './types';

const SUMMARY_REFRESH_MS = 60_000;

export function useZohoSummary() {
  const [data, setData] = useState<ZohoSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const result = await fetchZohoSummary(controller.signal);
        setData(result);
        setError(null);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : 'Zoho summary unavailable');
      } finally {
        setLoading(false);
      }
    };

    load();
    timer = setInterval(load, SUMMARY_REFRESH_MS);
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, []);

  return { data, loading, error };
}

export function useZohoModule(module: ZohoModuleKey, search: string, offset: number, limit = 50) {
  const [data, setData] = useState<ZohoListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const result = await fetchZohoModule(module, { limit, offset, search }, signal);
      setData(result);
      setError(null);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Zoho data unavailable');
    } finally {
      setLoading(false);
    }
  }, [module, search, offset, limit]);

  useEffect(() => {
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  return { data, loading, error, refetch: () => doFetch() };
}
