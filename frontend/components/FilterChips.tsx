'use client';

import type { Centre } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import { formatPeriodLabel } from '@/lib/datePresets';

interface Props {
  centres: Centre[];
  centreId: number | undefined;
  dateFrom: string;
  dateTo: string;
  onClearCentre: () => void;
  onClearDates: () => void;
  onClearAll: () => void;
  hidePeriod?: boolean;
}

export default function FilterChips({
  centres,
  centreId,
  dateFrom,
  dateTo,
  onClearCentre,
  onClearDates,
  onClearAll,
  hidePeriod = false,
}: Props) {
  const centre = centreId ? centres.find((c) => c.id === centreId) : null;
  const hasCentre = centreId != null;
  const hasDates = !!(dateFrom || dateTo) && !hidePeriod;
  const hasAny = hasCentre || hasDates;

  if (!hasAny) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mr-0.5">Filters</span>
      {hasCentre && centre && (
        <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-white border border-gray-200 text-xs text-gray-700 shadow-sm">
          <span className="text-gray-400">Centre</span>
          <span className="font-semibold truncate max-w-[160px]" title={centre.name}>
            {shortCentreName(centre.name)}
          </span>
          <button
            type="button"
            onClick={onClearCentre}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="Clear centre filter"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      )}
      {hasDates && (
        <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-lg bg-white border border-gray-200 text-xs text-gray-700 shadow-sm">
          <span className="text-gray-400">Period</span>
          <span className="font-semibold">{formatPeriodLabel(dateFrom, dateTo)}</span>
          <button
            type="button"
            onClick={onClearDates}
            className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="Clear date filter"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      )}
      {(hasCentre && hasDates) && (
        <button
          type="button"
          onClick={onClearAll}
            className="text-xs font-semibold text-blue-600 hover:underline px-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
