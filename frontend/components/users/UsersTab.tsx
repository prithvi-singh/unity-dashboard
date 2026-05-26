'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type {
  UserBreakdownData,
  UserBreakdownRole,
  UserBreakdownCentre,
  RosterListUser,
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

/** Convert CamelCase role names to plain English: "CentreManager" → "Centre Manager" */
function formatRoleName(roleName: string): string {
  if (!roleName) return roleName;
  return roleName.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
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
      {formatRoleName(roleName)}
    </span>
  );
}

// ── Role accent colours ───────────────────────────────────────────────────────

const ROLE_ACCENT: Array<{ match: string; dot: string; bg: string; text: string }> = [
  { match: 'clinician',    dot: 'bg-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700'   },
  { match: 'manager',      dot: 'bg-violet-500', bg: 'bg-violet-50', text: 'text-violet-700' },
  { match: 'centre admin', dot: 'bg-teal-500',   bg: 'bg-teal-50',   text: 'text-teal-700'   },
  { match: 'admin',        dot: 'bg-teal-500',   bg: 'bg-teal-50',   text: 'text-teal-700'   },
];
const ROLE_ACCENT_DEFAULT = { dot: 'bg-gray-400', bg: 'bg-gray-50', text: 'text-gray-600' };

function getRoleAccent(roleName: string) {
  const lower = roleName.toLowerCase();
  return ROLE_ACCENT.find((a) => lower.includes(a.match)) ?? ROLE_ACCENT_DEFAULT;
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

// ── Tooltip icon ──────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-100 text-gray-400
                 hover:bg-gray-200 hover:text-gray-600 cursor-help transition-colors ml-1 flex-shrink-0"
      title={text}
      aria-label={text}
    >
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </span>
  );
}

// ── Role breakdown table ──────────────────────────────────────────────────────

function RoleBreakdownTable({
  roles,
  periodLabel,
  onActiveClick,
  onQuietClick,
}: {
  roles: UserBreakdownRole[];
  periodLabel: string;
  onActiveClick: (role: UserBreakdownRole) => void;
  onQuietClick: (role: UserBreakdownRole) => void;
}) {
  const sorted = [...roles].sort((a, b) => b.total - a.total);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col">
      <div className="mb-4">
        <div className="flex items-center gap-1">
          <h3 className="text-sm font-semibold text-gray-900">Role Breakdown</h3>
          <InfoTooltip text="Active = performed at least one clinical action in Unity during the selected period. Quiet = no recorded activity." />
        </div>
        <p className="text-xs text-gray-400 mt-0.5">By role · active vs quiet · {periodLabel}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] border-b border-gray-100">
              <th className="py-2.5 text-left">Role</th>
              <th className="py-2.5 px-3 text-right">Total</th>
              <th className="py-2.5 px-3 text-right">Active</th>
              <th className="py-2.5 px-3 text-right">Quiet</th>
              <th className="py-2.5 pl-3 text-right">Active %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((role) => {
              const ac = getRoleAccent(role.roleName);
              return (
                <tr key={role.roleName} className="hover:bg-gray-50/60 transition-colors">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ac.dot}`} />
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ac.bg} ${ac.text}`}>
                        {formatRoleName(role.roleName)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right font-semibold tabular-nums text-gray-800">
                    {role.total.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => onActiveClick(role)}
                      className="font-semibold tabular-nums text-emerald-700 hover:text-emerald-900
                                 hover:underline underline-offset-2 transition-colors cursor-pointer"
                      title={`View ${role.active} active ${formatRoleName(role.roleName)} users`}
                    >
                      {role.active.toLocaleString()}
                    </button>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => onQuietClick(role)}
                      className="font-semibold tabular-nums text-gray-500 hover:text-gray-800
                                 hover:underline underline-offset-2 transition-colors cursor-pointer"
                      title={`View ${role.quiet} quiet ${formatRoleName(role.roleName)} users`}
                    >
                      {role.quiet.toLocaleString()}
                    </button>
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <span className="text-xs text-gray-400 tabular-nums">
                      {role.activePercent}% active
                    </span>
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

// ── Centre breakdown table ────────────────────────────────────────────────────

function CentreBreakdownTable({
  centres,
  periodLabel,
  onActiveClick,
  onQuietClick,
}: {
  centres: UserBreakdownCentre[];
  periodLabel: string;
  onActiveClick: (centre: UserBreakdownCentre) => void;
  onQuietClick: (centre: UserBreakdownCentre) => void;
}) {
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
              <th className="py-2.5 px-3 text-right">Quiet</th>
              <th className="py-2.5 pl-3 text-right flex items-center justify-end gap-0.5">
                Active %
                <InfoTooltip text="Percentage of users at this centre who performed at least one action during the selected period." />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {centres.map((c) => (
              <tr key={c.centreId} className="hover:bg-gray-50/70 transition-colors">
                <td className="py-3 font-medium text-gray-900 max-w-[200px] truncate" title={c.centreName}>
                  {c.centreName}
                </td>
                <td className="py-3 px-3 text-right font-semibold tabular-nums text-gray-800">
                  {c.total}
                </td>
                <td className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => onActiveClick(c)}
                    className={`font-semibold tabular-nums hover:underline underline-offset-2
                                transition-colors cursor-pointer ${
                                  c.active === 0 ? 'text-rose-500 hover:text-rose-700' : 'text-emerald-700 hover:text-emerald-900'
                                }`}
                    title={`View ${c.active} active users at ${c.centreName}`}
                  >
                    {c.active}
                  </button>
                </td>
                <td className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => onQuietClick(c)}
                    className="font-semibold tabular-nums text-gray-500 hover:text-gray-800
                               hover:underline underline-offset-2 transition-colors cursor-pointer"
                    title={`View ${c.quiet} quiet users at ${c.centreName}`}
                  >
                    {c.quiet}
                  </button>
                </td>
                <td className="py-3 pl-3 text-right">
                  <span className="text-xs text-gray-400 tabular-nums">
                    {c.activePercent}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Roster user drawer ────────────────────────────────────────────────────────

interface RosterDrawerProps {
  title: string;
  subtitle: string;
  users: RosterListUser[];
  isOpen: boolean;
  onClose: () => void;
  onUserClick: (id: number) => void;
  isQuiet?: boolean;
}

function RosterUserDrawer({ title, subtitle, users, isOpen, onClose, onUserClick, isQuiet }: RosterDrawerProps) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset search when drawer opens/closes
  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

  // Keyboard close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.centreName ?? '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleCopyEmails = useCallback(() => {
    const emails = filtered.map((u) => u.email).join(', ');
    navigator.clipboard.writeText(emails).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [filtered]);

  const handleExportCsv = useCallback(() => {
    const header = 'Name,Email,Centre,Role,Actions,Last Active,Last Login';
    const rows = filtered.map((u) =>
      [
        `"${u.firstName} ${u.lastName}"`,
        `"${u.email}"`,
        `"${u.centreName ?? ''}"`,
        `"${formatRoleName(u.roleName ?? '')}"`,
        u.actionsInPeriod,
        u.lastActivityDate ? new Date(u.lastActivityDate).toLocaleDateString('en-GB') : '',
        u.lastLoginDate ? new Date(u.lastLoginDate).toLocaleDateString('en-GB') : '',
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, title]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/30 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-drawer-title"
        className="relative w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col
                   animate-[slideInRight_220ms_cubic-bezier(0.22,1,0.36,1)]"
        style={{ willChange: 'transform' }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="min-w-0">
              <h2 id="roster-drawer-title" className="text-base font-bold text-gray-900 leading-tight">
                {title}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 font-medium flex-shrink-0">
              Showing {filtered.length.toLocaleString()} user{filtered.length !== 1 ? 's' : ''}
            </span>

            {/* Search */}
            <div className="relative flex-1 min-w-[160px]">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search by name, email or centre…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Copy emails */}
            <button
              type="button"
              onClick={handleCopyEmails}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600
                         bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              {copied ? 'Copied!' : 'Copy emails'}
            </button>

            {/* Export CSV */}
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600
                         bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
              <p className="text-sm text-gray-400">No users match your search.</p>
            </div>
          ) : (
            <table className="w-full text-sm" role="table">
              <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
                <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                  <th className="py-2.5 pl-6 pr-3 text-left">Name</th>
                  <th className="py-2.5 px-3 text-left hidden sm:table-cell">Centre</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                  <th className="py-2.5 px-3 text-right hidden md:table-cell">Last Active</th>
                  <th className="py-2.5 pl-3 pr-6 text-right hidden md:table-cell">Last Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((u) => {
                  const isNeverActive = u.neverActive === true;
                  const isQuietUser = u.actionsInPeriod === 0;
                  const rowClass = isNeverActive
                    ? 'bg-rose-50/40 hover:bg-rose-50/70'
                    : isQuiet
                    ? 'opacity-70 hover:opacity-100 hover:bg-gray-50/70'
                    : 'hover:bg-gray-50/70';

                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors cursor-pointer ${rowClass}`}
                      onClick={() => onUserClick(u.id)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onUserClick(u.id); }}
                      role="button"
                      aria-label={`Open profile for ${u.firstName} ${u.lastName}`}
                    >
                      <td className="py-3 pl-6 pr-3">
                        <p className={`font-medium ${isNeverActive ? 'text-rose-700' : 'text-gray-900'}`}>
                          {u.firstName} {u.lastName}
                          {isNeverActive && (
                            <span className="ml-1.5 text-[10px] font-bold text-rose-500 uppercase tracking-wide">Never active</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{u.email}</p>
                        {u.roleName && (
                          <span className="mt-0.5 inline-block">
                            <RoleBadge roleName={u.roleName} />
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-gray-600 hidden sm:table-cell">
                        {u.centreName ?? '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {isQuietUser ? (
                          <span className="text-gray-300 font-medium">0</span>
                        ) : (
                          <span className="text-gray-800 font-semibold">{u.actionsInPeriod.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right text-xs text-gray-500 tabular-nums hidden md:table-cell">
                        {fmtDaysAgo(u.lastActivityDate)}
                      </td>
                      <td className="py-3 pl-3 pr-6 text-right text-xs text-gray-400 tabular-nums hidden md:table-cell">
                        {fmtDate(u.lastLoginDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Attention row ─────────────────────────────────────────────────────────────

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

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 animate-pulse">
      <div className="h-9 w-9 bg-gray-100 rounded-xl mb-4" />
      <div className="h-2.5 w-16 bg-gray-100 rounded mb-2" />
      <div className="h-8 w-12 bg-gray-100 rounded" />
    </div>
  );
}

// ── Drawer state types ────────────────────────────────────────────────────────

interface RosterDrawerState {
  title: string;
  subtitle: string;
  users: RosterListUser[];
  isQuiet: boolean;
}

// ── Main UsersTab ─────────────────────────────────────────────────────────────

interface Props {
  data: UserBreakdownData | null;
  loading: boolean;
  error: string | null;
}

export default function UsersTab({ data, loading, error }: Props) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [rosterDrawer, setRosterDrawer] = useState<RosterDrawerState | null>(null);
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [neverSearch, setNeverSearch] = useState('');

  const periodLabel = formatPeriodLabel(data?.dateFrom, data?.dateTo);

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

  // Role drawer handlers
  const openRoleActive = useCallback((role: UserBreakdownRole) => {
    setRosterDrawer({
      title: `Active ${formatRoleName(role.roleName)} — ${periodLabel}`,
      subtitle: 'These users performed at least one action in Unity during this period.',
      users: role.activeUsers,
      isQuiet: false,
    });
  }, [periodLabel]);

  const openRoleQuiet = useCallback((role: UserBreakdownRole) => {
    setRosterDrawer({
      title: `Quiet ${formatRoleName(role.roleName)} — ${periodLabel}`,
      subtitle: 'These users had no recorded activity in Unity during this period. Ops can use this list to follow up.',
      users: role.quietUsers,
      isQuiet: true,
    });
  }, [periodLabel]);

  // Centre drawer handlers
  const openCentreActive = useCallback((centre: UserBreakdownCentre) => {
    setRosterDrawer({
      title: `Active users — ${centre.centreName}`,
      subtitle: `${centre.active} user${centre.active !== 1 ? 's' : ''} performed at least one action during this period. Sorted by activity.`,
      users: centre.activeUsers,
      isQuiet: false,
    });
  }, []);

  const openCentreQuiet = useCallback((centre: UserBreakdownCentre) => {
    setRosterDrawer({
      title: `Quiet users — ${centre.centreName}`,
      subtitle: 'These users had no recorded activity in Unity during this period. Ops can use this list to follow up.',
      users: centre.quietUsers,
      isQuiet: true,
    });
  }, []);

  const handleRosterUserClick = useCallback((id: number) => {
    setSelectedUserId(id);
  }, []);

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

      {/* ── Role + Centre breakdown ── */}
      {loading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <RoleBreakdownTable
            roles={data.byRole}
            periodLabel={periodLabel}
            onActiveClick={openRoleActive}
            onQuietClick={openRoleQuiet}
          />
          <CentreBreakdownTable
            centres={data.byCentre}
            periodLabel={periodLabel}
            onActiveClick={openCentreActive}
            onQuietClick={openCentreQuiet}
          />
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

      {/* Roster user drawer (role/centre drill-down) */}
      {rosterDrawer && (
        <RosterUserDrawer
          title={rosterDrawer.title}
          subtitle={rosterDrawer.subtitle}
          users={rosterDrawer.users}
          isOpen
          onClose={() => setRosterDrawer(null)}
          onUserClick={handleRosterUserClick}
          isQuiet={rosterDrawer.isQuiet}
        />
      )}

      {/* Individual user profile drawer (z-50, stacks above roster drawer) */}
      <UserProfileDrawer
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
      />
    </div>
  );
}
