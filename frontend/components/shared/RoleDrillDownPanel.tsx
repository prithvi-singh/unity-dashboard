'use client';

import { useRef } from 'react';
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

export default function RoleDrillDownPanel({ request, filters, centres, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useRoleDrillDown(request, filters);
  const isUserList = request?.type === 'clinician-inactive';
  const open = !!request;

  useSlideOverPanel(open, onClose, panelRef);

  if (!request) return null;

  const title = request.label ?? data?.title ?? 'Loading…';
  const scope = filterScopeLabel(centres, filters.centreId, filters.dateFrom ?? '', filters.dateTo ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close drill-down panel"
        onClick={onClose}
      />

      {/* Panel — full-screen slide-up on mobile, side panel on desktop */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-drilldown-title"
        className="relative w-full sm:max-w-3xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">Drill-down</p>
            <h2 id="role-drilldown-title" className="text-base font-semibold text-gray-900">
              {title}
            </h2>
            <p className="text-xs text-gray-500 mt-1">{scope}</p>
            {data && (
              <p className="text-[12px] text-gray-500 mt-0.5">
                {data.count} record{data.count !== 1 ? 's' : ''}
                {data.truncated ? ' · showing first 500' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {data && data.items.length > 0 && (
              <ExportExcelButton
                count={data.items.length}
                onClick={() => exportDrillDownToExcel(title, data.items, { isUserList })}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

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
            <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
              <div className="h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="sr-only">Loading drill-down records</span>
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
              <p className="text-sm font-medium text-gray-700">Nothing to show</p>
              <p className="text-[12px] text-gray-500">No matching records for the current filters.</p>
            </div>
          )}

          {!loading && data && data.items.length > 0 && (
            <div className="overflow-x-auto">
              <DrillDownTable items={data.items} isUserList={isUserList} showUnityLinks={!isUserList} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
