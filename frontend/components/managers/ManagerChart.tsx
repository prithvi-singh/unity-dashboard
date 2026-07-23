'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Manager, WorkloadCentreRow } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary } from '@/lib/roleDrillDown';
import { aggregateManagersByCentre, managerKpis, goalsDisplay } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import { shortCentreName } from '@/lib/centreNames';
import ActiveManagersPanel from '@/components/managers/ActiveManagersPanel';

interface KpiCardProps {
  label:      string;
  value:      string;
  context?:   React.ReactNode;
  tooltip?:   { title: string; description: string };
  valueColor?: string;
  hasAlert?:  boolean;
  clickable?: boolean;
  onClick?:   () => void;
  ariaLabel?: string;
}

function KpiCard({
  label, value, context, tooltip, valueColor, hasAlert, clickable, onClick, ariaLabel,
}: KpiCardProps) {
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      aria-label={clickable ? (ariaLabel ?? `${label}: ${value}`) : undefined}
      aria-haspopup={clickable ? 'dialog' : undefined}
      className={[
        'bg-white rounded-xl px-6 py-5 flex flex-col gap-2 text-left w-full',
        hasAlert
          ? 'border border-rose-200/80'
          : 'border border-gray-100',
        clickable
          ? 'cursor-pointer hover:border-gray-200 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
          : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 min-h-[20px]">
        <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-gray-500 leading-tight">
          {label}
        </span>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p
        className="text-[28px] font-medium leading-none tabular-nums"
        style={{ color: valueColor ?? '#111827' }}
      >
        {value}
      </p>
      {context && (
        <div className="text-[13px] text-gray-400 leading-snug mt-1">
          {context}
        </div>
      )}
    </Tag>
  );
}

// ─── Centre Activity — Manager Output ────────────────────────────────────────

interface ManagerCentreRow {
  centreId:             number;
  centreName:           string;
  reportsToApprove:     number;
  goalsToApprove:       number;
  casesRegistered:      number;
  assessmentsAssigned:  number;
  reportsApproved:      number | null;
  goalsApproved:        number | null;
  avgApprovalDays:      number | null;
  progressNotes:        number;
}

function buildManagerCentreRows(
  managers: Manager[],
  workload: WorkloadCentreRow[] | null,
): ManagerCentreRow[] {
  const byCentre = aggregateManagersByCentre(managers);
  const wMap = new Map(workload?.map((r) => [r.centreId, r]) ?? []);

  // Aggregate pending counts and progressNotes from manager data by primaryCentreId
  const pendingMap = new Map<number, { reportsToApprove: number; goalsToApprove: number; progressNotes: number }>();
  const visible = managers.filter((m) => m.roleName !== 'Super Admin');
  for (const m of visible) {
    if (m.centreId == null) continue;
    const ex = pendingMap.get(m.centreId);
    if (ex) {
      ex.reportsToApprove += m.reportsToApprove ?? 0;
      ex.goalsToApprove   += m.goalsToApprove   ?? 0;
      ex.progressNotes    += m.progressNotes     ?? 0;
    } else {
      pendingMap.set(m.centreId, {
        reportsToApprove: m.reportsToApprove ?? 0,
        goalsToApprove:   m.goalsToApprove   ?? 0,
        progressNotes:    m.progressNotes     ?? 0,
      });
    }
  }

  return byCentre.map((r) => {
    const w    = wMap.get(r.centreId);
    const pend = pendingMap.get(r.centreId) ?? { reportsToApprove: 0, goalsToApprove: 0, progressNotes: 0 };
    return {
      centreId:             r.centreId,
      centreName:           r.centreName,
      reportsToApprove:     pend.reportsToApprove,
      goalsToApprove:       pend.goalsToApprove,
      casesRegistered:      r.metric1,
      assessmentsAssigned:  r.metric2,
      reportsApproved:      w != null ? w.managerReportsApproved : null,
      goalsApproved:        w != null ? w.managerGoalsApproved   : null,
      avgApprovalDays:      w?.avgApprovalDays ?? null,
      progressNotes:        pend.progressNotes,
    };
  });
}

const CENTRE_DEFAULT_VISIBLE = 10;

type CentreColKey =
  | 'centreName'
  | 'reportsToApprove'
  | 'goalsToApprove'
  | 'reportsApproved'
  | 'goalsApproved'
  | 'avgApprovalDays'
  | 'casesRegistered'
  | 'assessmentsAssigned'
  | 'progressNotes';

type SortDir = 'asc' | 'desc';

interface CentreSortThProps {
  col:    CentreColKey;
  label:  string;
  tip?:   string;
  align?: 'left' | 'right';
  active: boolean;
  dir:    SortDir;
  onSort: (col: CentreColKey) => void;
}

function CentreSortTh({ col, label, tip, align = 'right', active, dir, onSort }: CentreSortThProps) {
  return (
    <th
      onClick={(e) => { e.stopPropagation(); onSort(col); }}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={[
        'px-3 py-[10px] text-[11px] font-medium uppercase tracking-[0.03em] cursor-pointer select-none',
        'hover:text-gray-700 transition-colors whitespace-nowrap',
        align === 'left' ? 'text-left' : 'text-right',
        active ? 'text-gray-900' : 'text-gray-500',
      ].join(' ')}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {tip && (
          <span className="text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal" title={tip}>
            ⓘ
          </span>
        )}
        {active && (
          <span className="text-[10px] text-gray-600">{dir === 'asc' ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );
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
function todayStr(): string { return new Date().toISOString().slice(0, 10); }

function ManagerCentreActivityTableInner({
  rows,
  loading,
}: {
  rows: ManagerCentreRow[];
  loading: boolean;
}) {
  const [sort, setSort]         = useState<{ col: CentreColKey; dir: SortDir }>({ col: 'reportsToApprove', dir: 'desc' });
  const [expanded, setExpanded] = useState(false);
  const [scrollCaptured, setScrollCaptured] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const collapse = useCallback(() => {
    setExpanded(false);
    setScrollCaptured(false);
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') collapse(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, collapse]);

  const toggleSort = useCallback((col: CentreColKey) => {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'centreName' ? 'asc' : 'desc' }
    );
  }, []);

  const getRowVal = (row: ManagerCentreRow, col: CentreColKey): number | string => {
    if (col === 'centreName') return row.centreName;
    if (col === 'avgApprovalDays') return row.avgApprovalDays ?? -1;
    return (row[col] as number | null) ?? -1;
  };

  const sorted = [...rows].sort((a, b) => {
    const av = getRowVal(a, sort.col);
    const bv = getRowVal(b, sort.col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const visible = expanded ? sorted : sorted.slice(0, CENTRE_DEFAULT_VISIBLE);
  const { col: sortCol, dir: sortDir } = sort;

  const handleExport = useCallback(() => {
    exportCsv(
      `unity-centre-manager-activity-${todayStr()}.csv`,
      ['Centre', 'Reports to Approve', 'Goals to Approve', 'Reports Approved', 'Goals Approved', 'Avg Approval Time', 'Cases Registered', 'Assessments Assigned', 'Progress Notes'],
      rows.map((r) => [
        r.centreName,
        String(r.reportsToApprove),
        String(r.goalsToApprove),
        String(r.reportsApproved ?? 0),
        String(r.goalsApproved ?? 0),
        r.avgApprovalDays != null ? `${r.avgApprovalDays.toFixed(1)}d` : 'N/A',
        String(r.casesRegistered),
        String(r.assessmentsAssigned),
        String(r.progressNotes),
      ]),
    );
  }, [rows]);

  const colCount = 10; // # + 9 data cols

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-medium text-gray-900">Centre activity — manager output</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Manager KPIs aggregated by centre</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
        >
          ↓ Export CSV
        </button>
      </div>

      <div
        ref={containerRef}
        className={[
          'overflow-x-auto',
          expanded && scrollCaptured ? 'overflow-y-auto max-h-[480px]' : '',
        ].join(' ')}
        style={expanded && !scrollCaptured ? { cursor: 'pointer' } : undefined}
        onClick={() => { if (expanded && !scrollCaptured) setScrollCaptured(true); }}
        aria-label="Centre activity — manager output table region"
      >
        <table className="w-full text-sm min-w-[860px]" role="table" aria-label="Centre activity — manager output">
          <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
            <tr>
              <th className="px-5 py-[10px] text-left text-[11px] font-medium uppercase tracking-[0.03em] text-gray-500 w-8">#</th>
              <CentreSortTh col="centreName"          label="Centre"               align="left" active={sortCol === 'centreName'}          dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="reportsToApprove"    label="Reports to Approve"   tip="Reports drafted by clinicians awaiting manager approval at this centre."
                            active={sortCol === 'reportsToApprove'} dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="goalsToApprove"      label="Goals to Approve"     tip="Goals awaiting manager approval at this centre."
                            active={sortCol === 'goalsToApprove'}   dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="reportsApproved"     label="Reports Approved"     tip="Reports signed off by managers at this centre in the period."
                            active={sortCol === 'reportsApproved'}  dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="goalsApproved"       label="Goals Approved"       tip="Goals signed off by managers at this centre in the period."
                            active={sortCol === 'goalsApproved'}    dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="avgApprovalDays"     label="Avg Approval Time"    tip="Average days from report draft to manager approval in the period."
                            active={sortCol === 'avgApprovalDays'}  dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="casesRegistered"     label="Cases Registered"     tip="Cases registered by managers at this centre in the period."
                            active={sortCol === 'casesRegistered'}  dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="assessmentsAssigned" label="Assessments Assigned" tip="Assessments routed to clinicians by managers at this centre in the period."
                            active={sortCol === 'assessmentsAssigned'} dir={sortDir} onSort={toggleSort} />
              <CentreSortTh col="progressNotes"       label="Progress Notes"       tip="Therapy progress notes added at this centre in the period."
                            active={sortCol === 'progressNotes'}    dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse border-b border-gray-50">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-gray-100 rounded" style={{ width: j === 1 ? 140 : 48 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-10 text-center text-gray-400 text-sm">
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
                    <span className="text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</span>
                  </td>
                  <td className="px-4 py-[10px] font-semibold text-gray-800 max-w-[180px] truncate" title={row.centreName}>
                    {shortCentreName(row.centreName)}
                  </td>
                  {/* Reports to Approve — red if > 0 */}
                  <td className="px-4 py-[10px] text-right">
                    <span className={`tabular-nums font-bold ${row.reportsToApprove > 0 ? 'text-[#A32D2D]' : 'text-gray-300'}`}>
                      {row.reportsToApprove > 0 ? row.reportsToApprove.toLocaleString() : '—'}
                    </span>
                  </td>
                  {/* Goals to Approve — red if > 0 */}
                  <td className="px-4 py-[10px] text-right">
                    <span className={`tabular-nums font-bold ${row.goalsToApprove > 0 ? 'text-[#A32D2D]' : 'text-gray-300'}`}>
                      {row.goalsToApprove > 0 ? row.goalsToApprove.toLocaleString() : '—'}
                    </span>
                  </td>
                  <NumCell value={row.reportsApproved} />
                  <NumCell value={row.goalsApproved} />
                  {/* Avg Approval Time */}
                  <td className={`px-4 py-[10px] text-right tabular-nums whitespace-nowrap ${avgDaysColor(row.avgApprovalDays)}`}>
                    {row.avgApprovalDays != null
                      ? `${row.avgApprovalDays.toFixed(1)}d`
                      : <span className="text-gray-300">N/A</span>}
                  </td>
                  <NumCell value={row.casesRegistered} />
                  <NumCell value={row.assessmentsAssigned} />
                  <NumCell value={row.progressNotes} />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && sorted.length > CENTRE_DEFAULT_VISIBLE && (
        <div className="px-5 py-3 border-t border-gray-50 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => { setExpanded((p) => !p); setScrollCaptured(false); }}
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {expanded ? 'Show fewer ↑' : `Show all ${sorted.length} rows ↓`}
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

function avgDaysColor(days: number | null | undefined): string {
  if (days == null) return 'text-gray-400';
  if (days < 2)  return 'text-[#1D9E75] font-semibold';
  if (days <= 5) return 'text-[#BA7517]';
  return 'text-[#A32D2D] font-semibold';
}

function NumCell({ value }: { value: number | null }) {
  if (value == null) {
    return <td className="px-4 py-[10px] text-right tabular-nums text-gray-300">—</td>;
  }
  return (
    <td className="px-4 py-[10px] text-right tabular-nums font-bold text-gray-900">
      {value > 0 ? value.toLocaleString() : <span className="text-gray-300 font-normal">—</span>}
    </td>
  );
}

export const ManagerCentreActivityTable = React.memo(ManagerCentreActivityTableInner, (prev, next) =>
  prev.rows === next.rows && prev.loading === next.loading
);

export { buildManagerCentreRows };

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  managers:          Manager[];
  summary:           RoleSummary | null;
  loading:           boolean;
  summaryLoading?:   boolean;
  workload?:         WorkloadCentreRow[] | null;
  workloadLoading?:  boolean;
  onDrillDown?:      OnRoleDrillDown;
  onProgressDrawer?: () => void;
  hideCentreActivity?: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManagerChart({
  managers,
  loading,
  workload,
  workloadLoading,
  onDrillDown,
  onProgressDrawer,
  hideCentreActivity = false,
}: Props) {
  const [activeManagersOpen, setActiveManagersOpen] = useState(false);

  const kpis      = managerKpis(managers);
  const byCentre  = aggregateManagersByCentre(managers);
  const drill     = onDrillDown;

  // Report approval percentage (requires workload for denominator)
  const totalReportsDrafted = workload
    ? workload.reduce((s, r) => s + r.reportsDrafted, 0)
    : null;
  const approvalPct =
    totalReportsDrafted != null && totalReportsDrafted > 0 && kpis.totalReportsApproved > 0
      ? Math.round((kpis.totalReportsApproved / totalReportsDrafted) * 100)
      : null;
  const approvalColor =
    approvalPct == null  ? '#111827'
    : approvalPct >= 80  ? '#1D9E75'
    : approvalPct >= 60  ? '#BA7517'
    : '#A32D2D';

  // Goals approved — use workload per-centre sum (centre-based, email-match-independent).
  const totalGoalsApproved =
    workload != null
      ? workload.reduce((s, r) => s + (r.managerGoalsApproved ?? 0), 0)
      : kpis.totalGoalsApproved;
  const totalGoalsApprovedItems =
    workload != null
      ? workload.reduce((s, r) => s + (r.managerGoalsApprovedItems ?? 0), 0)
      : kpis.totalGoalsApprovedItems;

  // Progress notes — aggregate from per-manager data (period-scoped)
  const seenMgrIds = new Set<number>();
  let totalProgressNotes   = 0;
  let totalGoalsDocumented = 0;
  for (const m of managers) {
    if (seenMgrIds.has(m.id)) continue;
    seenMgrIds.add(m.id);
    totalProgressNotes   += m.progressNotes   ?? 0;
    totalGoalsDocumented += m.goalsDocumented ?? 0;
  }

  // Centre activity summary — merge manager aggregation with workload data
  const centreActivityRows = buildManagerCentreRows(managers, workload ?? null);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading && managers.length === 0) {
    return (
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 animate-pulse"
        aria-busy="true"
        role="status"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-gray-100 rounded-xl h-32 border border-gray-100" />
        ))}
      </div>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!loading && managers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No manager data for the selected filters
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Five KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">

        {/* Card 1 — Cases registered */}
        <KpiCard
          label="Cases Registered"
          value={kpis.totalCases.toLocaleString()}
          context="Manager-initiated registrations"
          tooltip={KPI.MANAGER_TEAM_CASES_REGISTERED}
          clickable={!!drill && kpis.totalCases > 0}
          onClick={() => drill?.({ type: 'manager-registered', label: 'Cases registered' })}
        />

        {/* Card 2 — Assessments assigned */}
        <KpiCard
          label="Assessments Assigned"
          value={kpis.totalAssigned.toLocaleString()}
          context="Clinical handoffs to clinicians"
          tooltip={KPI.MANAGER_TEAM_ASSESSMENTS_ASSIGNED}
          clickable={!!drill && kpis.totalAssigned > 0}
          onClick={() => drill?.({ type: 'manager-assigned', label: 'Assessments assigned' })}
        />

        {/* Card 3 — Reports approved */}
        <KpiCard
          label="Reports Approved"
          value={kpis.totalReportsApproved.toLocaleString()}
          context={approvalPct != null ? `${approvalPct}% of drafted reports` : 'Reports approved this period'}
          valueColor={approvalColor}
          tooltip={KPI.MANAGER_TEAM_REPORTS_APPROVED}
          clickable={!!drill && kpis.totalReportsApproved > 0}
          onClick={() => drill?.({ type: 'clinician-pipeline-report-pdf', label: 'Reports approved' })}
        />

        {/* Card 4 — Goals approved */}
        <KpiCard
          label="Goals Approved"
          value={goalsDisplay(totalGoalsApproved, totalGoalsApprovedItems)}
          context="Goal sign-offs completed"
          tooltip={KPI.MANAGER_TEAM_GOALS_APPROVED}
          clickable={!!drill && totalGoalsApproved > 0}
          onClick={() => drill?.({ type: 'clinician-pipeline-goals-approved', label: 'Goals approved' })}
        />

        {/* Card 5 — Progress notes */}
        <KpiCard
          label="Progress Notes"
          value={totalProgressNotes.toLocaleString()}
          context={`${totalGoalsDocumented} goal${totalGoalsDocumented !== 1 ? 's' : ''} documented`}
          tooltip={KPI.MANAGER_PROGRESS_NOTES}
          clickable={!!onProgressDrawer && totalProgressNotes > 0}
          onClick={onProgressDrawer}
          ariaLabel={`Progress notes: ${totalProgressNotes}. Click to view goal coverage.`}
        />

      </div>

      {/* Active managers drawer */}
      {activeManagersOpen && (
        <ActiveManagersPanel
          managers={managers}
          onClose={() => setActiveManagersOpen(false)}
        />
      )}

      {/* ── Centre Activity Summary — only when not deferred to parent ─────── */}
      {!hideCentreActivity && (
        <ManagerCentreActivityTable
          rows={centreActivityRows}
          loading={loading || (workloadLoading ?? false)}
        />
      )}

    </div>
  );
}
