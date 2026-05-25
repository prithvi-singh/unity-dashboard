'use client';

import type {
  UserProfileRole,
  ClinicianSummary,
  ManagerSummary,
  CentreAdminSummary,
} from '@/lib/types';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';

function KpiCard({
  label,
  value,
  sub,
  color = 'text-gray-800',
  tooltip,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  tooltip?: KpiDefinition;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-5 py-4">
      <div className="flex items-center">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function fmtHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24 * 10) / 10}d`;
}

interface Props {
  role: UserProfileRole;
  summary: ClinicianSummary | ManagerSummary | CentreAdminSummary;
  loading: boolean;
}

export default function UserKpiCards({ role, summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (role === 'clinician') {
    const s = summary as ClinicianSummary;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KpiCard label="Results" value={s.resultsGenerated.toLocaleString()} color="text-[#378ADD]" tooltip={KPI.CLINICIAN_RESULTS} />
        <KpiCard label="Active Caseload" value={s.activeCaseload.toLocaleString()} color="text-[#1D9E75]" tooltip={KPI.CLINICIAN_ACTIVE_CASELOAD} />
        <KpiCard label="Yield" value={s.yield != null ? `${s.yield}%` : '—'} sub="results ÷ workload" tooltip={KPI.CLINICIAN_YIELD} />
        <KpiCard label="Audit Actions" value={s.totalAuditActions.toLocaleString()} tooltip={KPI.CLINICIAN_AUDIT_ACTIONS} />
        <KpiCard label="Active Days" value={s.activeDays} sub="days with activity" tooltip={KPI.CLINICIAN_ACTIVE_DAYS} />
        <KpiCard label="Avg Time to Result" value={fmtHours(s.avgTimeToResultHours)} sub="assign → result" tooltip={KPI.CLINICIAN_AVG_TIME_TO_RESULT} />
        <KpiCard
          label="Stuck Cases"
          value={s.stuckCases}
          sub=">14d, no result"
          color={s.stuckCases > 0 ? 'text-rose-500' : 'text-gray-800'}
          tooltip={KPI.CLINICIAN_STUCK_CASES}
        />
      </div>
    );
  }

  if (role === 'manager') {
    const s = summary as ManagerSummary;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KpiCard label="Registered" value={s.casesRegistered.toLocaleString()} color="text-[#7F77DD]" tooltip={KPI.MANAGER_CASES_REGISTERED} />
        <KpiCard label="Assigned" value={s.assessmentsAssigned.toLocaleString()} color="text-[#378ADD]" tooltip={KPI.MANAGER_ASSESSMENTS_ASSIGNED} />
        <KpiCard label="Handoff Rate" value={s.handoffRate != null ? `${s.handoffRate}%` : '—'} tooltip={KPI.MANAGER_HANDOFF_RATE} />
        <KpiCard label="Total Actions" value={s.totalActions.toLocaleString()} tooltip={KPI.MANAGER_TOTAL_ACTIONS} />
        <KpiCard label="Avg Onboarding" value={fmtHours(s.avgOnboardingHours)} sub="register → assign" tooltip={KPI.MANAGER_AVG_ONBOARDING} />
        <KpiCard
          label="Stuck Onboarding"
          value={s.stuckOnboarding}
          sub=">48h unassigned"
          color={s.stuckOnboarding > 0 ? 'text-rose-500' : 'text-gray-800'}
          tooltip={KPI.MANAGER_STUCK_ONBOARDING}
        />
        <KpiCard label="Transfers" value={s.transfers} sub={`${s.statusChanges} status changes`} tooltip={KPI.MANAGER_TRANSFERS} />
      </div>
    );
  }

  const s = summary as CentreAdminSummary;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <KpiCard label="Registered" value={s.casesRegistered.toLocaleString()} color="text-[#7F77DD]" tooltip={KPI.ADMIN_CASES_REGISTERED} />
      <KpiCard label="Routed to Clinical" value={s.casesAssignedToClinical.toLocaleString()} color="text-[#378ADD]" tooltip={KPI.ADMIN_ROUTED_TO_CLINICAL} />
      <KpiCard label="Routing Rate" value={s.routingRate != null ? `${s.routingRate}%` : '—'} tooltip={KPI.ADMIN_ROUTING_RATE} />
      <KpiCard label="Total Actions" value={s.totalActions.toLocaleString()} tooltip={KPI.ADMIN_TOTAL_ACTIONS} />
      <KpiCard label="Avg Routing Time" value={fmtHours(s.avgRoutingHours)} sub="register → assign" tooltip={KPI.ADMIN_AVG_ROUTING_TIME} />
      <KpiCard label="Same-Day Routing" value={s.sameDayRoutingPct != null ? `${s.sameDayRoutingPct}%` : '—'} sub="within 24h" tooltip={KPI.ADMIN_SAME_DAY_ROUTING} />
    </div>
  );
}
