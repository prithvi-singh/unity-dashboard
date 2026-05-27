'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import type { CoreMetrics, FilterParams } from './types';
import { fetchMetrics } from './api';

// ── Context value shape ───────────────────────────────────────────────────────

export interface MetricsContextValue {
  metrics: CoreMetrics | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refetch: () => void;
}

const DEFAULT_VALUE: MetricsContextValue = {
  metrics: null,
  loading: false,
  error: null,
  lastUpdated: null,
  refetch: () => {},
};

const MetricsContext = createContext<MetricsContextValue>(DEFAULT_VALUE);

// ── Provider ──────────────────────────────────────────────────────────────────

const METRICS_REFRESH_MS = 60_000;

interface MetricsProviderProps {
  children: React.ReactNode;
  filters: FilterParams;
  /** Called once with the refetch function so the parent can trigger manual refreshes */
  onRegisterRefetch?: (refetch: () => void) => void;
}

export function MetricsProvider({
  children,
  filters,
  onRegisterRefetch,
}: MetricsProviderProps) {
  const [metrics, setMetrics]       = useState<CoreMetrics | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; });

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMetrics(filtersRef.current);
      setMetrics(result);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch when filters change
  useEffect(() => {
    doFetch();
  }, [doFetch, filters.centreId, filters.dateFrom, filters.dateTo]);

  // Register refetch with parent so it can be triggered on manual refresh
  const onRegisterRefetchRef = useRef(onRegisterRefetch);
  onRegisterRefetchRef.current = onRegisterRefetch;
  useEffect(() => {
    onRegisterRefetchRef.current?.(doFetch);
  }, [doFetch]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const timer = setInterval(doFetch, METRICS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [doFetch]);

  const value = useMemo<MetricsContextValue>(
    () => ({ metrics, loading, error, lastUpdated, refetch: doFetch }),
    [metrics, loading, error, lastUpdated, doFetch],
  );

  return (
    <MetricsContext.Provider value={value}>
      {children}
    </MetricsContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

export function useMetrics(): MetricsContextValue {
  return useContext(MetricsContext);
}
