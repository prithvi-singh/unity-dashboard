'use client';

import type { BottleneckData } from '@/lib/types';
import type { OnBottleneckDrillDown } from '@/lib/bottleneckDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/bottleneckDrillDown';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';

interface Props {
  data: BottleneckData | null;
  loading: boolean;
  error: string | null;
  onDrillDown?: OnBottleneckDrillDown;
}

const ONBOARDING_SLA_HOURS = 24;
const GOAL_APPROVAL_SLA_HOURS = 48;
const COMPLETION_TARGET = 80;

function ProgressRing({ pct, color, size = 52 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <svg width={size} height={size} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F3F4F6" strokeWidth="4" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90, ${cx}, ${cy})`}
        style={{ transition: 'stroke-dasharray 0.7s ease' }}
      />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: '9.5px', fontWeight: 700, fill: '#6B7280', fontFamily: 'Inter, sans-serif' }}
      >
        {pct === 0 ? '—' : `${Math.round(pct)}%`}
      </text>
    </svg>
  );
}

function slaScore(avgHours: number | null, targetHours: number): number {
  if (avgHours === null || avgHours <= 0) return 0;
  if (avgHours <= targetHours) return 100;
  return Math.max(0, Math.min(100, (targetHours / avgHours) * 100));
}

const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V4m0 0l8-1 8 1v12l-8-1-8 1" />
  </svg>
);

const CheckCircleIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const WarningIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  pct?: number;
  ringColor?: string;
  iconBg: string;
  iconFg: string;
  icon: React.ReactNode;
  hasAlert?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  tooltip?: KpiDefinition;
  focusTarget?: string;
}

function KpiCard({ label, value, sub, pct, ringColor, iconBg, iconFg, icon, hasAlert, clickable, onClick, tooltip, focusTarget }: CardProps) {
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      data-focus-target={focusTarget}
      title={clickable ? DRILL_DOWN_HINT : undefined}
      className={`bg-gray-50 rounded-xl p-4 flex flex-col justify-between gap-3 text-left w-full ${
        hasAlert ? 'ring-1 ring-rose-200/80' : ''
      } ${clickable ? 'cursor-pointer hover:bg-gray-100 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconFg} p-2.5 rounded-xl`} aria-hidden="true">{icon}</div>
        {pct !== undefined && ringColor !== undefined && <ProgressRing pct={pct} color={ringColor} />}
      </div>
      <div>
        <div className="flex items-center mb-1">
          <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] leading-snug">{label}</p>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-[2rem] font-bold text-gray-900 leading-none tracking-tight tabular-nums">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1.5">{sub}</p>}
        {clickable && <p className="text-[10px] text-blue-500 font-semibold mt-2">{DRILL_DOWN_HINT} →</p>}
      </div>
    </Tag>
  );
}

function Skeleton() {
  return (
    <div className="bg-gray-50 rounded-xl p-4 animate-pulse">
      <div className="flex justify-between mb-4">
        <div className="h-9 w-9 bg-gray-100 rounded-xl" />
        <div className="h-[52px] w-[52px] bg-gray-100 rounded-full" />
      </div>
      <div className="h-2.5 w-36 bg-gray-100 rounded mb-2.5" />
      <div className="h-8 w-20 bg-gray-100 rounded" />
    </div>
  );
}

export default function BottleneckCards({ data, loading, error, onDrillDown }: Props) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <WarningIcon />
        Failed to load bottleneck metrics: {error}
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  const avgOnboarding =
    data.avgOnboardingHours !== null ? `${data.avgOnboardingHours.toFixed(1)}h` : '—';
  const avgGoalApproval =
    data.avgGoalApprovalHours !== null ? `${data.avgGoalApprovalHours.toFixed(1)}h` : '—';

  const onboardingSla = slaScore(data.avgOnboardingHours, ONBOARDING_SLA_HOURS);
  const goalApprovalSla = slaScore(data.avgGoalApprovalHours, GOAL_APPROVAL_SLA_HOURS);
  const completionGood = data.assessmentCompletionRate >= COMPLETION_TARGET;

  const actionItems =
    data.casesStuckInOnboarding + data.pendingGoalApprovals + data.pendingAssessments;
  const registered = data.funnel?.registered ?? 0;
  const actionPct = registered > 0
    ? Math.max(0, 100 - (actionItems / registered) * 100)
    : actionItems === 0 ? 100 : 0;

  const onboardingOverSla = data.avgOnboardingHours !== null && data.avgOnboardingHours > ONBOARDING_SLA_HOURS;
  const goalOverSla = data.avgGoalApprovalHours !== null && data.avgGoalApprovalHours > GOAL_APPROVAL_SLA_HOURS;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4" role="list" aria-label="Bottleneck metrics">
      <KpiCard
        label="Onboarding Turnaround"
        value={avgOnboarding}
        sub={onboardingOverSla ? `Over ${ONBOARDING_SLA_HOURS}h target` : `Under ${ONBOARDING_SLA_HOURS}h target`}
        pct={onboardingSla}
        ringColor={onboardingOverSla ? '#F43F5E' : '#0284C7'}
        iconBg={onboardingOverSla ? 'bg-rose-50' : 'bg-sky-50'}
        iconFg={onboardingOverSla ? 'text-rose-600' : 'text-sky-600'}
        icon={<ClockIcon />}
        hasAlert={onboardingOverSla}
        clickable={!!onDrillDown && data.avgOnboardingHours !== null}
        onClick={() => onDrillDown?.({ type: 'slow-onboarding', label: 'Slow onboarding (>24h to assign)' })}
        tooltip={KPI.ONBOARDING_TURNAROUND}
      />
      <KpiCard
        label="Goal Approval Turnaround"
        value={avgGoalApproval}
        sub={goalOverSla ? `Over ${GOAL_APPROVAL_SLA_HOURS}h target` : `Under ${GOAL_APPROVAL_SLA_HOURS}h target`}
        pct={goalApprovalSla}
        ringColor={goalOverSla ? '#F59E0B' : '#7C3AED'}
        iconBg={goalOverSla ? 'bg-amber-50' : 'bg-violet-50'}
        iconFg={goalOverSla ? 'text-amber-600' : 'text-violet-600'}
        icon={<FlagIcon />}
        hasAlert={goalOverSla}
        clickable={!!onDrillDown && data.avgGoalApprovalHours !== null}
        onClick={() => onDrillDown?.({ type: 'slow-goal-approval', label: 'Slow or pending goal approvals (>48h)' })}
        tooltip={KPI.GOAL_APPROVAL_TURNAROUND}
      />
      <KpiCard
        label="Assessment Completion"
        value={`${data.assessmentCompletionRate.toFixed(1)}%`}
        sub={completionGood ? `Above ${COMPLETION_TARGET}%` : `Below ${COMPLETION_TARGET}%`}
        pct={data.assessmentCompletionRate}
        ringColor={completionGood ? '#059669' : '#F59E0B'}
        iconBg={completionGood ? 'bg-emerald-50' : 'bg-amber-50'}
        iconFg={completionGood ? 'text-emerald-600' : 'text-amber-600'}
        icon={<CheckCircleIcon />}
        clickable={!!onDrillDown && data.pendingAssessments > 0}
        onClick={() => onDrillDown?.({ type: 'incomplete-assessments', label: 'Incomplete assessments' })}
        tooltip={KPI.ASSESSMENT_COMPLETION}
        focusTarget="bottleneck-incomplete-assessments"
      />
      <KpiCard
        label="Stuck in Onboarding"
        value={data.casesStuckInOnboarding.toString()}
        sub={data.casesStuckInOnboarding > 0 ? 'Unassigned 48h+' : 'Flowing normally'}
        iconBg={data.casesStuckInOnboarding > 0 ? 'bg-rose-50' : 'bg-gray-50'}
        iconFg={data.casesStuckInOnboarding > 0 ? 'text-rose-600' : 'text-gray-400'}
        icon={<WarningIcon />}
        hasAlert={data.casesStuckInOnboarding > 0}
        clickable={!!onDrillDown && data.casesStuckInOnboarding > 0}
        onClick={() => onDrillDown?.({ type: 'stuck-onboarding', label: 'Cases stuck in onboarding (>48h)' })}
        tooltip={KPI.STUCK_IN_ONBOARDING}
        focusTarget="bottleneck-stuck-onboarding"
      />
      <KpiCard
        label="Action Items"
        value={actionItems.toString()}
        sub={
          actionItems > 0
            ? `${data.casesStuckInOnboarding} stuck · ${data.pendingAssessments} incomplete · ${data.pendingGoalApprovals} goals`
            : 'Nothing blocked'
        }
        pct={actionPct}
        ringColor={actionItems > 0 ? '#F43F5E' : '#059669'}
        iconBg={actionItems > 0 ? 'bg-rose-50' : 'bg-emerald-50'}
        iconFg={actionItems > 0 ? 'text-rose-600' : 'text-emerald-600'}
        icon={<AlertIcon />}
        hasAlert={actionItems > 0}
        clickable={!!onDrillDown && actionItems > 0}
        onClick={() => onDrillDown?.({ type: 'all-actions', label: 'All action items' })}
        tooltip={KPI.ACTION_ITEMS}
      />
    </div>
  );
}
