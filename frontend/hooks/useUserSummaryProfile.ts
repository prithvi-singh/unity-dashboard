'use client';

import { useState, useCallback, useEffect } from 'react';
import { fetchUserSummaryProfile } from '@/lib/api';
import type { UserSummaryProfile } from '@/lib/types';

interface UseUserSummaryProfileResult {
  data: UserSummaryProfile | null;
  loading: boolean;
  error: string | null;
}

export function useUserSummaryProfile(userId: number | null): UseUserSummaryProfileResult {
  const [data, setData] = useState<UserSummaryProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const result = await fetchUserSummaryProfile(id);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId == null) {
      setData(null);
      setError(null);
      return;
    }
    doFetch(userId);
  }, [userId, doFetch]);

  return { data, loading, error };
}
