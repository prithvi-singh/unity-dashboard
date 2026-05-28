'use client';

import { useState } from 'react';
import type { Clinician, WorkloadCentreRow } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary, ClinicalPipelineData } from '@/lib/roleDrillDown';
import { clinicianKpis } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import { IDLE_CLINICIAN_DRILL_TITLE } from '@/lib/idleClinician';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import ActiveStaffPanel from '@/components/clinicians/ActiveStaffPanel';

// ─── Clean KpiCard ────────────────────────────────────────────────────────────
//
// Design system:
//   Label  — 11px · uppercase · tracking-[0.05em] · text-secondary
//   Value  — 28px · font-weight 500 · text-primary (override with valueColor)
//   Context — 13px · text-tertiary
//   Tooltip ⓘ on every label
//   No decorative icons · No donuts · No "View details →" links
//   Clickable cards open drill-down drawers directly

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
      {/* Label + tooltip */}
      <div className="flex items-center gap-1 min-h-[20px]">
        <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-gray-500 leading-tight">
          {label}
        </span>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>

      {/* Value */}
      <p
        className="text-[28px] font-medium leading-none tabular-nums"
        style={{ color: valueColor ?? '#111827' }}
      >
        {value}
      </p>

      {/* Context */}
      {context && (
        <div className="text-[13px] text-gray-400 leading-snug mt-1">
          {context}
        </div>
      )}
    </Tag>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clinicians:           Clinician[];
  summary:              RoleSummary | null;
  pipeline:             ClinicalPipelineData | null;
  loading:              boolean;
  summaryLoading?:      boolean;
  workload?:            WorkloadCentreRow[] | null;
  workloadLoading?:     boolean;
  onDrillDown?:         OnRoleDrillDown;
  onProgressDrawer?:    () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ClinicianChart({
  clinicians,
  summary,
  pipeline,
  loading,
  summaryLoading,
  workload,
  workloadLoading,
  onDrillDown,
  onProgressDrawer,
}: Props) {
  const [activeStaffOpen, setActiveStaffOpen] = useState(false);

  const kpis = clinicianKpis(clinicians);

  // Aggregate reports drafted from workload rows (period-scoped).
  const reportsDrafted = workload
    ? workload.reduce((s, r) => s + r.reportsDrafted, 0)
    : clinicians.reduce((s, r) => s + (r.reportsDrafted ?? 0), 0);

  // Aggregate pipeline state counts (point-in-time, from pipelineBreakdown on each clinician row).
  // Deduplicate by clinician id since API can return one row per clinician × centre.
  const seenIds = new Set<number>();
  let totalScoringBacklog = 0;
  let totalStuck14d = 0;
  let totalGoalsToAdd = 0;
  for (const c of clinicians) {
    if (seenIds.has(c.id)) continue;
    seenIds.add(c.id);
    totalScoringBacklog += c.pipelineBreakdown?.scoring ?? 0;
    totalStuck14d       += c.stuckCases ?? 0;
    totalGoalsToAdd     += c.pipelineBreakdown?.goalsToAdd ?? 0;
  }

  // Aggregate progress notes (period-scoped, from backend)
  const seenIds2 = new Set<number>();
  let totalProgressNotes  = 0;
  let totalGoalsDocumented = 0;
  for (const c of clinicians) {
    if (seenIds2.has(c.id)) continue;
    seenIds2.add(c.id);
    totalProgressNotes   += c.progressNotes   ?? 0;
    totalGoalsDocumented += c.goalsDocumented ?? 0;
  }

  const avgPerPerson = kpis.people > 0
    ? (kpis.totalCaseload / kpis.people).toFixed(1)
    : '—';

  const drill = onDrillDown;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading && clinicians.length === 0) {
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

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (clinicians.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No clinician data for the selected filters
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── Five clean KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">

        {/* Card 1 — Active caseload */}
        <KpiCard
          label="Active Caseload"
          value={kpis.totalCaseload.toLocaleString()}
          context={
            <span>
              <button
                type="button"
                onClick={() => drill?.({ type: 'clinician-caseload', label: 'Active caseload' })}
                className="font-medium text-gray-600 hover:text-blue-600 transition-colors underline-offset-2 hover:underline focus:outline-none"
              >
                {kpis.people} clinician{kpis.people !== 1 ? 's' : ''}
              </button>
              {' '}· avg {avgPerPerson}/person
            </span>
          }
          tooltip={KPI.CLINICIAN_TEAM_CASELOAD}
        />

        {/* Card 2 — Reports drafted (period-scoped) */}
        <KpiCard
          label="Reports Drafted"
          value={reportsDrafted.toLocaleString()}
          context="Clinician-drafted reports this period"
          tooltip={KPI.CLINICIAN_TEAM_REPORTS_DRAFTED}
          clickable={!!drill && reportsDrafted > 0}
          onClick={() => drill?.({ type: 'clinician-pipeline-report-pdf', label: 'Reports drafted' })}
        />

        {/* Card 3 — Scoring backlog: value = stuck >14d (matches drawer query exactly via
            summary.stuckCases), context = all-in-scoring broader total */}
        <KpiCard
          label="Scoring Backlog"
          value={(summary?.stuckCases ?? totalStuck14d).toLocaleString()}
          valueColor={(summary?.stuckCases ?? totalStuck14d) > 0 ? '#A32D2D' : '#111827'}
          context={`${totalScoringBacklog} total in scoring (any duration)`}
          hasAlert={(summary?.stuckCases ?? totalStuck14d) > 0}
          tooltip={KPI.CLINICIAN_TEAM_OVERDUE}
          clickable={!!drill && (summary?.stuckCases ?? totalStuck14d) > 0}
          onClick={() => drill?.({ type: 'clinician-stuck', label: 'Scoring backlog (>14 days)' })}
        />

        {/* Card 4 — Goals to add: value matches clinician-goals-to-add drawer exactly via
            summary.goalsToAdd (identical query to the drawer's queryClinicianGoalsToAdd) */}
        <KpiCard
          label="Goals to Add"
          value={(summary?.goalsToAdd ?? totalGoalsToAdd).toLocaleString()}
          context="Report approved, goals pending"
          valueColor={(summary?.goalsToAdd ?? totalGoalsToAdd) > 0 ? '#BA7517' : '#111827'}
          hasAlert={(summary?.goalsToAdd ?? totalGoalsToAdd) > 0}
          tooltip={KPI.CLINICIAN_GOALS_TO_ADD}
          clickable={!!drill && (summary?.goalsToAdd ?? totalGoalsToAdd) > 0}
          onClick={() => drill?.({ type: 'clinician-goals-to-add', label: 'Goals to add' })}
        />

        {/* Card 5 — Progress notes */}
        <KpiCard
          label="Progress Notes"
          value={totalProgressNotes.toLocaleString()}
          context={`${totalGoalsDocumented} goal${totalGoalsDocumented !== 1 ? 's' : ''} documented`}
          tooltip={KPI.CLINICIAN_PROGRESS_NOTES}
          clickable={!!onProgressDrawer && totalProgressNotes > 0}
          onClick={onProgressDrawer}
          ariaLabel={`Progress notes: ${totalProgressNotes}. Click to view goal coverage.`}
        />

      </div>

      {/* Active staff drawer */}
      {activeStaffOpen && (
        <ActiveStaffPanel
          clinicians={clinicians}
          onClose={() => setActiveStaffOpen(false)}
        />
      )}
    </div>
  );
}
