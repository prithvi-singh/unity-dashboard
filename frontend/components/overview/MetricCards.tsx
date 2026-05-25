'use client';

import type { OverviewData } from '@/lib/types';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';
import { DRILL_DOWN_HINT } from '@/lib/bottleneckDrillDown';

interface Props {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
  onOpenMultipleAssessments?: () => void;
  onOperationalDrill?: (type: 'status-changes' | 'transfers') => void;
}

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

const CasesIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const AssessmentIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
);
const AvgIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
);
const LayersIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);
const ResultsIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);
const CentreIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);
const AlertIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

interface CardProps {
  label: string; value: string; sub?: React.ReactNode;
  pct?: number; ringColor?: string;
  iconBg: string; iconFg: string; icon: React.ReactNode;
  hasAlert?: boolean;
  clickable?: boolean;
  onClick?: () => void;
  tooltip?: KpiDefinition;
  ariaLabel?: string;
}

function KpiCard({
  label, value, sub, pct, ringColor, iconBg, iconFg, icon, hasAlert,
  clickable, onClick, tooltip, ariaLabel,
}: CardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between">
        <div className={`${iconBg} ${iconFg} p-2.5 rounded-xl`} aria-hidden="true">{icon}</div>
        {pct !== undefined && ringColor !== undefined && <ProgressRing pct={pct} color={ringColor} />}
      </div>
      <div>
        <div className="flex items-center mb-1">
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.1em]">{label}</p>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-[2rem] font-bold text-gray-900 leading-none tracking-tight tabular-nums">{value}</p>
        {sub && <div className="text-xs text-gray-500 mt-1.5">{sub}</div>}
        {clickable && <p className="text-[10px] text-blue-700 font-semibold mt-2">{DRILL_DOWN_HINT} →</p>}
      </div>
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? `${label}: ${value}. ${DRILL_DOWN_HINT}`}
        aria-haspopup="dialog"
        className={`bg-white rounded-2xl p-5 flex flex-col justify-between gap-3 text-left w-full ${
          hasAlert
            ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
            : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100'
        } cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={`bg-white rounded-2xl p-5 flex flex-col justify-between gap-3 text-left w-full ${
      hasAlert
        ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] ring-1 ring-rose-200/80'
        : 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] border border-gray-100'
    }`}>
      {body}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="bg-white rounded-2xl p-5 animate-pulse border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between mb-4">
        <div className="h-9 w-9 bg-gray-100 rounded-xl" />
        <div className="h-[52px] w-[52px] bg-gray-100 rounded-full" />
      </div>
      <div className="h-2.5 w-20 bg-gray-100 rounded mb-2.5" />
      <div className="h-8 w-14 bg-gray-100 rounded" />
    </div>
  );
}

export default function MetricCards({ data, loading, error, onOpenMultipleAssessments, onOperationalDrill }: Props) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <AlertIcon /><span>Failed to load metrics: {error}</span>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-4">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} />)}
      </div>
    );
  }

  const activeCentres = data.byCentre.filter(c => c.cases + c.assessments + c.results > 0).length;
  const totalCentres  = data.byCentre.length;
  const alerts        = (data.totalStatusChanges ?? 0) + (data.totalTransfers ?? 0);
  const avgAssessmentsPerCase = data.totalCases > 0
    ? (data.totalAssessments / data.totalCases)
    : 0;
  const completionPct = data.totalAssessments > 0
    ? ((data.totalResults / data.totalAssessments) * 100)
    : 0;
  const scoringComplete = data.totalScoringComplete ?? data.pipeline?.scoringComplete ?? 0;
  const centrePct     = totalCentres > 0 ? (activeCentres / totalCentres) * 100 : 0;
  const multi = data.multipleAssessmentCases;
  const multiCount = multi?.count ?? 0;
  const multiPct = multi?.percentage ?? 0;
  const multiClickable = !!onOpenMultipleAssessments;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7 gap-4" role="list" aria-label="Overview metrics">
      <KpiCard label="Total Cases" value={data.totalCases.toLocaleString()} sub="This period"
        iconBg="bg-blue-50" iconFg="text-blue-600" icon={<CasesIcon />}
        tooltip={KPI.TOTAL_CASES} />
      <KpiCard label="Assessments" value={data.totalAssessments.toLocaleString()}
        sub="Assigned this period"
        iconBg="bg-violet-50" iconFg="text-violet-600" icon={<AssessmentIcon />}
        tooltip={KPI.ASSESSMENTS_ADDED} />
      <KpiCard
        label="Avg per Case"
        value={data.totalCases > 0 ? avgAssessmentsPerCase.toFixed(1) : '—'}
        sub={data.totalCases > 0 ? `${data.totalAssessments.toLocaleString()} ÷ ${data.totalCases.toLocaleString()} cases` : 'No cases in period'}
        iconBg="bg-indigo-50" iconFg="text-indigo-600" icon={<AvgIcon />}
        tooltip={KPI.AVG_ASSESSMENTS_PER_CASE}
      />
      <KpiCard
        label="Multi-Assessment Cases"
        value={multiCount.toLocaleString()}
        sub={`${multiPct.toFixed(1)}% of cases`}
        iconBg="bg-amber-50" iconFg="text-amber-700" icon={<LayersIcon />}
        clickable={multiClickable}
        onClick={multiClickable ? onOpenMultipleAssessments : undefined}
        tooltip={KPI.MULTIPLE_ASSESSMENT_CASES}
      />
      <KpiCard label="Report PDFs Created" value={data.totalResults.toLocaleString()}
        sub={`${scoringComplete.toLocaleString()} scored · ${completionPct.toFixed(1)}% of assigned assessments`}
        pct={completionPct} ringColor="#059669"
        iconBg="bg-emerald-50" iconFg="text-emerald-600" icon={<ResultsIcon />}
        tooltip={KPI.RESULTS_GENERATED} />
      <KpiCard label="Active Centres" value={`${activeCentres} / ${totalCentres}`}
        sub={activeCentres === totalCentres ? 'All centres engaged' : `${totalCentres - activeCentres} idle`}
        pct={centrePct} ringColor="#0284C7"
        iconBg="bg-sky-50" iconFg="text-sky-600" icon={<CentreIcon />}
        tooltip={KPI.ACTIVE_CENTRES} />
      <KpiCard label="Flags & Alerts" value={alerts.toLocaleString()}
        sub={alerts > 0 ? (
          onOperationalDrill ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              {data.totalStatusChanges > 0 && (
                <button
                  type="button"
                  onClick={() => onOperationalDrill('status-changes')}
                  className="text-blue-700 font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  {data.totalStatusChanges} status changes
                </button>
              )}
              {data.totalStatusChanges > 0 && data.totalTransfers > 0 && <span>·</span>}
              {data.totalTransfers > 0 && (
                <button
                  type="button"
                  onClick={() => onOperationalDrill('transfers')}
                  className="text-blue-700 font-semibold hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  {data.totalTransfers} transfers
                </button>
              )}
            </span>
          ) : `${data.totalStatusChanges} resets · ${data.totalTransfers} transfers`
        ) : 'Clean'}
        iconBg={alerts > 0 ? 'bg-rose-50' : 'bg-gray-50'} iconFg={alerts > 0 ? 'text-rose-600' : 'text-gray-400'}
        icon={<AlertIcon />} hasAlert={alerts > 0}
        tooltip={KPI.FLAGS_AND_ALERTS} />
    </div>
  );
}
