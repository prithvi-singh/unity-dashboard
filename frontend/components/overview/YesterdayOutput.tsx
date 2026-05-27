'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  DailyMetrics,
  WeeklySparklines,
  WeeklyAverages,
  YesterdayDrillDown,
  YesterdaySilentClinician,
} from '@/lib/types';
import PersonLink from '@/components/PersonLink';
import { shortCentreName } from '@/lib/centreNames';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDayName(iso: string) {
  try { return new Date(iso + 'T12:00:00').toLocaleDateString([], { weekday: 'long' }); }
  catch { return iso; }
}

function fmtDateShort(iso: string) {
  try { return new Date(iso + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }); }
  catch { return iso; }
}

function fmtDateFull(iso: string) {
  try { return new Date(iso + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function daysAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Math.round((Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86400000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return `${diff}d ago`;
}

type MetricKey = 'casesRegistered' | 'assessmentsScored' | 'reportsDrafted' | 'reportsApproved' | 'goalsAdded' | 'activeUsers';

const METRIC_LABELS: Record<MetricKey, string> = {
  casesRegistered:   'Cases registered',
  assessmentsScored: 'Assessments scored',
  reportsDrafted:    'Reports drafted',
  reportsApproved:   'Reports approved',
  goalsAdded:        'Goals added',
  activeUsers:       'Active users',
};

const AVG_KEY: Record<MetricKey, keyof WeeklyAverages> = {
  casesRegistered:   'avgDailyCasesRegistered',
  assessmentsScored: 'avgDailyAssessmentsScored',
  reportsDrafted:    'avgDailyReportsDrafted',
  reportsApproved:   'avgDailyReportsApproved',
  goalsAdded:        'avgDailyGoalsAdded',
  activeUsers:       'avgDailyActiveUsers',
};

const SPARK_KEY: Partial<Record<MetricKey, keyof WeeklySparklines>> = {
  casesRegistered:   'casesRegistered',
  assessmentsScored: 'assessmentsScored',
  reportsApproved:   'reportsApproved',
  activeUsers:       'activeUsers',
};

const ACCENT: Record<MetricKey, { base: string; hex: string }> = {
  casesRegistered:   { base: 'text-violet-600',  hex: '#7c3aed' },
  assessmentsScored: { base: 'text-blue-600',    hex: '#2563eb' },
  reportsDrafted:    { base: 'text-teal-600',    hex: '#0d9488' },
  reportsApproved:   { base: 'text-emerald-600', hex: '#059669' },
  goalsAdded:        { base: 'text-amber-600',   hex: '#d97706' },
  activeUsers:       { base: 'text-gray-600',    hex: '#6b7280' },
};

/** Colour the value vs the daily average. */
function valueColour(val: number, avg: number): string {
  if (avg === 0) return val > 0 ? 'text-emerald-600' : 'text-rose-600';
  const ratio = val / avg;
  if (ratio >= 1.2) return 'text-emerald-600';
  if (ratio >= 0.8) return 'text-gray-900';
  if (ratio >= 0.5) return 'text-amber-600';
  return 'text-rose-600';
}

// ── Rich Sparkline with reference line ───────────────────────────────────────

interface SparklineProps {
  data: number[];
  avg: number;
  hexColour: string;
}

function RichSparkline({ data, avg, hexColour }: SparklineProps) {
  const W = 60, H = 24, PAD = 2;
  if (data.length < 2) return <svg width={W} height={H} aria-hidden="true" />;

  const maxVal = Math.max(...data, avg, 1);
  const minVal = Math.min(...data, 0);
  const range  = maxVal - minVal || 1;

  const toY = (v: number) => H - PAD - ((v - minVal) / range) * (H - PAD * 2);
  const toX = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);

  const refY = toY(avg);

  // Build coloured segments
  const segments: Array<{ from: number; to: number; colour: string }> = [];
  for (let i = 1; i < data.length; i++) {
    const aboveAvg = (data[i - 1] >= avg && data[i] >= avg);
    const belowAvg = (data[i - 1] < avg && data[i] < avg);
    segments.push({
      from: i - 1,
      to: i,
      colour: aboveAvg ? '#1D9E75' : belowAvg ? '#ef4444' : hexColour,
    });
  }

  // Smooth path points
  const pathParts = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(v)}`).join(' ');

  return (
    <svg width={W} height={H} aria-hidden="true" style={{ overflow: 'visible' }}>
      {/* Reference dashed line at avg */}
      {avg > 0 && (
        <line
          x1={PAD} y1={refY} x2={W - PAD} y2={refY}
          stroke="#d1d5db" strokeWidth="1" strokeDasharray="2,2"
        />
      )}
      {/* Coloured segments */}
      {segments.map((seg, idx) => (
        <line
          key={idx}
          x1={toX(seg.from)} y1={toY(data[seg.from])}
          x2={toX(seg.to)}   y2={toY(data[seg.to])}
          stroke={seg.colour} strokeWidth="1.5" strokeLinecap="round"
        />
      ))}
      {/* Invisible wider path for hover area */}
      <path d={pathParts} fill="none" stroke="transparent" strokeWidth="8" />
    </svg>
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div className="relative ml-auto flex flex-col bg-white shadow-2xl w-full max-w-2xl max-h-screen overflow-hidden">
        {/* Header */}
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
        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Drawer: Active Users ──────────────────────────────────────────────────────

function ActiveUsersDrawer({
  open, onClose, yesterday, drill,
}: {
  open: boolean;
  onClose: () => void;
  yesterday: DailyMetrics | undefined;
  drill: YesterdayDrillDown | undefined;
}) {
  const [tab, setTab] = useState<'active' | 'silent'>('active');
  const activeCount  = yesterday?.activeUsers ?? 0;
  const silentList   = drill?.silentClinicians ?? [];

  return (
    <Drawer title="Staff active yesterday" open={open} onClose={onClose}>
      <div className="px-5 pt-4 pb-2 flex gap-2 border-b border-gray-100 flex-shrink-0">
        {(['active', 'silent'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ${
              tab === t
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t === 'active' ? `Active (${activeCount})` : `Silent (${silentList.length})`}
          </button>
        ))}
      </div>

      {tab === 'active' && (
        <div className="px-5 py-4">
          {activeCount === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-8">No staff were active yesterday.</p>
          ) : (
            <>
              {/* Top clinicians as proxy for active staff */}
              <p className="text-[12px] text-gray-500 mb-3">Top active clinicians by output yesterday</p>
              {(drill?.topClinicians ?? []).length === 0 ? (
                <p className="text-[13px] text-gray-400">No clinician data available.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                      <th className="pb-2 text-left font-medium">Name</th>
                      <th className="pb-2 text-left font-medium">Centre</th>
                      <th className="pb-2 text-right font-medium">Scored</th>
                      <th className="pb-2 text-right font-medium">Drafted</th>
                      <th className="pb-2 text-right font-medium">Goals</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(drill?.topClinicians ?? []).map((c) => (
                      <tr key={c.userId} className="hover:bg-gray-50/60">
                        <td className="py-2 pr-2">
                          <PersonLink userId={c.userId} role="clinician" firstName={c.firstName} lastName={c.lastName} />
                        </td>
                        <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                        <td className="py-2 text-right tabular-nums text-gray-700">{c.assessmentsScored}</td>
                        <td className="py-2 text-right tabular-nums text-gray-700">{c.reportsDrafted}</td>
                        <td className="py-2 text-right tabular-nums text-gray-700">{c.goalsAdded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'silent' && (
        <div className="px-5 py-4">
          {silentList.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-8">All clinicians with open caseloads were active yesterday.</p>
          ) : (
            <>
              <p className="text-[12px] text-gray-500 mb-3">
                Clinicians with open caseload who had no activity yesterday — sorted by caseload
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                    <th className="pb-2 text-left font-medium">Name</th>
                    <th className="pb-2 text-left font-medium">Centre</th>
                    <th className="pb-2 text-right font-medium">Open cases</th>
                    <th className="pb-2 text-right font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {silentList.map((c: YesterdaySilentClinician) => (
                    <tr key={c.userId} className="hover:bg-gray-50/60">
                      <td className="py-2 pr-2">
                        <PersonLink userId={c.userId} role="clinician" firstName={c.firstName} lastName={c.lastName} />
                      </td>
                      <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                      <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.activeCaseload}</td>
                      <td className="py-2 text-right text-gray-500 text-xs">{daysAgo(c.lastActiveDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Drawer: Active Centres ────────────────────────────────────────────────────

function ActiveCentresDrawer({
  open, onClose, yesterday, drill,
}: {
  open: boolean;
  onClose: () => void;
  yesterday: DailyMetrics | undefined;
  drill: YesterdayDrillDown | undefined;
}) {
  const topCentres = drill?.topCentres ?? [];
  const activeCentres = yesterday?.activeCentres ?? 0;

  return (
    <Drawer title={`Active centres yesterday — ${activeCentres} centres`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        {topCentres.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-8">No centre activity data for yesterday.</p>
        ) : (
          <>
            <p className="text-[12px] text-gray-500 mb-3">Top centres by total actions yesterday</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                  <th className="pb-2 text-left font-medium">Centre</th>
                  <th className="pb-2 text-right font-medium">Cases</th>
                  <th className="pb-2 text-right font-medium">Scored</th>
                  <th className="pb-2 text-right font-medium">Approved</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topCentres.map((c) => (
                  <tr key={c.centreId} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-2 font-medium text-gray-800">{shortCentreName(c.centreName)}</td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{c.casesRegistered}</td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{c.assessmentsScored}</td>
                    <td className="py-2 text-right tabular-nums text-gray-700">{c.reportsApproved}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-900">{c.totalActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Drawer>
  );
}

// ── Drawer: Generic metric ────────────────────────────────────────────────────

function MetricDrawer({
  metricKey, open, onClose, yesterday, drill,
}: {
  metricKey: MetricKey;
  open: boolean;
  onClose: () => void;
  yesterday: DailyMetrics | undefined;
  drill: YesterdayDrillDown | undefined;
}) {
  const val = yesterday ? (yesterday as unknown as Record<string, number>)[metricKey] ?? 0 : 0;

  // Reports drafted with empty state showing who should have drafted
  if (metricKey === 'reportsDrafted' && val === 0) {
    const topClinicians = drill?.topClinicians ?? [];
    const withScoredNotDrafted = topClinicians.filter((c) => c.assessmentsScored > 0 && c.reportsDrafted === 0);
    return (
      <Drawer title="Reports drafted yesterday" open={open} onClose={onClose}>
        <div className="px-5 py-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-[13px] text-amber-800 font-medium">No reports drafted yesterday</p>
            {withScoredNotDrafted.length > 0 && (
              <p className="text-[12px] text-amber-700 mt-1">
                {withScoredNotDrafted.length} clinician{withScoredNotDrafted.length !== 1 ? 's' : ''} with scored assessments have not yet drafted reports.
              </p>
            )}
          </div>
          {withScoredNotDrafted.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                  <th className="pb-2 text-left font-medium">Clinician</th>
                  <th className="pb-2 text-left font-medium">Centre</th>
                  <th className="pb-2 text-right font-medium">Assessments scored</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {withScoredNotDrafted.map((c) => (
                  <tr key={c.userId} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-2">
                      <PersonLink userId={c.userId} role="clinician" firstName={c.firstName} lastName={c.lastName} />
                    </td>
                    <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.assessmentsScored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Drawer>
    );
  }

  // Reports approved with empty state
  if (metricKey === 'reportsApproved' && val === 0) {
    return (
      <Drawer title="Reports approved yesterday" open={open} onClose={onClose}>
        <div className="px-5 py-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-[13px] text-amber-800 font-medium">No reports were approved yesterday</p>
            <p className="text-[12px] text-amber-700 mt-1">
              Managers may have pending approvals in their queue. Check the pipeline for drafted reports awaiting approval.
            </p>
          </div>
        </div>
      </Drawer>
    );
  }

  // Assessments scored — show top clinicians
  if (metricKey === 'assessmentsScored') {
    const clinicians = drill?.topClinicians ?? [];
    return (
      <Drawer title={`Assessments scored yesterday — ${val}`} open={open} onClose={onClose}>
        <div className="px-5 py-4">
          {clinicians.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-8">No data available.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                  <th className="pb-2 text-left font-medium">Clinician</th>
                  <th className="pb-2 text-left font-medium">Centre</th>
                  <th className="pb-2 text-right font-medium">Scored</th>
                  <th className="pb-2 text-right font-medium">Drafted</th>
                  <th className="pb-2 text-right font-medium">Goals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clinicians.filter((c) => c.assessmentsScored > 0).map((c) => (
                  <tr key={c.userId} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-2">
                      <PersonLink userId={c.userId} role="clinician" firstName={c.firstName} lastName={c.lastName} />
                    </td>
                    <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.assessmentsScored}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{c.reportsDrafted}</td>
                    <td className="py-2 text-right tabular-nums text-gray-600">{c.goalsAdded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Drawer>
    );
  }

  // Cases registered — show top centres
  if (metricKey === 'casesRegistered') {
    const centres = drill?.topCentres ?? [];
    return (
      <Drawer title={`Cases registered yesterday — ${val}`} open={open} onClose={onClose}>
        <div className="px-5 py-4">
          {centres.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-8">No cases registered yesterday.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                  <th className="pb-2 text-left font-medium">Centre</th>
                  <th className="pb-2 text-right font-medium">Cases registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {centres.filter((c) => c.casesRegistered > 0).map((c) => (
                  <tr key={c.centreId} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-2 font-medium text-gray-800">{shortCentreName(c.centreName)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.casesRegistered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Drawer>
    );
  }

  // Goals added — show top clinicians
  if (metricKey === 'goalsAdded') {
    const clinicians = (drill?.topClinicians ?? []).filter((c) => c.goalsAdded > 0);
    return (
      <Drawer title={`Goals added yesterday — ${val}`} open={open} onClose={onClose}>
        <div className="px-5 py-4">
          {clinicians.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-8">
              {val === 0 ? 'No goals were added yesterday.' : 'No clinician breakdown available.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-400">
                  <th className="pb-2 text-left font-medium">Clinician</th>
                  <th className="pb-2 text-left font-medium">Centre</th>
                  <th className="pb-2 text-right font-medium">Goals added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clinicians.map((c) => (
                  <tr key={c.userId} className="hover:bg-gray-50/60">
                    <td className="py-2 pr-2">
                      <PersonLink userId={c.userId} role="clinician" firstName={c.firstName} lastName={c.lastName} />
                    </td>
                    <td className="py-2 pr-2 text-gray-500 text-xs">{shortCentreName(c.centreName)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-gray-800">{c.goalsAdded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Drawer>
    );
  }

  // Default fallback
  return (
    <Drawer title={`${METRIC_LABELS[metricKey]} — ${val}`} open={open} onClose={onClose}>
      <div className="px-5 py-4">
        <p className="text-[13px] text-gray-500">Detail view for this metric is coming soon.</p>
      </div>
    </Drawer>
  );
}

// ── Main: YesterdayOutput ─────────────────────────────────────────────────────

interface YesterdayOutputProps {
  yesterday: DailyMetrics | undefined;
  sparklines: WeeklySparklines | undefined;
  averages: WeeklyAverages | undefined;
  drill: YesterdayDrillDown | undefined;
  loading: boolean;
  onGoLive?: (date: string) => void;
}

const METRIC_KEYS: MetricKey[] = [
  'casesRegistered', 'assessmentsScored', 'reportsDrafted',
  'reportsApproved', 'goalsAdded', 'activeUsers',
];

export default function YesterdayOutput({
  yesterday, sparklines, averages, drill, loading, onGoLive,
}: YesterdayOutputProps) {
  const [openDrawer, setOpenDrawer] = useState<MetricKey | 'activeUsers' | 'activeCentres' | null>(null);
  const [calloutDismissed, setCalloutDismissed] = useState(false);
  const closeDrawer = useCallback(() => setOpenDrawer(null), []);

  const label   = yesterday ? fmtDayName(yesterday.date) : '—';
  const dateStr = yesterday ? fmtDateShort(yesterday.date) : '';

  // Day-before values from sparklines index 5 (6th of 7 days = day[-2])
  const dayBefore: Partial<Record<MetricKey, number>> = sparklines ? {
    casesRegistered:   sparklines.casesRegistered[5]   ?? 0,
    assessmentsScored: sparklines.assessmentsScored[5] ?? 0,
    reportsApproved:   sparklines.reportsApproved[5]   ?? 0,
    activeUsers:       sparklines.activeUsers[5]        ?? 0,
  } : {};

  // Metrics below 50% of avg or zero
  const belowNormalMetrics: MetricKey[] = [];
  if (yesterday && averages) {
    for (const key of METRIC_KEYS) {
      if (key === 'activeUsers') continue; // don't include in callout
      const val = (yesterday as unknown as Record<string, number>)[key] ?? 0;
      const avg = averages[AVG_KEY[key]] as number;
      if (avg > 0 && val / avg < 0.5) belowNormalMetrics.push(key);
      else if (avg === 0 && val === 0) {/* no callout for always-zero */}
    }
  }

  // Loading skeleton
  if (loading || (!yesterday && !averages)) {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="h-4 w-36 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-52 bg-gray-100 rounded mt-1.5 animate-pulse" />
          </div>
          <div className="h-3 w-28 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3 sm:p-4 animate-pulse space-y-2">
              <div className="h-2.5 w-16 bg-gray-200 rounded" />
              <div className="h-6 w-10 bg-gray-200 rounded" />
              <div className="h-2 w-20 bg-gray-200 rounded" />
              <div className="h-2 w-14 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[15px] font-medium text-gray-900">Yesterday&apos;s output</h2>
          {yesterday && (
            <p className="text-[12px] text-gray-500 mt-0.5">{label}, {dateStr} — what got done</p>
          )}
        </div>
        {onGoLive && yesterday && (
          <button
            type="button"
            onClick={() => onGoLive(yesterday.date)}
            className="text-[12px] text-blue-600 hover:underline focus:outline-none whitespace-nowrap"
          >
            View full day in Live tab →
          </button>
        )}
      </div>

      {/* Six metric cards */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {METRIC_KEYS.map((key) => {
          const val     = yesterday ? ((yesterday as unknown as Record<string, number>)[key] ?? 0) : null;
          const avg     = averages ? (averages[AVG_KEY[key]] as number) : 0;
          const prevVal = dayBefore[key];
          const sparkKey = SPARK_KEY[key];
          const sparkData: number[] = sparklines && sparkKey
            ? (sparklines[sparkKey] as number[])
            : [];

          const vColour = val !== null ? valueColour(val, avg) : 'text-gray-400';
          const accent  = ACCENT[key];

          // Change line vs day before
          let changeLine: React.ReactNode = null;
          if (val !== null && prevVal !== undefined && SPARK_KEY[key]) {
            const diff = val - prevVal;
            if (val === 0) {
              changeLine = (
                <p className="text-[11px] font-medium text-rose-600">⚠ Nothing yesterday</p>
              );
            } else if (diff === 0) {
              changeLine = <p className="text-[11px] text-gray-400">— no change</p>;
            } else {
              const sign = diff > 0 ? '+' : '';
              changeLine = (
                <p className={`text-[11px] font-medium ${diff > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {sign}{diff} vs day before
                </p>
              );
            }
          }

          return (
            <button
              key={key}
              type="button"
              onClick={() => setOpenDrawer(key)}
              className="bg-gray-50 rounded-lg p-3 sm:p-4 flex flex-col gap-1.5 text-left hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 cursor-pointer"
              aria-label={`${METRIC_LABELS[key]}: ${val ?? '—'}. Click to drill down.`}
            >
              <p className="text-[11px] uppercase tracking-[0.05em] text-gray-400 font-medium">
                {METRIC_LABELS[key]}
              </p>
              <p className={`text-[24px] font-bold leading-none tabular-nums ${vColour}`}>
                {val !== null ? val.toLocaleString() : '—'}
              </p>
              {changeLine}
              {/* vs avg line */}
              {avg > 0 && (
                <p className="text-[11px] text-gray-400">
                  avg {avg % 1 === 0 ? avg : avg.toFixed(1)}/day this period
                </p>
              )}
              {/* Sparkline with reference line */}
              <div className="hidden sm:block mt-1">
                {sparkData.length > 0 && (
                  <RichSparkline data={sparkData} avg={avg} hexColour={accent.hex} />
                )}
              </div>
              {key === 'activeUsers' && yesterday && yesterday.activeCentres > 0 && (
                <p className="text-[10px] text-gray-400">
                  across{' '}
                  <span
                    role="button"
                    tabIndex={0}
                    className="text-blue-600 hover:underline cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setOpenDrawer('activeCentres'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setOpenDrawer('activeCentres'); } }}
                  >
                    {yesterday.activeCentres} centres
                  </span>
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Zero metric callout */}
      {!calloutDismissed && belowNormalMetrics.length > 0 && (
        <div
          className="mt-3 flex items-start gap-3 rounded-lg px-3.5 py-2.5"
          style={{ background: 'rgba(250,238,218,0.4)', borderLeft: '3px solid #BA7517' }}
          role="alert"
        >
          <p className="text-[12px] text-amber-800 flex-1">
            <span className="font-semibold">⚠ {belowNormalMetrics.length} metric{belowNormalMetrics.length !== 1 ? 's' : ''} were below normal yesterday: </span>
            {belowNormalMetrics.map((k, i) => (
              <span key={k}>
                {i > 0 && ', '}
                <button
                  type="button"
                  onClick={() => setOpenDrawer(k)}
                  className="underline text-amber-700 hover:text-amber-900 focus:outline-none"
                >
                  {METRIC_LABELS[k]}
                </button>
              </span>
            ))}
            <span className="text-amber-600"> — tap any to investigate</span>
          </p>
          <button
            type="button"
            onClick={() => setCalloutDismissed(true)}
            className="text-amber-500 hover:text-amber-700 flex-shrink-0 mt-0.5 focus:outline-none"
            aria-label="Dismiss callout"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Bottom line */}
      {yesterday && (
        <p className="mt-3 text-[12px] text-gray-500">
          <button
            type="button"
            onClick={() => setOpenDrawer('activeUsers')}
            className="text-blue-600 hover:underline focus:outline-none"
          >
            {yesterday.activeUsers} staff
          </button>
          {' '}active yesterday across{' '}
          <button
            type="button"
            onClick={() => setOpenDrawer('activeCentres')}
            className="text-blue-600 hover:underline focus:outline-none"
          >
            {yesterday.activeCentres} centres
          </button>
          {yesterday.date && (
            <>
              {' · '}
              <span className="text-gray-400">{fmtDateFull(yesterday.date)}</span>
            </>
          )}
        </p>
      )}

      {/* Drawers */}
      {METRIC_KEYS.map((key) => (
        <MetricDrawer
          key={key}
          metricKey={key}
          open={openDrawer === key}
          onClose={closeDrawer}
          yesterday={yesterday}
          drill={drill}
        />
      ))}

      <ActiveUsersDrawer
        open={openDrawer === 'activeUsers'}
        onClose={closeDrawer}
        yesterday={yesterday}
        drill={drill}
      />

      <ActiveCentresDrawer
        open={openDrawer === 'activeCentres'}
        onClose={closeDrawer}
        yesterday={yesterday}
        drill={drill}
      />
    </div>
  );
}
