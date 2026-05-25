'use client';

import { useMemo } from 'react';
import type { BottleneckData, BottleneckCentreBreakdown, Clinician, CentreBreakdown } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import {
  ACTION_SIGNAL_NAV,
  type ActionNavigationTarget,
  type ActionSignalId,
} from '@/lib/actionNavigation';

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'critical' | 'high' | 'medium' | 'info';

interface Signal {
  id: string;
  severity: Severity;
  owner?: 'Manager' | 'Clinician' | null;
  label: string;
  count: number;
  hint: string;
  examples?: string[];
  examplesTotal?: number;
  /** Full list — rendered in a scrollable panel (idle centres) */
  allNames?: string[];
  cta?: string;
  navigation?: ActionNavigationTarget;
}

const SEV: Record<Severity, {
  bar: string;
  bg: string;
  hover: string;
  num: string;
  btn: string;
  btnHover: string;
}> = {
  critical: {
    bar: 'bg-rose-500',
    bg: 'bg-rose-50/60',
    hover: 'hover:bg-rose-50',
    num: 'text-rose-600',
    btn: 'bg-rose-600',
    btnHover: 'hover:bg-rose-700',
  },
  high: {
    bar: 'bg-amber-500',
    bg: 'bg-amber-50/50',
    hover: 'hover:bg-amber-50/80',
    num: 'text-amber-600',
    btn: 'bg-amber-600',
    btnHover: 'hover:bg-amber-700',
  },
  medium: {
    bar: 'bg-sky-500',
    bg: 'bg-sky-50/50',
    hover: 'hover:bg-sky-50/80',
    num: 'text-sky-600',
    btn: 'bg-sky-600',
    btnHover: 'hover:bg-sky-700',
  },
  info: {
    bar: 'bg-slate-400',
    bg: 'bg-slate-50/80',
    hover: '',
    num: 'text-slate-600',
    btn: 'bg-slate-600',
    btnHover: 'hover:bg-slate-700',
  },
};

// ── Data helpers ──────────────────────────────────────────────────────────────

function idleClinicians(clinicians: Clinician[]) {
  const today = new Date().toISOString().slice(0, 10);
  return clinicians
    .filter((c) => c.activeCaseload > 0 && (
      !c.lastActivityDate || c.lastActivityDate.slice(0, 10) < today
    ))
    .sort((a, b) => b.activeCaseload - a.activeCaseload);
}

function topCentres(
  byCentre: BottleneckCentreBreakdown[],
  key: keyof Pick<BottleneckCentreBreakdown, 'stuckOnboarding' | 'pendingGoals' | 'incompleteAssessments'>,
  limit = 3,
) {
  return byCentre
    .filter((c) => c[key] > 0)
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit)
    .map((c) => shortCentreName(c.centreName));
}

function idleCentres(byCentre: CentreBreakdown[]) {
  return byCentre
    .filter((c) => c.cases + c.assessments + c.results === 0)
    .map((c) => shortCentreName(c.centreName))
    .sort((a, b) => a.localeCompare(b));
}

function navFor(id: ActionSignalId): { cta: string; navigation: ActionNavigationTarget } {
  const config = ACTION_SIGNAL_NAV[id];
  return {
    cta: config.cta,
    navigation: {
      tab: config.tab,
      focusId: config.focusId,
      bottleneckDrillDown: config.bottleneckDrillDown,
      roleDrillDown: config.roleDrillDown,
      bottleneckSort: config.bottleneckSort,
    },
  };
}

function formatExamples(names: string[], total?: number): string | null {
  if (names.length === 0) return null;
  const n = total ?? names.length;
  if (n <= names.length) return names.join(', ');
  if (names.length === 1) return `${names[0]} and ${n - 1} other${n - 1 !== 1 ? 's' : ''}`;
  if (names.length === 2) return `${names[0]}, ${names[1]} and ${n - 2} other${n - 2 !== 1 ? 's' : ''}`;
  return `${names.slice(0, 3).join(', ')} and ${n - 3} other${n - 3 !== 1 ? 's' : ''}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OwnerBadge({ owner }: { owner: 'Manager' | 'Clinician' }) {
  const cls =
    owner === 'Manager'
      ? 'bg-violet-500/15 text-violet-700 ring-violet-200'
      : 'bg-blue-500/15 text-blue-700 ring-blue-200';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ring-1 ${cls}`}>
      {owner}
    </span>
  );
}

function NameList({ names }: { names: string[] }) {
  return (
    <div
      className="mt-2 max-h-32 overflow-y-auto scrollbar-thin rounded-md bg-gray-50 ring-1 ring-gray-200/80 px-2.5 py-2"
      tabIndex={0}
      aria-label={`List of ${names.length} inactive centres`}
    >
      <ul className="space-y-1">
        {names.map((name) => (
          <li key={name} className="text-sm text-gray-700 truncate leading-snug" title={name}>
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SignalCard({
  signal,
  onNavigate,
}: {
  signal: Signal;
  onNavigate: (target: ActionNavigationTarget) => void;
}) {
  const s = SEV[signal.severity];
  const interactive = !!signal.navigation;
  const examples = signal.examples?.length
    ? formatExamples(signal.examples, signal.examplesTotal)
    : null;

  const body = (
    <div className="flex flex-col gap-2 h-full">
      <div className="flex items-start gap-3">
        <p className={`text-3xl sm:text-4xl font-bold tabular-nums tracking-tight leading-none ${s.num}`}>
          {signal.count.toLocaleString()}
        </p>
        <div className="min-w-0 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-gray-900 leading-snug">{signal.label}</p>
            {signal.owner && <OwnerBadge owner={signal.owner} />}
          </div>
          <p className="text-sm text-gray-600 mt-0.5 leading-snug">{signal.hint}</p>
        </div>
      </div>
      {signal.allNames && signal.allNames.length > 0 && (
        <NameList names={signal.allNames} />
      )}
      {!signal.allNames && examples && (
        <p className="text-sm text-gray-500 leading-relaxed mt-1">
          <span className="text-gray-400">Includes </span>
          {examples}
        </p>
      )}
      {interactive && signal.cta && (
        <span
          className={`mt-1 self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${s.btn} ${s.btnHover}`}
        >
          {signal.cta}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </span>
      )}
    </div>
  );

  const shell = 'relative bg-white px-4 py-3.5 sm:px-5 sm:py-4';

  if (!interactive) {
    return (
      <li className={`relative ${shell}`}>
        <div className={`absolute top-0 left-0 right-0 h-1 ${s.bar}`} />
        {body}
      </li>
    );
  }

  return (
    <li className={`relative ${shell}`}>
      <button
        type="button"
        onClick={() => onNavigate(signal.navigation!)}
        className={`group relative w-full h-full text-left -mx-4 -my-3.5 sm:-mx-5 sm:-my-4 px-4 py-3.5 sm:px-5 sm:py-4 ${s.bg} ${s.hover} transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-inset`}
      >
        <div className={`absolute top-0 left-0 right-0 h-1 ${s.bar}`} />
        {body}
      </button>
    </li>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-200">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="bg-white px-5 py-4 animate-pulse">
          <div className="flex gap-3">
            <div className="h-9 w-12 bg-gray-100 rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-44 bg-gray-100 rounded" />
              <div className="h-3.5 w-full max-w-xs bg-gray-50 rounded" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  bottlenecks: BottleneckData | null;
  clinicians: Clinician[];
  overviewCentres: CentreBreakdown[];
  overdueCount?: number;
  loading: boolean;
  onNavigate: (target: ActionNavigationTarget) => void;
}

export default function ActionFeed({ bottlenecks, clinicians, overviewCentres, overdueCount = 0, loading, onNavigate }: Props) {
  const signals = useMemo<Signal[]>(() => {
    if (!bottlenecks) return [];

    const out: Signal[] = [];

    const stuckTotal = bottlenecks.casesStuckInOnboarding;
    if (stuckTotal > 0) {
      out.push({
        id: 'stuck-onboarding',
        severity: 'critical',
        owner: 'Manager',
        label: 'Stuck in onboarding',
        count: stuckTotal,
        hint: '48h+ registered, still unassigned',
        examples: topCentres(bottlenecks.byCentre, 'stuckOnboarding'),
        ...navFor('stuck-onboarding'),
      });
    }

    const pendingGoals = bottlenecks.pendingGoalApprovals;
    if (pendingGoals > 0) {
      const turnaround = bottlenecks.avgGoalApprovalHours;
      out.push({
        id: 'pending-goals',
        severity: 'high',
        owner: 'Manager',
        label: 'Goals awaiting approval',
        count: pendingGoals,
        hint: turnaround != null
          ? `Avg ${turnaround.toFixed(1)}h on managers`
          : 'Waiting on manager review',
        examples: topCentres(bottlenecks.byCentre, 'pendingGoals'),
        ...navFor('pending-goals'),
      });
    }

    const idleClin = idleClinicians(clinicians);
    if (idleClin.length > 0) {
      out.push({
        id: 'idle-clinicians',
        severity: 'high',
        owner: 'Clinician',
        label: 'Idle clinicians',
        count: idleClin.length,
        hint: 'Open cases, no activity 14+ days',
        examples: idleClin.slice(0, 3).map((c) => `${c.firstName} ${c.lastName.split(' ')[0]}`),
        examplesTotal: idleClin.length,
        ...navFor('idle-clinicians'),
      });
    }

    const pendingAss = bottlenecks.pendingAssessments;
    if (pendingAss > 0) {
      out.push({
        id: 'incomplete-assessments',
        severity: 'medium',
        owner: 'Clinician',
        label: 'Incomplete assessments',
        count: pendingAss,
        hint: 'Assigned, no result yet',
        examples: topCentres(bottlenecks.byCentre, 'incompleteAssessments'),
        ...navFor('incomplete-assessments'),
      });
    }

    if (overdueCount > 0) {
      out.push({
        id: 'overdue-assessments',
        severity: 'critical',
        owner: 'Manager',
        label: 'Overdue assessments',
        count: overdueCount,
        hint: '14+ days, no result',
        ...navFor('overdue-assessments'),
      });
    }

    const idle = idleCentres(overviewCentres);
    if (idle.length > 0) {
      out.push({
        id: 'idle-centres',
        severity: 'info',
        label: 'Centres with no activity',
        count: idle.length,
        hint: 'No cases, assessments, or results this period',
        allNames: idle,
      });
    }

    return out;
  }, [bottlenecks, clinicians, overviewCentres, overdueCount]);

  const allClear = !loading && signals.length === 0 && bottlenecks != null;
  const hasData = signals.length > 0;
  const urgentCount = signals.filter((s) => s.severity === 'critical' || s.severity === 'high').length;
  const openItems = signals
    .filter((s) => s.severity !== 'info')
    .reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 shadow-[0_2px_12px_rgba(15,23,42,0.07)]">
      {/* Header */}
      <div className="px-5 py-3.5 bg-slate-900 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">Needs Action</h2>
          {hasData && (
            <p className="text-sm text-slate-400 mt-0.5">
              {urgentCount > 0 && (
                <span className="text-rose-300 font-medium">{urgentCount} urgent · </span>
              )}
              {signals.length} signal{signals.length !== 1 ? 's' : ''} — tap to investigate
            </p>
          )}
          {allClear && (
            <p className="text-sm text-emerald-400/90 mt-0.5">Nothing blocked this period</p>
          )}
        </div>
        {hasData && openItems > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-bold tabular-nums text-white tracking-tight leading-none">
              {openItems.toLocaleString()}
            </span>
            <span className="text-sm text-slate-400">open items</span>
          </div>
        )}
      </div>

      {loading && <SkeletonGrid />}

      {!loading && allClear && (
        <p className="bg-white px-5 py-4 text-base text-gray-500">No blockers in this period.</p>
      )}

      {!loading && hasData && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-200">
          {signals.map((s) => (
            <SignalCard key={s.id} signal={s} onNavigate={onNavigate} />
          ))}
        </ul>
      )}

      {!loading && !allClear && !hasData && bottlenecks == null && (
        <p className="bg-white px-5 py-4 text-base text-gray-500">Waiting for data…</p>
      )}
    </div>
  );
}
