'use client';

import { useState } from 'react';
import type { CentreAdmin } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import UserProfileLink from '@/components/users/UserProfileLink';
import type { ProfileLinkParams } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';

interface Props {
  admins: CentreAdmin[];
  loading: boolean;
  error: string | null;
  linkParams?: ProfileLinkParams;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

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
      className={[
        'px-3 py-[10px] text-[11px] font-medium uppercase tracking-[0.03em] cursor-pointer select-none transition-colors whitespace-nowrap',
        `text-${align}`,
        active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',
      ].join(' ')}
      title={title}
      onClick={() => onSort(col, isText ? 'asc' : 'desc')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {title && (
          <span className="text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal" title={title}>
            ⓘ
          </span>
        )}
        {active && (
          <span className="text-[10px] text-gray-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );
}

function timeAgo(iso: string | null, hasLogin?: boolean): string {
  if (!iso) return hasLogin ? 'Zero activity' : 'Never active';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function lastActiveClass(iso: string | null): string {
  if (!iso) return 'text-[#A32D2D] font-bold';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'text-[#1D9E75]';
  if (days === 1) return 'text-gray-800';
  if (days <= 3)  return 'text-gray-500';
  if (days <= 6)  return 'text-[#BA7517]';
  return 'text-[#A32D2D]';
}

function getVal(a: CentreAdmin, col: string): number | string {
  switch (col) {
    case 'name':        return `${a.lastName} ${a.firstName}`.toLowerCase();
    case 'centreName':  return (a.centreName ?? '').toLowerCase();
    case 'cases':       return a.casesRegistered;
    case 'assigned':    return a.casesAssignedToClinical;
    case 'assignRate':  return a.casesRegistered > 0 ? a.casesAssignedToClinical / a.casesRegistered : -1;
    case 'awaiting':    return Math.max(0, (a.casesRegistered ?? 0) - (a.casesAssignedToClinical ?? 0));
    case 'lastActivity':return a.lastActiveDate ?? '';
    case 'lastLogin':   return a.lastLoginDate ?? '';
    default:            return 0;
  }
}

function applySort(rows: CentreAdmin[], { col, dir }: SortState): CentreAdmin[] {
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

export default function CentreAdminTable({ admins, loading, error, linkParams, onDrillDown }: Props) {
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
        Failed to load centre admin data: {error}
      </div>
    );
  }

  const rows = applySort(admins, sort);

  // col count: # Admin Centre CasesReg Assigned RoutingRate Awaiting LastActive LastLogin
  const colCount = 9;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap min-h-[40px]">
        {loading ? (
          <div className="h-6 w-28 bg-gray-100 rounded-full animate-pulse" />
        ) : (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {rows.length} centre admin{rows.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Centre admin detail table">
          <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
            <tr>
              <th className="px-6 py-[10px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em] w-6">#</th>
              <SortTh col="name"        label="Admin"                sort={sort} onSort={handleSort} isText />
              <SortTh col="centreName"  label="Centre"               sort={sort} onSort={handleSort} isText />
              <SortTh col="cases"       label="Cases Registered"     sort={sort} onSort={handleSort} align="right"
                      title="Cases registered by this admin in the selected period." />
              <SortTh col="assigned"    label="Assessments Assigned" sort={sort} onSort={handleSort} align="right"
                      title="Cases routed to clinicians by this admin in the period." />
              <SortTh col="assignRate"  label="Routing Rate"         sort={sort} onSort={handleSort} align="right"
                      title="% of registered cases that were assigned to a clinician." />
              <SortTh col="awaiting"    label="Awaiting Assignment"  sort={sort} onSort={handleSort} align="right"
                      title="Cases registered but not yet assigned to a clinician." />
              <SortTh col="lastActivity" label="Last Active"         sort={sort} onSort={handleSort}
                      title="Last audit action performed by this user — ever, not limited to the selected period. Login alone does not count as activity." />
              <SortTh col="lastLogin"   label="Last Login"           sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-10 text-center text-gray-400">
                  No centre admin data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((a, idx) => {
                const reg      = a.casesRegistered   ?? 0;
                const assigned = a.casesAssignedToClinical ?? 0;
                const awaiting = Math.max(0, reg - assigned);
                const assignRate = reg > 0 ? Math.min((assigned / reg) * 100, 100) : null;
                const assignRateLabel = assignRate !== null ? `${assignRate.toFixed(0)}%` : '—';
                // Spec: >= 90% green, 70-89% amber, < 70% red
                const assignRateClass =
                  assignRate === null ? 'text-gray-300'
                  : assignRate >= 90   ? 'text-[#1D9E75] font-semibold'
                  : assignRate >= 70   ? 'text-[#BA7517]'
                  : 'text-[#A32D2D]';

                return (
                  <tr key={`${a.id}-${a.centreId ?? idx}`} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>

                    {/* Admin name */}
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={a.id}
                        role="centre-admin"
                        params={{ ...linkParams, centreId: a.centreId }}
                        firstName={a.firstName}
                      >
                        {a.firstName} {a.lastName}
                      </UserProfileLink>
                    </td>

                    {/* Centre */}
                    <td className="px-5 py-3.5 text-gray-600 text-xs max-w-[160px] truncate" title={a.centreName ?? ''}>
                      {shortCentreName(a.centreName)}
                    </td>

                    {/* Cases Registered */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && reg > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'admin-registered',
                            drillUserId: a.id,
                            drillCentreId: a.centreId ?? undefined,
                            label: `Registered · ${a.firstName} ${a.lastName}`,
                          })}
                          className="tabular-nums font-semibold text-gray-800 rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {reg.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums font-semibold ${reg > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                          {reg > 0 ? reg.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Assessments Assigned */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && assigned > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'admin-assigned',
                            drillUserId: a.id,
                            drillCentreId: a.centreId ?? undefined,
                            label: `Routed · ${a.firstName} ${a.lastName}`,
                          })}
                          className="tabular-nums text-gray-800 rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {assigned.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${assigned > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                          {assigned > 0 ? assigned.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Routing Rate */}
                    <td className={`px-5 py-3.5 text-right tabular-nums ${assignRateClass}`}>
                      {assignRateLabel}
                    </td>

                    {/* Awaiting Assignment — red if > 0 */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && awaiting > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'admin-unassigned',
                            drillUserId: a.id,
                            drillCentreId: a.centreId ?? undefined,
                            label: `Awaiting assignment · ${a.firstName} ${a.lastName}`,
                          })}
                          className="tabular-nums font-bold text-[#A32D2D] rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {awaiting.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${awaiting > 0 ? 'font-bold text-[#A32D2D]' : 'text-gray-300'}`}>
                          {awaiting > 0 ? awaiting.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Last Active */}
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${lastActiveClass(a.lastActiveDate ?? null)}`}>
                      {timeAgo(a.lastActiveDate ?? null, !!a.lastLoginDate)}
                    </td>

                    {/* Last Login */}
                    <td className="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm">
                      {timeAgo(a.lastLoginDate)}
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
