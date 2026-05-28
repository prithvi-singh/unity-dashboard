'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DrillDownTable from '@/components/shared/DrillDownTable';
import ExportExcelButton from '@/components/shared/ExportExcelButton';
import type { RoleDrillDownRequest } from '@/lib/roleDrillDown';
import { useRoleDrillDown } from '@/hooks/useRoleDrillDown';
import { useSlideOverPanel } from '@/hooks/useSlideOverPanel';
import { exportDrillDownToExcel } from '@/lib/exportDrillDownExcel';
import { filterScopeLabel } from '@/lib/filterScopeLabel';
import type { Centre, FilterParams } from '@/lib/types';

interface Props {
  request: RoleDrillDownRequest | null;
  filters: FilterParams;
  centres: Centre[];
  onClose: () => void;
}

function extractEmail(detail: string | null): string | null {
  if (!detail) return null;
  const m = detail.match(/Email:\s*([^\s·]+)/);
  return m ? m[1] : null;
}

export default function RoleDrillDownPanel({ request, filters, centres, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useRoleDrillDown(request, filters);
  const isUserList = request?.type === 'clinician-inactive';
  const open = !!request;

  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (!open) setSearch(''); }, [open]);

  useSlideOverPanel(open, onClose, panelRef);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.items;
    return data.items.filter((item) => {
      if (item.patientName.toLowerCase().includes(q)) return true;
      if (item.centreName.toLowerCase().includes(q)) return true;
      if (isUserList) {
        const email = extractEmail(item.detail);
        if (email && email.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [data, search, isUserList]);

  const handleCopyEmails = useCallback(() => {
    if (!data) return;
    const emails = data.items
      .map((item) => extractEmail(item.detail))
      .filter((e): e is string => !!e);
    if (emails.length === 0) return;
    navigator.clipboard.writeText(emails.join(', ')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [data]);

  if (!request) return null;

  const title = request.label ?? data?.title ?? 'Loading…';
  const scope = filterScopeLabel(centres, filters.centreId, filters.dateFrom ?? '', filters.dateTo ?? '');
  const totalCount = data?.count ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close drill-down panel"
        onClick={onClose}
      />

      {/* Panel — 640px desktop, full-screen mobile */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-drilldown-title"
        className="relative w-full sm:max-w-[640px] h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col
                   rounded-t-2xl sm:rounded-none border-l border-gray-200/60"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white px-4 sm:px-6 pt-5 pb-4 border-b border-gray-200/60 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 mb-1">
              Drill-down
            </p>
            <h2 id="role-drilldown-title" className="text-[18px] font-medium text-gray-900 leading-tight truncate">
              {title}
            </h2>
            <p className="text-[13px] text-gray-500 mt-0.5 leading-snug">{scope}</p>
            {data && (
              <p className="text-[13px] text-gray-400 mt-1">
                {totalCount.toLocaleString()} record{totalCount !== 1 ? 's' : ''}
                {data.truncated ? ' · showing first 500' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {data && data.items.length > 0 && (
              <ExportExcelButton
                count={data.items.length}
                onClick={() => exportDrillDownToExcel(title, data.items, { isUserList })}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-[44px] h-[44px] flex items-center justify-center rounded-lg text-gray-400
                         hover:text-gray-600 hover:bg-gray-100 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter bar — search + showing count + copy emails (person records only) */}
        {!loading && data && data.items.length > 0 && (
          <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 flex-shrink-0">
            <div className="relative flex-1 min-w-[160px]">
              <svg
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search by name, email or centre…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <span className="text-[12px] text-gray-400 ml-auto whitespace-nowrap">
              Showing {filteredItems.length.toLocaleString()} of {totalCount.toLocaleString()}
            </span>
            {isUserList && (
              <button
                type="button"
                onClick={handleCopyEmails}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600
                           bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {copied ? 'Copied!' : 'Copy emails'}
              </button>
            )}
          </div>
        )}

        {request.type === 'clinician-inactive' && (
          <div className="px-4 sm:px-6 py-3 border-b border-gray-100 bg-gray-50/60 flex-shrink-0 space-y-3">
            {data && data.items.length > 0 && (() => {
              const totalOpen = data.items.length;
              const clinicianBand = new Map<number, number>();
              data.items.forEach((item) => {
                const days = item.waitingHours != null ? Math.round(item.waitingHours / 24) : 0;
                const prev = clinicianBand.get(item.patientId);
                if (prev === undefined || days > prev) clinicianBand.set(item.patientId, days);
              });
              const idleBands = { low: 0, mid: 0, high: 0 };
              clinicianBand.forEach((days) => {
                if (days >= 7) idleBands.high++;
                else if (days >= 2) idleBands.mid++;
                else idleBands.low++;
              });
              return (
                <div className="flex flex-wrap gap-2 sm:gap-3">
                  <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 text-center min-w-[72px] sm:min-w-[80px]">
                    <p className="text-[18px] font-bold text-gray-900 tabular-nums leading-tight">{totalOpen}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">cases at risk</p>
                  </div>
                  {idleBands.high > 0 && (
                    <div className="bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 text-center min-w-[60px] sm:min-w-[64px]">
                      <p className="text-[18px] font-bold text-rose-600 tabular-nums leading-tight">{idleBands.high}</p>
                      <p className="text-[10px] text-rose-400 mt-0.5">7+ days idle</p>
                    </div>
                  )}
                  {idleBands.mid > 0 && (
                    <div className="bg-orange-50 border border-orange-100 rounded-xl px-3 py-2 text-center min-w-[60px] sm:min-w-[64px]">
                      <p className="text-[18px] font-bold text-orange-500 tabular-nums leading-tight">{idleBands.mid}</p>
                      <p className="text-[10px] text-orange-400 mt-0.5">2–6 days idle</p>
                    </div>
                  )}
                  {idleBands.low > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-center min-w-[60px] sm:min-w-[64px]">
                      <p className="text-[18px] font-bold text-amber-500 tabular-nums leading-tight">{idleBands.low}</p>
                      <p className="text-[10px] text-amber-400 mt-0.5">missed today</p>
                    </div>
                  )}
                </div>
              );
            })()}
            <div>
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1.5">How to action</p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2.5 py-1.5 leading-snug">
                  <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" />
                  <span><span className="font-semibold">Missed today</span> — send a reminder, may still act today</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs bg-orange-50 border border-orange-200 text-orange-800 rounded-lg px-2.5 py-1.5 leading-snug">
                  <span className="h-2 w-2 rounded-full bg-orange-400 flex-shrink-0" />
                  <span><span className="font-semibold">2–6 days</span> — check in, confirm availability and blockers</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-2.5 py-1.5 leading-snug">
                  <span className="h-2 w-2 rounded-full bg-rose-500 flex-shrink-0" />
                  <span><span className="font-semibold">7+ days</span> — escalate, consider reassigning open cases</span>
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto scrollbar-thin">
          {loading && (
            <div className="px-6 py-4 space-y-2 animate-pulse" role="status" aria-live="polite">
              <span className="sr-only">Loading drill-down records</span>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-3 items-center h-[44px]">
                  <div className="h-3 bg-gray-100 rounded flex-1" />
                  <div className="h-3 bg-gray-100 rounded w-16" />
                  <div className="h-3 bg-gray-100 rounded w-20" />
                  <div className="h-3 bg-gray-100 rounded w-10" />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="m-4 sm:m-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && data && data.items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-2" role="status">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <p className="text-sm font-medium text-gray-700">No items to show</p>
              <p className="text-[12px] text-gray-500">No matching records for the current filters.</p>
            </div>
          )}

          {!loading && data && data.items.length > 0 && filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-2" role="status">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              <p className="text-sm font-medium text-gray-700">No results for &ldquo;{search}&rdquo;</p>
              <p className="text-[12px] text-gray-500">Try a different name, email or centre.</p>
            </div>
          )}

          {!loading && data && filteredItems.length > 0 && (
            <div className="overflow-x-auto">
              <DrillDownTable items={filteredItems} isUserList={isUserList} showUnityLinks={!isUserList} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
