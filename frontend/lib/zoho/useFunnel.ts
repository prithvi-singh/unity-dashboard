
'use client';

// Funnel data hooks — same pattern as lib/zoho/useZoho.ts, kept inside
// lib/zoho/ so the module stays self-contained.

import { useState, useCallback, useEffect } from 'react';
import {
  fetchFunnelSummary,
  fetchFunnelGap,
  fetchPatientJourney,
} from './funnel';
import type {
  FunnelSummaryResponse,
  FunnelGapResponse,
  PatientJourneyResponse,
} from './funnel';

const SUMMARY_REFRESH_MS = 60_000;

export function useFunnelSummary(months: number) {
  const [data, setData] = useState<FunnelSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = async () => {
      try {
        const result = await fetchFunnelSummary(months, controller.signal);
        setData(result);
        setError(null);
        setWarming(false);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Funnel summary unavailable';
        if (msg.includes('503')) {
          setWarming(true);
          setError(null);
        } else {
          setError(msg);
        }
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
  }, [months]);

  return { data, loading, error, warming };
}

export function useFunnelGap(months: number, limit: number, offset: number) {
  const [data, setData] = useState<FunnelGapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);

  const doFetch = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await fetchFunnelGap(months, limit, offset, signal);
        setData(result);
        setError(null);
        setWarming(false);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Funnel gap data unavailable';
        if (msg.includes('503')) {
          setWarming(true);
          setError(null);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [months, limit, offset]
  );

  useEffect(() => {
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  return { data, loading, error, warming, refetch: () => doFetch() };
}

export function usePatientJourney(code: string | null) {
  const [data, setData] = useState<PatientJourneyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);

  const doFetch = useCallback(
    async (signal?: AbortSignal) => {
      if (!code) {
        setData(null);
        setLoading(false);
        setError(null);
        setWarming(false);
        return;
      }

      setLoading(true);
      setError(null);
      setWarming(false);

      try {
        const result = await fetchPatientJourney(code, signal);
        setData(result);
        setWarming(false);
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Failed to load patient journey';
        if (msg.includes('503')) {
          setWarming(true);
          setError(null);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    },
    [code]
  );

  useEffect(() => {
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  return { data, loading, error, warming, refetch: () => doFetch() };
}
