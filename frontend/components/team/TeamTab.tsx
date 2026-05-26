'use client';

import { useState } from 'react';
import type { Clinician, Manager, CentreAdmin, UserBreakdownData, WorkloadCentreRow } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary, ClinicalPipelineData } from '@/lib/roleDrillDown';
import ClinicianChart from '@/components/clinicians/ClinicianChart';
import ClinicianTable from '@/components/clinicians/ClinicianTable';
import ManagerChart from '@/components/managers/ManagerChart';
import ManagerTable from '@/components/managers/ManagerTable';
import CentreAdminChart from '@/components/centre-admins/CentreAdminChart';
import CentreAdminTable from '@/components/centre-admins/CentreAdminTable';
import UsersTab from '@/components/users/UsersTab';

export type TeamRole = 'clinicians' | 'managers' | 'admins' | 'roster';

const ROLE_PILLS: { id: TeamRole; label: string; accent: string }[] = [
  { id: 'clinicians', label: 'Clinicians',    accent: 'focus:ring-blue-500 focus:border-blue-500' },
  { id: 'managers',   label: 'Managers',      accent: 'focus:ring-violet-500 focus:border-violet-500' },
  { id: 'admins',     label: 'Centre Admins', accent: 'focus:ring-teal-500 focus:border-teal-500' },
  { id: 'roster',     label: 'Roster',        accent: 'focus:ring-gray-400 focus:border-gray-400' },
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

  userBreakdown: UserBreakdownData | null;
  userBreakdownLoading: boolean;
  userBreakdownError: string | null;

  linkParams: LinkParams;
  onDrillDown: OnRoleDrillDown;
}

function SearchBar({
  value,
  onChange,
  placeholder,
  accentClass,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  accentClass: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-0 max-w-xs">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
        </svg>
        <input
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 ${accentClass} w-full max-w-xs`}
        />
      </div>
      {value && (
        <button
          onClick={() => onChange('')}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );
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
  userBreakdown,
  userBreakdownLoading,
  userBreakdownError,
  linkParams,
  onDrillDown,
}: TeamTabProps) {
  const [search, setSearch] = useState('');

  const handleRoleChange = (r: TeamRole) => {
    setSearch('');
    onRoleChange(r);
  };

  const currentPill = ROLE_PILLS.find((p) => p.id === role)!;

  return (
    <div
      id="tabpanel-2"
      role="tabpanel"
      aria-labelledby="tab-2"
      className="mt-5 space-y-5"
    >
      {/* Role selector pills */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="View by role">
        {ROLE_PILLS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleRoleChange(id)}
            aria-pressed={role === id}
            className={[
              'px-4 py-1.5 rounded-full text-sm font-semibold transition-all',
              role === id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-800',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Clinicians ──────────────────────────────────────────────── */}
      {role === 'clinicians' && (
        <div className="space-y-5">
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
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search clinicians…"
            accentClass={currentPill.accent}
          />
          <ClinicianTable
            clinicians={clinicians.filter((c) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
                (c.centreName ?? '').toLowerCase().includes(q)
              );
            })}
            loading={cliniciansLoading}
            error={cliniciansError}
            linkParams={linkParams}
            onDrillDown={onDrillDown}
          />
        </div>
      )}

      {/* ── Managers ────────────────────────────────────────────────── */}
      {role === 'managers' && (
        <div className="space-y-5">
          <ManagerChart
            managers={managers}
            summary={managerSummary}
            loading={managersLoading}
            summaryLoading={managerSummaryLoading}
            onDrillDown={onDrillDown}
          />
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search managers…"
            accentClass={currentPill.accent}
          />
          <ManagerTable
            managers={managers.filter((m) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
                (m.centreName ?? '').toLowerCase().includes(q) ||
                (m.roleName ?? '').toLowerCase().includes(q)
              );
            })}
            loading={managersLoading}
            error={managersError}
            linkParams={linkParams}
            onDrillDown={onDrillDown}
          />
        </div>
      )}

      {/* ── Centre Admins ────────────────────────────────────────────── */}
      {role === 'admins' && (
        <div className="space-y-5">
          <CentreAdminChart
            admins={admins}
            summary={adminSummary}
            loading={adminsLoading}
            summaryLoading={adminSummaryLoading}
            onDrillDown={onDrillDown}
          />
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search centre admins…"
            accentClass={currentPill.accent}
          />
          <CentreAdminTable
            admins={admins.filter((a) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                `${a.firstName} ${a.lastName}`.toLowerCase().includes(q) ||
                (a.centreName ?? '').toLowerCase().includes(q)
              );
            })}
            loading={adminsLoading}
            error={adminsError}
            linkParams={linkParams}
            onDrillDown={onDrillDown}
          />
        </div>
      )}

      {/* ── Roster ──────────────────────────────────────────────────── */}
      {role === 'roster' && (
        <UsersTab
          data={userBreakdown}
          loading={userBreakdownLoading}
          error={userBreakdownError}
        />
      )}
    </div>
  );
}
