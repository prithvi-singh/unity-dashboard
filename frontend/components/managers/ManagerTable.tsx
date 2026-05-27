'use client';

import React, { useState } from 'react';
import type { Manager } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import UserProfileLink from '@/components/users/UserProfileLink';
import type { ProfileLinkParams } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import RoleBadge from '@/components/shared/RoleBadge';

interface Props {
  managers: Manager[];
  loading: boolean;
  error: string | null;
  linkParams?: ProfileLinkParams;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 text-[10px] ${active ? 'text-gray-600' : 'text-gray-300'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '⇅'}
    </span>
  );
}

function SortTh({
  col, label, sort, onSort, align = 'left', isText = false, title,
}: {
  col: string; label: string; sort: SortState;
  onSort: (col: string, def: SortDir) => void;
  align?: 'left' | 'right'; isText?: boolean; title?: string;
}) {
  const active = sort.col === col;
  return (
    <th
      className={`px-5 py-3 text-${align} cursor-pointer select-none hover:text-gray-700 transition-colors`}
      title={title}
      onClick={() => onSort(col, isText ? 'asc' : 'desc')}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon active={active} dir={sort.dir} />
      </span>
    </th>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function stalenessClass(iso: string | null): string {
  if (!iso) return 'text-gray-300';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 1) return 'text-green-600 font-medium';
  if (days <= 7) return 'text-amber-500';
  return 'text-rose-500';
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}


function getVal(m: Manager, col: string): number | string {
  switch (col) {
    case 'name':              return `${m.lastName} ${m.firstName}`.toLowerCase();
    case 'roleName':          return (m.roleName ?? '').toLowerCase();
    case 'centreName':        return (m.centreName ?? '').toLowerCase();
    case 'cases':             return m.casesRegistered;
    case 'assessments':       return m.assessmentsAssigned;
    case 'assignRate':        return m.casesRegistered > 0 ? m.assessmentsAssigned / m.casesRegistered : -1;
    case 'totalActions':      return m.totalActions;
    case 'reportsToApprove':  return m.reportsToApprove ?? 0;
    case 'goalsToApprove':    return m.goalsToApprove ?? 0;
    case 'pendingApprovals':  return m.pendingApprovals ?? 0;
    case 'lastActivity':      return m.lastActivityDate ?? '';
    case 'lastLogin':         return m.lastLoginDate ?? '';
    default:                  return 0;
  }
}

function applySort(rows: Manager[], { col, dir }: SortState): Manager[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      if (!av) return 1;
      if (!bv) return -1;
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });
}

function ManagerTableInner({ managers, loading, error, linkParams, onDrillDown }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'cases', dir: 'desc' });

  const handleSort = (col: string, def: SortDir) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: def }
    );

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load managers: {error}
      </div>
    );
  }

  const rows = applySort(
    managers.filter((m) => m.roleName !== 'Super Admin'),
    sort,
  );
  const peopleCount = new Set(rows.map((m) => m.id)).size;
  const maxCases       = Math.max(...rows.map((m) => m.casesRegistered), 1);
  const maxAssessments = Math.max(...rows.map((m) => m.assessmentsAssigned), 1);
  const maxActions     = Math.max(...rows.map((m) => m.totalActions), 1);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-medium text-gray-900">Manager Detail</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Sort by column</p>
          <p className="section-click-hint">Click any name to view their full profile</p>
        </div>
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
          {rows.length} centre assignment{rows.length !== 1 ? 's' : ''}
          {peopleCount !== rows.length && ` · ${peopleCount} managers`}
        </span>
      </div>
      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Manager detail table">
          <thead>
            <tr className="border-b border-gray-100 text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
              <th className="px-6 py-3 text-left w-6">#</th>
              <SortTh col="name"             label="Manager"          sort={sort} onSort={handleSort} isText />
              <SortTh col="roleName"         label="Role"             sort={sort} onSort={handleSort} isText />
              <SortTh col="centreName"       label="Centre"           sort={sort} onSort={handleSort} isText />
              <SortTh col="cases"            label="Cases"            sort={sort} onSort={handleSort} align="right" />
              <SortTh col="assessments"      label="Assessments"      sort={sort} onSort={handleSort} align="right" />
              <SortTh col="assignRate"       label="Assign Rate"      sort={sort} onSort={handleSort} align="right"
                      title="Assessments Assigned ÷ Cases Registered" />
              <SortTh col="reportsToApprove" label="Reports to Approve" sort={sort} onSort={handleSort} align="right"
                      title="Reports drafted by clinicians but not yet approved (report_pending_approval state)" />
              <SortTh col="goalsToApprove"   label="Goals to Approve"   sort={sort} onSort={handleSort} align="right"
                      title="Goals submitted by clinicians but not yet approved (goals_pending_approval state)" />
              <SortTh col="totalActions"     label="Total Actions"    sort={sort} onSort={handleSort} align="right" />
              <SortTh col="lastActivity"     label="Last Activity"    sort={sort} onSort={handleSort} />
              <SortTh col="lastLogin"        label="Last Login"       sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 12 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-6 py-10 text-center text-gray-400">
                  No manager data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((m, idx) => {
                const assignRate = m.casesRegistered > 0
                  ? Math.min((m.assessmentsAssigned / m.casesRegistered) * 100, 100)
                  : null;
                const assignRateLabel = assignRate !== null ? `${assignRate.toFixed(0)}%` : '—';
                const assignRateColor =
                  assignRate === null ? 'text-gray-300'
                  : assignRate >= 80   ? 'text-green-600 font-semibold'
                  : assignRate >= 50   ? 'text-amber-500 font-medium'
                  : 'text-rose-500 font-medium';

                return (
                  <tr key={`${m.id}-${m.centreId ?? idx}`} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={m.id}
                        role="manager"
                        params={{ ...linkParams, centreId: m.centreId }}
                        firstName={m.firstName}
                      >
                        {m.firstName} {m.lastName}
                      </UserProfileLink>
                    </td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={m.roleName} />
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 text-xs max-w-[160px] truncate" title={m.centreName ?? ''}>
                      {shortCentreName(m.centreName)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && m.casesRegistered > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-registered',
                            drillUserId: m.id,
                            drillCentreId: m.centreId ?? undefined,
                            label: `Registered · ${m.firstName} ${m.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums font-semibold text-[#7F77DD]">
                            {m.casesRegistered.toLocaleString()}
                          </span>
                          <MiniBar value={m.casesRegistered} max={maxCases} color="bg-[#7F77DD]" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums font-semibold text-[#7F77DD]">
                            {m.casesRegistered.toLocaleString()}
                          </span>
                          <MiniBar value={m.casesRegistered} max={maxCases} color="bg-[#7F77DD]" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && m.assessmentsAssigned > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-assigned',
                            drillUserId: m.id,
                            drillCentreId: m.centreId ?? undefined,
                            label: `Assigned · ${m.firstName} ${m.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums text-[#378ADD]">
                            {m.assessmentsAssigned.toLocaleString()}
                          </span>
                          <MiniBar value={m.assessmentsAssigned} max={maxAssessments} color="bg-[#378ADD]" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums text-[#378ADD]">
                            {m.assessmentsAssigned.toLocaleString()}
                          </span>
                          <MiniBar value={m.assessmentsAssigned} max={maxAssessments} color="bg-[#378ADD]" />
                        </>
                      )}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums ${assignRateColor}`}>
                      {assignRateLabel}
                    </td>

                    {/* Reports to Approve */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`tabular-nums font-bold ${(m.reportsToApprove ?? 0) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {(m.reportsToApprove ?? 0) > 0 ? (m.reportsToApprove ?? 0).toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Goals to Approve */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`tabular-nums font-bold ${(m.goalsToApprove ?? 0) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {(m.goalsToApprove ?? 0) > 0 ? (m.goalsToApprove ?? 0).toLocaleString() : '—'}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <span className="tabular-nums text-gray-600">
                        {m.totalActions.toLocaleString()}
                      </span>
                      <MiniBar value={m.totalActions} max={maxActions} color="bg-gray-300" />
                    </td>
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${stalenessClass(m.lastActivityDate)}`}>
                      {timeAgo(m.lastActivityDate)}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm">
                      {timeAgo(m.lastLoginDate)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}

// Memoized — manager table rows contain nested sort/render logic.
// Prevents re-render when only unrelated parent state changes.
const ManagerTable = React.memo(ManagerTableInner, (prev, next) =>
  prev.managers === next.managers &&
  prev.loading  === next.loading  &&
  prev.error    === next.error    &&
  prev.linkParams === next.linkParams &&
  prev.onDrillDown === next.onDrillDown
);

export default ManagerTable;
