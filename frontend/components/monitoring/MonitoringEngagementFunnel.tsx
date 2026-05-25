'use client';

import type { MonitoringData } from '@/lib/types';
import {
  computeDayStats,
  type MonitoringEngagementFilter,
  type EngagementRoleRow,
} from '@/lib/monitoringStats';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';

interface Props {
  data: MonitoringData | null;
  loading: boolean;
  selectedDate: string;
  activeFilter: MonitoringEngagementFilter;
  onFilterChange: (filter: MonitoringEngagementFilter) => void;
  onScrollToTable?: () => void;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function FilterButton({
  count,
  label,
  onClick,
  tone = 'default',
}: {
  count: number;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'warn' | 'good';
}) {
  if (count <= 0) {
    return <span className="text-gray-300 tabular-nums">0</span>;
  }

  const toneClass =
    tone === 'warn'
      ? 'text-rose-700 hover:bg-rose-50'
      : tone === 'good'
        ? 'text-emerald-700 hover:bg-emerald-50'
        : 'text-blue-700 hover:bg-blue-50';

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — click to filter table`}
      className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-semibold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${toneClass}`}
    >
      {count.toLocaleString()}
      <span className="text-[10px] font-normal opacity-70">→</span>
    </button>
  );
}

function RoleRow({
  row,
  onFilterChange,
  onScrollToTable,
}: {
  row: EngagementRoleRow;
  onFilterChange: (filter: MonitoringEngagementFilter) => void;
  onScrollToTable?: () => void;
}) {
  const apply = (filter: MonitoringEngagementFilter) => {
    onFilterChange(filter);
    onScrollToTable?.();
  };

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-2.5 pr-3">
        <p className="text-sm font-medium text-gray-900">{row.label}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {row.active} of {row.total} active ({pct(row.active, row.total)})
        </p>
      </td>
      <td className="py-2.5 px-2 text-right tabular-nums text-sm text-gray-700">
        {row.total.toLocaleString()}
      </td>
      <td className="py-2.5 px-2 text-right">
        <FilterButton
          count={row.loggedIn}
          label={`${row.label} signed in`}
          onClick={() => apply({ kind: 'role', roleGroup: row.roleGroup, tier: 'logged-in' })}
        />
      </td>
      <td className="py-2.5 px-2 text-right">
        <FilterButton
          count={row.active}
          label={`${row.label} active`}
          tone="good"
          onClick={() => apply({ kind: 'role', roleGroup: row.roleGroup, tier: 'active' })}
        />
      </td>
      <td className="py-2.5 px-2 text-right">
        <FilterButton
          count={row.inactive}
          label={`${row.label} inactive`}
          tone="warn"
          onClick={() => apply({ kind: 'role', roleGroup: row.roleGroup, tier: 'inactive' })}
        />
      </td>
    </tr>
  );
}

function Skeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 animate-pulse">
      <div className="h-4 w-48 bg-gray-100 rounded mb-2" />
      <div className="h-3 w-64 bg-gray-100 rounded mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function MonitoringEngagementFunnel({
  data,
  loading,
  selectedDate,
  activeFilter,
  onFilterChange,
  onScrollToTable,
}: Props) {
  if (loading && !data) return <Skeleton />;

  const stats = computeDayStats(data);
  if (!stats) return null;

  const apply = (filter: MonitoringEngagementFilter) => {
    onFilterChange(filter);
    onScrollToTable?.();
  };

  const coreEngagementPct = stats.coreStaff > 0
    ? Math.round((stats.coreActive / stats.coreStaff) * 100)
    : 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-5 h-full">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-gray-900">Who worked today?</h2>
          <KpiTooltip {...KPI.MONITORING_ENGAGEMENT} />
        </div>
        <p className="text-xs text-gray-400 mt-0.5">
          {selectedDate} · {stats.total.toLocaleString()} Unity accounts tracked
          {stats.byRole.some((r) => r.roleGroup === 'other') && (
            <span> (includes legacy or unassigned roles)</span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => apply({ kind: 'active' })}
          className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-left hover:bg-emerald-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-[0.08em]">Did case work</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{stats.active}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{pct(stats.active, stats.total)} of all accounts</p>
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'logged-in' })}
          className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2.5 text-left hover:bg-sky-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <p className="text-[10px] font-bold text-sky-700 uppercase tracking-[0.08em]">Signed in</p>
          <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{stats.loggedIn}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">New login session today</p>
        </button>
        <button
          type="button"
          onClick={() => apply({ kind: 'inactive' })}
          className={`rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 ${
            stats.needsAttention > 0
              ? 'border-rose-100 bg-rose-50/60 hover:bg-rose-50 focus-visible:ring-rose-400'
              : 'border-gray-100 bg-gray-50/60 hover:bg-gray-50 focus-visible:ring-gray-400'
          }`}
        >
          <p className={`text-[10px] font-bold uppercase tracking-[0.08em] ${stats.needsAttention > 0 ? 'text-rose-700' : 'text-gray-500'}`}>
            Needs nudge
          </p>
          <p className="text-xl font-bold text-gray-900 tabular-nums mt-1">{stats.needsAttention}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">Zero case actions today</p>
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
            Breakdown by role
          </p>
          <p className="text-[11px] text-gray-400">
            Core staff active: {stats.coreActive}/{stats.coreStaff} ({coreEngagementPct}%)
          </p>
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                <th className="text-left py-2 pr-3">Role</th>
                <th className="text-right py-2 px-2">Accounts</th>
                <th className="text-right py-2 px-2">Signed in</th>
                <th className="text-right py-2 px-2">Active</th>
                <th className="text-right py-2 px-2">Needs nudge</th>
              </tr>
            </thead>
            <tbody>
              {stats.byRole.map((row) => (
                <RoleRow
                  key={row.roleGroup}
                  row={row}
                  onFilterChange={onFilterChange}
                  onScrollToTable={onScrollToTable}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Click any number to filter the user list below.</p>
      </div>

      {stats.powerUsers > 0 && (
        <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
            <span className="text-xs text-gray-600">
              <span className="font-semibold text-gray-900">{stats.powerUsers}</span> high-activity staff (5+ actions)
            </span>
          </div>
          <button
            type="button"
            onClick={() => apply({ kind: 'power-users' })}
            className="text-xs font-semibold text-violet-700 hover:text-violet-900 whitespace-nowrap"
          >
            View list →
          </button>
        </div>
      )}

      {activeFilter.kind !== 'all' && (
        <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2 flex items-center justify-between gap-2">
          <p className="text-xs text-blue-800">
            Table filtered — click numbers above to change, or clear.
          </p>
          <button
            type="button"
            onClick={() => onFilterChange({ kind: 'all' })}
            className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
          >
            Clear filter
          </button>
        </div>
      )}
    </div>
  );
}
