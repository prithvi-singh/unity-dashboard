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

// ── Patient-link types ─────────────────────────────────────────────────────

export interface PatientLinkUnity {
  Id: number;
  PatientID: string;
  FirstName: string;
  LastName: string;
  Gender: string;
  DateOfBirth: string;
  Status: string;
  CentreId: number;
  CentreName: string;
}

export interface PatientLinkZoho {
  id: string;
  patientCode: string | null;
  name: string | null;
  status: string | null;
  holdReason: string | null;
  registrationDate: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  fatherName: string | null;
  motherName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  centreName: string | null;
  centreAdmin: string | null;
  childUin: string | null;
  addedTime: string | null;
  modifiedTime: string | null;
}

export interface PatientLinkResponse {
  unity: PatientLinkUnity | null;
  zoho: PatientLinkZoho | null;
}

export function fetchPatientLink(code: string, signal?: AbortSignal): Promise<PatientLinkResponse> {
  return get<PatientLinkResponse>(`/api/patient-link/${encodeURIComponent(code)}`, signal);
}
