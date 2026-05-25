'use client';

import { useState, useMemo } from 'react';
import type { AssessmentOverviewData, AssessmentByClinician } from '@/lib/types';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import ScrollRegion from '@/components/shared/ScrollRegion';

const MATRIX_TOOLTIP = {
  title: 'Assigned / Completed',
  description: 'Assigned vs results for this clinician. Grey = none. Red = low completion.',
};

const TYPE_TOOLTIPS: Record<string, { title: string; description: string }> = {
  SPM:   { title: 'SPM', description: 'Assigned and completed by this clinician.' },
  DP3:   { title: 'DP3', description: 'Assigned and completed by this clinician.' },
  REELS: { title: 'REELS', description: 'Assigned and completed by this clinician.' },
  ISAA:  { title: 'ISAA', description: 'Assigned and completed by this clinician.' },
};

interface Props {
  data: AssessmentOverviewData | null;
  loading: boolean;
}

const TYPES = ['SPM', 'DP3', 'REELS', 'ISAA'] as const;

type AssessmentKey = typeof TYPES[number];

function cellStyle(assigned: number, completed: number): { bg: string; text: string; title: string } {
  if (assigned === 0) {
    return { bg: 'bg-gray-50', text: 'text-gray-300', title: 'No assignments' };
  }
  const rate = completed / assigned;
  if (rate >= 0.8) {
    return { bg: 'bg-emerald-50', text: 'text-emerald-700', title: `${Math.round(rate * 100)}% completion` };
  }
  if (rate >= 0.5) {
    return { bg: 'bg-amber-50', text: 'text-amber-700', title: `${Math.round(rate * 100)}% completion` };
  }
  return { bg: 'bg-rose-50', text: 'text-rose-700', title: `${Math.round(rate * 100)}% completion — action needed` };
}

function Cell({ assigned, completed }: { assigned: number; completed: number }) {
  const s = cellStyle(assigned, completed);
  return (
    <td
      className={`px-3 py-2.5 text-center ${s.bg}`}
      title={s.title}
      aria-label={s.title}
    >
      {assigned === 0 ? (
        <span className="text-xs text-gray-300">—</span>
      ) : (
        <span className={`text-xs font-semibold tabular-nums ${s.text}`}>
          {assigned}/{completed}
        </span>
      )}
    </td>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-2.5"><div className="h-3 w-28 bg-gray-100 rounded animate-pulse" /></td>
      <td className="px-3 py-2.5"><div className="h-3 w-16 bg-gray-100 rounded animate-pulse" /></td>
      {TYPES.map((t) => (
        <td key={t} className="px-3 py-2.5"><div className="h-3 w-10 bg-gray-100 rounded animate-pulse mx-auto" /></td>
      ))}
    </tr>
  );
}

export default function AssessmentClinicianMatrix({ data, loading }: Props) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | AssessmentKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const clinicians = useMemo(() => {
    if (!data?.byClinician) return [];
    let list = data.byClinician;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          (c.centreName ?? '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
        return sortAsc ? cmp : -cmp;
      }
      const aVal = a[sortKey].assigned;
      const bVal = b[sortKey].assigned;
      return sortAsc ? aVal - bVal : bVal - aVal;
    });
  }, [data, search, sortKey, sortAsc]);

  function handleSort(key: 'name' | AssessmentKey) {
    if (key === sortKey) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(key === 'name'); }
  }

  function SortIcon({ col }: { col: 'name' | AssessmentKey }) {
    if (sortKey !== col) {
      return <svg className="w-3 h-3 text-gray-300 ml-0.5 inline" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 3v10M5 6l3-3 3 3M5 10l3 3 3-3" /></svg>;
    }
    return <svg className={`w-3 h-3 ml-0.5 inline ${sortAsc ? '' : 'rotate-180'} text-blue-500`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M8 12V4M5 7l3-3 3 3" /></svg>;
  }

  const totalClinicians = data?.byClinician.length ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-semibold text-gray-900">Clinician Matrix</h2>
            <KpiTooltip {...MATRIX_TOOLTIP} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {totalClinicians} clinician{totalClinicians !== 1 ? 's' : ''} · grey = none · red = low completion
          </p>
        </div>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            placeholder="Search clinicians…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-44"
          />
        </div>
      </div>

      <ScrollRegion maxHeightClass="max-h-[520px]" label="matrix">
        <table className="w-full text-sm" role="table" aria-label="Clinician assessment matrix">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                onClick={() => handleSort('name')}
              >
                Clinician <SortIcon col="name" />
              </th>
              <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Centre
              </th>
              {TYPES.map((t) => (
                <th
                  key={t}
                  scope="col"
                  className="px-3 py-2.5 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                  onClick={() => handleSort(t)}
                >
                  <span className="inline-flex items-center gap-0.5 justify-center">
                    {t} <SortIcon col={t} />
                    <KpiTooltip {...TYPE_TOOLTIPS[t]} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              : clinicians.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                    {search ? 'No clinicians match the search' : 'No clinician data available'}
                  </td>
                </tr>
              )
              : clinicians.map((c) => (
                <tr key={c.clinicianId} className="border-t border-gray-100 hover:bg-gray-50/70 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap max-w-[160px] truncate">
                    {c.centreName ?? '—'}
                  </td>
                  {TYPES.map((t) => (
                    <Cell key={t} assigned={c[t].assigned} completed={c[t].completed} />
                  ))}
                </tr>
              ))
            }
          </tbody>
        </table>
      </ScrollRegion>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-4 rounded bg-emerald-50 border border-emerald-100" />
          <span className="text-emerald-700 font-semibold">≥80%</span> — on track
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-4 rounded bg-amber-50 border border-amber-100" />
          <span className="text-amber-700 font-semibold">50–80%</span> — clinician to progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-4 rounded bg-rose-50 border border-rose-100" />
          <span className="text-rose-700 font-semibold">&lt;50%</span> — manager should follow up
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-8 h-4 rounded bg-gray-50 border border-gray-100" />
          <span className="text-gray-400">—</span> no assignments · possible capability gap
        </span>
        <span className="ml-auto text-gray-400 italic">Format: assigned / completed</span>
      </div>
    </div>
  );
}
