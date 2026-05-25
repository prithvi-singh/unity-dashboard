'use client';

import { useState } from 'react';
import type { AssessmentOverviewData, AssessmentTypeBlock } from '@/lib/types';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import ScrollRegion from '@/components/shared/ScrollRegion';

const COL_TOOLTIPS: Record<string, { title: string; description: string }> = {
  SPM: {
    title: 'SPM',
    description: 'Completion % at this centre. Bracket = total assigned.',
  },
  DP3: {
    title: 'DP3',
    description: 'Completion % at this centre. Bracket = total assigned.',
  },
  REELS: {
    title: 'REELS',
    description: 'Completion % at this centre. Bracket = total assigned.',
  },
  ISAA: {
    title: 'ISAA',
    description: 'Completion % at this centre. Bracket = total assigned.',
  },
};

interface Props {
  data: AssessmentOverviewData | null;
  loading: boolean;
}

const TYPES = ['SPM', 'DP3', 'REELS', 'ISAA'] as const;

function rateDot(rate: number) {
  if (rate === 0) return { color: 'bg-gray-300', label: 'No data' };
  if (rate >= 80) return { color: 'bg-emerald-500', label: 'Good' };
  if (rate >= 50) return { color: 'bg-amber-400', label: 'Moderate' };
  return { color: 'bg-rose-500', label: 'Low' };
}

function rateText(rate: number, total: number) {
  if (total === 0) return { cls: 'text-gray-400', text: '—' };
  if (rate >= 80) return { cls: 'text-emerald-700 font-semibold', text: `${rate.toFixed(0)}%` };
  if (rate >= 50) return { cls: 'text-amber-700 font-semibold', text: `${rate.toFixed(0)}%` };
  return { cls: 'text-rose-700 font-semibold', text: `${rate.toFixed(0)}%` };
}

function TypeCell({ block }: { block: AssessmentTypeBlock }) {
  const dot = rateDot(block.total === 0 ? 0 : block.completionRate);
  const txt = rateText(block.completionRate, block.total);

  return (
    <td className="px-4 py-3 text-center whitespace-nowrap">
      <div className="inline-flex items-center gap-1.5 justify-center">
        <span
          className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${dot.color}`}
          title={dot.label}
          aria-label={dot.label}
        />
        <span className={`text-sm tabular-nums ${txt.cls}`}>{txt.text}</span>
        {block.total > 0 && (
          <span className="text-[10px] text-gray-400 tabular-nums">({block.total})</span>
        )}
      </div>
    </td>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3"><div className="h-3 w-32 bg-gray-100 rounded animate-pulse" /></td>
      {TYPES.map((t) => (
        <td key={t} className="px-4 py-3 text-center">
          <div className="h-3 w-12 bg-gray-100 rounded animate-pulse mx-auto" />
        </td>
      ))}
    </tr>
  );
}

type SortKey = typeof TYPES[number] | 'centreName';

export default function AssessmentByCentreTable({ data, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('centreName');
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(key === 'centreName');
    }
  }

  const rows = data?.byCentre ?? [];

  const sorted = [...rows].sort((a, b) => {
    let aVal: number, bVal: number;
    if (sortKey === 'centreName') {
      return sortAsc
        ? a.centreName.localeCompare(b.centreName)
        : b.centreName.localeCompare(a.centreName);
    }
    aVal = a[sortKey].completionRate;
    bVal = b[sortKey].completionRate;
    return sortAsc ? aVal - bVal : bVal - aVal;
  });

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return (
        <svg className="w-3 h-3 text-gray-300 ml-0.5 inline" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" d="M8 3v10M5 6l3-3 3 3M5 10l3 3 3-3" />
        </svg>
      );
    }
    return (
      <svg className={`w-3 h-3 ml-0.5 inline ${sortAsc ? 'text-blue-500' : 'text-blue-500 rotate-180'}`} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" d="M8 12V4M5 7l3-3 3 3" />
      </svg>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">By Centre</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Completion % per type. <span className="text-emerald-600 font-medium">≥80%</span> · <span className="text-amber-600 font-medium">50–80%</span> · <span className="text-rose-600 font-medium">&lt;50%</span>
        </p>
      </div>

      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Assessment completion by centre">
          <thead>
            <tr className="bg-gray-50">
              <th
                scope="col"
                className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                onClick={() => handleSort('centreName')}
              >
                Centre <SortIcon col="centreName" />
              </th>
              {TYPES.map((t) => (
                <th
                  key={t}
                  scope="col"
                  className="px-4 py-2.5 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700"
                  onClick={() => handleSort(t)}
                >
                  <span className="inline-flex items-center gap-0.5 justify-center">
                    {t} <SortIcon col={t} />
                    <KpiTooltip {...COL_TOOLTIPS[t]} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !data
              ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              : sorted.length === 0
              ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                    No centre data available for the selected filters
                  </td>
                </tr>
              )
              : sorted.map((centre) => (
                <tr key={centre.centreId} className="border-t border-gray-100 hover:bg-gray-50/70 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap max-w-[220px] truncate">
                    {centre.centreName}
                  </td>
                  <TypeCell block={centre.SPM} />
                  <TypeCell block={centre.DP3} />
                  <TypeCell block={centre.REELS} />
                  <TypeCell block={centre.ISAA} />
                </tr>
              ))
            }
          </tbody>
        </table>
      </ScrollRegion>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ≥80% — on track</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 50–80% — monitor</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> &lt;50% — action needed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> no assignments</span>
        <span className="ml-auto text-gray-400">Count shown in brackets</span>
      </div>
    </div>
  );
}
