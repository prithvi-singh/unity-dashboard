'use client';

import { useEffect, useState } from 'react';
import { usePatientLink } from '@/lib/zoho/usePatientLink';
import { usePatientJourney } from '@/lib/zoho/useFunnel';
import type { PatientLinkZoho, PatientLinkUnity } from '@/lib/zoho/api';
import PatientJourneyTimeline from './PatientJourneyTimeline';

interface Props {
  open: boolean;
  patientCode: string | null;
  patientName?: string;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function abbreviateCentre(name: string | null): string {
  if (!name) return '';
  return name
    .replace(/Mom[''`\u2019]s Belief Learning Cent(?:re|er)/gi, 'MBLC')
    .replace(/Mom[''`\u2019]s Belief/gi, 'MB');
}

function normalizeCentre(name: string | null): string {
  if (!name) return '';
  return abbreviateCentre(name).replace(/\s+/g, ' ').replace(/[`\u2018\u2019]/g, "'").trim();
}

function centreNamesMatch(zoho: PatientLinkZoho | null, unity: PatientLinkUnity | null): boolean {
  if (!zoho || !unity) return true;
  const zohoNorm = normalizeCentre(zoho.centreName);
  const unityNorm = normalizeCentre(unity.CentreName);
  if (!zohoNorm || !unityNorm) return true;
  return zohoNorm.toLowerCase() === unityNorm.toLowerCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusLabel(status: string | null): string {
  if (!status) return 'Unknown';
  const l = status.toLowerCase();
  if (l.includes('hold')) return 'On Hold';
  if (l.includes('active')) return 'Active';
  return status;
}

function statusColour(status: string | null, holdReason: string | null): { dot: string; text: string; bg: string; ring: string } {
  const l = (status || '').toLowerCase();
  if (l.includes('hold') || holdReason) {
    return { dot: '#BA7517', text: '#BA7517', bg: 'bg-amber-50', ring: 'ring-1 ring-amber-200' };
  }
  if (l.includes('active')) {
    return { dot: '#1D9E75', text: '#1D9E75', bg: 'bg-emerald-50', ring: 'ring-1 ring-emerald-200' };
  }
  return { dot: '#9CA3AF', text: '#6B7280', bg: 'bg-gray-50', ring: 'ring-1 ring-gray-200' };
}

// ── Section components ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 mb-3">{children}</h3>;
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-[0.03em]">{label}</p>
      <p className={`text-sm text-gray-800 mt-0.5 ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PatientZohoDrawer({ open, patientCode, patientName, onClose }: Props) {
  const { data, loading, error, warming } = usePatientLink(open ? patientCode : null);
  const {
    data: journeyData,
    loading: journeyLoading,
    error: journeyError,
    warming: journeyWarming,
  } = usePatientJourney(open ? patientCode : null);
  const [journeyOpen, setJourneyOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const zoho = data?.zoho ?? null;
  const unity = data?.unity ?? null;
  const displayName = patientName || (unity ? `${unity.FirstName} ${unity.LastName}` : 'Unknown');
  const code = patientCode || (unity?.PatientID ?? '');
  const colour = statusColour(zoho?.status ?? null, zoho?.holdReason ?? null);
  const mismatch = !centreNamesMatch(zoho, unity);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close Zoho panel"
        onClick={onClose}
      />

      {/* Panel — 640px desktop, full-screen mobile */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="patient-zoho-title"
        className="relative w-full sm:max-w-[640px] h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none border-l border-gray-200/60"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 mb-1">Zoho patient</p>
            <h2 id="patient-zoho-title" className="text-[18px] font-medium text-gray-900 leading-tight truncate">
              {loading ? 'Loading…' : displayName}
            </h2>
            {code && !loading && (
              <p className="text-[13px] text-gray-500 mt-0.5 font-mono tabular-nums">#{code}</p>
            )}
            {zoho && (
              <div className="mt-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${colour.bg} ${colour.ring}`}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: colour.dot }} />
                  <span style={{ color: colour.text }}>{statusLabel(zoho.status)}</span>
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-gray-400">Loading Zoho record…</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-20 gap-2 px-4">
              <p className="text-sm font-medium text-gray-700">Failed to load</p>
              <p className="text-[12px] text-gray-500 text-center">{error}</p>
            </div>
          )}

          {warming && (
            <div className="flex flex-col items-center justify-center py-20 gap-2 px-4">
              <svg className="w-8 h-8 text-gray-300 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M2.985 7.018v4.992" />
              </svg>
              <p className="text-sm font-medium text-gray-700">Zoho data still syncing</p>
              <p className="text-[12px] text-gray-500 text-center">
                The Zoho integration is warming its cache. Check back shortly.
              </p>
            </div>
          )}

          {!loading && !error && !warming && !zoho && (
            <div className="flex flex-col items-center justify-center py-20 gap-2 px-4">
              <p className="text-sm font-medium text-gray-700">No Zoho record found for code {code}</p>
              <p className="text-[12px] text-gray-500 text-center">
                This patient exists in Unity but does not have a matching record in Zoho Creator.
              </p>
            </div>
          )}

          {!loading && !error && !warming && zoho && (
            <div className="divide-y divide-gray-100">
              {/* Family & Contact */}
              <section className="px-4 sm:px-6 py-4">
                <SectionTitle>Family &amp; Contact</SectionTitle>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Father" value={zoho.fatherName} />
                  <Field label="Mother" value={zoho.motherName} />
                  <Field label="Phone" value={zoho.phone} mono />
                  <Field label="Email" value={zoho.email} />
                </div>
                {zoho.address && (
                  <div className="mt-3">
                    <Field label="Address" value={zoho.address} />
                  </div>
                )}
              </section>

              {/* Registration */}
              <section className="px-4 sm:px-6 py-4">
                <SectionTitle>Registration</SectionTitle>
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field label="Registration date" value={formatDate(zoho.registrationDate)} />
                  <Field label="Child UIN" value={zoho.childUin} mono />
                  <Field label="Centre (Zoho)" value={zoho.centreName} />
                  <Field label="Centre admin" value={zoho.centreAdmin} />
                </div>
              </section>

              {/* Unity */}
              {unity && (
                <section className="px-4 sm:px-6 py-4">
                  <SectionTitle>Unity</SectionTitle>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <Field label="Name" value={`${unity.FirstName} ${unity.LastName}`} />
                    <Field label="Status" value={unity.Status} />
                    <Field label="Centre (Unity)" value={unity.CentreName} />
                    <Field label="DOB" value={formatDate(unity.DateOfBirth)} />
                  </div>
                  {mismatch && (
                    <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                      <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      <p className="text-[13px] text-amber-800">
                        Centre name differs: Zoho &ldquo;{abbreviateCentre(zoho.centreName)}&rdquo; vs Unity &ldquo;{abbreviateCentre(unity.CentreName)}&rdquo;
                      </p>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* Full Journey — collapsible timeline section */}
          {(zoho || (data && !loading && !error && !warming)) && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => setJourneyOpen(!journeyOpen)}
                className="w-full px-4 sm:px-6 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
                    Full Journey
                  </p>
                  {journeyData && (
                    <p className="text-[12px] text-gray-500 mt-0.5">
                      {journeyData.timeline.length} event{journeyData.timeline.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${journeyOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {journeyOpen && (
                <div className="px-4 sm:px-6 pb-5">
                  {journeyLoading && (
                    <div className="py-6 animate-pulse text-[12px] text-gray-400 text-center">
                      Loading journey…
                    </div>
                  )}

                  {journeyWarming && (
                    <div className="py-4 text-center text-[13px] text-amber-700 bg-amber-50 rounded-lg px-3 py-3">
                      Zoho data still syncing — journey timeline will appear shortly.
                    </div>
                  )}

                  {journeyError && (
                    <div className="py-4 text-center text-[12px] text-gray-500">
                      Unable to load journey timeline.
                    </div>
                  )}

                  {!journeyLoading && !journeyError && !journeyWarming && journeyData && (
                    <PatientJourneyTimeline timeline={journeyData.timeline} />
                  )}

                  {!journeyLoading && !journeyError && !journeyWarming && !journeyData && (
                    <p className="text-[12px] text-gray-400 text-center py-4">
                      No journey data available.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
