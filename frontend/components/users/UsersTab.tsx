'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type {
  UserBreakdownData,
  UserBreakdownRole,
  UserBreakdownCentre,
  RosterListUser,
  UserBreakdownNeverActive,
  UserBreakdownAttentionUser,
} from '@/lib/types';
import { useMetrics } from '@/lib/metricsContext';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';
import RoleBadge, { formatRoleName } from '@/components/shared/RoleBadge';
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
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

function exportCsv(filename: string, headers: string[], rows: string[][]): void {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [headers, ...rows].map((r) => r.map(escape).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Role accent colours ───────────────────────────────────────────────────────

const ROLE_ACCENT: Array<{ match: string; dotStyle: string; bg: string; fg: string }> = [
  { match: 'clinician',    dotStyle: 'bg-[#0C447C]', bg: '#E6F1FB', fg: '#0C447C' },
  { match: 'manager',      dotStyle: 'bg-[#3B6D11]', bg: '#EAF3DE', fg: '#3B6D11' },
  { match: 'centre admin', dotStyle: 'bg-[#0F6E56]', bg: '#E1F5EE', fg: '#0F6E56' },
  { match: 'admin',        dotStyle: 'bg-[#0F6E56]', bg: '#E1F5EE', fg: '#0F6E56' },
  { match: 'super',        dotStyle: 'bg-[#3C3489]', bg: '#EEEDFE', fg: '#3C3489' },
];
const ROLE_ACCENT_DEFAULT = { dotStyle: 'bg-gray-400', bg: '#F3F4F6', fg: '#6B7280' };

function getRoleAccent(roleName: string) {
  const lower = roleName.toLowerCase();
  return ROLE_ACCENT.find((a) => lower.includes(a.match)) ?? ROLE_ACCENT_DEFAULT;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, color, tooltip, onClick,
}: {
  label: string; value: number; sub?: string;
  icon?: React.ReactNode; color: 'blue' | 'emerald' | 'gray' | 'amber';
  tooltip?: KpiDefinition;
  onClick?: () => void;
}) {
  const colorMap = {
    blue:    { val: '#1D9E75' },
    emerald: { val: '#1D9E75' },
    gray:    { val: '#111827' },
    amber:   { val: '#BA7517' },
  };
  const c = colorMap[color];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={[
        'bg-white rounded-xl border border-gray-100 px-6 py-5 flex flex-col gap-2 text-left w-full',
        onClick
          ? 'cursor-pointer hover:border-gray-200 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
          : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 min-h-[20px]">
        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.05em] leading-tight">{label}</p>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p className="text-[28px] font-medium leading-none tabular-nums" style={{ color: c.val }}>{value.toLocaleString()}</p>
      {sub && <p className="text-[13px] text-gray-400 mt-1 leading-snug">{sub}</p>}
    </Tag>
  );
}

// ── Info tooltip ──────────────────────────────────────────────────────────────

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

// ── Role Breakdown Table ──────────────────────────────────────────────────────

function RoleBreakdownTable({
  roles,
  periodLabel,
  onActiveClick,
  onIdleClick,
  onQuietClick,
}: {
  roles: UserBreakdownRole[];
  periodLabel: string;
  onActiveClick: (role: UserBreakdownRole) => void;
  onIdleClick: (role: UserBreakdownRole) => void;
  onQuietClick: (role: UserBreakdownRole) => void;
}) {
  const sorted = [...roles].sort((a, b) => b.total - a.total);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
      <div className="mb-3">
        <div className="flex items-center gap-1">
          <h3 className="text-[14px] font-medium text-gray-900">Role Breakdown</h3>
          <InfoTooltip text="Active = at least one audit action in period. Idle = logged in but no actions. Quiet = no login and no actions." />
        </div>
        <p className="text-[12px] text-gray-500 mt-0.5">By role · active · idle · quiet · {periodLabel}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">
              <th className="py-[10px] px-3 text-left">Role</th>
              <th className="py-[10px] px-3 text-right">Total</th>
              <th className="py-[10px] px-3 text-right">Active</th>
              <th className="py-[10px] px-3 text-right">
                <span className="flex items-center justify-end gap-0.5">
                  Idle
                  <InfoTooltip text="Logged in but zero audit actions this period." />
                </span>
              </th>
              <th className="py-[10px] px-3 text-right">Quiet</th>
              <th className="py-[10px] px-3 text-right">Active %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sorted.map((role) => {
              const ac        = getRoleAccent(role.roleName);
              const idleCount = role.idle ?? 0;
              return (
                <tr key={role.roleName} className="hover:bg-gray-50/60 transition-colors">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ac.dotStyle}`} />
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: ac.bg, color: ac.fg }}
                      >
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
                    {idleCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => onIdleClick(role)}
                        className="font-semibold tabular-nums text-amber-600 hover:text-amber-800
                                   hover:underline underline-offset-2 transition-colors cursor-pointer"
                        title={`View ${idleCount} idle ${formatRoleName(role.roleName)} users`}
                      >
                        {idleCount.toLocaleString()}
                      </button>
                    ) : (
                      <span className="font-semibold tabular-nums text-gray-300">0</span>
                    )}
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

// ── Centre Breakdown Table ────────────────────────────────────────────────────

const CENTRE_DEFAULT_LIMIT = 10;

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
  const [expanded, setExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  // Sort by Active descending
  const sorted = useMemo(
    () => [...centres].sort((a, b) => b.active - a.active),
    [centres],
  );
  const visible = expanded ? sorted : sorted.slice(0, CENTRE_DEFAULT_LIMIT);
  const hasMore = sorted.length > CENTRE_DEFAULT_LIMIT;

  // Collapse on Escape
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col">
      <div className="mb-3">
        <div className="flex items-center gap-1">
          <h3 className="text-[14px] font-medium text-gray-900">Centre Breakdown</h3>
          <KpiTooltip {...KPI.USER_CENTRE_BREAKDOWN} />
        </div>
        <p className="text-[12px] text-gray-500 mt-0.5">Users per centre · {periodLabel}</p>
      </div>
      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">
              <th className="py-[10px] px-3 text-left">Centre</th>
              <th className="py-[10px] px-3 text-right">Total</th>
              <th className="py-[10px] px-3 text-right">Active</th>
              <th className="py-[10px] px-3 text-right">Quiet</th>
              <th className="py-[10px] px-3 text-right">
                <span className="flex items-center justify-end gap-0.5">
                  Active %
                  <InfoTooltip text="% who had audit actions in the period. Idle users (logged in, no actions) are excluded from Active." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.map((c) => (
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
      {hasMore && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              if (!expanded) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {expanded
              ? `Show less ↑`
              : `Show all ${sorted.length} centres ↓`}
          </button>
          {expanded && (
            <p className="text-[11px] text-gray-400">↕ Click to scroll · Esc to show less</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Standard drawer wrapper ───────────────────────────────────────────────────

function DrawerShell({
  id, title, subtitle, count, onClose, onExport, exportLabel, children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count?: number;
  onClose: () => void;
  onExport?: () => void;
  exportLabel?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/30 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="relative w-full max-w-[640px] h-full bg-white shadow-2xl flex flex-col
                   border-l border-gray-200/60 animate-[slideInRight_220ms_cubic-bezier(0.22,1,0.36,1)]"
        style={{ willChange: 'transform' }}
      >
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white px-6 pt-5 pb-4 border-b border-gray-200/60 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 mb-1">
                Drill-down
              </p>
              <h2 id={id} className="text-[18px] font-medium text-gray-900 leading-tight truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-[13px] text-gray-500 mt-0.5 leading-snug">{subtitle}</p>
              )}
              {count != null && (
                <p className="text-[13px] text-gray-400 mt-1">{count.toLocaleString()} record{count !== 1 ? 's' : ''}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onExport && (
                <button
                  type="button"
                  onClick={onExport}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600
                             border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {exportLabel ?? 'Export CSV'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-[44px] h-[44px] flex items-center justify-center rounded-lg text-gray-400
                           hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
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
  variant?: RosterDrawerVariant;
}

function RosterUserDrawer({ title, subtitle, users, isOpen, onClose, onUserClick, variant }: RosterDrawerProps) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) setSearch('');
  }, [isOpen]);

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
    const emails = users.map((u) => u.email).join(', ');
    navigator.clipboard.writeText(emails).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [users]);

  const handleExport = useCallback(() => {
    exportCsv(
      `unity-roster-${todayStr()}.csv`,
      ['Name', 'Email', 'Role', 'Centre', 'Actions in Period', 'Last Active', 'Last Login'],
      users.map((u) => [
        `${u.firstName} ${u.lastName}`,
        u.email,
        formatRoleName(u.roleName ?? ''),
        u.centreName ?? '',
        String(u.actionsInPeriod),
        u.lastActivityDate ? new Date(u.lastActivityDate).toLocaleDateString('en-GB') : '',
        u.lastLoginDate ? new Date(u.lastLoginDate).toLocaleDateString('en-GB') : '',
      ]),
    );
  }, [users]);

  if (!isOpen) return null;

  return (
    <DrawerShell
      id="roster-drawer-title"
      title={title}
      subtitle={subtitle}
      count={filtered.length}
      onClose={onClose}
      onExport={handleExport}
      exportLabel={`Export ${users.length} rows`}
    >
      {/* Search + copy row */}
      <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
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
        <span className="text-[12px] text-gray-400 ml-auto">
          Showing {filtered.length.toLocaleString()} of {users.length.toLocaleString()}
        </span>
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
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
          <p className="text-sm text-gray-400">No results for &ldquo;{search}&rdquo;</p>
          <p className="text-xs text-gray-400">Try a different name or centre</p>
        </div>
      ) : (
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }} role="table">
          <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
            <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.03em]">
              <th className="py-2.5 pl-6 pr-3 text-left" style={{ width: 180 }}>Name</th>
              <th className="py-2.5 px-3 text-left hidden sm:table-cell" style={{ width: 110 }}>Role</th>
              <th className="py-2.5 px-3 text-left hidden sm:table-cell" style={{ width: 160 }}>Centre</th>
              <th className="py-2.5 px-3 text-right" style={{ width: 60 }}>Actions</th>
              <th className="py-2.5 pl-3 pr-6 text-right hidden md:table-cell" style={{ width: 100 }}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  Last Active
                  <InfoTooltip text="Last audit action performed by this user — ever, not limited to the selected period. Login alone does not count as activity." />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((u) => {
              const isNeverActive = u.neverActive === true;
              const rowClass = isNeverActive
                ? 'bg-rose-50/40 hover:bg-rose-50/70'
                : variant === 'idle'
                ? 'bg-amber-50/30 hover:bg-amber-50/60'
                : variant === 'quiet'
                ? 'opacity-70 hover:opacity-100 hover:bg-gray-50/70'
                : 'hover:bg-gray-50/70';

              return (
                <tr
                  key={u.id}
                  className={`transition-colors cursor-pointer h-[44px] ${rowClass}`}
                  onClick={() => onUserClick(u.id)}
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onUserClick(u.id); }}
                  role="button"
                  aria-label={`Open profile for ${u.firstName} ${u.lastName}`}
                >
                  <td className="py-0 pl-6 pr-3" style={{ verticalAlign: 'middle' }}>
                    <p className={`text-[13px] font-medium truncate ${isNeverActive ? 'text-rose-700' : 'text-gray-900'}`} title={`${u.firstName} ${u.lastName}`}>
                      {u.firstName} {u.lastName}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate" title={u.email}>{u.email}</p>
                  </td>
                  <td className="py-0 px-3 hidden sm:table-cell" style={{ verticalAlign: 'middle' }}>
                    {u.roleName && (
                      <RoleBadge
                        role={u.roleName}
                        firstName={u.firstName}
                        lastName={u.lastName}
                      />
                    )}
                  </td>
                  <td className="py-0 px-3 text-xs text-gray-600 hidden sm:table-cell overflow-hidden" style={{ verticalAlign: 'middle' }}>
                    <span className="block truncate" title={u.centreName ?? undefined}>{u.centreName ?? '—'}</span>
                  </td>
                  <td className="py-0 px-3 text-right tabular-nums" style={{ verticalAlign: 'middle' }}>
                    {u.actionsInPeriod === 0 ? (
                      <span className="text-gray-300 font-medium">0</span>
                    ) : (
                      <span className="text-gray-800 font-semibold">{u.actionsInPeriod.toLocaleString()}</span>
                    )}
                  </td>
                  <td className="py-0 pl-3 pr-6 text-right text-xs text-gray-500 tabular-nums hidden md:table-cell" style={{ verticalAlign: 'middle' }}>
                    {fmtDaysAgo(u.lastActivityDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </DrawerShell>
  );
}

// ── Never Active Drawer ───────────────────────────────────────────────────────

function NeverActiveDrawer({
  users,
  onClose,
  onUserClick,
}: {
  users: UserBreakdownNeverActive[];
  onClose: () => void;
  onUserClick: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(
    () => [...users].sort((a, b) => {
      const ta = a.createdDate ? new Date(a.createdDate).getTime() : 0;
      const tb = b.createdDate ? new Date(b.createdDate).getTime() : 0;
      return tb - ta;
    }),
    [users],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return sorted;
    return sorted.filter((u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.centreName ?? '').toLowerCase().includes(q)
    );
  }, [sorted, search]);

  const handleCopyEmails = useCallback(() => {
    const emails = sorted.map((u) => u.email).join(', ');
    navigator.clipboard.writeText(emails).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [sorted]);

  const handleExport = useCallback(() => {
    exportCsv(
      `unity-never-active-${todayStr()}.csv`,
      ['Name', 'Email', 'Role', 'Centre', 'Account Created'],
      sorted.map((u) => [
        `${u.firstName} ${u.lastName}`,
        u.email,
        formatRoleName(u.roleName ?? ''),
        u.centreName ?? '',
        u.createdDate ? new Date(u.createdDate).toLocaleDateString('en-GB') : '',
      ]),
    );
  }, [sorted]);

  return (
    <DrawerShell
      id="never-active-drawer-title"
      title={`Never active — ${users.length} accounts`}
      subtitle="Zero audit history. Created but never used. Review with centre managers."
      count={filtered.length}
      onClose={onClose}
      onExport={handleExport}
      exportLabel={`Export ${sorted.length} rows`}
    >
      <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
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
        <span className="text-[12px] text-gray-400 ml-auto">
          Showing {filtered.length.toLocaleString()} of {sorted.length.toLocaleString()}
        </span>
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
      </div>

      <p className="px-6 py-2 text-[11px] text-gray-400 bg-amber-50/60 border-b border-amber-100">
        May include duplicates or leavers
      </p>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-200" />
          <p className="text-sm text-gray-400">
            {search ? `No results for "${search}"` : 'No items to show'}
          </p>
          {search && <p className="text-xs text-gray-400">Try a different name or centre</p>}
        </div>
      ) : (
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }} role="table">
          <thead className="sticky top-0 bg-white border-b border-gray-100 z-10">
            <tr className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.03em]">
              <th className="py-2.5 pl-6 pr-3 text-left" style={{ width: 180 }}>Name</th>
              <th className="py-2.5 px-3 text-left hidden sm:table-cell" style={{ width: 110 }}>Role</th>
              <th className="py-2.5 px-3 text-left hidden sm:table-cell" style={{ width: 160 }}>Centre</th>
              <th className="py-2.5 pl-3 pr-6 text-right" style={{ width: 110 }}>Account Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((u) => (
              <tr
                key={u.id}
                className="hover:bg-rose-50/40 transition-colors cursor-pointer h-[44px]"
                onClick={() => onUserClick(u.id)}
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onUserClick(u.id); }}
                role="button"
                aria-label={`Open profile for ${u.firstName} ${u.lastName}`}
              >
                <td className="py-0 pl-6 pr-3" style={{ verticalAlign: 'middle' }}>
                  <p className="text-[13px] font-medium text-rose-700 truncate" title={`${u.firstName} ${u.lastName}`}>
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate" title={u.email}>{u.email}</p>
                </td>
                <td className="py-0 px-3 hidden sm:table-cell" style={{ verticalAlign: 'middle' }}>
                  {u.roleName && (
                    <RoleBadge
                      role={u.roleName}
                      firstName={u.firstName}
                      lastName={u.lastName}
                    />
                  )}
                </td>
                <td className="py-0 px-3 text-xs text-gray-600 hidden sm:table-cell overflow-hidden" style={{ verticalAlign: 'middle' }}>
                  <span className="block truncate" title={u.centreName ?? undefined}>{u.centreName ?? '—'}</span>
                </td>
                <td className="py-0 pl-3 pr-6 text-right text-xs text-gray-500 tabular-nums" style={{ verticalAlign: 'middle' }}>
                  {fmtDate(u.createdDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DrawerShell>
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
        <RoleBadge role={roleName} firstName={firstName} lastName={lastName} />
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
    <div className="bg-white rounded-xl border border-gray-100 px-6 py-5 animate-pulse">
      <div className="h-2.5 w-20 bg-gray-100 rounded mb-3" />
      <div className="h-8 w-14 bg-gray-100 rounded mb-2" />
      <div className="h-2.5 w-24 bg-gray-100 rounded" />
    </div>
  );
}

// ── Drawer state ──────────────────────────────────────────────────────────────

type RosterDrawerVariant = 'active' | 'idle' | 'quiet';

interface RosterDrawerState {
  title: string;
  subtitle: string;
  users: RosterListUser[];
  variant: RosterDrawerVariant;
}

// ── Inline attention list with collapse ──────────────────────────────────────

const INLINE_DEFAULT_LIMIT = 10;

function AttentionList({
  title,
  badge,
  badgeColor,
  subtitle,
  tooltip,
  users,
  search,
  onSearchChange,
  renderExtra,
  onOpen,
  emptyMessage,
  exportFilename,
  exportHeaders,
  exportRow,
}: {
  title: string;
  badge: number;
  badgeColor: 'amber' | 'rose';
  subtitle: string;
  tooltip: KpiDefinition;
  users: (UserBreakdownAttentionUser | UserBreakdownNeverActive)[];
  search: string;
  onSearchChange: (v: string) => void;
  renderExtra?: (u: UserBreakdownAttentionUser | UserBreakdownNeverActive) => React.ReactNode;
  onOpen: (id: number) => void;
  emptyMessage?: string;
  exportFilename: string;
  exportHeaders: string[];
  exportRow: (u: UserBreakdownAttentionUser | UserBreakdownNeverActive) => string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  const visible = expanded ? users : users.slice(0, INLINE_DEFAULT_LIMIT);
  const hasMore = users.length > INLINE_DEFAULT_LIMIT;

  const handleExport = () => exportCsv(exportFilename, exportHeaders, users.map(exportRow));

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h4 className="text-sm font-semibold text-gray-800">
              {title}
              <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                badgeColor === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
              }`}>
                {badge}
              </span>
            </h4>
            <KpiTooltip {...tooltip} />
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-44"
            />
          </div>
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600
                       border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            title="Export CSV"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>
        </div>
      </div>

      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full" role="table">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">
              <th className="py-[10px] pl-4 pr-3 text-left">User</th>
              <th className="py-[10px] px-3 text-left">Role</th>
              <th className="py-[10px] px-3 text-left">Centre</th>
              {renderExtra ? (
                <>
                  <th className="py-[10px] px-3 text-left">
                    <span className="inline-flex items-center gap-0.5">
                      Last Active
                      <InfoTooltip text="Last audit action performed by this user — ever, not limited to the selected period. Login alone does not count as activity." />
                    </span>
                  </th>
                  <th className="py-[10px] pl-3 pr-4 text-left">Idle</th>
                </>
              ) : (
                <th className="py-[10px] pl-3 pr-4 text-left">Created</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-gray-400 py-6">
                  {emptyMessage ?? 'No results matching your search.'}
                </td>
              </tr>
            ) : (
              visible.map((u) => {
                const a = u as UserBreakdownAttentionUser;
                const n = u as UserBreakdownNeverActive;
                return (
                  <AttentionRow
                    key={u.id}
                    id={u.id}
                    firstName={u.firstName}
                    lastName={u.lastName}
                    email={u.email}
                    roleName={u.roleName}
                    centreName={u.centreName}
                    meta={renderExtra ? fmtDaysAgo(a.lastActivityDate) : fmtDate(n.createdDate)}
                    badge={renderExtra && a.daysSinceActive > 90 ? `${a.daysSinceActive}d` : undefined}
                    onOpen={onOpen}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="px-5 py-3 border-t border-gray-50 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setExpanded((v) => !v);
              if (!expanded) setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            {expanded ? 'Show less ↑' : `Show all ${users.length} users ↓`}
          </button>
          {expanded && (
            <p className="text-[11px] text-gray-400">↕ Click to scroll · Esc to show less</p>
          )}
        </div>
      )}
    </div>
  );
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
  const [neverActiveDrawerOpen, setNeverActiveDrawerOpen] = useState(false);
  const [inactiveSearch, setInactiveSearch] = useState('');
  const [neverSearch, setNeverSearch] = useState('');

  const { metrics } = useMetrics();

  const periodLabel = formatPeriodLabel(data?.dateFrom, data?.dateTo);

  // ── Derived user lists ────────────────────────────────────────────────────
  const allActiveUsers = useMemo<RosterListUser[]>(() => {
    if (!data) return [];
    return data.byRole.flatMap((r) => r.activeUsers);
  }, [data]);

  const allIdleUsers = useMemo<RosterListUser[]>(() => {
    if (!data) return [];
    return data.byRole.flatMap((r) => r.idleUsers ?? []);
  }, [data]);

  const allQuietUsers = useMemo<RosterListUser[]>(() => {
    if (!data) return [];
    return data.byRole.flatMap((r) => r.quietUsers);
  }, [data]);

  const allRosterUsers = useMemo<RosterListUser[]>(() => {
    return [...allActiveUsers, ...allIdleUsers, ...allQuietUsers];
  }, [allActiveUsers, allIdleUsers, allQuietUsers]);

  // Map neverActive users to RosterListUser shape so they can be included in the
  // Total Users drawer. This ensures the card value == drawer record count.
  const neverActiveAsRosterUsers = useMemo<RosterListUser[]>(() => {
    if (!data) return [];
    return data.neverActive.map((u) => ({
      id:              u.id,
      firstName:       u.firstName,
      lastName:        u.lastName,
      email:           u.email,
      centreName:      u.centreName,
      roleName:        u.roleName,
      actionsInPeriod: 0,
      lastActivityDate: null,
      lastLoginDate:   null,
      neverActive:     true,
    }));
  }, [data]);

  // ── Filtered attention lists ───────────────────────────────────────────────
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

  // totalUsers is derived from client arrays so it always equals the Total Users
  // drawer record count (active + idle + quiet + neverActive).
  const totalUsers  = allRosterUsers.length + neverActiveCount;
  const activeUsers = metrics?.users.active ?? data?.byStatus.active  ?? 0;
  // Idle and quiet are derived from the breakdown data so we get the
  // correctly split values (metricsService.users.quiet still includes idle).
  const idleUsers  = data?.byStatus.idle     ?? 0;
  const quietUsers = data?.byStatus.inactive ?? metrics?.users.quiet ?? 0;

  // ── Role drawer handlers ──────────────────────────────────────────────────
  const openRoleActive = useCallback((role: UserBreakdownRole) => {
    setRosterDrawer({
      title:    `Active ${formatRoleName(role.roleName)} — ${periodLabel}`,
      subtitle: 'Performed at least one audit action in Unity during this period.',
      users:    role.activeUsers,
      variant:  'active',
    });
  }, [periodLabel]);

  const openRoleIdle = useCallback((role: UserBreakdownRole) => {
    setRosterDrawer({
      title:    `Idle ${formatRoleName(role.roleName)} — ${periodLabel}`,
      subtitle: 'Logged in during this period but recorded zero audit actions.',
      users:    role.idleUsers ?? [],
      variant:  'idle',
    });
  }, [periodLabel]);

  const openRoleQuiet = useCallback((role: UserBreakdownRole) => {
    setRosterDrawer({
      title:    `Quiet ${formatRoleName(role.roleName)} — ${periodLabel}`,
      subtitle: 'No login and no audit activity during this period. Completely dormant.',
      users:    role.quietUsers,
      variant:  'quiet',
    });
  }, [periodLabel]);

  // ── Centre drawer handlers ────────────────────────────────────────────────
  const openCentreActive = useCallback((centre: UserBreakdownCentre) => {
    setRosterDrawer({
      title:    `Active users — ${centre.centreName}`,
      subtitle: `${centre.active} user${centre.active !== 1 ? 's' : ''} performed at least one audit action during this period.`,
      users:    centre.activeUsers,
      variant:  'active',
    });
  }, []);

  const openCentreQuiet = useCallback((centre: UserBreakdownCentre) => {
    setRosterDrawer({
      title:    `Quiet users — ${centre.centreName}`,
      subtitle: 'No login and no audit activity during this period.',
      users:    centre.quietUsers,
      variant:  'quiet',
    });
  }, []);

  // ── Summary card drawer handlers ──────────────────────────────────────────
  const openTotalUsers = useCallback(() => {
    setRosterDrawer({
      title:    `Total users`,
      subtitle: 'Full user roster — all roles, all centres.',
      users:    [...allRosterUsers, ...neverActiveAsRosterUsers],
      variant:  'active',
    });
  }, [allRosterUsers, neverActiveAsRosterUsers]);

  const openActiveUsers = useCallback(() => {
    setRosterDrawer({
      title:    `Active users — ${periodLabel}`,
      subtitle: 'Performed at least one audit action in Unity during this period.',
      users:    allActiveUsers,
      variant:  'active',
    });
  }, [allActiveUsers, periodLabel]);

  const openIdleUsers = useCallback(() => {
    setRosterDrawer({
      title:    `Idle users — ${periodLabel}`,
      subtitle: 'Logged in during this period but recorded zero audit actions.',
      users:    allIdleUsers,
      variant:  'idle',
    });
  }, [allIdleUsers, periodLabel]);

  const openQuietUsers = useCallback(() => {
    setRosterDrawer({
      title:    `Quiet users — ${periodLabel}`,
      subtitle: 'No login and no audit activity during this period. Completely dormant.',
      users:    allQuietUsers,
      variant:  'quiet',
    });
  }, [allQuietUsers, periodLabel]);

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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {loading || !data ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <SummaryCard
              label="Total Users"
              value={totalUsers}
              sub={`${data.byRole.length} role type${data.byRole.length !== 1 ? 's' : ''} · roster`}
              color="blue"
              tooltip={KPI.USER_TOTAL}
              onClick={allRosterUsers.length > 0 ? openTotalUsers : undefined}
            />
            <SummaryCard
              label="Active in Period"
              value={activeUsers}
              sub={`${pctOf(activeUsers, totalUsers)} of roster · ${periodLabel}`}
              color="emerald"
              tooltip={KPI.USER_ACTIVE_IN_PERIOD}
              onClick={allActiveUsers.length > 0 ? openActiveUsers : undefined}
            />
            <SummaryCard
              label="Idle in Period"
              value={idleUsers}
              sub={`Logged in · no audit activity`}
              color="amber"
              tooltip={KPI.USER_IDLE_IN_PERIOD}
              onClick={allIdleUsers.length > 0 ? openIdleUsers : undefined}
            />
            <SummaryCard
              label="Quiet in Period"
              value={quietUsers}
              sub={`${pctOf(quietUsers, totalUsers)} of roster · no login, no actions`}
              color="gray"
              tooltip={KPI.USER_QUIET_IN_PERIOD}
              onClick={allQuietUsers.length > 0 ? openQuietUsers : undefined}
            />
            <SummaryCard
              label="Never Active"
              value={neverActiveCount}
              sub={neverActiveCount > 0 ? 'Zero audit history ever' : 'All users have some history'}
              color={neverActiveCount > 0 ? 'amber' : 'emerald'}
              tooltip={KPI.USER_NEVER_ACTIVE}
              onClick={neverActiveCount > 0 ? () => setNeverActiveDrawerOpen(true) : undefined}
            />
          </>
        )}
      </div>

      {/* ── Role + Centre breakdown ── */}
      {loading || !data ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)] p-5 h-56 animate-pulse" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <RoleBreakdownTable
            roles={data.byRole}
            periodLabel={periodLabel}
            onActiveClick={openRoleActive}
            onIdleClick={openRoleIdle}
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
          <div className="mb-3">
            <h3 className="text-[15px] font-medium text-gray-900">Needs Attention</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Users with no recent activity, idle logins, or zero audit history
            </p>
          </div>

          {/* Recently Inactive includes idle users (logged in but no actions) */}
          {(data.recentlyInactive.length > 0 || allIdleUsers.length > 0) && (
            <AttentionList
              title="Recently Inactive"
              badge={data.recentlyInactive.length}
              badgeColor="amber"
              subtitle="No audit activity in the last 30 days · includes idle users logged in with no actions"
              tooltip={KPI.USER_RECENTLY_INACTIVE}
              users={filteredInactive}
              search={inactiveSearch}
              onSearchChange={setInactiveSearch}
              renderExtra={() => null}
              onOpen={setSelectedUserId}
              emptyMessage="No results matching your search."
              exportFilename={`unity-recently-inactive-${todayStr()}.csv`}
              exportHeaders={['Name', 'Email', 'Role', 'Centre', 'Last Active', 'Days Idle']}
              exportRow={(u) => {
                const a = u as UserBreakdownAttentionUser;
                return [
                  `${u.firstName} ${u.lastName}`,
                  u.email,
                  u.roleName,
                  u.centreName ?? '',
                  a.lastActivityDate ? new Date(a.lastActivityDate).toLocaleDateString('en-GB') : '',
                  String(a.daysSinceActive ?? ''),
                ];
              }}
            />
          )}

          {data.neverActive.length > 0 && (
            <AttentionList
              title="Never Active"
              badge={data.neverActive.length}
              badgeColor="rose"
              subtitle="Zero recorded actions · all time"
              tooltip={KPI.USER_NEVER_ACTIVE}
              users={filteredNever}
              search={neverSearch}
              onSearchChange={setNeverSearch}
              renderExtra={undefined}
              onOpen={setSelectedUserId}
              emptyMessage="No results matching your search."
              exportFilename={`unity-never-active-${todayStr()}.csv`}
              exportHeaders={['Name', 'Email', 'Role', 'Centre', 'Account Created']}
              exportRow={(u) => {
                const n = u as UserBreakdownNeverActive;
                return [
                  `${u.firstName} ${u.lastName}`,
                  u.email,
                  u.roleName,
                  u.centreName ?? '',
                  n.createdDate ? new Date(n.createdDate).toLocaleDateString('en-GB') : '',
                ];
              }}
            />
          )}

          {data.recentlyInactive.length === 0 && allIdleUsers.length === 0 && data.neverActive.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center py-10 gap-2">
              <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[14px] text-gray-500">All users engaged</p>
              <p className="text-[12px] text-gray-400">Everyone has been active in this period.</p>
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
          variant={rosterDrawer.variant}
        />
      )}

      {/* Never Active drawer */}
      {neverActiveDrawerOpen && data && (
        <NeverActiveDrawer
          users={data.neverActive}
          onClose={() => setNeverActiveDrawerOpen(false)}
          onUserClick={handleRosterUserClick}
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
