'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import type { Clinician, Manager, CentreAdmin, ConsistencyStatus, UserProfileRole } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import PersonLink from '@/components/PersonLink';

type RoleData = Clinician | Manager | CentreAdmin;
type SortCol  = 'name' | 'centre' | 'status' | 'coreJobDays' | 'coreOutput' | 'lastActive';
type SortDir  = 'asc' | 'desc';

interface LinkParams { centreId?: number; dateFrom?: string; dateTo?: string; }
interface Props { role: UserProfileRole; data: RoleData[]; loading: boolean; linkParams: LinkParams; }

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<ConsistencyStatus, number> = {
  silent: 0, inactive: 1, irregular: 2, consistent: 3,
};

const STATUS_BADGE: Record<ConsistencyStatus, { label: string; bg: string; color: string; border: string }> = {
  silent:     { label: 'Silent',     bg: '#FCEBEB', color: '#A32D2D', border: '#F7C1C1' },
  inactive:   { label: 'Inactive',   bg: '#FAEEDA', color: '#854F0B', border: '#F0D090' },
  irregular:  { label: 'Irregular',  bg: '#FDF5E0', color: '#9C6A10', border: '#F5DFA0' },
  consistent: { label: 'Consistent', bg: '#EAF3DE', color: '#3B6D11', border: '#C3E0A0' },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Display name: skip lastName if it is a single char / punctuation only. */
function displayName(r: RoleData): string {
  const last = (r.lastName ?? '').trim();
  return last.length <= 1 ? (r.firstName ?? '').trim() : `${r.firstName ?? ''} ${last}`.trim();
}

function coreOutputTotal(role: UserProfileRole, co: Record<string, number> | undefined): number {
  if (!co) return 0;
  if (role === 'clinician') return (co.assessmentsScored ?? 0) + (co.reportsDrafted ?? 0) + (co.goalsAdded ?? 0);
  if (role === 'manager')   return (co.reportsApproved  ?? 0) + (co.goalsApproved   ?? 0);
  return (co.casesRegistered ?? 0) + (co.cliniciansAssigned ?? 0);
}

/**
 * Smart core-output label: omit zero fields, return "—" when all are zero.
 * Clinician: "X scoring · X reporting · X goals"
 */
function coreOutputLabel(role: UserProfileRole, co: Record<string, number> | undefined): string {
  if (!co) return '—';
  const parts: string[] = [];
  if (role === 'clinician') {
    const s = co.assessmentsScored ?? 0;
    const r = co.reportsDrafted    ?? 0;
    const g = co.goalsAdded        ?? 0;
    if (s > 0) parts.push(`${s} scoring`);
    if (r > 0) parts.push(`${r} reporting`);
    if (g > 0) parts.push(`${g} goals`);
  } else if (role === 'manager') {
    const r = co.reportsApproved ?? 0;
    const g = co.goalsApproved   ?? 0;
    if (r > 0) parts.push(`${r} approved`);
    if (g > 0) parts.push(`${g} goals`);
  } else {
    const c = co.casesRegistered    ?? 0;
    const a = co.cliniciansAssigned ?? 0;
    if (c > 0) parts.push(`${c} cases`);
    if (a > 0) parts.push(`${a} assigned`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Tailwind colour class for core-job-days value relative to working days. */
function cjdColor(cjd: number, wd: number): string {
  if (wd === 0 || cjd === 0) return cjd === 0 && wd > 0 ? 'text-rose-600' : 'text-gray-400';
  const pct = cjd / wd;
  if (pct < 0.30) return 'text-amber-600';
  if (pct < 0.70) return 'text-gray-800';
  return 'text-emerald-700';
}

function statusCounts(data: RoleData[]) {
  const c: Record<ConsistencyStatus, number> = { consistent: 0, irregular: 0, inactive: 0, silent: 0 };
  for (const d of data) c[d.consistencyStatus ?? 'silent']++;
  return c;
}

function exportCsv(role: UserProfileRole, rows: RoleData[]) {
  const header = ['Name', 'Email', 'Centre', 'Consistency', '%', 'Core Job Days', 'Working Days', 'Core Output', 'Last Active'];
  const lines = rows.map((r) =>
    [
      displayName(r),
      (r as Clinician).email ?? '',
      r.centreName ?? '',
      r.consistencyStatus ?? '',
      String(r.consistencyPercent ?? 0),
      String(r.coreJobDays      ?? 0),
      String(r.totalWorkingDays ?? 0),
      coreOutputLabel(role, r.coreOutput),
      r.lastActiveDaysAgo != null ? `${r.lastActiveDaysAgo}d ago` : 'Never',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','),
  );
  const csv  = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `period-consistency-${role}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Debounce hook ─────────────────────────────────────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// ── Sort helper ───────────────────────────────────────────────────────────────

function sortRows(rows: RoleData[], col: SortCol, dir: SortDir, role: UserProfileRole): RoleData[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (col) {
      case 'name':   return sign * (a.lastName ?? '').localeCompare(b.lastName ?? '');
      case 'centre': return sign * (a.centreName ?? '').localeCompare(b.centreName ?? '');
      case 'status': {
        const sa = STATUS_ORDER[a.consistencyStatus ?? 'silent'];
        const sb = STATUS_ORDER[b.consistencyStatus ?? 'silent'];
        if (sa !== sb) return sign * (sa - sb);
        return (a.coreJobDays ?? 0) - (b.coreJobDays ?? 0); // tiebreak: least active first
      }
      case 'coreJobDays': {
        const ra = (a.coreJobDays ?? 0) / Math.max(a.totalWorkingDays ?? 1, 1);
        const rb = (b.coreJobDays ?? 0) / Math.max(b.totalWorkingDays ?? 1, 1);
        return sign * (ra - rb);
      }
      case 'coreOutput': return sign * (coreOutputTotal(role, a.coreOutput) - coreOutputTotal(role, b.coreOutput));
      case 'lastActive': {
        // Never (null) sorts to top on ascending, bottom on descending
        const da = a.lastActiveDaysAgo ?? (dir === 'asc' ? -1 : Infinity);
        const db = b.lastActiveDaysAgo ?? (dir === 'asc' ? -1 : Infinity);
        return sign * (da - db);
      }
      default: return 0;
    }
  });
}

// ── SortHeader sub-component ──────────────────────────────────────────────────

function SortHeader({
  col, active, dir, onSort, children, className,
}: {
  col: SortCol; active: boolean; dir: SortDir;
  onSort: (c: SortCol) => void;
  children: React.ReactNode; className?: string;
}) {
  return (
    <th
      className={`px-4 py-3 text-left cursor-pointer select-none group ${className ?? ''}`}
      onClick={() => onSort(col)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className={`inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.04em] transition-colors
        ${active ? 'text-gray-900' : 'text-gray-500 group-hover:text-gray-700'}`}>
        {children}
        <span className={`text-[10px] transition-opacity leading-none
          ${active ? 'opacity-100 text-gray-700' : 'opacity-0 group-hover:opacity-40 text-gray-400'}`}>
          {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  );
}

// ── LastActiveCell sub-component ──────────────────────────────────────────────

function LastActiveCell({ daysAgo }: { daysAgo: number | null | undefined }) {
  const [tooltip, setTooltip] = useState(false);

  if (daysAgo == null) {
    return (
      <div className="relative inline-block">
        <span
          className="text-rose-600 font-medium text-xs cursor-help"
          onMouseEnter={() => setTooltip(true)}
          onMouseLeave={() => setTooltip(false)}
        >
          Never active
        </span>
        {tooltip && (
          <div
            className="absolute bottom-full left-0 mb-1.5 z-50 bg-gray-900 text-white text-[11px] rounded-lg px-2.5 py-2 shadow-lg pointer-events-none leading-relaxed"
            style={{ width: 210 }}
          >
            This account has no audit log history. It may be a duplicate or unused account.
          </div>
        )}
      </div>
    );
  }

  if (daysAgo === 0) return <span className="text-emerald-600 font-medium text-xs">Today</span>;
  if (daysAgo === 1) return <span className="text-gray-700 text-xs">Yesterday</span>;
  if (daysAgo <= 7)  return <span className="text-amber-600 text-xs">{daysAgo}d ago</span>;
  return <span className="text-rose-500 text-xs">{daysAgo}d ago</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PeriodConsistencyTable({ role, data, loading, linkParams }: Props) {
  // Filter state
  const [searchRaw,     setSearchRaw]     = useState('');
  const [statusFilter,  setStatusFilter]  = useState<ConsistencyStatus | 'all'>('all');
  const [centreFilter,  setCentreFilter]  = useState<string>('all');
  const search = useDebounced(searchRaw, 200);

  // Sort state — default: status severity asc (silent first), tiebreak: coreJobDays asc
  const [sortCol, setSortCol] = useState<SortCol>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = useCallback((col: SortCol) => {
    setSortCol((prev) => {
      if (prev === col) { setSortDir((d) => d === 'asc' ? 'desc' : 'asc'); return col; }
      setSortDir('asc');
      return col;
    });
  }, []);

  // Derived data
  const counts = useMemo(() => statusCounts(data), [data]);

  const centreOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of data) if (r.centreName) seen.add(r.centreName);
    return [...seen].sort();
  }, [data]);

  const filtered = useMemo(() => {
    let rows = data;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
        (r.centreName ?? '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'all') rows = rows.filter((r) => (r.consistencyStatus ?? 'silent') === statusFilter);
    if (centreFilter !== 'all') rows = rows.filter((r) => r.centreName === centreFilter);
    return rows;
  }, [data, search, statusFilter, centreFilter]);

  const sorted = useMemo(() => sortRows(filtered, sortCol, sortDir, role), [filtered, sortCol, sortDir, role]);

  const isFiltered = search !== '' || statusFilter !== 'all' || centreFilter !== 'all';

  const clearFilters = useCallback(() => {
    setSearchRaw(''); setStatusFilter('all'); setCentreFilter('all');
  }, []);

  const hasConsistencyData = data.some((d) => (d.totalWorkingDays ?? 0) > 0);
  if (!hasConsistencyData && !loading) return null;

  const roleLabel = role === 'clinician' ? 'clinicians' : role === 'manager' ? 'managers' : 'admins';

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

      {/* ── Section header + filters ── */}
      <div className="px-6 py-4 border-b border-gray-100">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-gray-900">Period consistency</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              How consistently each person did their core job across the selected period
            </p>
          </div>
          <button
            onClick={() => exportCsv(role, sorted)}
            className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 active:bg-gray-100 transition-colors shrink-0"
          >
            Export CSV
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <input
            type="search"
            placeholder="Filter by name or centre…"
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-52 min-w-0"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ConsistencyStatus | 'all')}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
          >
            <option value="all">All statuses ({data.length})</option>
            <option value="silent">Silent ({counts.silent})</option>
            <option value="inactive">Inactive ({counts.inactive})</option>
            <option value="irregular">Irregular ({counts.irregular})</option>
            <option value="consistent">Consistent ({counts.consistent})</option>
          </select>
          {centreOptions.length > 1 && (
            <select
              value={centreFilter}
              onChange={(e) => setCentreFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer max-w-[180px] truncate"
            >
              <option value="all">All centres</option>
              {centreOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {/* Result count + clear */}
        {isFiltered && (
          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-gray-500">
              Showing <span className="font-medium">{sorted.length}</span> of{' '}
              <span className="font-medium">{data.length}</span> {roleLabel}
              {statusFilter !== 'all' && (
                <> · filtered by: <span className="font-medium capitalize">{statusFilter}</span></>
              )}
              {centreFilter !== 'all' && (
                <> · <span className="font-medium">{centreFilter}</span></>
              )}
            </span>
            <button onClick={clearFilters} className="text-[11px] text-blue-500 hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 180 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/60">
              {/* # — not sortable */}
              <th className="px-4 py-3 text-left text-[11px] font-medium text-gray-400 uppercase tracking-[0.04em] select-none">
                #
              </th>
              <SortHeader col="name"        active={sortCol === 'name'}        dir={sortDir} onSort={handleSort}>Name</SortHeader>
              <SortHeader col="centre"      active={sortCol === 'centre'}      dir={sortDir} onSort={handleSort}>Centre</SortHeader>
              <SortHeader col="status"      active={sortCol === 'status'}      dir={sortDir} onSort={handleSort}>Consistency</SortHeader>
              <SortHeader col="coreJobDays" active={sortCol === 'coreJobDays'} dir={sortDir} onSort={handleSort}>Core Job Days</SortHeader>
              <SortHeader col="coreOutput"  active={sortCol === 'coreOutput'}  dir={sortDir} onSort={handleSort}>Core Output</SortHeader>
              <SortHeader col="lastActive"  active={sortCol === 'lastActive'}  dir={sortDir} onSort={handleSort}>Last Active</SortHeader>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse" style={{ height: 52 }}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-3.5 bg-gray-100 rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-gray-400 text-sm">
                  No data for the selected {isFiltered ? 'filters' : 'period'}
                </td>
              </tr>
            ) : (
              sorted.map((person, i) => {
                const status = person.consistencyStatus ?? 'silent';
                const badge  = STATUS_BADGE[status];
                const cjd    = person.coreJobDays      ?? 0;
                const wd     = person.totalWorkingDays ?? 0;

                return (
                  <tr
                    key={person.id}
                    className="hover:bg-gray-50/80 transition-colors"
                    style={{ height: 52 }}
                  >
                    {/* # */}
                    <td className="px-4 text-[11px] text-gray-400 tabular-nums">{i + 1}</td>

                    {/* Name + email */}
                    <td className="px-4 overflow-hidden">
                      <PersonLink
                        userId={person.id}
                        role={role}
                        firstName={person.firstName}
                        lastName={person.lastName}
                        params={linkParams}
                      />
                      {(person as Clinician).email && (
                        <div className="text-[11px] text-gray-400 mt-[2px] truncate leading-none">
                          {(person as Clinician).email}
                        </div>
                      )}
                    </td>

                    {/* Centre — truncated with native tooltip */}
                    <td className="px-4 overflow-hidden" title={person.centreName ?? undefined}>
                      <span className="text-[12px] text-gray-500 truncate block">
                        {person.centreName ?? <span className="text-gray-300">—</span>}
                      </span>
                    </td>

                    {/* Consistency badge */}
                    <td className="px-4">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
                        style={{ backgroundColor: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* Core job days — colour-coded */}
                    <td className="px-4">
                      <span className={`text-[13px] font-medium tabular-nums ${cjdColor(cjd, wd)}`}>
                        {cjd} / {wd}
                      </span>
                    </td>

                    {/* Core output — zeroes suppressed */}
                    <td className="px-4 overflow-hidden">
                      <span className="text-[12px] text-gray-500 truncate block">
                        {coreOutputLabel(role, person.coreOutput)}
                      </span>
                    </td>

                    {/* Last active */}
                    <td className="px-4">
                      <LastActiveCell daysAgo={person.lastActiveDaysAgo} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollRegion>

      {/* ── Summary footer ── */}
      {!loading && data.length > 0 && (
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/40 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-gray-500">
            <span className="font-medium" style={{ color: '#3B6D11' }}>{counts.consistent}</span> consistent
            {' · '}
            <span className="font-medium text-amber-700">{counts.irregular}</span> irregular
            {' · '}
            <span className="font-medium text-amber-800">{counts.inactive}</span> inactive
            {' · '}
            <span className="font-bold" style={{ color: '#A32D2D' }}>{counts.silent}</span> silent
            {' — click any name for full profile'}
          </span>
        </div>
      )}
    </div>
  );
}
