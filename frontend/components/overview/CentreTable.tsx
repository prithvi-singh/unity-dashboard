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
type ColKey = 'centreName' | 'cases' | 'assessments' | 'completion';

const COLS: { col: ColKey; label: string; tip: string; align: 'left' | 'right'; defaultDir: SortDir; isText?: boolean }[] = [
  { col: 'centreName',  label: 'Centre',      tip: '',                                        align: 'left',  defaultDir: 'asc',  isText: true },
  { col: 'cases',       label: 'Cases',       tip: 'New children registered in the period',   align: 'right', defaultDir: 'desc' },
  { col: 'assessments', label: 'Assessments', tip: 'Assessments assigned in the period',      align: 'right', defaultDir: 'desc' },
  { col: 'completion',  label: 'PDF rate',    tip: 'Report PDFs generated ÷ assessments assigned. Can exceed 100% when backlog from prior periods is cleared.', align: 'right', defaultDir: 'desc' },
];

function reportPdf(row: CentreBreakdown): number {
  return row.reportPdfCreated ?? row.results ?? 0;
}

function getVal(row: CentreBreakdown, col: ColKey): number | string {
  switch (col) {
    case 'centreName':  return row.centreName ?? '';
    case 'cases':       return row.cases;
    case 'assessments': return row.assessments;
    case 'completion':  return row.assessments > 0 ? reportPdf(row) / row.assessments : -1;
    default:            return 0;
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

function pdfRate(row: CentreBreakdown): number {
  return row.assessments === 0 ? 0 : (reportPdf(row) / row.assessments) * 100;
}

function pdfLabel(row: CentreBreakdown): string {
  if (row.assessments === 0) return '—';
  const r = pdfRate(row);
  return r > 100 ? '>100%' : `${r.toFixed(0)}%`;
}

function StatusPill({ row }: { row: CentreBreakdown }) {
  const active = row.cases + row.assessments + reportPdf(row) > 0;
  if (!active)
    return <span className="text-[10px] font-semibold text-gray-300 bg-gray-50 px-2 py-0.5 rounded-full">Idle</span>;

  const rate = pdfRate(row);
  if (rate >= 75)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Healthy
      </span>
    );
  if (rate >= 40)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />In progress
      </span>
    );
  if (rate > 0)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Low
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />No PDFs yet
    </span>
  );
}

const COL_COUNT = COLS.length + 1; // + Status

export default function CentreTable({ data, loading }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'assessments', dir: 'desc' });

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
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Status</th>
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
              rows.map((row, idx) => {
                const rate = pdfRate(row);
                const isActive = row.cases + row.assessments + reportPdf(row) > 0;
                return (
                  <tr
                    key={row.centreId}
                    className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors ${!isActive ? 'opacity-40' : ''}`}
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
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col items-end gap-1">
                        <span className={`tabular-nums text-sm font-semibold ${rate > 100 ? 'text-teal-600' : rate >= 75 ? 'text-emerald-600' : rate >= 40 ? 'text-amber-600' : rate > 0 ? 'text-rose-500' : 'text-gray-300'}`}>
                          {pdfLabel(row)}
                        </span>
                        {row.assessments > 0 && (
                          <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${rate > 100 ? 'bg-teal-400' : rate >= 75 ? 'bg-emerald-400' : rate >= 40 ? 'bg-amber-400' : rate > 0 ? 'bg-rose-400' : 'bg-gray-200'}`}
                              style={{ width: `${Math.min(rate, 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill row={row} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
