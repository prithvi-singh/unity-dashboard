'use client';

import { useState, useMemo } from 'react';
import type {
  UserBreakdownData,
  UserBreakdownRole,
  UserBreakdownCentre,
} from '@/lib/types';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';
import UserProfileDrawer from './UserProfileDrawer';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDaysAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff}d ago`;
}

function formatPeriodLabel(dateFrom?: string | null, dateTo?: string | null): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  if (dateFrom && dateTo) {
    return dateFrom === dateTo ? fmt(dateFrom) : `${fmt(dateFrom)} – ${fmt(dateTo)}`;
  }
  if (dateFrom) return `from ${fmt(dateFrom)}`;
  if (dateTo) return `to ${fmt(dateTo)}`;
  return 'all time';
}

function pctOf(part: number, total: number): string {
  if (total <= 0) return '0%';
  const pct = (part / total) * 100;
  return pct >= 10 || pct === 0 || pct === 100
    ? `${Math.round(pct)}%`
    : `${pct.toFixed(1)}%`;
}

// ── Role badge colours ────────────────────────────────────────────────────────

const ROLE_BADGE: Record<string, string> = {
  clinician:     'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  manager:       'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  'centre admin':'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  admin:         'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
};

function getRoleBadge(roleName: string): string {
  const lower = roleName.toLowerCase();
  for (const [key, style] of Object.entries(ROLE_BADGE)) {
    if (lower.includes(key)) return style;
  }
  return 'bg-gray-50 text-gray-500 ring-1 ring-gray-200';
}

function RoleBadge({ roleName }: { roleName: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${getRoleBadge(roleName)}`}>
      {roleName}
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      <span className={`text-xs font-medium ${active ? 'text-emerald-700' : 'text-gray-500'}`}>
        {active ? 'Active' : 'Inactive'}
      </span>
    </span>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, icon, color, tooltip,
}: {
  label: string; value: number; sub?: string;
  icon: React.ReactNode; color: 'blue' | 'emerald' | 'gray' | 'amber';
  tooltip?: KpiDefinition;
}) {
  const colorMap = {
    blue:    { bg: 'bg-blue-50',    fg: 'text-blue-600',    val: 'text-blue-700' },
    emerald: { bg: 'bg-emerald-50', fg: 'text-emerald-600', val: 'text-emerald-700' },
    gray:    { bg: 'bg-gray-100',   fg: 'text-gray-500',    val: 'text-gray-700' },
    amber:   { bg: 'bg-amber-50',   fg: 'text-amber-600',   val: 'text-amber-700' },
  };
  const c = colorMap[color];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-3">
      <div className={`${c.bg} ${c.fg} w-9 h-9 rounded-xl flex items-center justify-center`} aria-hidden="true">
        {icon}
      </div>
      <div>
        <div className="flex items-center mb-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em]">{label}</p>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className={`text-[2rem] font-bold leading-none tabular-nums ${c.val}`}>{value.toLocaleString()}</p>
        {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Role breakdown card ───────────────────────────────────────────────────────

const ROLE_ACCENT: Array<{
  match: string;
  dot: string;
  bg: string;
  text: string;
  bar: string;
  barFaint: string;
}> = [
  { match: 'clinician',    dot: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-700',    bar: 'bg-blue-500',    barFaint: 'bg-blue-100' },
  { match: 'manager',      dot: 'bg-violet-500',  bg: 'bg-violet-50',  text: 'text-violet-700',  bar: 'bg-violet-500',  barFaint: 'bg-violet-100' },
  { match: 'centre admin', dot: 'bg-teal-500',    bg: 'bg-teal-50',    text: 'text-teal-700',    bar: 'bg-teal-500',    barFaint: 'bg-teal-100' },
  { match: 'admin',        dot: 'bg-teal-500',    bg: 'bg-teal-50',    text: 'text-teal-700',    bar: 'bg-teal-500',    barFaint: 'bg-teal-100' },
];

const ROLE_ACCENT_DEFAULT = {
  dot: 'bg-gray-400', bg: 'bg-gray-50', text: 'text-gray-600',
  bar: 'bg-gray-400', barFaint: 'bg-gray-100',
};

function getRoleAccent(roleName: string) {
  const lower = roleName.toLowerCase();
  return ROLE_ACCENT.find((a) => lower.includes(a.match)) ?? ROLE_ACCENT_DEFAULT;
}

function RoleBreakdownCard({ roles, periodLabel }: { roles: UserBreakdownRole[]; periodLabel: string }) {
  const sorted = [...roles].sort((a, b) => b.count - a.count);
  const maxCount = sorted[0]?.count ?? 1;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-5">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">Role Breakdown</h3>
          <KpiTooltip {...KPI.USER_ROLE_BREAKDOWN} />
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          By role · active vs quiet · {periodLabel}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-gray-50">
        {sorted.map((role) => {
          const ac = getRoleAccent(role.roleName);
          const activePct = role.count > 0 ? (role.activeCount / role.count) * 100 : 0;
          const widthPct  = maxCount > 0 ? (role.count / maxCount) * 100 : 0;

          return (
            <div key={role.roleName} className="py-3.5 first:pt-0 last:pb-0 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ac.dot}`} />
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ac.bg} ${ac.text}`}>
                    {role.roleName}
                  </span>
                </div>
                <span
                  className="text-xl font-bold tabular-nums text-gray-900 leading-none flex-shrink-0"
                  title={`${role.count.toLocaleString()} in roster`}
                >
                  {role.count.toLocaleString()}
                </span>
              </div>

              <div
                className={`h-2 rounded-full ${ac.barFaint} overflow-hidden`}
                style={{ width: `${widthPct}%`, minWidth: role.count > 0 ? '2.5rem' : undefined }}
                title={`${role.activeCount} active · ${role.inactiveCount} quiet`}
              >
                <div className="h-full flex">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${activePct}%` }}
                  />
                  <div
                    className="h-full bg-gray-300/70 transition-all duration-500"
                    style={{ width: `${100 - activePct}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1" title="Audit activity in selected period">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="font-medium text-emerald-700">{role.activeCount}</span>
                  <span>active</span>
                </span>
                <span className="text-gray-200">·</span>
                <span className="flex items-center gap-1" title="No audit activity in selected period">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                  <span className="font-medium text-gray-500">{role.inactiveCount}</span>
                  <span>quiet</span>
                </span>
                <span className="text-gray-200">·</span>
                <span className={`font-semibold ${activePct >= 70 ? 'text-emerald-600' : activePct >= 40 ? 'text-amber-600' : 'text-rose-500'}`}>
                  {pctOf(role.activeCount, role.count)} active
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Centre breakdown table ────────────────────────────────────────────────────

function CentreBreakdownTable({
  centres,
  periodLabel,
  onUserClick,
}: {
  centres: UserBreakdownCentre[];
  periodLabel: string;
  onUserClick?: (id: number) => void;
}) {
  void onUserClick;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">Centre Breakdown</h3>
          <KpiTooltip {...KPI.USER_CENTRE_BREAKDOWN} />
        </div>
        <p className="text-xs text-gray-400 mt-0.5">Users per centre · {periodLabel}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] border-b border-gray-100">
              <th className="py-2.5 text-left">Centre</th>
              <th className="py-2.5 px-3 text-right">Total</th>
              <th className="py-2.5 px-3 text-right">Active</th>
              <th className="py-2.5 px-3 text-right">Clinicians</th>
              <th className="py-2.5 px-3 text-right">Others</th>
              <th className="py-2.5 pl-3 text-right">Engaged</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {centres.map((c) => {
              const activePct = c.total > 0 ? (c.activeInPeriod / c.total) * 100 : 0;
              return (
                <tr key={c.centreId} className="hover:bg-gray-50/70 transition-colors">
                  <td className="py-3 font-medium text-gray-900 max-w-[200px] truncate" title={c.centreName}>
                    {c.centreName}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold tabular-nums text-gray-800">{c.total}</td>
                  <td className="py-3 px-3 text-right tabular-nums text-emerald-700 font-medium">{c.activeInPeriod}</td>
                  <td className="py-3 px-3 text-right tabular-nums text-blue-600">{c.clinicians}</td>
                  <td className="py-3 px-3 text-right tabular-nums text-violet-600">{c.managers}</td>
                  <td className="py-3 pl-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden" title={`${pctOf(c.activeInPeriod, c.total)} active in period`}>
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${activePct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 tabular-nums w-10 text-right">{pctOf(c.activeInPeriod, c.total)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Attention table (shared for inactive + never active) ──────────────────────

function AttentionRow({
  id, firstName, lastName, email, roleName, centreName, badge, meta, onOpen,
}: {
  id: number; firstName: string; lastName: string; email: string;
  roleName: string; centreName: string | null; badge?: string; meta: string;
  onOpen: (id: number) => void;
}) {
  return (
    <tr
      className="hover:bg-gray-50/70 transition-colors cursor-pointer"
      onClick={() => onOpen(id)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(id); }}
      role="button"
      aria-label={`Open profile for ${firstName} ${lastName}`}
    >
      <td className="py-3 pl-4 pr-3">
        <p className="font-medium text-gray-900">{firstName} {lastName}</p>
        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[180px]">{email}</p>
      </td>
      <td className="py-3 px-3">
        <RoleBadge roleName={roleName} />
      </td>
      <td className="py-3 px-3 text-xs text-gray-600 max-w-[120px] truncate" title={centreName ?? ''}>
        {centreName ?? '—'}
      </td>
      <td className="py-3 px-3 text-xs text-gray-700 whitespace-nowrap">{meta}</td>
      {badge && (
        <td className="py-3 pl-3 pr-4">
          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            {badge}
          </span>
        </td>
      )}
    </tr>
  );
}

// ── Main UsersTab ─────────────────────────────────────────────────────────────

interface Props {
  data: UserBreakdownData | null;
  loading: boolean;
  error: string | null;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 animate-pulse">
      <div className="h-9 w-9 bg-gray-100 rounded-xl mb-4" />
      <div className="h-2.5 w-16 bg-gray-100 rounded mb-2" />
      <div className="h-8 w-12 bg-gray-100 rounded" />
    </div>
  );
}

export default function UsersTab({ data, loading, error }: Props) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [neverSearch, setNeverSearch] = useState('');

  const filteredInactive = useMemo(() => {
    if (!data) return [];
    const q = inactiveSearch.toLowerCase();
    return data.recentlyInactive.filter((u) =>
      !q || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.centreName ?? '').toLowerCase().includes(q)
    );
  }, [data, inactiveSearch]);

  const filteredNever = useMemo(() => {
    if (!data) return [];
    const q = neverSearch.toLowerCase();
    return data.neverActive.filter((u) =>
      !q || `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.centreName ?? '').toLowerCase().includes(q)
    );
  }, [data, neverSearch]);

  const neverActiveCount = data?.neverActive.length ?? 0;
  const periodLabel = formatPeriodLabel(data?.dateFrom, data?.dateTo);

  if (error) {
    return (
      <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load user data: {error}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-5">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <SummaryCard
              label="Total Users"
              value={data.total}
              sub={`${data.byRole.length} role type${data.byRole.length !== 1 ? 's' : ''} · roster`}
              color="blue"
              tooltip={KPI.USER_TOTAL}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            />
            <SummaryCard
              label="Active in Period"
              value={data.byStatus.active}
              sub={`${pctOf(data.byStatus.active, data.total)} of roster · ${periodLabel}`}
              color="emerald"
              tooltip={KPI.USER_ACTIVE_IN_PERIOD}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <SummaryCard
              label="Quiet in Period"
              value={data.byStatus.inactive}
              sub={`${pctOf(data.byStatus.inactive, data.total)} of roster · no audit activity`}
              color="gray"
              tooltip={KPI.USER_QUIET_IN_PERIOD}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              }
            />
            <SummaryCard
              label="Never Active"
              value={neverActiveCount}
              sub={neverActiveCount > 0 ? 'Zero audit history ever' : 'All users have some history'}
              color={neverActiveCount > 0 ? 'amber' : 'emerald'}
              tooltip={KPI.USER_NEVER_ACTIVE}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              }
            />
          </>
        )}
      </div>

      {/* ── Charts row ── */}
      {loading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <RoleBreakdownCard roles={data.byRole} periodLabel={periodLabel} />
          <CentreBreakdownTable centres={data.byCentre} periodLabel={periodLabel} onUserClick={setSelectedUserId} />
        </div>
      )}

      {/* ── Needs Attention ── */}
      {!loading && data && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-900">Needs Attention</h3>
          </div>

          {/* Recently inactive */}
          {data.recentlyInactive.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)]">
              <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1">
                    <h4 className="text-sm font-semibold text-gray-800">
                      Recently Inactive
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
                        {data.recentlyInactive.length}
                      </span>
                    </h4>
                    <KpiTooltip {...KPI.USER_RECENTLY_INACTIVE} />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">No audit activity in the last 30 days</p>
                </div>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search…"
                    value={inactiveSearch}
                    onChange={(e) => setInactiveSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" role="table">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] border-b border-gray-50">
                      <th className="py-2.5 pl-4 pr-3 text-left">User</th>
                      <th className="py-2.5 px-3 text-left">Role</th>
                      <th className="py-2.5 px-3 text-left">Centre</th>
                      <th className="py-2.5 px-3 text-left">Last Active</th>
                      <th className="py-2.5 pl-3 pr-4 text-left">Idle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredInactive.slice(0, 50).map((u) => (
                      <AttentionRow
                        key={u.id}
                        id={u.id}
                        firstName={u.firstName}
                        lastName={u.lastName}
                        email={u.email}
                        roleName={u.roleName}
                        centreName={u.centreName}
                        meta={fmtDaysAgo(u.lastActivityDate)}
                        badge={u.daysSinceActive > 90 ? `${u.daysSinceActive}d` : undefined}
                        onOpen={setSelectedUserId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredInactive.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-6">No results matching your search.</p>
              )}
            </div>
          )}

          {/* Never active */}
          {data.neverActive.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)]">
              <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1">
                    <h4 className="text-sm font-semibold text-gray-800">
                      Never Active
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700">
                        {data.neverActive.length}
                      </span>
                    </h4>
                    <KpiTooltip {...KPI.USER_NEVER_ACTIVE} />
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">Zero recorded actions · all time</p>
                </div>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Search…"
                    value={neverSearch}
                    onChange={(e) => setNeverSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" role="table">
                  <thead>
                    <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] border-b border-gray-50">
                      <th className="py-2.5 pl-4 pr-3 text-left">User</th>
                      <th className="py-2.5 px-3 text-left">Role</th>
                      <th className="py-2.5 px-3 text-left">Centre</th>
                      <th className="py-2.5 pl-3 pr-4 text-left">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredNever.slice(0, 50).map((u) => (
                      <AttentionRow
                        key={u.id}
                        id={u.id}
                        firstName={u.firstName}
                        lastName={u.lastName}
                        email={u.email}
                        roleName={u.roleName}
                        centreName={u.centreName}
                        meta={fmtDate(u.createdDate)}
                        onOpen={setSelectedUserId}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredNever.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-6">No results matching your search.</p>
              )}
            </div>
          )}

          {data.recentlyInactive.length === 0 && data.neverActive.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] px-6 py-10 flex flex-col items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <p className="text-sm font-medium text-gray-700">All users engaged</p>
              <p className="text-xs text-gray-400">Everyone is active.</p>
            </div>
          )}
        </section>
      )}

      {/* Profile drawer */}
      <UserProfileDrawer
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}
