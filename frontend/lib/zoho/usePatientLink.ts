'use client';

import { useState, useCallback, useEffect } from 'react';
import { fetchPatientLink } from './api';
import type { PatientLinkResponse } from './api';

export function usePatientLink(code: string | null) {
  const [data, setData] = useState<PatientLinkResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);

  const doFetch = useCallback(async (signal?: AbortSignal) => {
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
      const result = await fetchPatientLink(code, signal);
      setData(result);
      setWarming(false);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : 'Failed to load patient link';
      if (msg.includes('503')) {
        setWarming(true);
        setError(null);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    const controller = new AbortController();
    doFetch(controller.signal);
    return () => controller.abort();
  }, [doFetch]);

  return { data, loading, error, warming, refetch: () => doFetch() };
}
