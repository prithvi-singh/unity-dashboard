'use client';

import { useState, useMemo, useEffect } from 'react';
import type {
  OverviewData,
  NeedsActionCounts,
  BottleneckData,
  Clinician,
  UpcomingBottleneckItem,
  PipelineStageData,
  PipelineStagePendingCase,
} from '@/lib/types';
import type { ActionNavigationTarget } from '@/lib/actionNavigation';
import { ACTION_SIGNAL_NAV } from '@/lib/actionNavigation';
import { shortCentreName } from '@/lib/centreNames';
import PersonLink from '@/components/PersonLink';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { KpiTooltip } from '@/components/shared/KpiTooltip';
import { KPI } from '@/lib/kpiDefinitions';
import PeriodSummary from '@/components/overview/PeriodSummary';

// ── Helpers ───────────────────────────────────────────────────────────────────

function navFor(id: keyof typeof ACTION_SIGNAL_NAV): ActionNavigationTarget {
  const c = ACTION_SIGNAL_NAV[id];
  return { tab: c.tab, focusId: c.focusId, bottleneckDrillDown: c.bottleneckDrillDown, roleDrillDown: c.roleDrillDown, bottleneckSort: c.bottleneckSort };
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Role badges ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: 'Centre Admin (Ops)' | 'Clinician' | 'Manager' }) {
  const cls =
    role === 'Manager'           ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-200' :
    role === 'Clinician'         ? 'bg-blue-500/15 text-blue-700 ring-1 ring-blue-200' :
                                   'bg-teal-500/15 text-teal-700 ring-1 ring-teal-200';
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {role}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-medium text-gray-900">{title}</h2>
      {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — NEEDS ACTION (HERO)
// ═══════════════════════════════════════════════════════════════════════════════

interface NeedsActionProps {
  needsAction: NeedsActionCounts | null | undefined;
  loading: boolean;
  onNavigate: (target: ActionNavigationTarget) => void;
  asOf: Date | null;
}

interface PipelineCard {
  id: 'stuck-in-scoring' | 'reports-overdue' | 'approvals-needed' | 'goals-not-added';
  label: string;
  description: string;
  role: 'Clinician' | 'Manager';
  count: number;
  countColour: string;
  cta: string;
}

function NeedsAction({ needsAction, loading, onNavigate, asOf }: NeedsActionProps) {
  const cards: PipelineCard[] = useMemo(() => {
    const na = needsAction ?? { stuckInScoring: 0, reportsOverdue: 0, approvalsNeeded: 0, goalsNotAdded: 0, total: 0 };
    return [
      {
        id: 'stuck-in-scoring',
        label: 'Stuck in scoring',
        description: 'Not progressing through assessment · 14+ days',
        role: 'Clinician',
        count: na.stuckInScoring,
        countColour: na.stuckInScoring > 0 ? 'text-rose-600' : 'text-gray-400',
        cta: 'Show stuck cases',
      },
      {
        id: 'reports-overdue',
        label: 'Reports overdue',
        description: 'Scored but report not drafted · 7+ days',
        role: 'Clinician',
        count: na.reportsOverdue,
        countColour: na.reportsOverdue > 0 ? 'text-amber-600' : 'text-gray-400',
        cta: 'Show overdue reports',
      },
      {
        id: 'approvals-needed',
        label: 'Approvals needed',
        description: 'Manager action required · 5+ days pending',
        role: 'Manager',
        count: na.approvalsNeeded,
        countColour: na.approvalsNeeded > 0 ? 'text-emerald-600' : 'text-gray-400',
        cta: 'Show pending approvals',
      },
      {
        id: 'goals-not-added',
        label: 'Goals not added',
        description: 'Report approved, goals pending · 7+ days',
        role: 'Clinician',
        count: na.goalsNotAdded,
        countColour: na.goalsNotAdded > 0 ? 'text-amber-600' : 'text-gray-400',
        cta: 'Show goals pending',
      },
    ];
  }, [needsAction]);

  const totalOpen = cards.reduce((s, c) => s + c.count, 0);
  const urgentCount = (needsAction?.stuckInScoring ?? 0) + (needsAction?.approvalsNeeded ?? 0);
  const allClear = !loading && needsAction != null && totalOpen === 0;

  // Loading skeleton
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between animate-pulse">
          <div className="h-4 w-32 bg-gray-100 rounded" />
          <div className="h-5 w-16 bg-gray-100 rounded-full" />
        </div>
        <div className="divide-y divide-gray-50">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-5 py-3.5 flex items-center gap-4 animate-pulse">
              <div className="h-6 w-8 bg-gray-100 rounded flex-shrink-0" />
              <div className="flex-1 h-3.5 bg-gray-100 rounded" />
              <div className="h-5 w-20 bg-gray-100 rounded-full flex-shrink-0" />
              <div className="h-4 w-14 bg-gray-100 rounded flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // All clear state
  if (allClear) {
    return (
      <div className="bg-white rounded-xl border border-emerald-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="px-5 py-3.5 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          <div>
            <span className="text-[14px] font-medium text-gray-900">All clear</span>
            <span className="text-[13px] text-gray-400 ml-2">No urgent pipeline issues right now</span>
          </div>
          {asOf && <span className="ml-auto text-[11px] text-gray-400">as of {fmtTime(asOf)}</span>}
        </div>
      </div>
    );
  }

  const activeCount = cards.filter((c) => c.count > 0).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
      {/* Header bar */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
        <h2 className="text-[14px] font-medium text-gray-900">Needs action</h2>
        <span className="text-[12px] text-gray-400">
          {urgentCount > 0 && <span className="text-rose-600 font-medium">{urgentCount} urgent · </span>}
          {activeCount} signal{activeCount !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[22px] font-bold tabular-nums text-gray-900 leading-none">{totalOpen}</span>
          <span className="text-[11px] text-gray-400">open items</span>
          {asOf && <span className="text-[11px] text-gray-300 hidden sm:inline">· {fmtTime(asOf)}</span>}
        </div>
      </div>

      {/* Signal rows */}
      <div className="divide-y divide-gray-50">
        {cards.map((card) => {
          const hasIssue = card.count > 0;
          return (
            <div
              key={card.id}
              className={`flex items-center gap-3 px-5 py-3 ${hasIssue ? '' : 'opacity-40'}`}
            >
              {/* Count */}
              <p className={`text-[22px] font-bold tabular-nums leading-none w-10 text-right flex-shrink-0 ${card.countColour}`}>
                {card.count}
              </p>

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-800 leading-snug">{card.label}</p>
                <p className="text-[11px] text-gray-400 truncate">{card.description}</p>
              </div>

              {/* Role badge */}
              <RoleBadge role={card.role} />

              {/* Action link */}
              {hasIssue && (
                <button
                  type="button"
                  onClick={() => onNavigate(navFor(card.id))}
                  className="flex-shrink-0 text-[12px] font-medium text-blue-600 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  {card.cta} →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — UPCOMING BOTTLENECKS
// ═══════════════════════════════════════════════════════════════════════════════

interface UpcomingBottlenecksProps {
  items: UpcomingBottleneckItem[];
  loading: boolean;
}

function UpcomingBottlenecksSection({ items, loading }: UpcomingBottlenecksProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 5);

  if (loading || items.length === 0) return null;

  function urgencyColour(days: number) {
    return days <= 2 ? 'text-rose-600 font-bold' : 'text-amber-600 font-semibold';
  }

  return (
    <div className="bg-white rounded-xl border-l-4 border-amber-400 border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-[15px] font-medium text-gray-900">Upcoming issues — act now to prevent escalation</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">Assessments approaching overdue threshold</p>
        <p className="text-[13px] text-amber-700 bg-amber-50 rounded-md px-3 py-2 mt-3">
          {items.length} assessment{items.length !== 1 ? 's' : ''} assigned 10–13 days ago with no result.
          These become overdue in the next 1–4 days.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100">
              {['Patient', 'Assessment', 'Clinician', 'Centre', 'Days assigned', 'Days until overdue'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] uppercase tracking-[0.04em] text-gray-400 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((item, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-3 text-gray-700 font-medium max-w-[140px] truncate" title={item.patientName ?? ''}>
                  {item.patientName || '—'}
                  {item.patientDisplayId && (
                    <span className="ml-1 text-[11px] text-gray-400">#{item.patientDisplayId}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{item.assessmentType}</td>
                <td className="px-4 py-3 text-gray-600">
                  {item.clinicianId > 0 && item.clinicianName ? (
                    <PersonLink
                      userId={item.clinicianId}
                      role="clinician"
                      firstName={item.clinicianName.split(' ')[0] ?? ''}
                      lastName={item.clinicianName.split(' ').slice(1).join(' ')}
                    />
                  ) : (item.clinicianName || '—')}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-[120px] truncate" title={item.centreName ?? ''}>
                  {item.centreName ? shortCentreName(item.centreName) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 tabular-nums">{item.daysAssigned}</td>
                <td className={`px-4 py-3 tabular-nums ${urgencyColour(item.daysUntilOverdue)}`}>
                  {item.daysUntilOverdue} day{item.daysUntilOverdue !== 1 ? 's' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > 5 && (
        <div className="px-5 py-3 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[12px] text-blue-600 hover:underline focus:outline-none"
          >
            {expanded ? 'Show fewer' : `Show all ${items.length} →`}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — PIPELINE HEALTH (compact rows)
// ═══════════════════════════════════════════════════════════════════════════════

// Stage tooltip definitions
// Goals stages count cases (distinct patients/assessments), not individual goal events.
const STAGE_TOOLTIPS: Record<string, string> = {
  'stage-registered':     'A new child case was created in Unity',
  'stage-history':        'At least one section of the case history form was saved',
  'stage-assigned':       'A clinician was assigned to conduct an assessment for this case',
  'stage-scoring':        'Clinician completed the assessment scoring process',
  'stage-report-drafted': 'Clinician created the assessment report',
  'stage-report-approved':'Manager reviewed and approved the report, generating a PDF',
  'stage-goals-added':    'Number of cases where at least one intervention goal was added in the selected period. Counts cases not individual goals to prevent inflation.',
  'stage-goals-approved': 'Manager reviewed and approved the goals',
};

// Pending / stuck case drawer
interface PipelineCasesDrawerProps {
  stageId: string;
  stageLabel: string;
  type: 'pending' | 'stuck';
  stuckThreshold: number;
  nextLabel?: string;
  dateFrom?: string;
  dateTo?: string;
  centreId?: number | null;
  onClose: () => void;
}

function PipelineCasesDrawer({
  stageId, stageLabel, type, stuckThreshold, nextLabel, dateFrom, dateTo, centreId, onClose,
}: PipelineCasesDrawerProps) {
  const [cases, setCases] = useState<PipelineStagePendingCase[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ stage: stageId, type });
    if (centreId) params.set('centreId', String(centreId));
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);

    fetch(`/api/overview/pipeline-cases?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setCases(d.cases ?? []))
      .catch(() => setErr('Failed to load cases'));
  }, [stageId, type, centreId, dateFrom, dateTo]); // eslint-disable-line

  const isStuck = type === 'stuck';
  const title = isStuck
    ? `Stuck — ${stageLabel}`
    : `Pending — ${stageLabel}`;
  const subtitle = isStuck
    ? `Cases in ${stageLabel} for more than ${stuckThreshold} days`
    : `Cases completed ${stageLabel} but not yet${nextLabel ? ` at ${nextLabel}` : ' progressed'}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className={`px-5 py-4 border-b flex items-start justify-between gap-4 ${isStuck ? 'bg-rose-50 border-rose-100' : 'bg-white border-gray-100'}`}>
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="text-gray-400 hover:text-gray-600 mt-0.5 focus:outline-none flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {err ? (
            <div className="p-6 text-[13px] text-rose-600">{err}</div>
          ) : cases === null ? (
            <div className="p-6 space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded" />
              ))}
            </div>
          ) : cases.length === 0 ? (
            <div className="p-10 text-center text-[13px] text-gray-400">No cases to show</div>
          ) : (
            <table className="w-full text-[13px] min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase tracking-[0.04em] text-gray-400">
                  <th className="px-4 py-2.5 text-left">Patient</th>
                  {cases.some((c) => c.assessmentType) && <th className="px-3 py-2.5 text-left">Assessment</th>}
                  {cases.some((c) => c.responsiblePersonId) && <th className="px-3 py-2.5 text-left">Responsible</th>}
                  <th className="px-3 py-2.5 text-left">Centre</th>
                  <th className="px-3 py-2.5 text-right">Days waiting</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c, i) => (
                  <tr key={i} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${isStuck ? 'bg-rose-50/20' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[140px] truncate" title={c.patientName ?? ''}>
                      {c.patientName || '—'}
                      {c.patientDisplayId && <span className="ml-1 text-[11px] text-gray-400">#{c.patientDisplayId}</span>}
                    </td>
                    {cases.some((x) => x.assessmentType) && (
                      <td className="px-3 py-2.5 text-gray-600">{c.assessmentType || '—'}</td>
                    )}
                    {cases.some((x) => x.responsiblePersonId) && (
                      <td className="px-3 py-2.5 text-gray-600">
                        {c.responsiblePersonId > 0 && c.responsiblePersonName ? (
                          <PersonLink
                            userId={c.responsiblePersonId}
                            role="clinician"
                            firstName={c.responsiblePersonName.split(' ')[0] ?? ''}
                            lastName={c.responsiblePersonName.split(' ').slice(1).join(' ')}
                          />
                        ) : c.responsiblePersonName || '—'}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-gray-500 max-w-[120px] truncate" title={c.centreName ?? ''}>{c.centreName || '—'}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${isStuck ? 'text-rose-600' : 'text-amber-600'}`}>{c.daysWaiting}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {cases && cases.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">
            Showing up to 50 cases · sorted by days waiting
          </div>
        )}
      </div>
    </div>
  );
}

// Main pipeline component
interface PipelineHealthProps {
  stages: PipelineStageData[] | undefined;
  loading: boolean;
  dateFrom?: string;
  dateTo?: string;
  centreId?: number | null;
}

function PipelineHealth({ stages, loading, dateFrom, dateTo, centreId }: PipelineHealthProps) {
  const [drawer, setDrawer] = useState<{ stageIdx: number; type: 'pending' | 'stuck' } | null>(null);

  // ── Colour / badge helpers ───────────────────────────────────────────────

  function countColour(pct: number, isBase: boolean): string {
    if (isBase || pct >= 70) return '#111827';
    if (pct >= 50) return '#BA7517';
    return '#A32D2D';
  }

  function dotColor(stuckCount: number): string {
    if (stuckCount === 0) return '#888780';
    if (stuckCount <= 3) return '#BA7517';
    return '#A32D2D';
  }

  function roleBadge(role: string): { label: string; bg: string; fg: string } {
    const r = role.toLowerCase();
    if (r === 'clinician') return { label: 'Clinician', bg: '#E6F1FB', fg: '#0C447C' };
    if (r === 'manager')   return { label: 'Manager',   bg: '#EAF3DE', fg: '#3B6D11' };
    if (r.includes('clinician')) return { label: 'Clin / Mgr', bg: '#E6F1FB', fg: '#0C447C' };
    return { label: 'Ops / Mgr', bg: '#E1F5EE', fg: '#0F6E56' };
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (loading || !stages) {
    return (
      <div>
        <SectionTitle
          title="Clinical pipeline"
          subtitle="Each step counts cases · pending = not yet progressed · stuck = waiting beyond threshold."
        />
        <div className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
          <div className="hidden md:grid grid-cols-2 gap-x-6">
            {[0, 1].map((col) => (
              <div key={col} className="space-y-1">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <div className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
                    <div className="h-3 w-24 bg-gray-100 rounded" />
                    <div className="h-4 w-12 bg-gray-100 rounded-full ml-1" />
                    <div className="ml-auto h-4 w-8 bg-gray-100 rounded" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="md:hidden space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <div className="w-2 h-2 rounded-full bg-gray-200 flex-shrink-0" />
                <div className="h-3 w-28 bg-gray-100 rounded" />
                <div className="h-4 w-14 bg-gray-100 rounded-full ml-2" />
                <div className="ml-auto h-4 w-8 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const drawerStage = drawer !== null ? stages[drawer.stageIdx] : null;
  const nextStageLabel = drawer !== null && drawer.stageIdx < stages.length - 1
    ? stages[drawer.stageIdx + 1].label
    : undefined;

  const mid         = Math.ceil(stages.length / 2);
  const leftStages  = stages.slice(0, mid);
  const rightStages = stages.slice(mid);

  // ── Single row renderer (used in both columns and mobile) ────────────────

  function renderRow(stage: PipelineStageData, globalIdx: number, isLast: boolean) {
    const isBase  = globalIdx === 0;
    const colour  = countColour(stage.percentOfBase, isBase);
    const badge   = roleBadge(stage.responsibleRole);
    const dot     = dotColor(stage.stuckCount);

    return (
      <div
        key={stage.id}
        className="relative"
        style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--color-border-tertiary, #f3f4f6)' }}
      >
        {/* Connector line bridges this dot to the next row's dot */}
        {!isLast && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: 3, top: 14, bottom: -6,
              borderLeft: '1px dashed var(--color-border-secondary, #e5e7eb)',
              pointerEvents: 'none', zIndex: 0,
            }}
          />
        )}

        <div
          className="relative z-10 flex items-center hover:bg-[#f9fafb] hover:-mx-2 hover:px-2 hover:rounded transition-colors"
          style={{ gap: 8, padding: '6px 0' }}
        >
          {/* 1. Status dot — colour signals stuck severity */}
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />

          {/* 2. Stage label + ⓘ tooltip */}
          <div style={{ width: 130, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: 'var(--color-text-secondary, #6b7280)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {stage.label}
            </span>
            {STAGE_TOOLTIPS[stage.id] && (
              <span
                title={STAGE_TOOLTIPS[stage.id]}
                className="text-[10px] text-gray-300 cursor-default select-none leading-none flex-shrink-0"
                aria-label={STAGE_TOOLTIPS[stage.id]}
              >ⓘ</span>
            )}
          </div>

          {/* 3. Role badge — abbreviated label */}
          <span style={{
            fontSize: 10, padding: '2px 6px', borderRadius: 99,
            background: badge.bg, color: badge.fg,
            flexShrink: 0, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {badge.label}
          </span>

          {/* 4. Spacer */}
          <span style={{ flex: 1 }} />

          {/* 5. Count */}
          <span style={{
            fontSize: 15, fontWeight: 500, color: colour,
            flexShrink: 0, minWidth: 28, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {stage.count.toLocaleString()}
          </span>

          {/* 6. Percentage — hidden below 400 px */}
          <span
            className="pl-pct"
            style={{
              fontSize: 12, color: 'var(--color-text-tertiary, #9ca3af)',
              flexShrink: 0, minWidth: 38, textAlign: 'right',
            }}
          >
            {!isBase ? `(${stage.percentOfBase}%)` : ''}
          </span>

          {/* 7. Pending — "—" when zero, clickable button when > 0 */}
          <span style={{ flexShrink: 0, minWidth: 65, textAlign: 'right' }}>
            {stage.pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => setDrawer({ stageIdx: globalIdx, type: 'pending' })}
                title={`${stage.pendingCount} cases completed ${stage.label} but have not progressed to ${stages[globalIdx + 1]?.label ?? 'the next stage'} yet`}
                className="text-[11px] font-medium text-amber-600 hover:underline focus:outline-none"
              >
                {stage.pendingCount} pending
              </button>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary, #9ca3af)' }}>—</span>
            )}
          </span>

          {/* 8. Stuck — visibility:hidden (not display:none) preserves column width */}
          <span style={{
            flexShrink: 0, minWidth: 50, textAlign: 'right',
            visibility: stage.stuckCount > 0 ? 'visible' : 'hidden',
          }}>
            {stage.stuckCount > 0 ? (
              <button
                type="button"
                onClick={() => setDrawer({ stageIdx: globalIdx, type: 'stuck' })}
                title={`${stage.stuckCount} cases have been at ${stage.label} for more than ${stage.stuckThresholdDays} days`}
                className="text-[11px] font-medium text-rose-600 hover:underline focus:outline-none"
              >
                {stage.stuckCount} stuck
              </button>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 500, color: '#A32D2D' }}>
                {stage.stuckCount} stuck
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      <style>{`@media (max-width: 400px) { .pl-pct { display: none !important; } }`}</style>

      <SectionTitle
        title="Clinical pipeline"
        subtitle="Each step counts cases (one child can have multiple assessments). Goals counted as cases with goals added — not total goal events. Pending = not yet progressed. Stuck = waiting beyond threshold."
      />

      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">

        {/* ── Desktop: two-column grid ≥ 769 px ──────────────────────────── */}
        <div className="hidden md:grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}>

          {/* Left column — stages 1–4 */}
          <div style={{ borderRight: '0.5px solid var(--color-border-tertiary, #f3f4f6)', paddingRight: 16 }}>
            {leftStages.map((stage, i) =>
              renderRow(stage, i, i === leftStages.length - 1)
            )}
          </div>

          {/* Right column — stages 5–8 */}
          <div style={{ paddingLeft: 16 }}>
            {rightStages.map((stage, i) =>
              renderRow(stage, mid + i, i === rightStages.length - 1)
            )}
          </div>

        </div>

        {/* ── Mobile: single column ≤ 768 px ─────────────────────────────── */}
        <div className="md:hidden">
          {stages.map((stage, idx) => {
            // Between-stage note: show when > 5% of the prev stage is still pending
            const showBetween = idx > 0 && stages[idx - 1].pendingCount > 0
              && stages[idx - 1].count > 0
              && (stages[idx - 1].pendingCount / stages[idx - 1].count) > 0.05;
            const prevStage = stages[idx - 1];
            return (
              <div key={stage.id}>
                {showBetween && prevStage && (
                  <div className="flex items-center gap-1 pl-4 pr-4 py-0.5">
                    <span className="text-[11px] text-amber-600">
                      ↳ {prevStage.pendingCount} didn&apos;t progress yet
                      {prevStage.avgDaysInStage != null && ` · avg ${prevStage.avgDaysInStage}d waiting`}
                    </span>
                  </div>
                )}
                {renderRow(stage, idx, idx === stages.length - 1)}
              </div>
            );
          })}
        </div>

      </div>

      {/* Drill-down drawer */}
      {drawer !== null && drawerStage && (
        <PipelineCasesDrawer
          stageId={drawerStage.id}
          stageLabel={drawerStage.label}
          type={drawer.type}
          stuckThreshold={drawerStage.stuckThresholdDays}
          nextLabel={nextStageLabel}
          dateFrom={dateFrom}
          dateTo={dateTo}
          centreId={centreId}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT — OverviewTab
// ═══════════════════════════════════════════════════════════════════════════════

export interface OverviewTabProps {
  overview: OverviewData | null;
  overviewLoading: boolean;
  /** @deprecated kept for backward compatibility — NeedsAction now uses overview.needsAction */
  bottlenecks?: BottleneckData | null;
  /** @deprecated kept for backward compatibility */
  bottlenecksLoading?: boolean;
  /** @deprecated kept for backward compatibility */
  clinicians?: Clinician[];
  /** @deprecated kept for backward compatibility */
  cliniciansLoading?: boolean;
  /** @deprecated kept for backward compatibility */
  overdueCount?: number;
  onNavigate: (target: ActionNavigationTarget) => void;
  onOpenMultipleAssessments: () => void;
  onOpenIdleCentres: () => void;
  dateFrom?: string;
  dateTo?: string;
  asOf: Date | null;
}

export default function OverviewTab({
  overview,
  overviewLoading,
  onNavigate,
  onOpenMultipleAssessments,
  onOpenIdleCentres,
  dateFrom,
  dateTo,
  asOf,
}: OverviewTabProps) {
  const needsActionLoading = overviewLoading;

  // Only show upcoming bottlenecks if data loaded and count > 0
  const upcomingItems = overview?.upcomingBottlenecks?.items ?? [];
  const upcomingLoading = overviewLoading;

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* Section 1: Needs Action — pipeline health signals from overview.needsAction */}
      <NeedsAction
        needsAction={overview?.needsAction}
        loading={needsActionLoading}
        onNavigate={onNavigate}
        asOf={asOf}
      />

      {/* Section 2: Period Summary */}
      <PeriodSummary
        data={overview}
        loading={overviewLoading}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onOpenMultipleAssessments={onOpenMultipleAssessments}
        onOpenIdleCentres={onOpenIdleCentres}
      />

      {/* Section 3: Upcoming Bottlenecks (only if count > 0) */}
      {(upcomingLoading || upcomingItems.length > 0) && (
        <UpcomingBottlenecksSection
          items={upcomingItems}
          loading={upcomingLoading}
        />
      )}

      {/* Section 4: Clinical Pipeline */}
      <PipelineHealth
        stages={overview?.pipelineStages}
        loading={overviewLoading}
        dateFrom={dateFrom}
        dateTo={dateTo}
        centreId={overview ? undefined : undefined}
      />

    </div>
  );
}
