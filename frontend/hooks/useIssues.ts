'use client';

import { useState, useCallback, useEffect } from 'react';
import { fetchIssues } from '@/lib/api';
import type { IssuesData } from '@/lib/types';

interface UseIssuesResult {
  data: IssuesData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useIssues(enabled = true): UseIssuesResult {
  const [data, setData]       = useState<IssuesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchIssues();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load issues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    doFetch();
  }, [enabled, doFetch]);

  return { data, loading, error, refetch: doFetch };
}
