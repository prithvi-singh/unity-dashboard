'use client';

import { useState, useEffect } from 'react';
import ScrollRegion from '@/components/shared/ScrollRegion';
import type { BottleneckCentreBreakdown, BottleneckData } from '@/lib/types';
import type { BottleneckDrillDownType, OnBottleneckDrillDown } from '@/lib/bottleneckDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/bottleneckDrillDown';
import { shortCentreName } from '@/lib/centreNames';
import type { BottleneckActionSortCol } from '@/lib/actionNavigation';

interface Props {
  data: BottleneckData | null;
  loading: boolean;
  error?: string | null;
  onDrillDown?: OnBottleneckDrillDown;
  sortFocus?: BottleneckActionSortCol | null;
}

type SortDir = 'asc' | 'desc';
type ColKey = 'centreName' | 'stuckOnboarding' | 'pendingGoals' | 'incompleteAssessments' | 'total';
interface SortState { col: ColKey; dir: SortDir }

const COLS: { col: ColKey; label: string; align: 'left' | 'right'; defaultDir: SortDir; isText?: boolean }[] = [
  { col: 'centreName', label: 'Centre', align: 'left', defaultDir: 'asc', isText: true },
  { col: 'stuckOnboarding', label: 'Stuck >48h', align: 'right', defaultDir: 'desc' },
  { col: 'pendingGoals', label: 'Pending Goals', align: 'right', defaultDir: 'desc' },
  { col: 'incompleteAssessments', label: 'Incomplete', align: 'right', defaultDir: 'desc' },
  { col: 'total', label: 'Total', align: 'right', defaultDir: 'desc' },
];

function rowTotal(row: BottleneckCentreBreakdown): number {
  return row.stuckOnboarding + row.pendingGoals + row.incompleteAssessments;
}

function getVal(row: BottleneckCentreBreakdown, col: ColKey): number | string {
  switch (col) {
    case 'centreName': return row.centreName ?? '';
    case 'stuckOnboarding': return row.stuckOnboarding;
    case 'pendingGoals': return row.pendingGoals;
    case 'incompleteAssessments': return row.incompleteAssessments;
    case 'total': return rowTotal(row);
    default: return 0;
  }
}

function applySort(rows: BottleneckCentreBreakdown[], sort: SortState): BottleneckCentreBreakdown[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, sort.col);
    const bv = getVal(b, sort.col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sort.dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });
}

function SeverityPill({
  row,
  onDrillDown,
}: {
  row: BottleneckCentreBreakdown;
  onDrillDown?: OnBottleneckDrillDown;
}) {
  const total = rowTotal(row);
  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Clear
      </span>
    );
  }

  const isCritical = row.stuckOnboarding > 0 || total >= 5;
  const severity = isCritical ? 'critical' as const : 'watch' as const;

  const pill = isCritical ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Critical
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Watch
    </span>
  );

  if (!onDrillDown) return pill;

  return (
    <button
      type="button"
      title={DRILL_DOWN_HINT}
      onClick={() =>
        onDrillDown({
          type: 'centre-severity',
          drillCentreId: row.centreId,
          severity,
          label: `${isCritical ? 'Critical' : 'Watch'} action items · ${row.centreName}`,
        })
      }
      className="cursor-pointer hover:opacity-80 transition-opacity rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {pill}
    </button>
  );
}

function MiniBar({
  value, max, colorClass, clickable, onClick, label,
}: {
  value: number;
  max: number;
  colorClass: string;
  clickable?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const inner = (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums text-gray-700 text-sm">{value.toLocaleString()}</span>
      <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );

  if (!clickable || value <= 0) return inner;

  return (
    <button
      type="button"
      onClick={onClick}
      title={label ?? DRILL_DOWN_HINT}
      className="w-full rounded-lg px-1 py-0.5 -mx-1 hover:bg-gray-100 transition-colors cursor-pointer text-right"
    >
      {inner}
    </button>
  );
}

export default function BottleneckActionTable({ data, loading, error, onDrillDown, sortFocus }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'total', dir: 'desc' });

  useEffect(() => {
    if (!sortFocus) return;
    setSort({ col: sortFocus, dir: 'desc' });
  }, [sortFocus]);

  const handleSort = (col: ColKey, def: SortDir) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: def }
    );

  const rows = data ? applySort(data.byCentre, sort) : [];
  const maxStuck = rows.reduce((m, r) => Math.max(m, r.stuckOnboarding), 0);
  const maxGoals = rows.reduce((m, r) => Math.max(m, r.pendingGoals), 0);
  const maxIncomplete = rows.reduce((m, r) => Math.max(m, r.incompleteAssessments), 0);

  const totalActions = data
    ? data.casesStuckInOnboarding + data.pendingGoalApprovals + data.pendingAssessments
    : 0;

  const drill = (
    type: BottleneckDrillDownType,
    centre: BottleneckCentreBreakdown,
    label: string
  ) => {
    onDrillDown?.({
      type,
      drillCentreId: centre.centreId,
      label: `${label} · ${centre.centreName}`,
    });
  };

  return (
    <div
      data-focus-target="bottleneck-action-table"
      className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden"
    >
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Queue by Centre</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {totalActions > 0
              ? `${totalActions} open · click to drill in`
              : 'Nothing blocked'}
          </p>
        </div>
        {data && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full flex-shrink-0">
            {data.byCentre.length} centres
          </span>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Failed to load centre breakdown: {error}
        </div>
      )}

      {!loading && data && totalActions === 0 && (
        <div className="mx-6 my-5 rounded-xl border border-emerald-100 bg-emerald-50/60 px-5 py-4 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
          <p className="text-sm text-emerald-800">All clear for the selected filters. No stuck cases, pending goals, or incomplete assessments.</p>
        </div>
      )}

      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm min-w-[560px]" role="table" aria-label="Bottleneck action queue by centre">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] w-6">#</th>
              {COLS.map(({ col, label, align, defaultDir }) => (
                <th
                  key={col}
                  className={`px-4 py-3 text-${align} text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] cursor-pointer select-none hover:text-gray-700 transition-colors ${
                    sortFocus === col ? 'bg-amber-50/80 text-amber-700' : ''
                  }`}
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
              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Severity</th>
            </tr>
          </thead>
          <tbody>
            {loading || !data ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse border-b border-gray-50">
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-gray-100 rounded" style={{ width: j === 1 ? 120 : 64 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-400 text-sm">
                  No centre data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((centre, idx) => {
                const total = rowTotal(centre);
                const isIdle = total === 0;
                return (
                  <tr
                    key={centre.centreId}
                    className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/70 transition-colors ${isIdle ? 'opacity-40' : ''}`}
                  >
                    <td className="px-6 py-3.5">
                      <span className="text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</span>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-gray-800 max-w-[200px] truncate" title={centre.centreName}>
                      {shortCentreName(centre.centreName)}
                    </td>
                    <td className="px-4 py-3.5">
                      <MiniBar
                        value={centre.stuckOnboarding}
                        max={maxStuck}
                        colorClass="bg-rose-400"
                        clickable={!!onDrillDown}
                        onClick={() => drill('stuck-onboarding', centre, 'Stuck in onboarding')}
                        label="View stuck cases"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <MiniBar
                        value={centre.pendingGoals}
                        max={maxGoals}
                        colorClass="bg-amber-400"
                        clickable={!!onDrillDown}
                        onClick={() => drill('pending-goals', centre, 'Pending goal approvals')}
                        label="View pending goals"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <MiniBar
                        value={centre.incompleteAssessments}
                        max={maxIncomplete}
                        colorClass="bg-violet-400"
                        clickable={!!onDrillDown}
                        onClick={() => drill('incomplete-assessments', centre, 'Incomplete assessments')}
                        label="View incomplete assessments"
                      />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {total > 0 && onDrillDown ? (
                        <button
                          type="button"
                          onClick={() => drill('all-actions', centre, 'All action items')}
                          title={DRILL_DOWN_HINT}
                          className="tabular-nums font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          {total.toLocaleString()}
                        </button>
                      ) : (
                        <span className="tabular-nums font-semibold text-gray-800">{total.toLocaleString()}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <SeverityPill row={centre} onDrillDown={onDrillDown} />
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
