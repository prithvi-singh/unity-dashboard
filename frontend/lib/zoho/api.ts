// Zoho API client — mirrors lib/api.ts conventions but deliberately
// separate: a Zoho outage or shape change must never touch core fetchers.

import type { ZohoListResponse, ZohoModuleKey, ZohoSummaryResponse } from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: 'no-store', signal });
  if (!res.ok) {
    throw new Error(`Zoho API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export function fetchZohoSummary(signal?: AbortSignal): Promise<ZohoSummaryResponse> {
  return get<ZohoSummaryResponse>('/api/zoho/summary', signal);
}

export interface ZohoListParams {
  limit?: number;
  offset?: number;
  search?: string;
}

export function fetchZohoModule(
  module: ZohoModuleKey,
  { limit = 50, offset = 0, search = '' }: ZohoListParams = {},
  signal?: AbortSignal
): Promise<ZohoListResponse> {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  if (search) q.set('search', search);
  return get<ZohoListResponse>(`/api/zoho/${module}?${q.toString()}`, signal);
}
