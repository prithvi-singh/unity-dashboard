'use client';

import type { CentreAdmin } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { adminFunnel, adminKpis, aggregateAdminsByCentre } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import RoleFunnel from '@/components/shared/RoleFunnel';
import RoleCentreChart from '@/components/shared/RoleCentreChart';
import RoleCentreTable from '@/components/shared/RoleCentreTable';

interface Props {
  admins: CentreAdmin[];
  summary: RoleSummary | null;
  loading: boolean;
  summaryLoading?: boolean;
  onDrillDown?: OnRoleDrillDown;
}

function ProgressRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const cx = size / 2;
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#F3F4F6" strokeWidth="4" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90, ${cx}, ${cx})`}
      />
      <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '9.5px', fontWeight: 700, fill: '#6B7280' }}
      >
        {pct === 0 ? '—' : `${Math.round(pct)}%`}
      </text>
    </svg>
  );
}

function KpiCard({
  label, value, sub, pct, ringColor, iconBg, iconFg, icon, hasAlert, clickable, onClick,
}: {
  label: string; value: string; sub?: string; pct?: number; ringColor?: string;
  iconBg: string; iconFg: string; icon: React.ReactNode; hasAlert?: boolean;
  clickable?: boolean; onClick?: () => void;
}) {
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      title={clickable ? DRILL_DOWN_HINT : undefined}
      className={`bg-gray-50 rounded-xl p-4 flex flex-col justify-between gap-3 text-left w-full ${
        hasAlert ? 'ring-1 ring-rose-200/80' : 'border border-gray-100'
      } shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ${
        clickable ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconFg} p-2.5 rounded-xl`}>{icon}</div>
        {pct !== undefined && ringColor && <ProgressRing pct={pct} color={ringColor} />}
      </div>
      <div>
        <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">{label}</p>
        <p className="text-[2rem] font-bold text-gray-900 leading-none tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        {clickable && <p className="text-[10px] text-blue-500 font-semibold mt-2">{DRILL_DOWN_HINT} →</p>}
      </div>
    </Tag>
  );
}

export default function CentreAdminChart({
  admins, summary, loading, summaryLoading, onDrillDown,
}: Props) {
  const kpis = adminKpis(admins);
  const funnel = adminFunnel(admins);
  const byCentre = aggregateAdminsByCentre(admins);
  const unassigned = summary?.unassignedCases ?? 0;
  const drill = onDrillDown;

  if (loading && admins.length === 0) {
    return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => <div key={i} className="bg-gray-100 rounded-xl h-36 border border-gray-100" />)}
    </div>;
  }

  if (kpis.people === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No centre admin data for the selected filters
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Cases Registered"
          value={kpis.totalRegistered.toLocaleString()}
          sub="ops intake in period"
          iconBg="bg-teal-50" iconFg="text-teal-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>}
          clickable={!!drill && kpis.totalRegistered > 0}
          onClick={() => drill?.({ type: 'admin-registered', label: 'Cases registered' })}
        />
        <KpiCard
          label="Routed to Clinical"
          value={kpis.totalAssigned.toLocaleString()}
          sub="clinical assignments"
          pct={kpis.routingPct}
          ringColor="#F97316"
          iconBg="bg-orange-50" iconFg="text-orange-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>}
          clickable={!!drill && kpis.totalAssigned > 0}
          onClick={() => drill?.({ type: 'admin-assigned', label: 'Routed to clinical' })}
        />
        <KpiCard
          label="Awaiting Routing"
          value={summaryLoading ? '…' : unassigned.toLocaleString()}
          sub="registered, never assigned"
          hasAlert={unassigned > 0}
          iconBg="bg-rose-50" iconFg="text-rose-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          clickable={!!drill && unassigned > 0}
          onClick={() => drill?.({ type: 'admin-unassigned', label: 'Awaiting clinical assignment' })}
        />
        <KpiCard
          label="Routing Rate"
          value={`${kpis.routingPct}%`}
          sub="target 80%+ same period"
          pct={kpis.routingPct}
          ringColor={kpis.routingPct >= 80 ? '#1D9E75' : kpis.routingPct >= 50 ? '#F59E0B' : '#F43F5E'}
          iconBg="bg-emerald-50" iconFg="text-emerald-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <KpiCard
          label="Active Ops"
          value={`${kpis.activeCount}/${kpis.people}`}
          sub={kpis.assignments !== kpis.people ? `${kpis.assignments} centre assignments` : undefined}
          pct={kpis.people > 0 ? Math.round((kpis.activeCount / kpis.people) * 100) : 0}
          ringColor="#14B8A6"
          iconBg="bg-cyan-50" iconFg="text-cyan-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RoleFunnel
          title="Ops Routing Funnel"
          subtitle="Intake → route → active"
          loading={loading}
          onDrillDown={onDrillDown}
          steps={[
            { label: 'Registered', value: funnel.registered, barColor: 'bg-teal-500', drillType: 'admin-registered', drillLabel: 'Cases registered' },
            { label: 'Routed', value: funnel.assigned, barColor: 'bg-orange-500', pctLabel: funnel.registered > 0 ? `${Math.round((funnel.assigned / funnel.registered) * 100)}% routing rate` : undefined, drillType: 'admin-assigned', drillLabel: 'Routed to clinical' },
            { label: 'Active', value: funnel.activeAdmins, barColor: 'bg-emerald-500', pctLabel: `${funnel.activeAdmins} ops admins active` },
          ]}
        />
        <RoleCentreChart
          title="By Centre"
          subtitle="Registered vs routed"
          rows={byCentre}
          loading={loading}
          onDrillDown={onDrillDown}
          datasets={[
            { label: 'Registered', color: 'rgba(20,184,166,0.82)', metricKey: 'metric1', drillType: 'admin-registered' },
            { label: 'Routed', color: 'rgba(249,115,22,0.78)', metricKey: 'metric2', drillType: 'admin-assigned' },
            { label: 'Backlog', color: 'rgba(244,63,94,0.75)', metricKey: 'metric3', drillType: 'admin-unassigned' },
          ]}
        />
      </div>

      <RoleCentreTable
        title="Routing queue"
        subtitle="Registered but not yet routed"
        actionNote="Backlog = registered minus routed. Ops admins: route cases so managers can assign."
        tooltip={KPI.ADMIN_CENTRE_QUEUE}
        rows={byCentre}
        loading={loading}
        onDrillDown={onDrillDown}
        cols={[
          { key: 'metric1', label: 'Registered', colorClass: 'bg-teal-500', drillType: 'admin-registered' },
          { key: 'metric2', label: 'Routed', colorClass: 'bg-orange-500', drillType: 'admin-assigned' },
          { key: 'metric3', label: 'Backlog', colorClass: 'bg-rose-400', drillType: 'admin-unassigned' },
        ]}
      />
    </div>
  );
}
