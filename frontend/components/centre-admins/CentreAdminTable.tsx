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

function getVal(a: CentreAdmin, col: string): number | string {
  switch (col) {
    case 'name':                  return `${a.lastName} ${a.firstName}`.toLowerCase();
    case 'centreName':            return (a.centreName ?? '').toLowerCase();
    case 'cases':                 return a.casesRegistered;
    case 'assigned':              return a.casesAssignedToClinical;
    case 'assignRate':            return a.casesRegistered > 0 ? a.casesAssignedToClinical / a.casesRegistered : -1;
    case 'totalActions':          return a.totalActions;
    case 'lastActivity':          return a.lastActivityDate ?? '';
    case 'lastLogin':             return a.lastLoginDate ?? '';
    default:                      return 0;
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

  const rows        = applySort(admins, sort);
  const peopleCount = new Set(rows.map((a) => a.id)).size;
  const maxCases        = Math.max(...rows.map((a) => a.casesRegistered), 1);
  const maxAssigned     = Math.max(...rows.map((a) => a.casesAssignedToClinical), 1);
  const maxActions      = Math.max(...rows.map((a) => a.totalActions), 1);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Centre Admin Detail</h2>
          <p className="text-xs text-gray-400 mt-0.5">Sort by column</p>
        </div>
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
          {rows.length} centre assignment{rows.length !== 1 ? 's' : ''}
          {peopleCount !== rows.length && ` · ${peopleCount} admins`}
        </span>
      </div>
      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="Centre admin detail table">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              <th className="px-6 py-3 text-left w-6">#</th>
              <SortTh col="name"        label="Admin"                sort={sort} onSort={handleSort} isText />
              <SortTh col="centreName"  label="Centre"               sort={sort} onSort={handleSort} isText />
              <SortTh col="cases"       label="Cases Registered"     sort={sort} onSort={handleSort} align="right" />
              <SortTh col="assigned"    label="Assigned to Clinical" sort={sort} onSort={handleSort} align="right" />
              <SortTh col="assignRate"  label="Assignment Rate"      sort={sort} onSort={handleSort} align="right"
                      title="Cases Assigned to Clinical ÷ Cases Registered" />
              <SortTh col="totalActions" label="Total Actions"       sort={sort} onSort={handleSort} align="right" />
              <SortTh col="lastActivity" label="Last Activity"       sort={sort} onSort={handleSort} />
              <SortTh col="lastLogin"    label="Last Login"          sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 9 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-10 text-center text-gray-400">
                  No centre admin data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((a, idx) => {
                const assignRate = a.casesRegistered > 0
                  ? Math.min((a.casesAssignedToClinical / a.casesRegistered) * 100, 100)
                  : null;
                const assignRateLabel = assignRate !== null ? `${assignRate.toFixed(0)}%` : '—';
                const assignRateColor =
                  assignRate === null ? 'text-gray-300'
                  : assignRate >= 80   ? 'text-green-600 font-semibold'
                  : assignRate >= 50   ? 'text-amber-500 font-medium'
                  : 'text-rose-500 font-medium';

                return (
                  <tr key={`${a.id}-${a.centreId ?? idx}`} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={a.id}
                        role="centre-admin"
                        params={{ ...linkParams, centreId: a.centreId }}
                        className="text-gray-800 hover:text-blue-600 hover:underline underline-offset-2 transition-colors"
                      >
                        {a.firstName} {a.lastName}
                      </UserProfileLink>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 text-xs max-w-[160px] truncate" title={a.centreName ?? ''}>
                      {shortCentreName(a.centreName)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && a.casesRegistered > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'admin-registered',
                            drillUserId: a.id,
                            drillCentreId: a.centreId ?? undefined,
                            label: `Registered · ${a.firstName} ${a.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums font-semibold text-teal-600">
                            {a.casesRegistered.toLocaleString()}
                          </span>
                          <MiniBar value={a.casesRegistered} max={maxCases} color="bg-teal-500" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums font-semibold text-teal-600">
                            {a.casesRegistered.toLocaleString()}
                          </span>
                          <MiniBar value={a.casesRegistered} max={maxCases} color="bg-teal-500" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && a.casesAssignedToClinical > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'admin-assigned',
                            drillUserId: a.id,
                            drillCentreId: a.centreId ?? undefined,
                            label: `Routed · ${a.firstName} ${a.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums text-orange-500">
                            {a.casesAssignedToClinical.toLocaleString()}
                          </span>
                          <MiniBar value={a.casesAssignedToClinical} max={maxAssigned} color="bg-orange-400" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums text-orange-500">
                            {a.casesAssignedToClinical.toLocaleString()}
                          </span>
                          <MiniBar value={a.casesAssignedToClinical} max={maxAssigned} color="bg-orange-400" />
                        </>
                      )}
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums ${assignRateColor}`}>
                      {assignRateLabel}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="tabular-nums text-gray-600">
                        {a.totalActions.toLocaleString()}
                      </span>
                      <MiniBar value={a.totalActions} max={maxActions} color="bg-gray-300" />
                    </td>
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${stalenessClass(a.lastActivityDate)}`}>
                      {timeAgo(a.lastActivityDate)}
                    </td>
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
