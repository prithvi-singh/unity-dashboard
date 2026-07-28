
// Funnel API client — mirrors lib/zoho/api.ts conventions.
// Separate module so funnel types and fetchers stay self-contained.

import type { PatientLinkUnity, PatientLinkZoho } from './api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: 'no-store', signal });
  if (!res.ok) {
    throw new Error(`Zoho API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ── Funnel summary ──────────────────────────────────────────────────────────

export interface FunnelCohort {
  month: string;
  leads: number;
  converted: number;
  registeredInUnity: number;
  assessmentStarted: number;
  reportOrGoal: number;
  completed: number;
}

export interface FunnelSummaryResponse {
  cohorts: FunnelCohort[];
  asOf: string;
}

export function fetchFunnelSummary(months: number, signal?: AbortSignal): Promise<FunnelSummaryResponse> {
  return get<FunnelSummaryResponse>(`/api/funnel/summary?months=${months}`, signal);
}

// ── Funnel gap ──────────────────────────────────────────────────────────────

export interface FunnelGapEntry {
  childName: string;
  patientCode: string;
  registrationDate: string;
  centreHeadName: string;
  leadGeneratedBy: string;
  enrollmentAmount: number;
}

export interface FunnelGapResponse {
  gap: FunnelGapEntry[];
  total: number;
  totalConverted: number;
  limit: number;
  offset: number;
  asOf: string;
}

export function fetchFunnelGap(
  months: number,
  limit: number,
  offset: number,
  signal?: AbortSignal
): Promise<FunnelGapResponse> {
  const q = new URLSearchParams();
  q.set('months', String(months));
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return get<FunnelGapResponse>(`/api/funnel/gap?${q.toString()}`, signal);
}

// ── Patient journey ─────────────────────────────────────────────────────────

export interface JourneyEvent {
  date: string;
  source: 'zoho' | 'unity';
  label: string;
  detail: string;
}

export interface PatientJourneyResponse {
  code: string;
  timeline: JourneyEvent[];
  unity: PatientLinkUnity | null;
  zoho: PatientLinkZoho | null;
}

export function fetchPatientJourney(code: string, signal?: AbortSignal): Promise<PatientJourneyResponse> {
  return get<PatientJourneyResponse>(`/api/patient-link/${encodeURIComponent(code)}/journey`, signal);
}
