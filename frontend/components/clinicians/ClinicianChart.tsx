'use client';

import { useState } from 'react';
import type { Clinician, WorkloadCentreRow } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary, ClinicalPipelineData } from '@/lib/roleDrillDown';
import { clinicianKpis } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import { IDLE_CLINICIAN_DRILL_TITLE } from '@/lib/idleClinician';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import ActiveStaffPanel from '@/components/clinicians/ActiveStaffPanel';
import WorkloadByCentreTable from '@/components/clinicians/WorkloadByCentreTable';

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
        'bg-white rounded-xl p-4 flex flex-col gap-2 text-left w-full',
        hasAlert
          ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] border border-gray-100',
        clickable
          ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
          : '',
      ].join(' ')}
    >
      {/* Label + tooltip */}
      <div className="flex items-center gap-1 min-h-[20px]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-500 leading-tight">
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
        <div className="text-[13px] text-gray-400 leading-snug">
          {context}
        </div>
      )}
    </Tag>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clinicians:       Clinician[];
  summary:          RoleSummary | null;
  pipeline:         ClinicalPipelineData | null;
  loading:          boolean;
  summaryLoading?:  boolean;
  workload?:        WorkloadCentreRow[] | null;
  workloadLoading?: boolean;
  onDrillDown?:     OnRoleDrillDown;
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
}: Props) {
  const [activeStaffOpen, setActiveStaffOpen] = useState(false);

  const kpis  = clinicianKpis(clinicians);
  const idle  = summary?.inactiveCount ?? 0;

  // Aggregate reports drafted from workload rows (period-scoped).
  const reportsDrafted = workload
    ? workload.reduce((s, r) => s + r.reportsDrafted, 0)
    : clinicians.reduce((s, r) => s + (r.reportsDrafted ?? 0), 0);

  // Aggregate pipeline state counts (point-in-time, from pipelineBreakdown on each clinician row)
  // Using a Set to deduplicate by clinician id since API returns one row per clinician×centre.
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

  const activePct = kpis.people > 0
    ? Math.round((kpis.activeCount / kpis.people) * 100)
    : 0;

  const avgPerPerson = kpis.people > 0
    ? (kpis.totalCaseload / kpis.people).toFixed(1)
    : '—';

  const drill = onDrillDown;

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading && clinicians.length === 0) {
    return (
      <div
        className="grid grid-cols-2 lg:grid-cols-5 gap-4 animate-pulse"
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">

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

        {/* Card 3 — Scoring backlog (point-in-time, pipeline state) */}
        <KpiCard
          label="Scoring Backlog"
          value={totalScoringBacklog.toLocaleString()}
          valueColor={totalStuck14d > 0 ? '#EF4444' : totalScoringBacklog > 0 ? '#F59E0B' : '#111827'}
          context={totalStuck14d > 0 ? `${totalStuck14d} stuck >14 days` : 'Cases scoring pending'}
          hasAlert={totalStuck14d > 0}
          tooltip={KPI.CLINICIAN_TEAM_OVERDUE}
          clickable={!!drill && totalScoringBacklog > 0}
          onClick={() => drill?.({ type: 'clinician-stuck', label: 'Scoring backlog' })}
        />

        {/* Card 4 — Goals to add (point-in-time) */}
        <KpiCard
          label="Goals to Add"
          value={totalGoalsToAdd.toLocaleString()}
          valueColor={totalGoalsToAdd > 0 ? '#F59E0B' : '#111827'}
          context="Report approved, goals pending"
          hasAlert={totalGoalsToAdd > 0}
          tooltip={KPI.CLINICIAN_TEAM_OVERDUE}
        />

        {/* Card 4 — Idle clinicians */}
        <KpiCard
          label="Idle Clinicians"
          value={summaryLoading ? '…' : idle.toLocaleString()}
          valueColor={idle > 0 ? '#F59E0B' : '#111827'}
          context="Open caseload, no activity in selected period"
          hasAlert={idle > 0}
          tooltip={KPI.CLINICIAN_IDLE}
          clickable={!!drill && idle > 0}
          onClick={() => drill?.({ type: 'clinician-inactive', label: IDLE_CLINICIAN_DRILL_TITLE })}
        />

      </div>

      {/* Card 5 — Active clinicians (full-width row, separate for prominence) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Active Clinicians"
          value={`${kpis.activeCount} / ${kpis.people}`}
          context="Performed core job in selected period"
          tooltip={KPI.CLINICIAN_ACTIVE_STAFF}
          clickable
          onClick={() => setActiveStaffOpen(true)}
          ariaLabel={`Active Clinicians: ${kpis.activeCount} of ${kpis.people}. Click to see list.`}
        />
        {/* Extra info context across remaining columns */}
        <div className="col-span-1 lg:col-span-4 bg-white rounded-xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] p-4 flex items-center">
          <p className="text-[13px] text-gray-400 leading-relaxed">
            {activePct}% of clinicians took at least one core clinical action in the selected period.
            {idle > 0 && (
              <span>
                {' '}<button
                  type="button"
                  onClick={() => drill?.({ type: 'clinician-inactive', label: IDLE_CLINICIAN_DRILL_TITLE })}
                  className="text-amber-600 hover:text-amber-700 font-medium hover:underline underline-offset-2 focus:outline-none"
                >
                  {idle} idle clinician{idle !== 1 ? 's' : ''}
                </button>{' '}
                have open caseload but no activity.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Active staff drawer */}
      {activeStaffOpen && (
        <ActiveStaffPanel
          clinicians={clinicians}
          onClose={() => setActiveStaffOpen(false)}
        />
      )}

      {/* ── Centre Activity Summary — replaces the old "Delivery by Centre" bar chart ── */}
      <WorkloadByCentreTable
        rows={workload ?? null}
        loading={workloadLoading ?? false}
      />
    </div>
  );
}
