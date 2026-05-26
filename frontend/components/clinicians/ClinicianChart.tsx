'use client';

import type { Clinician, WorkloadCentreRow } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary, ClinicalPipelineData } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import {
  aggregateCliniciansByCentre,
  clinicianKpis,
} from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import { IDLE_CLINICIAN_LABEL, IDLE_CLINICIAN_SUBTITLE, IDLE_CLINICIAN_DRILL_TITLE } from '@/lib/idleClinician';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import RoleCentreChart from '@/components/shared/RoleCentreChart';
import WorkloadByCentreTable from '@/components/clinicians/WorkloadByCentreTable';

interface Props {
  clinicians: Clinician[];
  summary: RoleSummary | null;
  pipeline: ClinicalPipelineData | null;
  loading: boolean;
  summaryLoading?: boolean;
  pipelineLoading?: boolean;
  workload: WorkloadCentreRow[] | null;
  workloadLoading: boolean;
  onDrillDown?: OnRoleDrillDown;
}

function ProgressRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const cx = size / 2;
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#F3F4F6" strokeWidth="4" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90, ${cx}, ${cx})`}
      />
      <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '9.5px', fontWeight: 700, fill: '#6B7280' }}
      >
        {pct === 0 ? '—' : `${Math.round(pct)}%`}
      </text>
    </svg>
  );
}

function KpiCard({
  label, value, sub, pct, ringColor, iconBg, iconFg, icon, hasAlert, clickable, onClick, focusTarget, tooltip, ariaLabel,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  ringColor?: string;
  iconBg: string;
  iconFg: string;
  icon: React.ReactNode;
  hasAlert?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  focusTarget?: string;
  tooltip?: { title: string; description: string };
  ariaLabel?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconFg} p-2.5 rounded-xl`}>{icon}</div>
        {pct !== undefined && ringColor && <ProgressRing pct={pct} color={ringColor} />}
      </div>
      <div>
        <div className="flex items-center mb-1">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.1em]">{label}</p>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-[2rem] font-bold text-gray-900 leading-none tracking-tight tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        {clickable && <p className="text-[10px] text-blue-700 font-semibold mt-2">{DRILL_DOWN_HINT} →</p>}
      </div>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-focus-target={focusTarget}
        aria-label={ariaLabel ?? `${label}: ${value}. ${DRILL_DOWN_HINT}`}
        aria-haspopup="dialog"
        className={`bg-white rounded-2xl p-5 flex flex-col justify-between gap-3 text-left w-full ${
          hasAlert
            ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
            : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100'
        } cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      data-focus-target={focusTarget}
      className={`bg-white rounded-2xl p-5 flex flex-col justify-between gap-3 text-left w-full ${
        hasAlert
          ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
          : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100'
      }`}
    >
      {body}
    </div>
  );
}

export default function ClinicianChart({
  clinicians, summary, pipeline, loading, summaryLoading, workload, workloadLoading, onDrillDown,
}: Props) {
  const kpis = clinicianKpis(clinicians);
  const byCentre = aggregateCliniciansByCentre(clinicians);
  const stuck = summary?.stuckCases ?? 0;
  const inactive = summary?.inactiveCount ?? 0;
  const pipe = pipeline ?? {
    assigned: 0,
    scoringComplete: 0,
    reportPdfCreated: 0,
    reportShared: 0,
    goalsAdded: 0,
    goalsApproved: 0,
  };

  if (loading && clinicians.length === 0) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 animate-pulse" aria-busy="true" role="status">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-white rounded-2xl h-36 border border-gray-100" />
        ))}
      </div>
    );
  }

  if (clinicians.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-400">
        No clinician data for the selected filters
      </div>
    );
  }

  const drill = onDrillDown;
  const activePct = kpis.people > 0 ? Math.round((kpis.activeCount / kpis.people) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Active Caseload"
          value={kpis.totalCaseload.toLocaleString()}
          sub={`${kpis.people} clinicians · avg ${kpis.people > 0 ? (kpis.totalCaseload / kpis.people).toFixed(1) : '—'}/person`}
          tooltip={KPI.CLINICIAN_ACTIVE_CASELOAD}
          iconBg="bg-emerald-50" iconFg="text-emerald-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          clickable={!!drill}
          onClick={() => drill?.({ type: 'clinician-caseload', label: 'Active caseload' })}
        />
        <KpiCard
          label="Report PDFs"
          value={pipe.reportPdfCreated.toLocaleString()}
          sub={`${pipe.scoringComplete.toLocaleString()} scored · assessment-level counts`}
          pct={pipe.assigned > 0 ? Math.round((pipe.reportPdfCreated / pipe.assigned) * 100) : 0}
          ringColor="#378ADD"
          tooltip={KPI.CLINICIAN_RESULTS}
          iconBg="bg-blue-50" iconFg="text-blue-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>}
          clickable={!!drill}
          onClick={() => drill?.({ type: 'clinician-pipeline-report-pdf', label: 'Report PDF created' })}
        />
        <KpiCard
          label="Stuck Cases"
          value={summaryLoading ? '…' : stuck.toLocaleString()}
          sub=">14d assigned, no result"
          hasAlert={stuck > 0}
          tooltip={KPI.CLINICIAN_STUCK_CASES}
          iconBg="bg-rose-50" iconFg="text-rose-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
          clickable={!!drill && stuck > 0}
          onClick={() => drill?.({ type: 'clinician-stuck', label: 'Stuck cases (>14d)' })}
        />
        <KpiCard
          label={IDLE_CLINICIAN_LABEL}
          value={summaryLoading ? '…' : inactive.toLocaleString()}
          sub={IDLE_CLINICIAN_SUBTITLE}
          hasAlert={inactive > 0}
          pct={100 - activePct}
          ringColor="#F59E0B"
          tooltip={KPI.CLINICIAN_IDLE}
          iconBg="bg-amber-50" iconFg="text-amber-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>}
          clickable={!!drill && inactive > 0}
          onClick={() => drill?.({ type: 'clinician-inactive', label: IDLE_CLINICIAN_DRILL_TITLE })}
          focusTarget="clinician-idle"
        />
        <KpiCard
          label="Active Staff"
          value={`${kpis.activeCount}/${kpis.people}`}
          sub={`${activePct}% engaged in period`}
          pct={activePct}
          ringColor="#1D9E75"
          tooltip={KPI.CLINICIAN_ACTIVE_STAFF}
          iconBg="bg-teal-50" iconFg="text-teal-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
        />
      </div>

      <RoleCentreChart
        title="Delivery by centre"
        subtitle="Caseload vs report PDFs — spot high workload and low output"
        rows={byCentre}
        loading={loading}
        onDrillDown={onDrillDown}
        datasets={[
          { label: 'Caseload',    color: 'rgba(29,158,117,0.82)', metricKey: 'metric1', drillType: 'clinician-caseload' },
          { label: 'Report PDFs', color: 'rgba(55,138,221,0.82)', metricKey: 'metric2', drillType: 'clinician-pipeline-report-pdf' },
        ]}
      />

      <WorkloadByCentreTable rows={workload} loading={workloadLoading} />
    </div>
  );
}
