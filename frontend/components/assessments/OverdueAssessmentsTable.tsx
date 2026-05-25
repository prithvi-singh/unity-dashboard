'use client';

import { useState, useMemo } from 'react';
import type { AssessmentOverviewData, SlowAssessment } from '@/lib/types';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import ScrollRegion from '@/components/shared/ScrollRegion';

const OVERDUE_TOOLTIP = {
  title: 'Overdue',
  description: 'No result 14+ days after assignment. Clinician owns completion; manager escalates at 21d.',
};

const DAYS_TOOLTIP = {
  title: 'Days Pending',
  description: 'Days since assignment. 14–21d: nudge. 21d+: escalate or reassign.',
};

interface Props {
  data: AssessmentOverviewData | null;
  loading: boolean;
}

const TYPE_BADGE: Record<string, string> = {
  SPM:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60',
  DP3:   'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60',
  REELS: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100/60',
  ISAA:  'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DaysBadge({ days }: { days: number }) {
  if (days > 21) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-600 text-white">
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01" />
        </svg>
        {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
      {days}d
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100">
      {[120, 80, 140, 140, 70, 100].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-3 bg-gray-100 rounded animate-pulse`} style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

type SortKey = 'patientName' | 'assessmentType' | 'clinicianName' | 'centreName' | 'daysPending' | 'assignedDate';

export default function OverdueAssessmentsTable({ data, loading }: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('daysPending');
  const [sortAsc, setSortAsc] = useState(false);

  const rows: SlowAssessment[] = useMemo(() => {
    if (!data?.slowAssessments) return [];
    let list = [...data.slowAssessments];

    if (typeFilter !== 'all') {
      list = list.filter((r) => r.assessmentType === typeFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.patientName.toLowerCase().includes(q) ||
          r.clinicianName.toLowerCase().includes(q) ||
          r.centreName.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av;
      }
      const as = String(av ?? '');
      const bs = String(bv ?? '');
      return sortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, search, typeFilter, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(key !== 'daysPending'); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return <svg className="w-3 h-3 text-gray-300 ml-0.5 inline" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M8 3v10M5 6l3-3 3 3M5 10l3 3 3-3" /></svg>;
    }
    return <svg className={`w-3 h-3 ml-0.5 inline text-blue-500 ${sortAsc ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M8 12V4M5 7l3-3 3 3" /></svg>;
  }

  const criticalCount = data?.slowAssessments.filter((r) => r.daysPending > 21).length ?? 0;
  const overdueCount = data?.slowAssessments.length ?? 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Overdue Assessments</h2>
                <KpiTooltip {...OVERDUE_TOOLTIP} />
                {overdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="4" />
                    </svg>
                    {overdueCount} overdue
                  </span>
                )}
                {criticalCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-600 text-white">
                    {criticalCount} critical (&gt;21d)
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                14+ days, no result · <span className="text-amber-600 font-medium">14–21d: nudge</span> · <span className="text-rose-600 font-medium">&gt;21d: escalate</span>
                <span className="ml-2 text-gray-300">·</span>
                <span className="ml-2 italic">All-time — not limited to the selected date range</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Type filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700"
              aria-label="Filter by assessment type"
            >
              <option value="all">All types</option>
              <option value="SPM">SPM</option>
              <option value="DP3">DP3</option>
              <option value="REELS">REELS</option>
              <option value="ISAA">ISAA</option>
            </select>

            {/* Search */}
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                placeholder="Patient, clinician, centre…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48"
              />
            </div>
          </div>
        </div>
      </div>

      <ScrollRegion maxHeightClass="max-h-[560px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Overdue assessments list">
          <thead className="sticky top-0 z-10 bg-gray-50">
            <tr>
              {(
                [
                  ['patientName', 'Patient'],
                  ['assessmentType', 'Type'],
                  ['clinicianName', 'Clinician'],
                  ['centreName', 'Centre'],
                  ['daysPending', 'Days Pending'],
                  ['assignedDate', 'Assigned Date'],
                ] as [SortKey, string][]
              ).map(([key, label]) => (
                <th
                  key={key}
                  scope="col"
                  className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                  onClick={() => handleSort(key)}
                >
                  <span className="inline-flex items-center gap-0.5">
                    {label} <SortIcon col={key} />
                    {key === 'daysPending' && <KpiTooltip {...DAYS_TOOLTIP} />}
                    {key === 'clinicianName' && (
                      <KpiTooltip
                        title="Clinician (responsible)"
                        description="Assigned clinician. Must generate the result."
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data
              ? Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              : rows.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    {overdueCount === 0 ? (
                      <div className="flex flex-col items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                        <p className="text-sm font-medium text-gray-700">No overdue assessments</p>
                        <p className="text-xs text-gray-400">All assessments are within the 14-day window</p>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">No results match your filters</p>
                    )}
                  </td>
                </tr>
              )
              : rows.map((row) => {
                const isCritical = row.daysPending > 21;
                return (
                  <tr
                    key={row.allocatePatientId}
                    className={[
                      'border-t transition-colors',
                      isCritical
                        ? 'border-rose-200 bg-rose-50/40 hover:bg-rose-50/70'
                        : 'border-gray-100 hover:bg-gray-50/70',
                    ].join(' ')}
                  >
                    <td className="px-4 py-3 max-w-[11rem]">
                      <p className={`font-medium text-sm truncate ${isCritical ? 'text-rose-800' : 'text-gray-800'}`} title={row.patientName}>
                        {row.patientName}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${TYPE_BADGE[row.assessmentType] ?? 'bg-gray-100 text-gray-700'}`}>
                        {row.assessmentType}
                      </span>
                    </td>
                    <td className={`px-4 py-3 font-medium whitespace-nowrap ${isCritical ? 'text-rose-800' : 'text-gray-800'}`}>
                      {row.clinicianName}
                    </td>
                    <td className={`px-4 py-3 text-sm whitespace-nowrap max-w-[180px] truncate ${isCritical ? 'text-rose-700' : 'text-gray-600'}`}>
                      {row.centreName}
                    </td>
                    <td className="px-4 py-3">
                      <DaysBadge days={row.daysPending} />
                      {isCritical && (
                        <span className="ml-1.5 text-[10px] font-semibold text-rose-600">Critical</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-xs tabular-nums ${isCritical ? 'text-rose-700' : 'text-gray-500'}`}>
                      {formatDate(row.assignedDate)}
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </ScrollRegion>

      {rows.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center gap-4 text-[10px] text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-8 h-4 rounded bg-rose-50 border border-rose-200" />
            <span className="text-rose-700 font-semibold">&gt;21 days — Critical</span> · Manager: follow up or reassign
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-8 h-4 rounded bg-white border border-gray-100" />
            14–21 days · Manager: prompt clinician to complete
          </span>
          <span className="ml-auto text-gray-400">Showing {rows.length} of {overdueCount}</span>
        </div>
      )}
    </div>
  );
}
