'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  OverviewData,
  PreviousPeriodMetrics,
} from '@/lib/types';
import { useMetrics } from '@/lib/metricsContext';
import { shortCentreName } from '@/lib/centreNames';
import PersonLink from '@/components/PersonLink';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateShort(iso: string) {
  try { return new Date(iso + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }); }
  catch { return iso; }
}

const PREV_PERIOD_KEY = 'overview-prevperiod-toggle';

// ── Benchmark dot ─────────────────────────────────────────────────────────────

type BenchmarkLevel = 'green' | 'amber' | 'red';

const BENCHMARK_COLOURS: Record<BenchmarkLevel, string> = {
  green: '#1D9E75',
  amber: '#BA7517',
  red:   '#A32D2D',
};

interface BenchmarkDotProps {
  level: BenchmarkLevel;
  tooltip: string;
}

function BenchmarkDot({ level, tooltip }: BenchmarkDotProps) {
  return (
    <span
      title={tooltip}
      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 cursor-default"
      style={{ background: BENCHMARK_COLOURS[level] }}
      aria-label={tooltip}
    />
  );
}

// ── Period comparison arrow ───────────────────────────────────────────────────

interface PeriodDeltaProps {
  current: number;
  previous: number;
  prevDates: string;
  inverse?: boolean; // if true, more = worse (e.g., idle centres)
}

function PeriodDelta({ current, previous, prevDates, inverse = false }: PeriodDeltaProps) {
  const diff = current - previous;
  if (diff === 0) {
    return (
      <p className="text-[11px] text-gray-400 mt-1">— same as prev period</p>
    );
  }
  const improved = inverse ? diff < 0 : diff > 0;
  const sign = diff > 0 ? '+' : '';
  const colour = improved ? 'text-emerald-600' : 'text-rose-600';
  const arrow  = diff > 0 ? '↑' : '↓';
  return (
    <p className={`text-[11px] font-medium mt-1 ${colour}`}>
      {arrow} {sign}{diff.toLocaleString()} vs {prevDates}
    </p>
  );
}

// ── Drawer shell ──────────────────────────────────────────────────────────────

interface DrawerProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Drawer({ title, open, onClose, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div className="relative ml-auto flex flex-col bg-white shadow-2xl w-full max-w-2xl max-h-screen overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── Idle Centres Drawer ───────────────────────────────────────────────────────

function IdleCentresDrawer({
  open, onClose, data,
}: {
  open: boolean;
  onClose: () => void;
  data: OverviewData | null;
}) {
  const idleCentres = data?.idleCentreDetails ?? [];
  return (
    <Drawer title={`Idle centres this period — ${idleCentres.length}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        {idleCentres.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">All centres were active this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                <th className="pb-2 text-left font-medium">Centre</th>
                <th className="pb-2 text-right font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {idleCentres.map((c, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  <td className="py-2 pr-2 font-medium text-gray-800">{shortCentreName(c.name)}</td>
                  <td className="py-2 text-right text-gray-500 text-xs">
                    {c.lastActivityDate ? fmtDateShort(c.lastActivityDate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

// ── Multi-assessment Drawer ───────────────────────────────────────────────────

function MultiAssessmentDrawer({
  open, onClose, data,
}: {
  open: boolean;
  onClose: () => void;
  data: OverviewData | null;
}) {
  const cases = data?.multipleAssessmentCases?.cases ?? [];
  return (
    <Drawer title={`Multi-assessment cases — ${cases.length}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        {cases.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No multi-assessment cases this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                <th className="pb-2 text-left font-medium">Patient</th>
                <th className="pb-2 text-left font-medium">Centre</th>
                <th className="pb-2 text-right font-medium">Assessments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cases.map((c) => (
                <tr key={c.patientId} className="hover:bg-gray-50/60">
                  <td className="py-2 pr-2">
                    <span className="font-medium text-gray-900">{c.firstName} {c.lastName}</span>
                    {c.patientDisplayId && (
                      <span className="ml-1.5 text-[11px] text-gray-400">#{c.patientDisplayId}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.totalAssessments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

// ── Reports Approved Drawer ───────────────────────────────────────────────────

function ReportsApprovedDrawer({
  open, onClose, totalApproved, totalScored, approvedPct,
}: {
  open: boolean;
  onClose: () => void;
  totalApproved: number;
  totalScored: number;
  approvedPct: number;
}) {
  return (
    <Drawer title={`Reports approved — ${totalApproved}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        <div className="flex gap-4 mb-5">
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex-1 text-center">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Approved</p>
            <p className="text-[28px] font-bold text-gray-900">{totalApproved}</p>
          </div>
          <div className="bg-gray-50 rounded-lg px-4 py-3 flex-1 text-center">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Scored</p>
            <p className="text-[28px] font-bold text-gray-900">{totalScored}</p>
          </div>
          <div className={`rounded-lg px-4 py-3 flex-1 text-center ${
            approvedPct >= 80 ? 'bg-emerald-50' : approvedPct >= 60 ? 'bg-amber-50' : 'bg-rose-50'
          }`}>
            <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Rate</p>
            <p className={`text-[28px] font-bold ${
              approvedPct >= 80 ? 'text-emerald-700' : approvedPct >= 60 ? 'text-amber-700' : 'text-rose-700'
            }`}>{approvedPct}%</p>
          </div>
        </div>
        <p className="text-[12px] text-gray-500">
          Target: 80%+ of scored assessments should have approved reports. 
          {approvedPct < 80 && (
            <span className="text-amber-700 font-medium">
              {' '}Currently {approvedPct}% — managers may have a backlog of approvals pending.
            </span>
          )}
        </p>
      </div>
    </Drawer>
  );
}

// ── Total Cases Drawer ────────────────────────────────────────────────────────

function TotalCasesDrawer({
  open, onClose, data, totalCases,
}: {
  open: boolean;
  onClose: () => void;
  data: OverviewData | null;
  totalCases: number;
}) {
  const byCentre = data?.byCentre ?? [];
  const withCases = [...byCentre].filter((c) => c.cases > 0).sort((a, b) => b.cases - a.cases);

  return (
    <Drawer title={`Total cases — ${totalCases}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        <p className="text-[12px] text-gray-500 mb-3">Cases registered this period, grouped by centre</p>
        {withCases.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No cases this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                <th className="pb-2 text-left font-medium">Centre</th>
                <th className="pb-2 text-right font-medium">Cases</th>
                <th className="pb-2 text-right font-medium">Assessments</th>
                <th className="pb-2 text-right font-medium">Reports approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {withCases.map((c) => (
                <tr key={c.centreId} className="hover:bg-gray-50/60">
                  <td className="py-2 pr-2 font-medium text-gray-800">{shortCentreName(c.centreName)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-gray-900">{c.cases}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{c.assessments || '—'}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{c.reportsApproved || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

// ── Active Centres Drawer ─────────────────────────────────────────────────────

function ActiveCentresDrawer({
  open, onClose, data, activeCentres,
}: {
  open: boolean;
  onClose: () => void;
  data: OverviewData | null;
  activeCentres: number;
}) {
  const byCentre = (data?.byCentre ?? [])
    .filter((c) => c.cases > 0 || c.assessments > 0)
    .sort((a, b) => b.cases - a.cases);

  return (
    <Drawer title={`Active centres — ${activeCentres}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        {byCentre.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No active centres this period.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                <th className="pb-2 text-left font-medium">Centre</th>
                <th className="pb-2 text-right font-medium">Cases</th>
                <th className="pb-2 text-right font-medium">Assessments</th>
                <th className="pb-2 text-right font-medium">Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {byCentre.map((c) => (
                <tr key={c.centreId} className="hover:bg-gray-50/60">
                  <td className="py-2 pr-2 font-medium text-gray-800">{shortCentreName(c.centreName)}</td>
                  <td className="py-2 text-right tabular-nums font-semibold text-gray-900">{c.cases || '—'}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{c.assessments || '—'}</td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{c.reportsApproved || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Drawer>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

interface PeriodCardProps {
  label: string;
  value: React.ReactNode;
  context?: React.ReactNode;
  benchmark?: BenchmarkDotProps;
  prevDelta?: React.ReactNode;
  tooltip?: Parameters<typeof KpiTooltip>[0];
  clickable?: boolean;
  onClick?: () => void;
  footnote?: React.ReactNode;
}

function PeriodCard({
  label, value, context, benchmark, prevDelta, tooltip, clickable, onClick, footnote,
}: PeriodCardProps) {
  const body = (
    <div className="flex flex-col gap-1.5 h-full">
      <div className="flex items-center gap-1.5">
        {benchmark && <BenchmarkDot {...benchmark} />}
        <p className="text-[11px] uppercase tracking-[0.04em] text-gray-400 font-medium">{label}</p>
        {tooltip && <KpiTooltip {...tooltip} />}
      </div>
      <p className={`text-[26px] font-bold leading-none tabular-nums text-gray-900 ${
        clickable ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''
      }`}>
        {value}
      </p>
      {context && <div className="text-[11px] text-gray-500">{context}</div>}
      {prevDelta}
      {footnote && <div className="text-[10px] text-gray-400 mt-0.5">{footnote}</div>}
    </div>
  );

  const cls = 'bg-gray-50 rounded-lg p-4 flex flex-col gap-1.5';

  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        className={`${cls} text-left hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
      >
        {body}
      </button>
    );
  }
  return <div className={cls}>{body}</div>;
}

// ── Main: PeriodSummary ───────────────────────────────────────────────────────

interface PeriodSummaryProps {
  data: OverviewData | null;
  loading: boolean;
  dateFrom?: string;
  dateTo?: string;
  onOpenMultipleAssessments?: () => void;
  onOpenIdleCentres?: () => void;
}

type PeriodDrawer = 'cases' | 'active-centres' | 'idle-centres' | 'multi-assessment' | null;

export default function PeriodSummary({
  data, loading, dateFrom, dateTo, onOpenMultipleAssessments, onOpenIdleCentres,
}: PeriodSummaryProps) {
  const { metrics, loading: mLoading } = useMetrics();

  // Previous period toggle — persisted in localStorage
  const [showPrev, setShowPrev] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem(PREV_PERIOD_KEY) === 'true'; } catch { return false; }
  });

  const [openDrawer, setOpenDrawer] = useState<PeriodDrawer>(null);
  const closeDrawer = useCallback(() => setOpenDrawer(null), []);

  function togglePrev() {
    setShowPrev((prev) => {
      const next = !prev;
      try { localStorage.setItem(PREV_PERIOD_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const periodLabel = (dateFrom && dateTo)
    ? `${fmtDateShort(dateFrom)} – ${fmtDateShort(dateTo)}`
    : 'Selected period';

  if (loading || mLoading || !data || !metrics) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-40 bg-gray-100 rounded mt-1.5 animate-pulse" />
          </div>
          <div className="h-7 w-28 bg-gray-100 rounded-full animate-pulse" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-4 animate-pulse space-y-2">
              <div className="h-2.5 w-20 bg-gray-200 rounded" />
              <div className="h-7 w-14 bg-gray-200 rounded" />
              <div className="h-2 w-28 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const totalCases    = metrics.cases.total;
  const activeCentres = metrics.centres.active;
  const idleCentres   = metrics.centres.idle;
  const totalCentres  = metrics.centres.total;
  const multi         = data.multipleAssessmentCases;
  const multiPct      = multi?.percentage ?? 0;

  // Pipeline state counts (point-in-time) — from needsAction totals
  const na = data.needsAction;
  const totalScoring         = na?.totalScoring         ?? 0;
  const totalReportNotDrafted = na?.totalReportNotDrafted ?? 0;
  const totalAwaitingApproval = na?.totalAwaitingApproval ?? 0;
  const totalGoalsNotAdded   = na?.totalGoalsNotAdded   ?? 0;

  const prev = data.previousPeriodMetrics;
  const prevDates = prev ? `${fmtDateShort(prev.dateFrom)}–${fmtDateShort(prev.dateTo)}` : '';

  const centreActivePct = totalCentres > 0 ? Math.round((activeCentres / totalCentres) * 100) : 0;
  const centresBenchmark: BenchmarkDotProps = {
    level: centreActivePct >= 60 ? 'green' : centreActivePct >= 40 ? 'amber' : 'red',
    tooltip: `Active centres: ${activeCentres} of ${totalCentres} (${centreActivePct}%)`,
  };

  return (
    <div>
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[15px] font-medium text-gray-900">Pipeline snapshot</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">Current state of all open assessments</p>
        </div>
        {prev && (
          <button
            type="button"
            onClick={togglePrev}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors border ${
              showPrev
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
            </svg>
            vs prev period
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" role="list" aria-label="Pipeline metrics">

        {/* Card 1 — In scoring */}
        <PeriodCard
          label="In scoring"
          value={totalScoring.toLocaleString()}
          context="Active assessments being scored"
          tooltip={KPI.TOTAL_CASES}
        />

        {/* Card 2 — Awaiting report */}
        <PeriodCard
          label="Awaiting report"
          value={
            <span className={totalReportNotDrafted > 0 ? 'text-amber-600' : 'text-gray-900'}>
              {totalReportNotDrafted.toLocaleString()}
            </span>
          }
          context="Scored, report not drafted"
          prevDelta={showPrev && prev ? (
            <PeriodDelta current={totalReportNotDrafted} previous={prev.totalReportsDrafted} prevDates={prevDates} inverse />
          ) : undefined}
        />

        {/* Card 3 — Awaiting approval */}
        <PeriodCard
          label="Awaiting approval"
          value={
            <span className={totalAwaitingApproval > 0 ? 'text-amber-600' : 'text-gray-900'}>
              {totalAwaitingApproval.toLocaleString()}
            </span>
          }
          context="Manager action needed"
          prevDelta={showPrev && prev ? (
            <PeriodDelta current={totalAwaitingApproval} previous={prev.totalReportsApproved} prevDates={prevDates} inverse />
          ) : undefined}
        />

        {/* Card 4 — Goals to add */}
        <PeriodCard
          label="Goals to add"
          value={
            <span className={totalGoalsNotAdded > 0 ? 'text-amber-600' : 'text-gray-900'}>
              {totalGoalsNotAdded.toLocaleString()}
            </span>
          }
          context="Report approved, goals pending"
        />

        {/* Card 5 — Active centres */}
        <PeriodCard
          label="Active centres"
          value={`${activeCentres} / ${totalCentres}`}
          context={
            idleCentres > 0 ? (
              <button
                type="button"
                onClick={() => setOpenDrawer('idle-centres')}
                className="text-rose-600 hover:underline focus:outline-none"
              >
                {idleCentres} idle this period
              </button>
            ) : (
              'All centres engaged'
            )
          }
          benchmark={centresBenchmark}
          tooltip={KPI.ACTIVE_CENTRES}
          clickable
          onClick={() => setOpenDrawer('active-centres')}
          prevDelta={showPrev && prev ? (
            <PeriodDelta current={activeCentres} previous={prev.activeCentres} prevDates={prevDates} />
          ) : undefined}
        />

        {/* Card 6 — Multi-assessment cases */}
        <PeriodCard
          label="Multi-assessment"
          value={(multi?.count ?? 0).toLocaleString()}
          context={`${multiPct.toFixed(1)}% of cases`}
          tooltip={KPI.MULTIPLE_ASSESSMENT_CASES}
          clickable
          onClick={() => setOpenDrawer('multi-assessment')}
        />

      </div>

      {/* Drawers */}
      <TotalCasesDrawer
        open={openDrawer === 'cases'}
        onClose={closeDrawer}
        data={data}
        totalCases={totalCases}
      />

      <ActiveCentresDrawer
        open={openDrawer === 'active-centres'}
        onClose={closeDrawer}
        data={data}
        activeCentres={activeCentres}
      />

      <IdleCentresDrawer
        open={openDrawer === 'idle-centres'}
        onClose={closeDrawer}
        data={data}
      />

      <MultiAssessmentDrawer
        open={openDrawer === 'multi-assessment'}
        onClose={closeDrawer}
        data={data}
      />
    </div>
  );
}
