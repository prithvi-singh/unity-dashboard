'use client';

import { useState } from 'react';
import type { MonitoringData } from '@/lib/types';
import { computeDayStats, aggregateByCentre } from '@/lib/monitoringStats';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';

interface Props {
  data: MonitoringData | null;
  loading: boolean;
}

function ProgressRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const cx = size / 2;
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#F3F4F6" strokeWidth="4" />
      <circle
        cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90, ${cx}, ${cx})`}
        style={{ transition: 'stroke-dasharray 0.7s ease' }}
      />
      <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '9.5px', fontWeight: 700, fill: '#6B7280' }}
      >
        {pct === 0 ? '—' : `${Math.round(pct)}%`}
      </text>
    </svg>
  );
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  iconBg: string;
  iconFg: string;
  icon: React.ReactNode;
  ring?: { pct: number; color: string };
  alert?: boolean;
  tooltip?: KpiDefinition;
}

function KpiCard({ label, value, sub, iconBg, iconFg, icon, ring, alert, tooltip }: CardProps) {
  return (
    <div className={`bg-white rounded-2xl p-5 flex flex-col justify-between gap-3 ${
      alert
        ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
        : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100'
    }`}>
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconFg} p-2.5 rounded-xl`}>{icon}</div>
        {ring && <ProgressRing pct={ring.pct} color={ring.color} />}
      </div>
      <div>
        <div className="flex items-center mb-1">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em]">{label}</p>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-[2rem] font-bold text-gray-900 leading-none tracking-tight tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 animate-pulse border border-gray-100">
      <div className="flex justify-between mb-4">
        <div className="h-9 w-9 bg-gray-100 rounded-xl" />
        <div className="h-[52px] w-[52px] bg-gray-100 rounded-full" />
      </div>
      <div className="h-2.5 w-24 bg-gray-100 rounded mb-2" />
      <div className="h-8 w-16 bg-gray-100 rounded" />
    </div>
  );
}

const BoltIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const BuildingIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);
const AlertIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);
const ChartIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

// ─── Expandable Centres Active card ────────────────────────────────────────────

interface CentresCardProps {
  centresActive: number;
  centreRows: { centreName: string; actions: number; activeUsers: number }[];
}

function CentresActiveCard({ centresActive, centreRows }: CentresCardProps) {
  const [open, setOpen] = useState(false);
  const active = centreRows.filter((c) => c.actions > 0);

  return (
    <div className="bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100 flex flex-col overflow-hidden">
      {/* KPI header row */}
      <div className="p-5 flex flex-col justify-between gap-3 flex-1">
        <div className="flex items-start justify-between">
          <div className="bg-sky-50 text-sky-600 p-2.5 rounded-xl">
            <BuildingIcon />
          </div>
          <KpiTooltip {...KPI.CENTRES_ACTIVE} />
        </div>
        <div>
          <div className="flex items-center mb-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em]">
              Centres Active
            </p>
          </div>
          <p className="text-[2rem] font-bold text-gray-900 leading-none tracking-tight tabular-nums">
            {centresActive}
          </p>
          <p className="text-xs text-gray-500 mt-1.5">
            {centresActive > 0 ? 'At least 1 action today' : 'None yet'}
          </p>
        </div>
      </div>

      {/* Toggle button */}
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full px-5 py-2 text-[11px] font-semibold text-sky-600 hover:text-sky-800 hover:bg-sky-50/60 transition-colors border-t border-gray-50 text-left flex items-center justify-between"
          aria-expanded={open}
        >
          <span>{open ? 'Hide details' : `See all ${active.length} active centres`}</span>
          <span className="text-gray-300 text-[10px]">{open ? '↑' : '↓'}</span>
        </button>
      )}

      {/* Drilldown list */}
      {open && (
        <div className="border-t border-gray-50 divide-y divide-gray-50 max-h-56 overflow-y-auto">
          {active.map((c) => (
            <div
              key={c.centreName}
              className="flex items-center justify-between px-5 py-2 hover:bg-gray-50/60"
            >
              <span
                className="text-xs text-gray-700 font-medium truncate max-w-[160px]"
                title={c.centreName}
              >
                {c.centreName}
              </span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[11px] text-gray-400 tabular-nums">
                  {c.activeUsers} user{c.activeUsers !== 1 ? 's' : ''}
                </span>
                <span className="text-[11px] font-bold text-sky-700 tabular-nums bg-sky-50 px-1.5 py-0.5 rounded">
                  {c.actions}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MonitoringCards({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  const stats = computeDayStats(data);
  if (!stats) return null;

  const avgActions = stats.active > 0
    ? (stats.totalActions / stats.active).toFixed(1)
    : '0';

  const centreRows = aggregateByCentre(stats.users);

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4" role="list" aria-label="Monitoring metrics">
      <KpiCard
        label="Engagement Rate"
        value={`${stats.coreActive} / ${stats.coreStaff}`}
        sub={`${stats.active} active across all ${stats.total} accounts · ${stats.loggedIn} signed in`}
        ring={{ pct: stats.coreStaff > 0 ? (stats.coreActive / stats.coreStaff) * 100 : 0, color: '#059669' }}
        iconBg="bg-emerald-50"
        iconFg="text-emerald-600"
        icon={<BoltIcon />}
        tooltip={KPI.ENGAGEMENT_RATE}
      />
      <KpiCard
        label="Actions Today"
        value={stats.totalActions.toLocaleString()}
        sub={`${avgActions} avg per active user`}
        iconBg="bg-violet-50"
        iconFg="text-violet-600"
        icon={<ChartIcon />}
        tooltip={KPI.ACTIONS_TODAY}
      />
      <CentresActiveCard
        centresActive={stats.centresActive}
        centreRows={centreRows}
      />
      <KpiCard
        label="Need Follow-up"
        value={String(stats.needsAttention)}
        sub={stats.needsAttention > 0 ? 'Zero actions today' : 'All engaged'}
        iconBg={stats.needsAttention > 0 ? 'bg-rose-50' : 'bg-gray-50'}
        iconFg={stats.needsAttention > 0 ? 'text-rose-600' : 'text-gray-400'}
        icon={<AlertIcon />}
        alert={stats.needsAttention > 0}
        tooltip={KPI.NEED_FOLLOW_UP}
      />
    </div>
  );
}
