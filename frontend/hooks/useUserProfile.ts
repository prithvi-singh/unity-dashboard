'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchUserProfile } from '@/lib/api';
import type { UserProfileData, UserProfileParams } from '@/lib/types';

interface UseUserProfileResult {
  data: UserProfileData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUserProfile(userId: number, params: UserProfileParams): UseUserProfileResult {
  const [data, setData] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; });

  const doFetch = useCallback(async () => {
    if (!userId || isNaN(userId)) {
      setError('Invalid user id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchUserProfile(userId, paramsRef.current);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load user profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    doFetch();
  }, [doFetch, userId, params.role, params.centreId, params.dateFrom, params.dateTo]);

  return { data, loading, error, refetch: doFetch };
}
