'use client';

import { useState, useCallback } from 'react';
import type { Clinician, Manager, CentreAdmin, UserBreakdownData, WorkloadCentreRow, CentresOverviewData, FilterParams } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary, ClinicalPipelineData } from '@/lib/roleDrillDown';
import ClinicianChart from '@/components/clinicians/ClinicianChart';
import ClinicianTable from '@/components/clinicians/ClinicianTable';
import WorkloadByCentreTable from '@/components/clinicians/WorkloadByCentreTable';
import ManagerChart, { buildManagerCentreRows, ManagerCentreActivityTable } from '@/components/managers/ManagerChart';
import ManagerTable from '@/components/managers/ManagerTable';
import PendingManagerActions from '@/components/managers/PendingManagerActions';
import CentreAdminChart from '@/components/centre-admins/CentreAdminChart';
import CentreAdminTable from '@/components/centre-admins/CentreAdminTable';
import UsersTab from '@/components/users/UsersTab';
import CentresTab from '@/components/centres/CentresTab';
import ErrorBoundary from '@/components/shared/ErrorBoundary';

// ── CSV export helpers ─────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function fmtDateCsv(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB');
}

function groupClinicianRowsForExport(rows: Clinician[]) {
  const map = new Map<number, {
    firstName: string; lastName: string; email: string; centres: string[];
    scoringComplete: number; reportsDrafted: number; reportEdits: number;
    pipelineGoals: number; progressNotes: number; goalsDocumented: number;
    activeCaseload: number; lastActivityDate: string | null; lastLoginDate: string | null;
  }>();
  for (const c of rows) {
    const existing = map.get(c.id);
    if (existing) {
      if (!existing.centres.includes(c.centreName ?? '')) existing.centres.push(c.centreName ?? '');
      existing.scoringComplete  += c.scoringComplete  ?? 0;
      existing.reportsDrafted   += c.reportsDrafted   ?? 0;
      existing.reportEdits      += c.reportEdits      ?? 0;
      existing.pipelineGoals    += c.pipelineBreakdown?.goalsToAdd ?? 0;
      existing.progressNotes    += c.progressNotes    ?? 0;
      existing.goalsDocumented  += c.goalsDocumented  ?? 0;
      existing.activeCaseload   += c.activeCaseload;
      if (c.lastActivityDate && (!existing.lastActivityDate || c.lastActivityDate > existing.lastActivityDate))
        existing.lastActivityDate = c.lastActivityDate;
      if (c.lastLoginDate && (!existing.lastLoginDate || c.lastLoginDate > existing.lastLoginDate))
        existing.lastLoginDate = c.lastLoginDate;
    } else {
      map.set(c.id, {
        firstName: c.firstName, lastName: c.lastName, email: c.email,
        centres:          [c.centreName ?? ''],
        scoringComplete:  c.scoringComplete  ?? 0,
        reportsDrafted:   c.reportsDrafted   ?? 0,
        reportEdits:      c.reportEdits      ?? 0,
        pipelineGoals:    c.pipelineBreakdown?.goalsToAdd ?? 0,
        progressNotes:    c.progressNotes    ?? 0,
        goalsDocumented:  c.goalsDocumented  ?? 0,
        activeCaseload:   c.activeCaseload,
        lastActivityDate: c.lastActivityDate,
        lastLoginDate:    c.lastLoginDate,
      });
    }
  }
  return Array.from(map.values());
}

export type TeamRole = 'clinicians' | 'managers' | 'admins' | 'centres' | 'roster';

// ── Sub-tab navigation standard ───────────────────────────────────────────────
// Active: font-weight 500, 2px border-bottom, text-primary, no background fill
// Inactive: text-secondary, no border
// Order: Clinicians | Managers | Centre Admins | Centres | Roster

const ROLE_TABS: { id: TeamRole; label: string }[] = [
  { id: 'clinicians', label: 'Clinicians'   },
  { id: 'managers',   label: 'Managers'     },
  { id: 'admins',     label: 'Centre Admins'},
  { id: 'centres',    label: 'Centres'      },
  { id: 'roster',     label: 'Roster'       },
];

interface LinkParams {
  centreId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface TeamTabProps {
  role: TeamRole;
  onRoleChange: (role: TeamRole) => void;

  clinicians: Clinician[];
  cliniciansLoading: boolean;
  cliniciansError: string | null;
  clinicianSummary: RoleSummary | null;
  clinicianSummaryLoading: boolean;
  clinicalPipeline: ClinicalPipelineData | null;
  clinicalPipelineLoading: boolean;
  workload: WorkloadCentreRow[] | null;
  workloadLoading: boolean;
  workloadError: string | null;
  onWorkloadRetry: () => void;

  managers: Manager[];
  managersLoading: boolean;
  managersError: string | null;
  managerSummary: RoleSummary | null;
  managerSummaryLoading: boolean;

  admins: CentreAdmin[];
  adminsLoading: boolean;
  adminsError: string | null;
  adminSummary: RoleSummary | null;
  adminSummaryLoading: boolean;

  centresData: CentresOverviewData | null;
  centresLoading: boolean;
  centresError: string | null;

  userBreakdown: UserBreakdownData | null;
  userBreakdownLoading: boolean;
  userBreakdownError: string | null;

  linkParams: LinkParams;
  filters: FilterParams;
  onDrillDown: OnRoleDrillDown;
}

export default function TeamTab({
  role,
  onRoleChange,
  clinicians,
  cliniciansLoading,
  cliniciansError,
  clinicianSummary,
  clinicianSummaryLoading,
  clinicalPipeline,
  clinicalPipelineLoading,
  workload,
  workloadLoading,
  workloadError,
  onWorkloadRetry,
  managers,
  managersLoading,
  managersError,
  managerSummary,
  managerSummaryLoading,
  admins,
  adminsLoading,
  adminsError,
  adminSummary,
  adminSummaryLoading,
  centresData,
  centresLoading,
  centresError,
  userBreakdown,
  userBreakdownLoading,
  userBreakdownError,
  linkParams,
  filters,
  onDrillDown,
}: TeamTabProps) {
  const [clinicianSearch, setClinicianSearch] = useState('');
  const [managerSearch, setManagerSearch] = useState('');
  const [adminSearch, setAdminSearch] = useState('');

  // ── Filtered rows (shared between table render and CSV export) ─────────────
  const filteredClinicians = clinicians.filter((c) => {
    if (!clinicianSearch) return true;
    const q = clinicianSearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || (c.centreName ?? '').toLowerCase().includes(q);
  });

  const filteredManagers = managers.filter((m) => {
    if (!managerSearch) return true;
    const q = managerSearch.toLowerCase();
    const centreMatch = m.centres?.some((c) => c.centreName.toLowerCase().includes(q))
      ?? (m.centreName ?? '').toLowerCase().includes(q);
    return `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) || centreMatch || (m.roleName ?? '').toLowerCase().includes(q);
  });

  const filteredAdmins = admins.filter((a) => {
    if (!adminSearch) return true;
    const q = adminSearch.toLowerCase();
    return `${a.firstName} ${a.lastName}`.toLowerCase().includes(q) || (a.centreName ?? '').toLowerCase().includes(q);
  });

  // ── CSV export handlers ────────────────────────────────────────────────────
  const handleExportClinicians = useCallback(() => {
    const grouped = groupClinicianRowsForExport(filteredClinicians);
    exportCsv(
      `unity-clinician-detail-${todayStr()}.csv`,
      ['Name', 'Email', 'Centre', 'Assessments Scored', 'Reports Drafted', 'Report Edits', 'Active Cases', 'Scoring Backlog', 'Reports Pending', 'Goals Pending', 'Progress Notes', 'Goals Documented', 'Last Active', 'Last Login'],
      grouped.map((g) => [
        `${g.firstName} ${g.lastName}`, g.email, g.centres.join(' | '),
        String(g.scoringComplete), String(g.reportsDrafted), String(g.reportEdits),
        String(g.activeCaseload), String(0), String(0), String(g.pipelineGoals),
        String(g.progressNotes), String(g.goalsDocumented),
        fmtDateCsv(g.lastActivityDate), fmtDateCsv(g.lastLoginDate),
      ]),
    );
  }, [filteredClinicians]);

  const handleExportManagers = useCallback(() => {
    const visible = filteredManagers.filter((m) => m.roleName !== 'Super Admin');
    const deduped = [...new Map(visible.map((m) => [m.id, m])).values()];
    exportCsv(
      `unity-manager-detail-${todayStr()}.csv`,
      ['Name', 'Email', 'Centre', 'Reports to Approve', 'Goals to Approve', 'Reports Approved', 'Goals Approved', 'Avg Approval Time', 'Assessments Scored', 'Reports Drafted', 'Progress Notes', 'Cases Registered', 'Assessments Assigned', 'Last Active', 'Last Login'],
      deduped.map((m) => [
        `${m.firstName} ${m.lastName}`, m.email,
        m.centres?.map((c) => c.centreName).join(' | ') ?? m.centreName ?? '',
        String(m.reportsToApprove ?? 0), String(m.goalsToApprove ?? 0),
        String(m.reportsApproved ?? 0), String(m.goalsApproved ?? 0),
        m.avgApprovalDays != null ? `${m.avgApprovalDays.toFixed(1)}d` : 'N/A',
        String(m.assessmentsScored ?? 0), String(m.reportsDrafted ?? 0),
        String(m.progressNotes ?? 0),
        String(m.casesRegistered), String(m.assessmentsAssigned),
        fmtDateCsv(m.lastActivityDate), fmtDateCsv(m.lastLoginDate),
      ]),
    );
  }, [filteredManagers]);

  const handleExportAdmins = useCallback(() => {
    exportCsv(
      `unity-ops-detail-${todayStr()}.csv`,
      ['Name', 'Email', 'Centre', 'Cases Registered', 'Assessments Assigned', 'Routing Rate', 'Awaiting Assignment', 'Last Active', 'Last Login'],
      filteredAdmins.map((a) => {
        const reg      = a.casesRegistered ?? 0;
        const assigned = a.casesAssignedToClinical ?? 0;
        const rate     = reg > 0 ? `${Math.min(Math.round((assigned / reg) * 100), 100)}%` : '—';
        return [
          `${a.firstName} ${a.lastName}`, a.email, a.centreName ?? '',
          String(reg), String(assigned), rate,
          String(Math.max(0, reg - assigned)),
          fmtDateCsv(a.lastActivityDate), fmtDateCsv(a.lastLoginDate),
        ];
      }),
    );
  }, [filteredAdmins]);

  const handleRoleChange = (r: TeamRole) => {
    setClinicianSearch('');
    setManagerSearch('');
    setAdminSearch('');
    onRoleChange(r);
  };

  return (
    <div
      id="tabpanel-2"
      role="tabpanel"
      aria-labelledby="tab-2"
      className="mt-5 space-y-5"
    >
      {/* ── Sub-tab navigation ──────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap border-b border-gray-200"
        role="tablist"
        aria-label="View by role"
      >
        {ROLE_TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={role === id}
            onClick={() => handleRoleChange(id)}
            className={[
              'px-4 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 whitespace-nowrap',
              role === id
                ? 'font-medium text-gray-900 border-b-2 border-gray-900 -mb-px'
                : 'text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── CLINICIANS ──────────────────────────────────────────────────────── */}
      {/* Section order: Metric cards → Clinician Detail table →              */}
      {/*               Centre Activity Summary → Period Consistency           */}
      {role === 'clinicians' && (
        <ErrorBoundary label="Clinicians">
          <div className="space-y-8">

            {/* 1. Metric cards */}
            <ClinicianChart
              clinicians={clinicians}
              summary={clinicianSummary}
              pipeline={clinicalPipeline}
              loading={cliniciansLoading}
              summaryLoading={clinicianSummaryLoading}
              workload={workload}
              workloadLoading={workloadLoading}
              onDrillDown={onDrillDown}
            />

            {/* 2. Clinician Detail table */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <h2 className="text-[15px] font-medium text-gray-900">Clinician detail</h2>
                  <p className="text-[12px] text-gray-500 mt-0.5">Click any name to view full profile</p>
                </div>
                <div className="flex items-center gap-2">
                  {clinicianSearch && (
                    <button
                      type="button"
                      onClick={() => setClinicianSearch('')}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportClinicians}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
                  >
                    ↓ Export CSV
                  </button>
                </div>
              </div>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Filter by name or centre…"
                  value={clinicianSearch}
                  onChange={(e) => setClinicianSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-full max-w-xs"
                />
              </div>
              <ClinicianTable
                clinicians={filteredClinicians}
                loading={cliniciansLoading}
                error={cliniciansError}
                linkParams={linkParams}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* 3. Centre Activity Summary — clinician KPIs */}
            <WorkloadByCentreTable
              rows={workload ?? null}
              loading={workloadLoading}
              error={workloadError}
              onRetry={onWorkloadRetry}
            />

          </div>
        </ErrorBoundary>
      )}

      {/* ── MANAGERS ────────────────────────────────────────────────────────── */}
      {/* Section order: Metric cards → Pending manager actions →               */}
      {/*               Manager Detail table → Centre Activity Summary          */}
      {role === 'managers' && (
        <ErrorBoundary label="Managers">
          <div className="space-y-8">

            {/* 1. Metric cards */}
            <ManagerChart
              managers={managers}
              summary={managerSummary}
              loading={managersLoading}
              summaryLoading={managerSummaryLoading}
              workload={workload}
              workloadLoading={workloadLoading}
              onDrillDown={onDrillDown}
              hideCentreActivity
            />

            {/* 2. Pending manager actions */}
            <PendingManagerActions filters={filters} onDrillDown={onDrillDown} />

            {/* 3. Manager Detail table */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <h2 className="text-[15px] font-medium text-gray-900">Manager detail</h2>
                  <p className="text-[12px] text-gray-500 mt-0.5">Click any name to view full profile</p>
                </div>
                <div className="flex items-center gap-2">
                  {managerSearch && (
                    <button type="button" onClick={() => setManagerSearch('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportManagers}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
                  >
                    ↓ Export CSV
                  </button>
                </div>
              </div>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Filter by name or centre…"
                  value={managerSearch}
                  onChange={(e) => setManagerSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 w-full max-w-xs"
                />
              </div>
              <ManagerTable
                managers={filteredManagers}
                loading={managersLoading}
                error={managersError}
                linkParams={linkParams}
                onDrillDown={onDrillDown}
              />
            </div>

            {/* 4. Centre Activity Summary */}
            <ManagerCentreActivityTable
              rows={buildManagerCentreRows(managers, workload ?? null)}
              loading={managersLoading || (workloadLoading ?? false)}
            />

          </div>
        </ErrorBoundary>
      )}

      {/* ── CENTRE ADMINS ────────────────────────────────────────────────────── */}
      {/* Section order: Metric cards → Centre Intake Summary →                 */}
      {/*               Centre Admin Detail table → Period Consistency           */}
      {role === 'admins' && (
        <ErrorBoundary label="Centre Admins">
          <div className="space-y-8">

            {/* 1. Metric cards */}
            <CentreAdminChart
              admins={admins}
              summary={adminSummary}
              loading={adminsLoading}
              summaryLoading={adminSummaryLoading}
              onDrillDown={onDrillDown}
            />

            {/* 2. Centre Admin Detail table */}
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <h2 className="text-[15px] font-medium text-gray-900">Centre admin detail</h2>
                  <p className="text-[12px] text-gray-500 mt-0.5">Click any name to view full profile</p>
                </div>
                <div className="flex items-center gap-2">
                  {adminSearch && (
                    <button type="button" onClick={() => setAdminSearch('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportAdmins}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors shrink-0"
                  >
                    ↓ Export CSV
                  </button>
                </div>
              </div>
              <div className="relative mb-3">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                </svg>
                <input
                  type="search"
                  placeholder="Filter by name or centre…"
                  value={adminSearch}
                  onChange={(e) => setAdminSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-400 w-full max-w-xs"
                />
              </div>
              <CentreAdminTable
                admins={filteredAdmins}
                loading={adminsLoading}
                error={adminsError}
                linkParams={linkParams}
                onDrillDown={onDrillDown}
              />
            </div>

          </div>
        </ErrorBoundary>
      )}

      {/* ── CENTRES ─────────────────────────────────────────────────────────── */}
      {/* Section order: Metric cards → Centre Status table → Detail drawer    */}
      {role === 'centres' && (
        <ErrorBoundary label="Centres">
          <CentresTab
            data={centresData}
            loading={centresLoading}
            error={centresError}
            filters={filters}
            workload={workload}
            workloadLoading={workloadLoading}
            workloadError={workloadError}
            onWorkloadRetry={onWorkloadRetry}
            onDrillDown={onDrillDown}
          />
        </ErrorBoundary>
      )}

      {/* ── ROSTER ──────────────────────────────────────────────────────────── */}
      {/* Section order: Metric cards → Role Breakdown → Centre Breakdown →    */}
      {/*               Needs Attention                                         */}
      {role === 'roster' && (
        <ErrorBoundary label="Roster">
          <UsersTab
            data={userBreakdown}
            loading={userBreakdownLoading}
            error={userBreakdownError}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
