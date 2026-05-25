'use client';

import { useState } from 'react';
import type { MonitoringUser } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import {
  isSuperAdmin,
  matchesEngagementFilter,
  engagementFilterLabel,
  type MonitoringEngagementFilter,
} from '@/lib/monitoringStats';
import UserProfileLink from '@/components/users/UserProfileLink';
import { inferProfileRole, ROLE_LABELS } from '@/lib/userProfile';

interface Props {
  users: MonitoringUser[];
  loading: boolean;
  error: string | null;
  engagementFilter?: MonitoringEngagementFilter;
  onClearEngagementFilter?: () => void;
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
  col, label, sort, onSort, align = 'left', isText = false, children,
}: {
  col: string;
  label?: string;
  children?: React.ReactNode;
  sort: SortState;
  onSort: (col: string, def: SortDir) => void;
  align?: 'left' | 'right';
  isText?: boolean;
}) {
  const active = sort.col === col;
  return (
    <th
      className={`px-5 py-3 text-${align} cursor-pointer select-none hover:text-gray-700 transition-colors`}
      onClick={() => onSort(col, isText ? 'asc' : 'desc')}
    >
      <span className="inline-flex items-center gap-1">
        {children ?? label}
        <SortIcon active={active} dir={sort.dir} />
      </span>
    </th>
  );
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-gray-400 text-xs">—</span>;
  const styles: Record<string, string> = {
    Clinician:        'bg-blue-100 text-blue-700',
    CentreManager:    'bg-green-100 text-green-700',
    SuperAdmin:       'bg-purple-100 text-purple-700',
    'Centre Manager': 'bg-green-100 text-green-700',
    'Centre Admin':   'bg-orange-100 text-orange-700',
    'Super Admin':    'bg-purple-100 text-purple-700',
  };
  const cls = styles[role] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {role}
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getVal(u: MonitoringUser, col: string): number | string {
  switch (col) {
    case 'name':           return `${u.lastName} ${u.firstName}`.toLowerCase();
    case 'roleName':       return (u.roleName ?? '').toLowerCase();
    case 'centreName':     return (u.centreName ?? '').toLowerCase();
    case 'active':         return u.active ? 1 : 0;
    case 'actionCount':    return u.actionCount;
    case 'lastActionTime': return u.lastActionTime ?? '';
    default:               return 0;
  }
}

function applySort(rows: MonitoringUser[], { col, dir }: SortState): MonitoringUser[] {
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

export default function UserStatusTable({
  users, loading, error, engagementFilter, onClearEngagementFilter,
}: Props) {
  const [sort, setSort]             = useState<SortState>({ col: 'active', dir: 'desc' });
  const [centreSearch, setCentreSearch] = useState('');

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
        Failed to load user status: {error}
      </div>
    );
  }

  // Collect all centre names per user before deduplicating
  const centresByUser = new Map<number, string[]>();
  for (const u of users) {
    if (!u.centreName) continue;
    const existing = centresByUser.get(u.id) ?? [];
    if (!existing.includes(u.centreName)) existing.push(u.centreName);
    centresByUser.set(u.id, existing);
  }

  const seen = new Set<number>();
  const unique = users
    .filter((u) => !isSuperAdmin(u.roleName))
    .filter((u) => { if (seen.has(u.id)) return false; seen.add(u.id); return true; });

  const sorted = applySort(unique, sort);

  const query = centreSearch.trim().toLowerCase();
  const afterEngagement = engagementFilter
    ? sorted.filter((u) => matchesEngagementFilter(u, engagementFilter))
    : sorted;

  const filtered = !query
    ? afterEngagement
    : afterEngagement.filter((u) => {
        const allCentres = centresByUser.get(u.id) ?? (u.centreName ? [u.centreName] : []);
        return allCentres.some(
          (c) => c.toLowerCase().includes(query) || shortCentreName(c).toLowerCase().includes(query),
        );
      });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">User Status</h2>
          {engagementFilter && engagementFilter.kind !== 'all' && (
            <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Showing: {engagementFilterLabel(engagementFilter)}</span>
              {onClearEngagementFilter && (
                <button
                  type="button"
                  onClick={onClearEngagementFilter}
                  className="text-blue-700 font-semibold hover:underline"
                >
                  Clear
                </button>
              )}
            </p>
          )}
          {query && (
            <p className="text-xs text-gray-400 mt-0.5">
              {filtered.length} of {afterEngagement.length} user{afterEngagement.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="search"
            placeholder="Filter by centre…"
            value={centreSearch}
            onChange={(e) => setCentreSearch(e.target.value)}
            autoComplete="off"
            className="pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 w-52 transition"
          />
          {centreSearch && (
            <button
              onClick={() => setCentreSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm" role="table" aria-label="User activity status table">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              <SortTh col="name"          label="User"    sort={sort} onSort={handleSort} isText />
              <SortTh col="roleName"      label="Role"    sort={sort} onSort={handleSort} isText />
              <SortTh col="centreName"    label="Centre"  sort={sort} onSort={handleSort} isText />
              <SortTh col="active"        label="Status"  sort={sort} onSort={handleSort} />
              <SortTh col="actionCount"   label="Actions" sort={sort} onSort={handleSort} align="right" />
              <SortTh col="lastActionTime" label="Last Action" sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-gray-400">
                  {query ? `No users found for "${centreSearch}"` : 'No user data available'}
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const rowBase  = u.active ? 'border-l-4 border-green-400' : 'border-l-4 border-transparent';
                const textMuted = !u.active ? 'text-gray-400' : '';
                const profileRole = inferProfileRole(u.roleName, u.email, u.firstName, u.lastName);
                const displayRole = profileRole ? ROLE_LABELS[profileRole] : u.roleName;

                return (
                  <tr key={u.id} className={`hover:bg-gray-50/70 transition-colors ${rowBase}`}>
                    <td className={`px-5 py-3.5 font-medium whitespace-nowrap ${textMuted || 'text-gray-800'}`}>
                      {profileRole ? (
                        <UserProfileLink
                          userId={u.id}
                          role={profileRole}
                          className={`${textMuted ? 'text-gray-400 hover:text-gray-700' : 'text-gray-800 hover:text-blue-600'} hover:underline underline-offset-2 transition-colors`}
                        >
                          {u.firstName} {u.lastName}
                        </UserProfileLink>
                      ) : (
                        <span>{u.firstName} {u.lastName}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <RoleBadge role={displayRole} />
                    </td>
                    <td className={`px-5 py-3.5 ${textMuted || 'text-gray-600'}`}>
                      {(() => {
                        const allCentres = centresByUser.get(u.id) ?? [];
                        if (allCentres.length <= 1) {
                          return (
                            <span title={u.centreName ?? undefined}>
                              {shortCentreName(u.centreName)}
                            </span>
                          );
                        }
                        return (
                          <span className="relative group cursor-default">
                            <span className="underline decoration-dotted decoration-gray-400" title={u.centreName ?? undefined}>
                              {shortCentreName(u.centreName)}
                            </span>
                            <span className="absolute left-0 top-full mt-1.5 z-50 hidden group-hover:flex flex-col gap-1 min-w-max bg-gray-900 text-white text-xs rounded-xl px-3 py-2 shadow-lg">
                              <span className="font-semibold text-gray-300 mb-0.5">All centres</span>
                              {allCentres.slice(0, 5).map((name) => (
                                <span key={name} className="whitespace-nowrap" title={name}>
                                  {shortCentreName(name)}
                                </span>
                              ))}
                              {allCentres.length > 5 && (
                                <span className="whitespace-nowrap text-gray-400 mt-0.5">
                                  +{allCentres.length - 5} more centre{allCentres.length - 5 > 1 ? 's' : ''}
                                </span>
                              )}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5">
                        <span className={['h-2 w-2 rounded-full', u.active ? 'bg-green-500' : 'bg-rose-400'].join(' ')} />
                        <span className={`text-xs ${u.active ? 'text-green-700' : 'text-rose-500'}`}>
                          {u.active ? 'Active' : 'No activity'}
                        </span>
                      </span>
                    </td>
                    <td className={`px-5 py-3.5 text-right tabular-nums ${textMuted || 'text-gray-700'}`}>
                      {u.actionCount}
                    </td>
                    <td className={`px-5 py-3.5 whitespace-nowrap ${textMuted || 'text-gray-600'}`}>
                      {formatTime(u.lastActionTime)}
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
