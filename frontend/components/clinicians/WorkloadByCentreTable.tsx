'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { WorkloadCentreRow } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import { goalsDisplay } from '@/lib/roleStats';

const DEFAULT_VISIBLE = 10;

type SortDir = 'asc' | 'desc';
type ColKey =
  | 'centreName'
  | 'caseload'
  | 'assessmentsScored'
  | 'reportsDrafted'
  | 'reportEdits'
  | 'reportsApproved'
  | 'goalsAdded'
  | 'goalsApproved'
  | 'progressNotes';

interface ColConfig {
  key: ColKey;
  label: string;
  tip: string;
  secondary?: boolean;
  isText?: boolean;
}

const COLS: ColConfig[] = [
  { key: 'centreName',       label: 'Centre',             tip: '',                                                                                                     isText: true },
  { key: 'caseload',         label: 'Active Cases',       tip: 'Non-closed cases at this centre.' },
  { key: 'assessmentsScored',label: 'Assessments Scored', tip: 'Assessments completed by clinicians at this centre in the period.' },
  { key: 'reportsDrafted',   label: 'Reports Drafted',    tip: 'Reports drafted by clinicians at this centre in the period.' },
  { key: 'reportEdits',      label: 'Report Edits',       tip: 'Edits to existing reports. Informational only.', secondary: true },
  { key: 'reportsApproved',  label: 'Reports Approved',   tip: 'Reports signed off by managers at this centre in the period.' },
  { key: 'goalsAdded',       label: 'Cases w/ Goals',     tip: 'Cases with at least one goal added after report approval.' },
  { key: 'goalsApproved',    label: 'Goals Approved',     tip: 'Goals signed off by managers at this centre in the period.' },
  { key: 'progressNotes',    label: 'Progress Notes',     tip: 'Therapy progress notes added at this centre in the period.' },
];

function getVal(row: WorkloadCentreRow, col: ColKey): number | string {
  if (col === 'centreName') return row.centreName;
  if (col === 'progressNotes') return row.progressNotes ?? 0;
  if (col === 'assessmentsScored') return row.assessmentsScored ?? 0;
  return row[col as Exclude<ColKey, 'centreName' | 'progressNotes' | 'assessmentsScored'>] as number;
}

function sortRows(rows: WorkloadCentreRow[], col: ColKey, dir: SortDir): WorkloadCentreRow[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
}

// ── CSV export ─────────────────────────────────────────────────────────────────
function exportCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers, ...rows].map((r) => r.map(escape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const COL_SKELETON_COUNT = COLS.length + 1; // +1 for the # column

interface Props {
  rows: WorkloadCentreRow[] | null;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

function WorkloadByCentreTableInner({ rows, loading, error, onRetry }: Props) {
  const [sort, setSort] = useState<{ col: ColKey; dir: SortDir }>({ col: 'caseload', dir: 'desc' });
  const [expanded, setExpanded] = useState(false);
  const [scrollCaptured, setScrollCaptured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleSort = useCallback((col: ColKey, isText?: boolean) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: isText ? 'asc' : 'desc' }
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
  const sorted = sortRows(safeRows, sort.col, sort.dir);
  const visible = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const totalCount = sorted.length;

  const handleExport = useCallback(() => {
    exportCsv(
      `unity-centre-clinician-activity-${todayStr()}.csv`,
      ['Centre', 'Active Cases', 'Assessments Scored', 'Reports Drafted', 'Report Edits', 'Reports Approved', 'Cases w/ Goals', 'Goals Approved', 'Progress Notes'],
      safeRows.map((r) => [
        r.centreName,
        String(r.caseload),
        String(r.assessmentsScored ?? 0),
        String(r.reportsDrafted),
        String(r.reportEdits),
        String(r.reportsApproved),
        String(r.goalsAdded),
        String(r.goalsApproved),
        String(r.progressNotes ?? 0),
      ]),
    );
  }, [safeRows]);

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-medium text-gray-900">Centre activity — clinician output</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Clinician KPIs aggregated by centre</p>
        </div>
        <div className="px-6 py-10 flex flex-col items-center gap-3 text-center">
          <svg className="w-5 h-5 text-rose-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-gray-500">Could not load centre activity data</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium text-gray-900">Centre activity — clinician output</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Clinician KPIs aggregated by centre</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
        >
          ↓ Export CSV
        </button>
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
        aria-label="Centre activity — clinician output table region"
      >
        <table
          className="w-full text-sm min-w-[820px]"
          role="table"
          aria-label="Centre activity — clinician output"
        >
          <thead>
            <tr className="border-b border-gray-100 sticky top-0 bg-gray-50 z-10">
              {/* Row number */}
              <th className="px-5 py-[10px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em] w-8">
                #
              </th>
              {COLS.map(({ key, label, tip, secondary, isText }) => (
                <th
                  key={key}
                  title={tip || undefined}
                  onClick={(e) => { e.stopPropagation(); toggleSort(key, isText); }}
                  aria-sort={
                    sort.col === key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={[
                    isText ? 'text-left' : 'text-right',
                    'px-4 py-[10px] text-[11px] font-medium uppercase tracking-[0.03em] cursor-pointer select-none hover:text-gray-700 transition-colors whitespace-nowrap',
                    secondary
                      ? sort.col === key
                        ? 'text-gray-400'
                        : 'text-gray-300'
                      : sort.col === key
                      ? 'text-gray-900'
                      : 'text-gray-500',
                  ].join(' ')}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {tip && (
                      <span className="text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal" title={tip}>
                        ⓘ
                      </span>
                    )}
                    {sort.col === key && (
                      <span className="text-[10px] text-gray-600">
                        {sort.dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading && visible.length === 0 ? (
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
              visible.map((row, idx) => (
                <tr
                  key={row.centreId}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                >
                  <td className="px-5 py-[10px]">
                    <span className="text-[11px] font-bold text-gray-300 tabular-nums">
                      {idx + 1}
                    </span>
                  </td>
                  {/* Centre name */}
                  <td
                    className="px-4 py-[10px] font-semibold text-gray-800 max-w-[180px] truncate"
                    title={row.centreName}
                  >
                    {shortCentreName(row.centreName)}
                  </td>
                  {/* Active Cases */}
                  <Num value={row.caseload} />
                  {/* Assessments Scored */}
                  <Num value={row.assessmentsScored ?? 0} />
                  {/* Reports Drafted */}
                  <Num value={row.reportsDrafted} />
                  {/* Report Edits — secondary, grey */}
                  <td className="px-4 py-[10px] text-right tabular-nums text-gray-400">
                    {row.reportEdits > 0 ? (
                      row.reportEdits
                    ) : (
                      <span className="text-gray-200">—</span>
                    )}
                  </td>
                  {/* Reports Approved */}
                  <Num value={row.reportsApproved} />
                  {/* Cases w/ Goals — N (total items) */}
                  <td className="px-4 py-[10px] text-right tabular-nums font-bold text-gray-900">
                    {row.goalsAdded > 0
                      ? goalsDisplay(row.goalsAdded, row.goalsAddedItems ?? 0)
                      : <span className="text-gray-300 font-normal">—</span>}
                  </td>
                  {/* Goals Approved — N (total items) */}
                  <td className="px-4 py-[10px] text-right tabular-nums font-bold text-gray-900">
                    {row.goalsApproved > 0
                      ? goalsDisplay(row.goalsApproved, row.goalsApprovedItems ?? 0)
                      : <span className="text-gray-300 font-normal">—</span>}
                  </td>
                  {/* Progress Notes */}
                  <Num value={row.progressNotes ?? 0} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Expand / Collapse footer */}
      {totalCount > DEFAULT_VISIBLE && (
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
              ? `Show fewer ↑`
              : `Show all ${totalCount} rows ↓`}
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

const WorkloadByCentreTable = React.memo(WorkloadByCentreTableInner, (prev, next) =>
  prev.rows === next.rows && prev.loading === next.loading && prev.error === next.error
);

export default WorkloadByCentreTable;

/** Plain bold number cell — right-aligned, em-dash when zero */
function Num({ value }: { value: number }) {
  return (
    <td className="px-4 py-[10px] text-right tabular-nums font-bold text-gray-900">
      {value > 0 ? value : <span className="text-gray-300 font-normal">—</span>}
    </td>
  );
}
