'use client';

import type {
  UserProfileRole,
  ClinicianCoreMetrics,
  ManagerCoreMetrics,
  OpsAdminCoreMetrics,
  ConsistencyScore,
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
    <div className="bg-gray-50 rounded-xl px-4 py-3.5">
      <div className="flex items-center gap-1">
        <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">{label}</p>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function fmtDays(d: number | null): string {
  if (d == null) return '—';
  if (d < 1) return '<1d';
  return `${Math.round(d * 10) / 10}d`;
}


interface Props {
  role: UserProfileRole;
  coreMetrics: ClinicianCoreMetrics | ManagerCoreMetrics | OpsAdminCoreMetrics;
  consistencyScore: ConsistencyScore;
  loading: boolean;
}

export default function UserKpiCards({ role, coreMetrics, consistencyScore, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-gray-50 rounded-xl p-4 animate-pulse">
            <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
            <div className="h-7 w-12 bg-gray-200 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const activeDays = consistencyScore.coreJobDays;

  if (role === 'clinician') {
    const s = coreMetrics as ClinicianCoreMetrics;
    const pl = s.pipelineBreakdown;
    const totalActive = (pl?.scoring ?? 0) + (pl?.reportsToWrite ?? 0) + (pl?.goalsToAdd ?? 0) + (pl?.pendingApproval ?? 0);
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        {/* Period-scoped activity metrics */}
        <KpiCard
          label="Assessments Scored"
          value={s.assessmentsScored.toLocaleString()}
          color="text-[#378ADD]"
          tooltip={KPI.CLINICIAN_ASSESSMENTS_SCORED}
        />
        <KpiCard
          label="Reports Drafted"
          value={s.reportsDrafted.toLocaleString()}
          color="text-[#1D9E75]"
          tooltip={KPI.CLINICIAN_REPORTS_DRAFTED}
        />
        <KpiCard
          label="Goals Added"
          value={s.goalsAdded.toLocaleString()}
          color="text-[#7F77DD]"
          tooltip={KPI.CLINICIAN_GOALS_ADDED}
        />
        <KpiCard
          label="Avg Days to Result"
          value={fmtDays(s.avgDaysToResult)}
          sub="assign → score"
          tooltip={KPI.CLINICIAN_AVG_TIME_TO_RESULT}
        />
        {/* Point-in-time pipeline state counts */}
        <KpiCard
          label="In Scoring"
          value={pl?.scoring ?? s.activeCaseload}
          sub="Cases being scored"
          color={(s.stuckCases > 0) ? 'text-rose-500' : 'text-gray-800'}
          tooltip={KPI.CLINICIAN_ACTIVE_CASELOAD}
        />
        <KpiCard
          label="Reports to Draft"
          value={pl?.reportsToWrite ?? 0}
          sub="Scored, report pending"
          color={(pl?.reportsToWrite ?? 0) > 0 ? 'text-amber-500' : 'text-gray-800'}
          tooltip={KPI.CLINICIAN_REPORTS_DRAFTED}
        />
        <KpiCard
          label="Goals to Add"
          value={pl?.goalsToAdd ?? 0}
          sub="Report approved, goals pending"
          color={(pl?.goalsToAdd ?? 0) > 0 ? 'text-amber-500' : 'text-gray-800'}
          tooltip={KPI.CLINICIAN_GOALS_ADDED}
        />
        <KpiCard
          label="Total Active"
          value={totalActive}
          sub="All open cases"
          tooltip={KPI.CLINICIAN_ACTIVE_CASELOAD}
        />
      </div>
    );
  }

  if (role === 'manager') {
    const s = coreMetrics as ManagerCoreMetrics;
    const reportsToApprove = s.reportsToApprove ?? 0;
    const goalsToApprove   = s.goalsToApprove   ?? 0;
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <KpiCard
          label="Reports to Approve"
          value={reportsToApprove}
          color={reportsToApprove > 0 ? 'text-rose-600' : 'text-gray-800'}
          tooltip={{ title: 'Reports to Approve', description: "Reports currently awaiting this manager's approval (point-in-time snapshot, not date-filtered)" }}
        />
        <KpiCard
          label="Goals to Approve"
          value={goalsToApprove}
          color={goalsToApprove > 0 ? 'text-rose-600' : 'text-gray-800'}
          tooltip={{ title: 'Goals to Approve', description: "Goal sets currently awaiting this manager's approval (point-in-time snapshot, not date-filtered)" }}
        />
        <KpiCard
          label="Reports Approved"
          value={s.reportsApproved.toLocaleString()}
          color="text-[#378ADD]"
          sub="this period"
          tooltip={KPI.MANAGER_REPORTS_APPROVED}
        />
        <KpiCard
          label="Goals Approved"
          value={s.goalsApproved.toLocaleString()}
          color="text-[#1D9E75]"
          sub="this period"
          tooltip={KPI.MANAGER_GOALS_APPROVED}
        />
        <KpiCard
          label="Avg Days to Approve"
          value={fmtDays(s.avgDaysToApproveReport)}
          sub="reports"
          tooltip={KPI.MANAGER_AVG_DAYS_APPROVE_REPORT}
        />
        <KpiCard
          label="Avg Days to Approve"
          value={fmtDays(s.avgDaysToApproveGoal)}
          sub="goals"
          tooltip={KPI.MANAGER_AVG_DAYS_APPROVE_GOAL}
        />
        <KpiCard
          label="Active Days"
          value={activeDays}
          sub="core job days"
          tooltip={KPI.MANAGER_ACTIVE_DAYS}
        />
      </div>
    );
  }

  // centre-admin
  const s = coreMetrics as OpsAdminCoreMetrics;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <KpiCard
        label="Cases Registered"
        value={s.casesRegistered.toLocaleString()}
        color="text-[#7F77DD]"
        tooltip={KPI.ADMIN_CASES_REGISTERED}
      />
      <KpiCard
        label="Clinicians Assigned"
        value={s.cliniciansAssigned.toLocaleString()}
        color="text-[#378ADD]"
        tooltip={KPI.ADMIN_CLINICIANS_ASSIGNED}
      />
      <KpiCard
        label="Avg Days to Assign"
        value={fmtDays(s.avgDaysToAssign)}
        sub="register → assign"
        tooltip={KPI.ADMIN_AVG_DAYS_TO_ASSIGN}
      />
      <KpiCard
        label="Stuck Onboarding"
        value={s.stuckOnboarding}
        sub=">48h unassigned"
        color={s.stuckOnboarding > 0 ? 'text-rose-500' : 'text-gray-800'}
        tooltip={KPI.ADMIN_STUCK_ONBOARDING}
      />
      <KpiCard
        label="Active Days"
        value={activeDays}
        sub="core job days"
        tooltip={KPI.ADMIN_ACTIVE_DAYS}
      />
    </div>
  );
}
