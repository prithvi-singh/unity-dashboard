'use client';

import type { CentreAdmin } from '@/lib/types';
import type { OnRoleDrillDown, RoleSummary } from '@/lib/roleDrillDown';
import { adminKpis } from '@/lib/roleStats';
import { KPI } from '@/lib/kpiDefinitions';
import { KpiTooltip } from '@/components/shared/KpiTooltip';

interface Props {
  admins: CentreAdmin[];
  summary: RoleSummary | null;
  loading: boolean;
  summaryLoading?: boolean;
  onDrillDown?: OnRoleDrillDown;
}

// ─── Standard KpiCard (no icons, no donuts) ───────────────────────────────────
interface KpiCardProps {
  label:       string;
  value:       string;
  context?:    React.ReactNode;
  tooltip?:    { title: string; description: string };
  valueColor?: string;
  hasAlert?:   boolean;
  clickable?:  boolean;
  onClick?:    () => void;
  ariaLabel?:  string;
}

function KpiCard({ label, value, context, tooltip, valueColor, hasAlert, clickable, onClick, ariaLabel }: KpiCardProps) {
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      aria-label={clickable ? (ariaLabel ?? `${label}: ${value}`) : undefined}
      aria-haspopup={clickable ? 'dialog' : undefined}
      className={[
        'bg-white rounded-xl px-6 py-5 flex flex-col gap-2 text-left w-full',
        hasAlert
          ? 'border border-rose-200/80'
          : 'border border-gray-100',
        clickable
          ? 'cursor-pointer hover:border-gray-200 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400'
          : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1 min-h-[20px]">
        <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-gray-500 leading-tight">
          {label}
        </span>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p className="text-[28px] font-medium leading-none tabular-nums" style={{ color: valueColor ?? '#111827' }}>
        {value}
      </p>
      {context && (
        <div className="text-[13px] text-gray-400 leading-snug mt-1">{context}</div>
      )}
    </Tag>
  );
}

export default function CentreAdminChart({
  admins, summary, loading, summaryLoading, onDrillDown,
}: Props) {
  const kpis = adminKpis(admins);
  const unassigned = summary?.unassignedCases ?? 0;
  const drill = onDrillDown;

  if (loading && admins.length === 0) {
    return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 animate-pulse">
      {[1, 2, 3, 4, 5].map((i) => <div key={i} className="bg-gray-100 rounded-xl h-32 border border-gray-100" />)}
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <KpiCard
        label="Cases Registered"
        value={(kpis.totalRegistered ?? 0).toLocaleString()}
        context="Ops intake in period"
        tooltip={KPI.ADMIN_CASES_REGISTERED}
        clickable={!!drill && kpis.totalRegistered > 0}
        onClick={() => drill?.({ type: 'admin-registered', label: 'Cases registered' })}
      />
      <KpiCard
        label="Clinicians Assigned"
        value={(kpis.totalAssigned ?? 0).toLocaleString()}
        context="Clinical assignments routed"
        tooltip={KPI.ADMIN_ASSIGNED}
        clickable={!!drill && kpis.totalAssigned > 0}
        onClick={() => drill?.({ type: 'admin-assigned', label: 'Clinicians assigned' })}
      />
      <KpiCard
        label="Awaiting Assignment"
        value={summaryLoading ? '…' : unassigned.toLocaleString()}
        context="Registered, not yet assigned"
        valueColor={unassigned > 0 ? '#A32D2D' : '#111827'}
        hasAlert={unassigned > 0}
        tooltip={KPI.ADMIN_UNASSIGNED}
        clickable={!!drill && unassigned > 0}
        onClick={() => drill?.({ type: 'admin-unassigned', label: 'Awaiting assignment' })}
      />
      <KpiCard
        label="Routing Rate"
        value={`${kpis.routingPct}%`}
        context="Registered cases routed to clinical"
        tooltip={KPI.ADMIN_ROUTING_RATE}
      />
      <KpiCard
        label="Active Ops Admins"
        value={`${kpis.activeCount} / ${kpis.people}`}
        context="Core job activity in period"
        tooltip={KPI.ADMIN_ACTIVE_STAFF}
      />
    </div>
  );
}
