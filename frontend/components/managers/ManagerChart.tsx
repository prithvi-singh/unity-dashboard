'use client';

import type { Manager } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { aggregateManagersByCentre, managerFunnel, managerKpis } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import RoleFunnel from '@/components/shared/RoleFunnel';
import RoleCentreChart from '@/components/shared/RoleCentreChart';
import RoleCentreTable from '@/components/shared/RoleCentreTable';

interface Props {
  managers: Manager[];
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

export default function ManagerChart({
  managers, summary, loading, summaryLoading, onDrillDown,
}: Props) {
  const kpis = managerKpis(managers);
  const funnel = managerFunnel(managers);
  const byCentre = aggregateManagersByCentre(managers);
  const stuck = summary?.stuckOnboarding ?? 0;
  const drill = onDrillDown;

  if (loading && managers.length === 0) {
    return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
      {[1, 2, 3, 4].map((i) => <div key={i} className="bg-gray-100 rounded-xl h-36 border border-gray-100" />)}
    </div>;
  }

  if (kpis.people === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">
        No manager data for the selected filters
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Cases Registered"
          value={kpis.totalCases.toLocaleString()}
          sub="in selected period"
          iconBg="bg-violet-50" iconFg="text-violet-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>}
          clickable={!!drill && kpis.totalCases > 0}
          onClick={() => drill?.({ type: 'manager-registered', label: 'Cases registered' })}
        />
        <KpiCard
          label="Assessments Assigned"
          value={kpis.totalAssigned.toLocaleString()}
          sub="clinical handoffs"
          pct={kpis.assignPct}
          ringColor="#378ADD"
          iconBg="bg-blue-50" iconFg="text-blue-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
          clickable={!!drill && kpis.totalAssigned > 0}
          onClick={() => drill?.({ type: 'manager-assigned', label: 'Assessments assigned' })}
        />
        <KpiCard
          label="Stuck Onboarding"
          value={summaryLoading ? '…' : stuck.toLocaleString()}
          sub=">48h unassigned"
          hasAlert={stuck > 0}
          iconBg="bg-rose-50" iconFg="text-rose-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          clickable={!!drill && stuck > 0}
          onClick={() => drill?.({ type: 'manager-stuck-onboarding', label: 'Stuck onboarding (>48h)' })}
        />
        <KpiCard
          label="Assign Rate"
          value={`${kpis.assignPct}%`}
          sub="assessments / registrations"
          pct={kpis.assignPct}
          ringColor={kpis.assignPct >= 80 ? '#1D9E75' : kpis.assignPct >= 50 ? '#F59E0B' : '#F43F5E'}
          iconBg="bg-teal-50" iconFg="text-teal-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
        />
        <KpiCard
          label="Active Managers"
          value={`${kpis.activeCount}/${kpis.people}`}
          sub={kpis.assignments !== kpis.people ? `${kpis.assignments} centre assignments` : undefined}
          pct={kpis.people > 0 ? Math.round((kpis.activeCount / kpis.people) * 100) : 0}
          ringColor="#7F77DD"
          iconBg="bg-indigo-50" iconFg="text-indigo-600"
          icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RoleFunnel
          title="Onboarding Funnel"
          subtitle="Register → assign → active"
          loading={loading}
          onDrillDown={onDrillDown}
          steps={[
            { label: 'Registered', value: funnel.registered, barColor: 'bg-violet-500', drillType: 'manager-registered', drillLabel: 'Cases registered' },
            { label: 'Assigned', value: funnel.assigned, barColor: 'bg-blue-500', pctLabel: funnel.registered > 0 ? `${Math.round((funnel.assigned / funnel.registered) * 100)}% assign rate` : undefined, drillType: 'manager-assigned', drillLabel: 'Assessments assigned' },
            { label: 'Active', value: funnel.activeManagers, barColor: 'bg-emerald-500', pctLabel: `${funnel.activeManagers} managers active this period` },
          ]}
        />
        <RoleCentreChart
          title="By Centre"
          subtitle="Registered vs assigned"
          rows={byCentre}
          loading={loading}
          onDrillDown={onDrillDown}
          datasets={[
            { label: 'Registered', color: 'rgba(127,119,221,0.82)', metricKey: 'metric1', drillType: 'manager-registered' },
            { label: 'Assigned', color: 'rgba(55,138,221,0.82)', metricKey: 'metric2', drillType: 'manager-assigned' },
          ]}
        />
      </div>

      <RoleCentreTable
        title="Assignment queue"
        subtitle="Registered but not yet assigned"
        actionNote="Unassigned = waiting for a clinician. Managers: assign assessments. Click Unassigned for cases >48h."
        tooltip={KPI.MANAGER_CENTRE_QUEUE}
        rows={byCentre.map((r) => ({
          ...r,
          metric3: Math.max(0, r.metric1 - r.metric2),
        }))}
        loading={loading}
        onDrillDown={onDrillDown}
        cols={[
          { key: 'metric1', label: 'Registered', colorClass: 'bg-violet-500', drillType: 'manager-registered' },
          { key: 'metric2', label: 'Assigned', colorClass: 'bg-blue-500', drillType: 'manager-assigned' },
          { key: 'metric3', label: 'Unassigned', colorClass: 'bg-amber-400', drillType: 'manager-stuck-onboarding' },
        ]}
      />
    </div>
  );
}
