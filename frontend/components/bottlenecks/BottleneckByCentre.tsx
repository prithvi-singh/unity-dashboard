'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { WorkloadCentreRow } from '@/lib/types';

const DEFAULT_VISIBLE = 10;

type SortDir = 'asc' | 'desc';
type ColKey =
  | 'centreName'
  | 'caseload'
  | 'reportsDrafted'
  | 'reportEdits'
  | 'reportsApproved'
  | 'goalsAdded'
  | 'goalsApproved'
  | 'managerReportsApproved'
  | 'managerGoalsApproved';

interface ColConfig {
  key: ColKey;
  label: string;
  tip: string;
  secondary?: boolean;
  isText?: boolean;
}

const COLS: ColConfig[] = [
  {
    key: 'centreName',
    label: 'Centre',
    tip: '',
    isText: true,
  },
  {
    key: 'caseload',
    label: 'Active Cases',
    tip: 'Active non-closed caseload at this centre (live snapshot, not date-filtered)',
  },
  {
    key: 'reportsDrafted',
    label: 'Reports Drafted',
    tip: 'ReportAdded events in the selected period (UpdateReport excluded)',
  },
  {
    key: 'reportEdits',
    label: 'Report Edits',
    tip: 'UpdateReport events — informational only, not a performance metric. High count vs Drafted may indicate padding.',
    secondary: true,
  },
  {
    key: 'reportsApproved',
    label: 'Reports Approved',
    tip: 'ReportPDFGenerated events in the selected period (distinct per assessment, clinician side)',
  },
  {
    key: 'goalsAdded',
    label: 'Goals Added',
    tip: 'GoalAdded events in the selected period',
  },
  {
    key: 'goalsApproved',
    label: 'Goals Approved',
    tip: 'PatientGoalApprovalRequestGoal rows approved in the selected period',
  },
  {
    key: 'managerReportsApproved',
    label: 'Mgr Reports Approved',
    tip: 'ReportPDFGenerated events actioned by manager-role users (not Clinician / Super Admin)',
  },
  {
    key: 'managerGoalsApproved',
    label: 'Mgr Goals Approved',
    tip: 'Goal approvals actioned by manager-role users in the selected period',
  },
];

const COL_SKELETON_COUNT = COLS.length + 1;

function getVal(row: WorkloadCentreRow, col: ColKey): number | string {
  if (col === 'centreName') return row.centreName;
  return row[col];
}

function isZeroRow(row: WorkloadCentreRow): boolean {
  return (
    row.caseload === 0 &&
    row.reportsDrafted === 0 &&
    row.reportEdits === 0 &&
    row.reportsApproved === 0 &&
    row.goalsAdded === 0 &&
    row.goalsApproved === 0 &&
    row.managerReportsApproved === 0 &&
    row.managerGoalsApproved === 0
  );
}

function sortRows(
  rows: WorkloadCentreRow[],
  col: ColKey,
  dir: SortDir,
): WorkloadCentreRow[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return dir === 'asc'
      ? (av as number) - (bv as number)
      : (bv as number) - (av as number);
  });
}

interface Props {
  rows: WorkloadCentreRow[] | null;
  loading: boolean;
}

export default function BottleneckByCentre({ rows, loading }: Props) {
  const [sort, setSort] = useState<{ col: ColKey; dir: SortDir }>({
    col: 'caseload',
    dir: 'desc',
  });
  const [expanded, setExpanded] = useState(false);
  const [scrollCaptured, setScrollCaptured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleSort = useCallback((col: ColKey, isText?: boolean) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: isText ? 'asc' : 'desc' },
    );
  }, []);

  const collapse = useCallback(() => {
    setExpanded(false);
    setScrollCaptured(false);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collapse();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, collapse]);

  const handleTableClick = useCallback(() => {
    if (expanded && !scrollCaptured) setScrollCaptured(true);
  }, [expanded, scrollCaptured]);

  const safeRows = rows ?? [];

  // Split active vs zero rows; sort each group separately then concat
  const activeRows = safeRows.filter((r) => !isZeroRow(r));
  const zeroRows   = safeRows.filter((r) => isZeroRow(r));

  const sortedActive = sortRows(activeRows, sort.col, sort.dir);
  const sortedZero   = sortRows(zeroRows,   sort.col, sort.dir);
  const allSorted    = [...sortedActive, ...sortedZero];

  const visible    = expanded ? allSorted : allSorted.slice(0, DEFAULT_VISIBLE);
  const totalCount = allSorted.length;
  const hiddenCount = totalCount - DEFAULT_VISIBLE;

  const cardClass =
    'bg-white rounded-xl border border-gray-200 overflow-hidden';

  return (
    <div className={cardClass}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-[14px] font-medium text-gray-900">
          Centre Activity Summary
        </h2>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Cases, reports and goals per centre — click any column to sort
        </p>
      </div>

      {/* Scrollable table wrapper */}
      <div
        ref={containerRef}
        className={[
          'overflow-x-auto',
          expanded && scrollCaptured
            ? 'overflow-y-auto max-h-[520px]'
            : '',
        ].join(' ')}
        style={expanded && !scrollCaptured ? { cursor: 'pointer' } : undefined}
        onClick={handleTableClick}
        aria-label="Centre Activity Summary table region"
      >
        <table
          className="w-full text-sm min-w-[960px]"
          role="table"
          aria-label="Centre Activity Summary"
        >
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] w-8">
                #
              </th>
              {COLS.map(({ key, label, tip, secondary, isText }) => (
                <th
                  key={key}
                  title={tip || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSort(key, isText);
                  }}
                  aria-sort={
                    sort.col === key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={[
                    isText ? 'text-left' : 'text-right',
                    'px-4 py-3 text-[10px] font-bold uppercase tracking-[0.08em] cursor-pointer select-none hover:text-gray-700 transition-colors whitespace-nowrap',
                    secondary
                      ? sort.col === key
                        ? 'text-gray-400'
                        : 'text-gray-300'
                      : sort.col === key
                      ? 'text-gray-700'
                      : 'text-gray-400',
                  ].join(' ')}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <span
                      className={`text-[9px] ${
                        sort.col === key ? 'text-gray-600' : 'text-gray-300'
                      }`}
                    >
                      {sort.col === key
                        ? sort.dir === 'asc'
                          ? '↑'
                          : '↓'
                        : '⇅'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && !rows ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse border-b border-gray-50">
                  {Array.from({ length: COL_SKELETON_COUNT }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div
                        className="h-4 bg-gray-100 rounded"
                        style={{ width: j === 1 ? 140 : 48 }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={COL_SKELETON_COUNT}
                  className="px-6 py-10 text-center text-gray-400 text-sm"
                >
                  No centre data
                </td>
              </tr>
            ) : (
              visible.map((row, idx) => {
                const zero = isZeroRow(row);
                return (
                  <tr
                    key={row.centreId}
                    className={[
                      'border-b border-gray-50 last:border-0 transition-colors',
                      zero
                        ? 'opacity-40'
                        : idx % 2 === 0
                        ? 'bg-white hover:bg-gray-50/60'
                        : 'bg-gray-50/40 hover:bg-gray-100/40',
                    ].join(' ')}
                  >
                    <td className="px-5 py-3.5">
                      <span className="text-[11px] font-bold text-gray-300 tabular-nums">
                        {idx + 1}
                      </span>
                    </td>
                    {/* Centre name */}
                    <td
                      className="px-4 py-3.5 font-semibold text-gray-800 max-w-[180px] truncate"
                      title={row.centreName}
                    >
                      {row.centreName}
                    </td>
                    {/* Active Cases */}
                    <Num value={row.caseload} />
                    {/* Reports Drafted */}
                    <Num value={row.reportsDrafted} />
                    {/* Report Edits — secondary, grey */}
                    <td className="px-4 py-3.5 text-right tabular-nums text-gray-400">
                      {row.reportEdits > 0 ? (
                        row.reportEdits
                      ) : (
                        <span className="text-gray-200">—</span>
                      )}
                    </td>
                    {/* Reports Approved */}
                    <Num value={row.reportsApproved} />
                    {/* Goals Added */}
                    <Num value={row.goalsAdded} />
                    {/* Goals Approved */}
                    <Num value={row.goalsApproved} />
                    {/* Manager Reports Approved */}
                    <Num value={row.managerReportsApproved} />
                    {/* Manager Goals Approved */}
                    <Num value={row.managerGoalsApproved} />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Expand / Collapse footer */}
      {hiddenCount > 0 && (
        <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => {
              setExpanded((prev) => !prev);
              setScrollCaptured(false);
            }}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {expanded
              ? 'Show fewer ↑'
              : `Show all ${totalCount} centres ↓`}
          </button>
          {expanded && (
            <p className="text-[11px] text-gray-400 flex-shrink-0">
              {scrollCaptured
                ? '↕ Scrolling active · Esc to collapse'
                : '↕ Click table to scroll · Esc to collapse'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Num({ value }: { value: number }) {
  return (
    <td className="px-4 py-3.5 text-right tabular-nums font-bold text-gray-900">
      {value > 0 ? value : <span className="text-gray-300 font-normal">—</span>}
    </td>
  );
}
