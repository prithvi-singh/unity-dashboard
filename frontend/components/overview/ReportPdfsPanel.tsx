'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FilterParams, ReportPdfCentre, ReportPdfRecord } from '@/lib/types';
import { fetchReportPdfs } from '@/lib/api';

interface Props {
  open: boolean;
  filters: FilterParams;
  totalReports: number;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const BADGE: Record<string, string> = {
  SPM:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  DP3:   'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  REELS: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  ISAA:  'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
};
function badgeCls(type: string) {
  return BADGE[(type || '').toUpperCase()] ?? 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';
}

// ── Record row ────────────────────────────────────────────────────────────────

function RecordRow({ record, variant }: { record: ReportPdfRecord; variant: 'pdf' | 'draft' }) {
  return (
    <div className="py-2.5 border-b border-gray-100 last:border-0">
      {/* Case name + assessment badge + date */}
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-gray-900">
          {record.patientName || `Case #${record.patientId}`}
        </span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ring-inset flex-shrink-0 ${badgeCls(record.assessmentType)}`}>
          {record.assessmentType}
        </span>
        <span className="text-[11px] text-gray-400 ml-auto hidden sm:block">{fmtDate(record.eventAt)}</span>
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Performed by</span>
          <span className="font-medium text-gray-700">{record.clinicianName || '—'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
            {variant === 'pdf' ? 'PDF by' : 'Draft by'}
          </span>
          <span className="font-medium text-gray-700">{record.actorName || '—'}</span>
        </span>
      </div>
    </div>
  );
}

// ── Centre card (collapsible) ─────────────────────────────────────────────────

function CentreCard({ centre, defaultOpen }: { centre: ReportPdfCentre; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pdfCount   = centre.pdfs.length;
  const draftCount = centre.drafts.length;

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-6 py-3.5 text-left hover:bg-gray-50/70 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-medium text-sm text-gray-900 truncate">{centre.centreName}</span>

          {pdfCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4" />
              </svg>
              {pdfCount} PDF{pdfCount !== 1 ? 's' : ''}
            </span>
          )}

          {draftCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 ring-1 ring-amber-200 flex-shrink-0">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {draftCount} draft{draftCount !== 1 ? 's' : ''} pending
            </span>
          )}
        </div>

        <svg
          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-6 pb-3 bg-gray-50/40">
          {/* PDFs section */}
          {pdfCount > 0 && (
            <div className="mb-3">
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-[0.1em] pt-2 pb-1">
                PDFs Created
              </p>
              {centre.pdfs.map((r) => (
                <RecordRow key={`pdf-${r.allocatePatientId}-${r.eventAt}`} record={r} variant="pdf" />
              ))}
            </div>
          )}

          {/* Drafts section */}
          {draftCount > 0 && (
            <div>
              <div className="flex items-center gap-2 pt-2 pb-1">
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-[0.1em]">
                  Drafts — Awaiting Manager Approval
                </p>
              </div>
              {centre.drafts.map((r) => (
                <RecordRow key={`draft-${r.allocatePatientId}-${r.eventAt}`} record={r} variant="draft" />
              ))}
            </div>
          )}

          {pdfCount === 0 && draftCount === 0 && (
            <p className="text-xs text-gray-400 py-2">No records.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ReportPdfsPanel({ open, filters, totalReports, onClose }: Props) {
  const [data, setData]       = useState<ReportPdfCentre[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetchReportPdfs(filters)
      .then(setData)
      .catch((err) => setError(err.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) { setSearch(''); setData([]); setError(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);

  const totalDrafts = useMemo(() => data.reduce((s, c) => s + c.drafts.length, 0), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((c) => {
        const centreMatch = c.centreName.toLowerCase().includes(q);
        const matchRecord = (r: ReportPdfRecord) =>
          (r.patientName ?? '').toLowerCase().includes(q) ||
          (r.clinicianName ?? '').toLowerCase().includes(q) ||
          (r.actorName ?? '').toLowerCase().includes(q) ||
          r.assessmentType.toLowerCase().includes(q);
        const matchedPdfs   = c.pdfs.filter(matchRecord);
        const matchedDrafts = c.drafts.filter(matchRecord);
        if (centreMatch) return c;
        if (matchedPdfs.length > 0 || matchedDrafts.length > 0) {
          return { ...c, pdfs: matchedPdfs, drafts: matchedDrafts };
        }
        return null;
      })
      .filter(Boolean) as ReportPdfCentre[];
  }, [data, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close panel"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-pdfs-title"
        className="relative w-full sm:max-w-2xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em] mb-1">Drill-down</p>
            <h2 id="report-pdfs-title" className="text-base font-semibold text-gray-900">
              Report PDFs Created
            </h2>

            {!loading && !error && (
              <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                <span className="text-xs font-semibold text-emerald-700">
                  {totalReports.toLocaleString()} PDFs
                </span>

                {totalDrafts > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      {totalDrafts} draft{totalDrafts !== 1 ? 's' : ''} pending approval
                    </span>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-500 italic">Manager action required</span>
                  </>
                )}

                {data.length > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="text-xs text-gray-500">
                      {data.length} centre{data.length !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
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

        {/* Search */}
        {!loading && !error && data.length > 0 && (
          <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex-shrink-0">
            <label className="sr-only" htmlFor="report-pdfs-search">Search</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
              <input
                id="report-pdfs-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search centre, clinician, assessment type…"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300"
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-400">Loading report details…</p>
            </div>
          )}

          {error && (
            <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
              <p className="text-sm font-medium text-gray-700">
                {data.length === 0 ? 'No reports in this period' : 'No results match your search'}
              </p>
              <p className="text-xs text-gray-400">
                {data.length === 0 ? 'Try adjusting the date range or centre filter.' : 'Try a different search term.'}
              </p>
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <div>
              {filtered.map((centre, i) => (
                <CentreCard key={centre.centreId} centre={centre} defaultOpen={i === 0} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
