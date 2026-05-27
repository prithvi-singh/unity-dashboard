'use client';

import { useRef } from 'react';
import DrillDownTable from '@/components/shared/DrillDownTable';
import { useBottleneckDrillDown } from '@/hooks/useBottleneckDrillDown';
import type { BottleneckDrillDownRequest } from '@/lib/bottleneckDrillDown';
import ExportExcelButton from '@/components/shared/ExportExcelButton';
import { exportDrillDownToExcel } from '@/lib/exportDrillDownExcel';
import { useSlideOverPanel } from '@/hooks/useSlideOverPanel';
import { filterScopeLabel } from '@/lib/filterScopeLabel';
import type { Centre, FilterParams } from '@/lib/types';

interface Props {
  request: BottleneckDrillDownRequest | null;
  filters: FilterParams;
  centres: Centre[];
  onClose: () => void;
}

export default function BottleneckDrillDownPanel({ request, filters, centres, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useBottleneckDrillDown(request, filters);
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
        aria-labelledby="bottleneck-drilldown-title"
        className="relative w-full sm:max-w-3xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">Drill-down</p>
            <h2 id="bottleneck-drilldown-title" className="text-base font-semibold text-gray-900 truncate">
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
                onClick={() => exportDrillDownToExcel(title, data.items)}
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
              <DrillDownTable items={data.items} showUnityLinks />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
