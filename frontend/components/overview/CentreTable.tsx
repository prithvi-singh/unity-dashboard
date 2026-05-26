'use client';

import { useState } from 'react';
import type { OverviewData, CentreBreakdown } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  data: OverviewData | null;
  loading: boolean;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: ColKey; dir: SortDir }
type ColKey = 'centreName' | 'cases' | 'assessments' | 'reportsDrafted' | 'reportsApproved';

const COLS: { col: ColKey; label: string; tip: string; align: 'left' | 'right'; defaultDir: SortDir; isText?: boolean }[] = [
  { col: 'centreName',     label: 'Centre',            tip: '',                                                              align: 'left',  defaultDir: 'asc',  isText: true },
  { col: 'cases',          label: 'Cases',             tip: 'New children registered in the period',                        align: 'right', defaultDir: 'desc' },
  { col: 'assessments',    label: 'Assessments',       tip: 'Assessments assigned in the period',                           align: 'right', defaultDir: 'desc' },
  { col: 'reportsDrafted', label: 'Reports Drafted',   tip: 'ReportAdded events logged for this centre in the period',      align: 'right', defaultDir: 'desc' },
  { col: 'reportsApproved',label: 'Reports Approved',  tip: 'ReportPDFGenerated events logged for this centre in the period', align: 'right', defaultDir: 'desc' },
];

function getVal(row: CentreBreakdown, col: ColKey): number | string {
  switch (col) {
    case 'centreName':      return row.centreName ?? '';
    case 'cases':           return row.cases;
    case 'assessments':     return row.assessments;
    case 'reportsDrafted':  return row.reportsDrafted;
    case 'reportsApproved': return row.reportsApproved;
    default:                return 0;
  }
}

function applySort(rows: CentreBreakdown[], { col, dir }: SortState): CentreBreakdown[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string')
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });
}

const COL_COUNT = COLS.length + 1; // + row number column

export default function CentreTable({ data, loading }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'reportsDrafted', dir: 'desc' });

  const handleSort = (col: ColKey, def: SortDir) =>
    setSort((prev) => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: def });

  const rows = data ? applySort(data.byCentre, sort) : [];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Centre Breakdown</h2>
          <p className="text-xs text-gray-400 mt-0.5">Activity per centre in the selected period</p>
        </div>
        {data && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {data.byCentre.length} centres
          </span>
        )}
      </div>

      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm min-w-[480px]" role="table" aria-label="Centre breakdown">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] w-6">#</th>
              {COLS.map(({ col, label, tip, align, defaultDir }) => (
                <th
                  key={col}
                  title={tip || undefined}
                  className={`px-4 py-3 text-${align} text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] cursor-pointer select-none hover:text-gray-700 transition-colors whitespace-nowrap`}
                  onClick={() => handleSort(col, defaultDir)}
                  aria-sort={sort.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <span className={`text-[9px] ${sort.col === col ? 'text-gray-600' : 'text-gray-300'}`}>
                      {sort.col === col ? (sort.dir === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse border-b border-gray-50">
                  {Array.from({ length: COL_COUNT }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-gray-100 rounded" style={{ width: j === 1 ? 140 : 56 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="px-6 py-10 text-center text-gray-400 text-sm">No centre data</td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr
                  key={row.centreId}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <span className="text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</span>
                  </td>
                  <td className="px-4 py-3.5 font-medium text-gray-800 max-w-[200px] truncate" title={row.centreName}>
                    {shortCentreName(row.centreName)}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-gray-700 font-medium">
                    {row.cases > 0 ? row.cases : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-gray-700 font-medium">
                    {row.assessments > 0 ? row.assessments : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-gray-700 font-medium">
                    {row.reportsDrafted > 0 ? row.reportsDrafted : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-gray-700 font-medium">
                    {row.reportsApproved > 0 ? row.reportsApproved : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
