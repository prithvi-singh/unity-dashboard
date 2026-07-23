'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type {
  CentresOverviewData,
  CentreOverviewRow,
  CentreStatus,
  CentreDetailData,
  FilterParams,
  WorkloadCentreRow,
  UserProfileRole,
} from '@/lib/types';
import { fetchCentreDetail } from '@/lib/api';
import ScrollRegion from '@/components/shared/ScrollRegion';
import WorkloadByCentreTable from '@/components/clinicians/WorkloadByCentreTable';
import PersonLink from '@/components/PersonLink';
import { inferProfileRole } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { goalsDisplay } from '@/lib/roleStats';
import RoleBadge from '@/components/shared/RoleBadge';

// ── Colour constants (spec) ────────────────────────────────────────────────────
const STATUS_COLOUR: Record<CentreStatus, { dot: string; badge: string; text: string }> = {
  'on-track':        { dot: '#1D9E75', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',   text: 'On track' },
  'needs-attention': { dot: '#BA7517', badge: 'bg-amber-50  text-amber-700  border-amber-200',       text: 'Needs attention' },
  'blocked':         { dot: '#A32D2D', badge: 'bg-rose-50   text-rose-700   border-rose-200',        text: 'Blocked' },
};

// ── Assessment status display ──────────────────────────────────────────────────
const ASSESSMENT_STATUS_LABEL: Record<string, string> = {
  NotStarted:  'Not Started',
  InProgress:  'In Progress',
  Completed:   'Completed',
  OnHold:      'On Hold',
  not_started: 'Not Started',
  in_progress: 'In Progress',
};
function formatAssessmentStatus(status: string): string {
  return ASSESSMENT_STATUS_LABEL[status] ?? status;
}
function assessmentStatusColour(status: string): string {
  if (status === 'InProgress' || status === 'in_progress') return '#BA7517';
  if (status === 'Completed')                               return '#1D9E75';
  return 'var(--color-text-secondary, #6b7280)';
}

// ── Assessment type badge ──────────────────────────────────────────────────────
const ASSESSMENT_TYPE_STYLE: Record<string, { bg: string; color: string }> = {
  SPM:   { bg: '#E6F1FB', color: '#0C447C' },
  ISAA:  { bg: '#EAF3DE', color: '#3B6D11' },
  REELS: { bg: '#FEF3C7', color: '#92400E' },
  DP3:   { bg: '#F3E8FF', color: '#6B21A8' },
};
function AssessmentTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-gray-300">—</span>;
  const style = ASSESSMENT_TYPE_STYLE[type.toUpperCase()] ?? {
    bg:    'var(--color-background-secondary, #f3f4f6)',
    color: 'var(--color-text-secondary, #6b7280)',
  };
  return (
    <span
      style={{
        background: style.bg,
        color:      style.color,
        fontSize:   11,
        padding:    '2px 8px',
        borderRadius: 99,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display:    'inline-block',
      }}
    >
      {type}
    </span>
  );
}

// ── Days open colour ───────────────────────────────────────────────────────────
function daysOpenStyle(days: number): React.CSSProperties {
  if (days > 14) return { color: '#A32D2D', fontWeight: 700 };
  if (days > 7)  return { color: '#BA7517' };
  return { color: 'var(--color-text-primary, #111827)' };
}

// ── Pipeline owner badge config ────────────────────────────────────────────────
const OWNER_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  'ops-mgr':  { bg: '#E1F5EE', fg: '#0F6E56', label: 'Ops / Mgr' },
  'clin-mgr': { bg: 'var(--color-background-secondary, #f3f4f6)', fg: 'var(--color-text-secondary, #6b7280)', label: 'Clin / Mgr' },
  'clinician':{ bg: '#E6F1FB', fg: '#0C447C', label: 'Clinician' },
  'manager':  { bg: '#EAF3DE', fg: '#3B6D11', label: 'Manager' },
};

function pipelineCountColour(
  value: number,
  tier: 'normal' | 'warn70' | 'warn30',
  pctVal: number | undefined,
): string {
  if (value === 0) return 'var(--color-text-secondary, #6b7280)';
  if (pctVal === undefined) return 'var(--color-text-primary, #111827)';
  if (tier === 'warn70' && pctVal < 70) return '#BA7517';
  if (tier === 'warn30' && pctVal < 30) return '#A32D2D';
  return 'var(--color-text-primary, #111827)';
}

function formatPeriodLabel(dateFrom?: string, dateTo?: string): string {
  if (!dateFrom && !dateTo) return 'all time';
  const mv = (s: string) =>
    new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (dateFrom && dateTo) {
    const f = mv(dateFrom);
    const t = mv(dateTo);
    return f === t ? f : `${f} – ${t}`;
  }
  return dateFrom ? `from ${mv(dateFrom)}` : `to ${mv(dateTo!)}`;
}

function statusOrder(s: CentreStatus) {
  return s === 'blocked' ? 0 : s === 'needs-attention' ? 1 : 2;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function pipelineColour(n: number, warn = 1, crit = 3): string {
  if (n === 0) return 'text-gray-300';
  if (n > crit) return 'text-rose-600 font-bold';
  if (n >= warn) return 'text-amber-600 font-semibold';
  return 'text-gray-700';
}

// ── Summary card ──────────────────────────────────────────────────────────────
interface SummaryCardProps {
  label:   string;
  value:   number | string;
  context: string;
  tooltip: string;
  valueClass?: string;
  onClick?: () => void;
}
function SummaryCard({ label, value, context, tooltip, valueClass = 'text-gray-900', onClick }: SummaryCardProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      title={tooltip}
      onClick={onClick}
      className={[
        'bg-white rounded-xl border border-gray-100 px-6 py-5 flex flex-col gap-2 text-left w-full',
        onClick ? 'cursor-pointer hover:border-gray-200 hover:-translate-y-0.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : '',
      ].join(' ')}
    >
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.05em] leading-tight">{label}</p>
      <p className={`text-[28px] font-medium tabular-nums leading-none ${valueClass}`}>{value}</p>
      <p className="text-[13px] text-gray-400 mt-1 leading-snug">{context}</p>
    </Tag>
  );
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: CentreStatus }) {
  const { dot, text } = STATUS_COLOUR[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="flex-shrink-0 rounded-full"
        style={{ width: 8, height: 8, backgroundColor: dot }}
        aria-hidden="true"
      />
      <span className="text-sm">{text}</span>
    </span>
  );
}

// ── Status filter drawer ──────────────────────────────────────────────────────
interface StatusDrawerProps {
  title:    string;
  centres:  CentreOverviewRow[];
  onClose:  () => void;
  onSelect: (c: CentreOverviewRow) => void;
}
function StatusDrawer({ title, centres, onClose, onSelect }: StatusDrawerProps) {
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-sm bg-white shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
          {centres.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No centres</p>
          ) : (
            centres.map((c) => (
              <button
                key={c.centreId}
                className="w-full text-left px-5 py-3.5 hover:bg-gray-50 transition-colors"
                onClick={() => { onClose(); onSelect(c); }}
              >
                <p className="text-sm font-medium text-gray-900">{c.centreName}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {c.pipeline.scoring} scoring · {c.pipeline.pendingApproval} pending · {c.intake.stuckUnassigned} stuck
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Centre Detail Drawer ──────────────────────────────────────────────────────
interface DetailDrawerProps {
  centre:       CentreOverviewRow;
  filters:      FilterParams;
  onClose:      () => void;
  onDrillDown?: OnRoleDrillDown;
}

// Pipeline snapshot row ───────────────────────────────────────────────────────
interface PipelineStepDef {
  label:   string;
  owner:   string;
  value:   number;
  pct:     number | undefined;
  tier:    'baseline' | 'normal' | 'warn70' | 'warn30';
}

function PipelineSnapshotRow({ step, isLast }: { step: PipelineStepDef; isLast: boolean }) {
  const badge = OWNER_BADGE[step.owner];
  const countColour = step.tier === 'baseline'
    ? (step.value === 0 ? 'var(--color-text-secondary, #6b7280)' : 'var(--color-text-primary, #111827)')
    : pipelineCountColour(step.value, step.tier === 'normal' ? 'normal' : step.tier, step.pct);
  const isBold = step.value > 0;

  return (
    <div
      style={{
        borderBottom: isLast ? 'none' : '0.5px solid var(--color-border-tertiary, #f3f4f6)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        paddingTop: 6,
        paddingBottom: 6,
      }}
    >
      {/* Step label */}
      <span
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          color: 'var(--color-text-secondary, #6b7280)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {step.label}
      </span>

      {/* Owner badge */}
      <span
        style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 99,
          background: badge.bg,
          color: badge.fg,
          fontWeight: 600,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {badge.label}
      </span>

      {/* Count */}
      <span
        style={{
          fontSize: 14,
          fontWeight: isBold ? 500 : 400,
          color: countColour,
          flexShrink: 0,
          minWidth: 28,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {step.value.toLocaleString()}
      </span>

      {/* Percentage */}
      <span
        style={{
          fontSize: 12,
          color: 'var(--color-text-secondary, #6b7280)',
          flexShrink: 0,
          minWidth: 40,
          textAlign: 'right',
        }}
      >
        {step.pct !== undefined ? `(${step.pct}%)` : ''}
      </span>
    </div>
  );
}

function DetailDrawer({ centre, filters, onClose, onDrillDown }: DetailDrawerProps) {
  const [detail, setDetail]   = useState<CentreDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [activeCasesOpen, setActiveCasesOpen] = useState(false);
  const [overdueOpen, setOverdueOpen]         = useState(false);

  type ACSort  = 'patientName' | 'assessmentType' | 'clinicianName' | 'status' | 'daysOpen';
  type OASort  = 'patientName' | 'assessmentType' | 'clinicianName' | 'assessmentStatus' | 'daysPending';
  type SortDir = 'asc' | 'desc';

  const [acSort, setAcSort]       = useState<ACSort>('daysOpen');
  const [acDir,  setAcDir]        = useState<SortDir>('desc');
  const [oaSort, setOaSort]       = useState<OASort>('daysPending');
  const [oaDir,  setOaDir]        = useState<SortDir>('desc');

  function toggleAcSort(col: ACSort) {
    if (acSort === col) setAcDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setAcSort(col); setAcDir(col === 'daysOpen' ? 'desc' : 'asc'); }
  }
  function toggleOaSort(col: OASort) {
    if (oaSort === col) setOaDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setOaSort(col); setOaDir(col === 'daysPending' ? 'desc' : 'asc'); }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchCentreDetail(centre.centreId, {
        dateFrom: filters.dateFrom,
        dateTo:   filters.dateTo,
      });
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load centre detail');
    } finally {
      setLoading(false);
    }
  }, [centre.centreId, filters.dateFrom, filters.dateTo]);

  useEffect(() => { load(); }, [load]);

  const { dot, text: statusText } = STATUS_COLOUR[centre.status];

  const staffStatusLabel: Record<string, { label: string; className: string }> = {
    'active':       { label: 'Active',       className: 'bg-emerald-50 text-emerald-700' },
    'idle':         { label: 'Idle',         className: 'bg-amber-50   text-amber-700'   },
    'silent':       { label: 'Silent',       className: 'bg-gray-100   text-gray-500'    },
    'never-active': { label: 'Never active', className: 'bg-rose-50    text-rose-600'    },
  };

  const staffSortOrder = (s: string) => ({ active: 0, idle: 1, silent: 2, 'never-active': 3 })[s] ?? 4;
  const sortedStaff = detail ? [...detail.staff].sort((a, b) => staffSortOrder(a.status) - staffSortOrder(b.status)) : [];

  const sortedActiveCases = useMemo(() => {
    if (!detail) return [];
    return [...detail.activeCases].sort((a, b) => {
      let cmp = 0;
      if (acSort === 'patientName')    cmp = (a.patientName ?? '').localeCompare(b.patientName ?? '');
      else if (acSort === 'assessmentType') cmp = (a.assessmentType ?? '').localeCompare(b.assessmentType ?? '');
      else if (acSort === 'clinicianName')  cmp = (a.clinicianName ?? '').localeCompare(b.clinicianName ?? '');
      else if (acSort === 'status')         cmp = (a.status ?? '').localeCompare(b.status ?? '');
      else if (acSort === 'daysOpen')       cmp = a.daysOpen - b.daysOpen;
      return acDir === 'desc' ? -cmp : cmp;
    });
  }, [detail, acSort, acDir]);

  const sortedOverdueAssessments = useMemo(() => {
    if (!detail) return [];
    return [...detail.overdueAssessments].sort((a, b) => {
      let cmp = 0;
      if (oaSort === 'patientName')       cmp = (a.patientName ?? '').localeCompare(b.patientName ?? '');
      else if (oaSort === 'assessmentType')    cmp = (a.assessmentType ?? '').localeCompare(b.assessmentType ?? '');
      else if (oaSort === 'clinicianName')     cmp = (a.clinicianName ?? '').localeCompare(b.clinicianName ?? '');
      else if (oaSort === 'assessmentStatus')  cmp = (a.assessmentStatus ?? '').localeCompare(b.assessmentStatus ?? '');
      else if (oaSort === 'daysPending')       cmp = a.daysPending - b.daysPending;
      return oaDir === 'desc' ? -cmp : cmp;
    });
  }, [detail, oaSort, oaDir]);

  // ── Pipeline snapshot data (period-based, from centre prop) ─────────────────
  const reg = centre.intake.casesRegistered;
  function snapshotPct(n: number): number | undefined {
    if (reg <= 0) return undefined;
    return Math.round((n / reg) * 100);
  }

  const pipelineSteps: PipelineStepDef[] = [
    {
      label: 'Case Registered',
      owner: 'ops-mgr',
      value: reg,
      pct:   undefined,
      tier:  'baseline',
    },
    {
      label: 'Case History',
      owner: 'clin-mgr',
      value: centre.intake.casesAssigned,
      pct:   snapshotPct(centre.intake.casesAssigned),
      tier:  'normal',
    },
    {
      label: 'Assessment Assign',
      owner: 'ops-mgr',
      value: centre.throughput.assessmentsAssigned,
      pct:   snapshotPct(centre.throughput.assessmentsAssigned),
      tier:  'normal',
    },
    {
      label: 'Scoring Complete',
      owner: 'clinician',
      value: centre.throughput.assessmentsScored,
      pct:   snapshotPct(centre.throughput.assessmentsScored),
      tier:  'warn70',
    },
    {
      label: 'Report Drafted',
      owner: 'clinician',
      value: centre.output.reportsDrafted,
      pct:   snapshotPct(centre.output.reportsDrafted),
      tier:  'warn70',
    },
    {
      label: 'Report Approved',
      owner: 'manager',
      value: centre.output.reportsApproved,
      pct:   snapshotPct(centre.output.reportsApproved),
      tier:  'warn70',
    },
    {
      label: 'Goals Added',
      owner: 'clinician',
      value: centre.output.goalsAdded,
      pct:   snapshotPct(centre.output.goalsAdded),
      tier:  'warn30',
    },
    {
      label: 'Goals Approved',
      owner: 'manager',
      value: centre.output.goalsApproved,
      pct:   snapshotPct(centre.output.goalsApproved),
      tier:  'warn30',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">

        {/* Header — unchanged */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 id="detail-title" className="text-xl font-bold text-gray-900 truncate">{centre.centreName}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-full flex-shrink-0" style={{ width: 8, height: 8, backgroundColor: dot }} />
                <span className="text-sm text-gray-600">{statusText}</span>
              </span>
              {centre.statusReasons.length > 0 && (
                <span className="text-xs text-gray-400">— {centre.statusReasons.join(' · ')}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="ml-4 text-gray-400 hover:text-gray-600 p-1.5 rounded-lg flex-shrink-0" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Section 1 — Key metrics mini cards */}
          <div className="grid grid-cols-4 gap-3">
            {/* Active Caseload */}
            <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider leading-none mb-1">Active Caseload</p>
              <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--color-text-primary, #111827)' }}>
                {centre.throughput.activeCaseload}
              </p>
            </div>
            {/* In Scoring — spec: text-primary, not blue */}
            <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider leading-none mb-1">In Scoring</p>
              <p className="text-xl font-bold tabular-nums" style={{ color: 'var(--color-text-primary, #111827)' }}>
                {centre.pipeline.scoring}
              </p>
            </div>
            {/* Staff Active — X in #1D9E75 / /Y in text-tertiary */}
            <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider leading-none mb-1">Staff Active</p>
              <p className="text-xl font-bold tabular-nums">
                <span style={{ color: '#1D9E75' }}>{centre.staff.activeThisPeriod}</span>
                <span style={{ color: 'var(--color-text-tertiary, #9ca3af)' }}>/{centre.staff.total}</span>
              </p>
            </div>
            {/* Stuck Cases — #A32D2D if > 0 */}
            <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider leading-none mb-1">Stuck Cases</p>
              <p
                className="text-xl font-bold tabular-nums"
                style={{ color: centre.intake.stuckUnassigned > 0 ? '#A32D2D' : 'var(--color-text-primary, #111827)' }}
              >
                {centre.intake.stuckUnassigned}
              </p>
            </div>
          </div>

          {/* Section 1b — Pipeline Snapshot (always rendered, uses centre prop — no detail-fetch dependency) */}
          <div>
            <div className="mb-2">
              <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text-primary, #111827)', margin: 0 }}>
                Pipeline snapshot
              </p>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary, #6b7280)', marginTop: 2 }}>
                Cases at each stage · this centre · {formatPeriodLabel(filters.dateFrom, filters.dateTo)}
              </p>
            </div>
            {pipelineSteps.map((step, i) => (
              <PipelineSnapshotRow
                key={step.label}
                step={step}
                isLast={i === pipelineSteps.length - 1}
              />
            ))}
          </div>

          {/* Section 2 — Intake, Throughput & Output — flat two-column grid */}
          <div className="space-y-4">
            {/* INTAKE group */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.05em] mb-2">Intake</p>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell
                  label="Cases registered"
                  value={centre.intake.casesRegistered}
                />
                <MetricCell
                  label="Avg days to assign"
                  value={centre.intake.avgDaysToAssign != null ? `${centre.intake.avgDaysToAssign}d` : '—'}
                  colour={centre.intake.avgDaysToAssign != null && centre.intake.avgDaysToAssign > 2 ? '#A32D2D' : undefined}
                />
                <MetricCell
                  label="Stuck unassigned"
                  value={centre.intake.stuckUnassigned}
                  colour={centre.intake.stuckUnassigned > 0 ? '#A32D2D' : undefined}
                  onClick={centre.intake.stuckUnassigned > 0 && onDrillDown
                    ? () => onDrillDown({
                        type: 'manager-stuck-onboarding',
                        drillCentreId: centre.centreId,
                        label: `Stuck unassigned · ${centre.centreName}`,
                      })
                    : undefined}
                />
                <MetricCell
                  label="Cases assigned"
                  value={centre.intake.casesAssigned}
                />
              </div>
            </div>

            {/* THROUGHPUT group */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.05em] mb-2">Throughput</p>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Active caseload"       value={centre.throughput.activeCaseload} />
                <MetricCell label="Assessments assigned"  value={centre.throughput.assessmentsAssigned} />
                <MetricCell label="Assessments scored"    value={centre.throughput.assessmentsScored} />
                <MetricCell
                  label="Pending approval"
                  value={centre.pipeline.pendingApproval}
                  colour={centre.pipeline.pendingApproval > 0 ? '#A32D2D' : undefined}
                />
              </div>
            </div>

            {/* OUTPUT group */}
            <div>
              <p className="text-[11px] font-medium text-gray-500 uppercase tracking-[0.05em] mb-2">Output</p>
              <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Reports drafted"   value={centre.output.reportsDrafted} />
                <MetricCell label="Reports approved"  value={centre.output.reportsApproved} />
                <MetricCell label="Goals added"       value={centre.output.goalsAdded} />
                <MetricCell label="Goals approved"    value={centre.output.goalsApproved} />
                <MetricCell
                  label="Avg days to approve report"
                  value={centre.output.avgDaysToApproveReport != null ? `${centre.output.avgDaysToApproveReport}d` : '—'}
                  colour={centre.output.avgDaysToApproveReport != null && centre.output.avgDaysToApproveReport > 7 ? '#A32D2D' : undefined}
                />
                <MetricCell
                  label="Avg days to approve goal"
                  value={centre.output.avgDaysToApproveGoal != null ? `${centre.output.avgDaysToApproveGoal}d` : '—'}
                  colour={centre.output.avgDaysToApproveGoal != null && centre.output.avgDaysToApproveGoal > 7 ? '#A32D2D' : undefined}
                />
              </div>
            </div>
          </div>

          {/* Section 3 — Staff at this centre */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-0.5">Staff at this centre</h3>
            <p className="section-click-hint mb-2">Click any name to view their full profile</p>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>
            ) : sortedStaff.length === 0 ? (
              <p className="text-sm text-gray-400">No staff assigned to this centre</p>
            ) : (
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name / Email</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Last Active</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Last Login</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortedStaff.map((s) => {
                      const st = staffStatusLabel[s.status] ?? { label: s.status || '—', className: 'bg-gray-100 text-gray-500' };
                      const profileRole: UserProfileRole | null = inferProfileRole(s.roleName, s.email, s.firstName, s.lastName);
                      return (
                        <tr key={s.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="font-medium text-gray-800">
                              {profileRole ? (
                                <PersonLink
                                  userId={s.id}
                                  role={profileRole}
                                  firstName={s.firstName}
                                  lastName={s.lastName}
                                />
                              ) : (
                                <span>{s.firstName} {s.lastName}</span>
                              )}
                            </div>
                            {s.email && (
                              <div className="text-[11px] text-gray-400 mt-0.5">{s.email}</div>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {s.roleName ? (
                              <RoleBadge
                                role={s.roleName}
                                firstName={s.firstName}
                                lastName={s.lastName}
                              />
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${st.className}`}>
                              {st.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{timeAgo(s.lastActivityDate)}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{timeAgo(s.lastLoginDate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 4 — Active cases (collapsed) */}
          {!loading && detail && (
            <div>
              <button
                onClick={() => setActiveCasesOpen((v) => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
              >
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${activeCasesOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Show {detail.activeCases.length} active case{detail.activeCases.length !== 1 ? 's' : ''}
              </button>
              {activeCasesOpen && (
                <div className="mt-3 rounded-xl border border-gray-100 overflow-x-auto">
                  {detail.activeCases.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">No active cases</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          {(
                            [
                              { key: 'patientName',    label: 'Patient',         align: 'left'  },
                              { key: 'assessmentType', label: 'Assessment Type', align: 'left'  },
                              { key: 'clinicianName',  label: 'Clinician',       align: 'left'  },
                              { key: 'status',         label: 'Status',          align: 'left'  },
                              { key: 'daysOpen',       label: 'Days Open',       align: 'right' },
                            ] as { key: ACSort; label: string; align: 'left' | 'right' }[]
                          ).map(({ key, label, align }) => (
                            <th
                              key={key}
                              onClick={() => toggleAcSort(key)}
                              className={`px-4 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-[0.03em] cursor-pointer select-none whitespace-nowrap hover:text-gray-600 transition-colors text-${align}`}
                            >
                              {label}
                              {acSort === key && (
                                <span className="ml-1 opacity-60">{acDir === 'desc' ? '↓' : '↑'}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {sortedActiveCases.map((ac) => (
                          <tr key={`${ac.patientId}-${ac.assessmentType}`} className="hover:bg-gray-50/60">
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-[13px]" style={{ color: 'var(--color-text-primary, #111827)' }}>
                                {ac.patientName}
                              </span>
                              {ac.patientDisplayId && (
                                <span className="ml-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
                                  #{ac.patientDisplayId}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <AssessmentTypeBadge type={ac.assessmentType} />
                            </td>
                            <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--color-text-primary, #111827)' }}>
                              {ac.clinicianName ? (
                                <span className="border-b border-dotted border-gray-400 cursor-default" title={`View ${ac.clinicianName}'s profile →`}>
                                  {ac.clinicianName}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-[12px]" style={{ color: assessmentStatusColour(ac.status) }}>
                              {formatAssessmentStatus(ac.status)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-[13px]" style={daysOpenStyle(ac.daysOpen)}>
                              {ac.daysOpen}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section 5 — Overdue assessments (collapsed) */}
          {!loading && detail && (
            <div>
              <button
                onClick={() => setOverdueOpen((v) => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
              >
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${overdueOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Show {detail.overdueAssessments.length} overdue assessment{detail.overdueAssessments.length !== 1 ? 's' : ''}
                {detail.overdueAssessments.length > 0 && (
                  <span className="ml-1 text-xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-full">
                    {detail.overdueAssessments.length}
                  </span>
                )}
              </button>
              {overdueOpen && (
                <div className="mt-3 rounded-xl border border-rose-100 overflow-x-auto">
                  {detail.overdueAssessments.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">No overdue assessments</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-rose-50 border-b border-rose-100">
                          {(
                            [
                              { key: 'patientName',      label: 'Patient',         align: 'left'  },
                              { key: 'assessmentType',   label: 'Assessment Type', align: 'left'  },
                              { key: 'clinicianName',    label: 'Clinician',       align: 'left'  },
                              { key: 'assessmentStatus', label: 'Status',          align: 'left'  },
                              { key: 'daysPending',      label: 'Days Open',       align: 'right' },
                            ] as { key: OASort; label: string; align: 'left' | 'right' }[]
                          ).map(({ key, label, align }) => (
                            <th
                              key={key}
                              onClick={() => toggleOaSort(key)}
                              className={`px-4 py-2.5 text-[11px] font-medium text-rose-400 uppercase tracking-[0.03em] cursor-pointer select-none whitespace-nowrap hover:text-rose-600 transition-colors text-${align}`}
                            >
                              {label}
                              {oaSort === key && (
                                <span className="ml-1 opacity-60">{oaDir === 'desc' ? '↓' : '↑'}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-50">
                        {sortedOverdueAssessments.map((oa) => (
                          <tr key={`${oa.patientId}-${oa.assessmentType}`} className="hover:bg-rose-50/40">
                            <td className="px-4 py-2.5">
                              <span className="font-medium text-[13px]" style={{ color: 'var(--color-text-primary, #111827)' }}>
                                {oa.patientName}
                              </span>
                              {oa.patientDisplayId && (
                                <span className="ml-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary, #6b7280)' }}>
                                  #{oa.patientDisplayId}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <AssessmentTypeBadge type={oa.assessmentType} />
                            </td>
                            <td className="px-4 py-2.5 text-[13px]" style={{ color: 'var(--color-text-primary, #111827)' }}>
                              {oa.clinicianName ? (
                                <span className="border-b border-dotted border-gray-400 cursor-default" title={`View ${oa.clinicianName}'s profile →`}>
                                  {oa.clinicianName}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-[12px]" style={{ color: assessmentStatusColour(oa.assessmentStatus) }}>
                              {formatAssessmentStatus(oa.assessmentStatus)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-[13px]" style={daysOpenStyle(oa.daysPending)}>
                              {oa.daysPending}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && detail && centre.lastActivityDate === null && (
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-5 py-6 text-center">
              <p className="text-sm text-gray-500">No activity recorded for <strong>{centre.centreName}</strong> in this period</p>
              <p className="text-xs text-gray-400 mt-1">
                Last activity: {centre.lastActivityDate ? timeAgo(centre.lastActivityDate) : 'Never'}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── MetricCell — flat grid cell for Intake/Throughput/Output sections ─────────
function MetricCell({
  label,
  value,
  colour,
  onClick,
}: {
  label:    string;
  value:    string | number;
  colour?:  string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={[
        'rounded-lg bg-gray-50 px-3 py-2.5 text-left w-full',
        onClick ? 'cursor-pointer hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : '',
      ].join(' ')}
    >
      <p
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-secondary, #6b7280)',
          fontWeight: 500,
          marginBottom: 2,
        }}
      >
        {label}
        {onClick && <span style={{ marginLeft: 4, opacity: 0.5 }}>↗</span>}
      </p>
      <p
        className="tabular-nums"
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: colour ?? 'var(--color-text-primary, #111827)',
        }}
      >
        {value}
      </p>
    </Tag>
  );
}

// ── Main CentresTab component ─────────────────────────────────────────────────

interface CentresTabProps {
  data:            CentresOverviewData | null;
  loading:         boolean;
  error:           string | null;
  filters:         FilterParams;
  workload:         WorkloadCentreRow[] | null;
  workloadLoading:  boolean;
  workloadError?:   string | null;
  onWorkloadRetry?: () => void;
  onDrillDown?:     OnRoleDrillDown;
}

export default function CentresTab({ data, loading, error, filters, workload, workloadLoading, workloadError, onWorkloadRetry, onDrillDown }: CentresTabProps) {
  const [statusDrawer, setStatusDrawer] = useState<{ title: string; centres: CentreOverviewRow[] } | null>(null);
  const [detailCentre, setDetailCentre] = useState<CentreOverviewRow | null>(null);
  const [search, setSearch]             = useState('');

  const summary  = data?.summary;
  const allRows  = data?.centres ?? [];

  // Sort: blocked → needs-attention → on-track; within group by stuckUnassigned desc
  const sorted = useMemo(() => {
    const filtered = search
      ? allRows.filter((c) => c.centreName.toLowerCase().includes(search.toLowerCase()))
      : allRows;
    return [...filtered].sort((a, b) => {
      const so = statusOrder(a.status) - statusOrder(b.status);
      if (so !== 0) return so;
      return b.intake.stuckUnassigned - a.intake.stuckUnassigned;
    });
  }, [allRows, search]);

  const colCount = 15;

  const openStatusDrawer = useCallback((status: CentreStatus | 'idle') => {
    if (status === 'idle') {
      // "Idle" = no staff active in the selected period (matches Q15 in metricsService).
      setStatusDrawer({
        title:   'Idle Centres',
        centres: allRows.filter((c) => c.staff.activeThisPeriod === 0 && c.staff.total > 0),
      });
    } else {
      const map: Record<CentreStatus, string> = {
        'on-track':        'On Track',
        'needs-attention': 'Needs Attention',
        'blocked':         'Blocked',
      };
      setStatusDrawer({
        title:   map[status],
        centres: allRows.filter((c) => c.status === status),
      });
    }
  }, [allRows]);

  // Must be declared before any early return to satisfy Rules of Hooks
  const totalStuckScoring = useMemo(
    () => allRows.reduce((s, c) => s + (c.pipeline?.stuckScoring14d ?? 0), 0),
    [allRows],
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load centres: {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Total centres"
          value={loading ? '—' : (summary?.totalCentres ?? 0)}
          context="In the Unity system"
          tooltip="All active centres excluding deleted/test centres."
        />
        <SummaryCard
          label="On track"
          value={loading ? '—' : (summary?.onTrack ?? 0)}
          context="No pipeline blockers"
          tooltip="Centres with no stuck scoring cases, no overdue approvals, and no goals pending over threshold."
          valueClass="text-emerald-600"
          onClick={() => !loading && openStatusDrawer('on-track')}
        />
        <SummaryCard
          label="Needs attention"
          value={loading ? '—' : (summary?.needsAttention ?? 0)}
          context="1–3 pipeline issues"
          tooltip="Centres with 1–3 cases stuck in scoring 14+ days, approvals pending 5+ days, or goals not added 7+ days."
          valueClass="text-amber-600"
          onClick={() => !loading && openStatusDrawer('needs-attention')}
        />
        <SummaryCard
          label="Blocked"
          value={loading ? '—' : (summary?.blocked ?? 0)}
          context="Requires immediate action"
          tooltip="Centres with more than 3 stuck scoring cases (21+ days), 3+ approvals pending over 7 days, or entire staff inactive."
          valueClass={(summary?.blocked ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900'}
          onClick={() => !loading && openStatusDrawer('blocked')}
        />
        <SummaryCard
          label="Idle centres"
          value={loading ? '—' : (summary?.idleCentres ?? 0)}
          context="No activity this period"
          tooltip="Centres with zero audit log activity in the selected period."
          valueClass={(summary?.idleCentres ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900'}
          onClick={() => !loading && openStatusDrawer('idle')}
        />
        {/* Card 6 — Goal coverage */}
        <SummaryCard
          label="Goal coverage"
          value={
            loading || !data?.goalCoverage
              ? '—'
              : `${data.goalCoverage.coveragePercent}%`
          }
          context={
            data?.goalCoverage
              ? `${data.goalCoverage.goalsWithNotes} of ${data.goalCoverage.approvedGoals} goals documented`
              : 'Approved goals with progress notes'
          }
          tooltip="Percentage of approved goals that have at least one progress note. FSP goals excluded — no progress table available."
        />
      </div>

      {/* ── Status table ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-[15px] font-medium text-gray-900">Centre Status</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">Blocked first · click any row to drill down</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search centres…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 w-44"
              />
            </div>
          </div>
        </div>

        <ScrollRegion maxHeightClass="max-h-[600px]" label="table">
          <table className="w-full min-w-[900px] text-sm" role="table" aria-label="Centre status table">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
              <tr>
                <th className="px-5 py-[10px] text-left w-6 text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">#</th>
                <th className="px-5 py-[10px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Centre</th>
                <th className="px-5 py-[10px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Status</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Stuck</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Caseload</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Cases in scoring (not_started/in_progress)">Scoring</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Cases in report/approval/goals stages">Pipeline</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Distinct patients registered in period">Cases Reg</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Distinct patients assigned to clinical in period">Cases Asgn</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Rpts Drafted</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Rpts Approved</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Goals Added: N assessments (total items)">Goals Added</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]" title="Goals Approved: N assessments (total items)">Goals Apprvd</th>
                <th className="px-5 py-[10px] text-right text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Staff</th>
                <th className="px-5 py-[10px] text-left  text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em]">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: colCount }).map((__, j) => (
                      <td key={j} className="px-5 py-3.5">
                        <div className="h-4 bg-gray-100 rounded w-14" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-gray-400">
                    {search ? 'No centres match your search' : 'No centre data for the selected filters'}
                  </td>
                </tr>
              ) : (
                sorted.map((c, idx) => {
                  const isIdle = c.lastActivityDate === null;
                  const rowClass = isIdle ? 'text-gray-300' : 'text-gray-700';
                  return (
                    <tr
                      key={c.centreId}
                      className={`transition-colors cursor-pointer hover:bg-blue-50/40 ${isIdle ? 'opacity-60' : ''}`}
                      onClick={() => setDetailCentre(c)}
                    >
                      <td className={`px-5 py-3 text-[11px] font-bold tabular-nums ${isIdle ? 'text-gray-200' : 'text-gray-300'}`}>{idx + 1}</td>
                      <td className={`px-5 py-3 font-medium whitespace-nowrap ${isIdle ? 'text-gray-400' : 'text-gray-900'}`}>{c.centreName}</td>
                      <td className="px-5 py-3">
                        <StatusDot status={c.status} />
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums font-bold ${c.intake.stuckUnassigned > 0 ? 'text-rose-600' : rowClass}`}>
                        {c.intake.stuckUnassigned > 0 ? c.intake.stuckUnassigned : <span className="text-gray-200 font-normal">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums font-medium ${rowClass}`}>{c.throughput.activeCaseload || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${pipelineColour(c.pipeline?.scoring ?? 0)}`}>
                        {(c.pipeline?.scoring ?? 0) > 0 ? c.pipeline.scoring : <span className="text-gray-200">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${pipelineColour((c.pipeline?.reportNotDrafted ?? 0) + (c.pipeline?.pendingApproval ?? 0) + (c.pipeline?.goalsNotAdded ?? 0))}`}>
                        {((c.pipeline?.reportNotDrafted ?? 0) + (c.pipeline?.pendingApproval ?? 0) + (c.pipeline?.goalsNotAdded ?? 0)) > 0
                          ? (c.pipeline.reportNotDrafted + c.pipeline.pendingApproval + c.pipeline.goalsNotAdded)
                          : <span className="text-gray-200">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.intake.casesRegistered || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.intake.casesAssigned || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.output.reportsDrafted || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.output.reportsApproved || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>
                        {c.output.goalsAdded > 0
                          ? goalsDisplay(c.output.goalsAdded, c.output.goalsAddedItems ?? 0)
                          : <span className="text-gray-200">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>
                        {c.output.goalsApproved > 0
                          ? goalsDisplay(c.output.goalsApproved, c.output.goalsApprovedItems ?? 0)
                          : <span className="text-gray-200">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-right tabular-nums ${c.staff.activeThisPeriod === 0 && c.staff.total > 0 ? 'text-rose-600 font-semibold' : rowClass}`}>
                        {c.staff.total > 0 ? `${c.staff.activeThisPeriod}/${c.staff.total}` : <span className="text-gray-200">—</span>}
                      </td>
                      <td className={`px-5 py-3 text-xs whitespace-nowrap ${isIdle ? 'text-gray-300' : 'text-gray-500'}`}>{timeAgo(c.lastActivityDate)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollRegion>
      </div>

      {/* ── Workload by centre ─────────────────────────────────────────────── */}
      <WorkloadByCentreTable rows={workload} loading={workloadLoading} error={workloadError ?? null} onRetry={onWorkloadRetry} />

      {/* ── Status drawer ─────────────────────────────────────────────────── */}
      {statusDrawer && (
        <StatusDrawer
          title={statusDrawer.title}
          centres={statusDrawer.centres}
          onClose={() => setStatusDrawer(null)}
          onSelect={(c) => setDetailCentre(c)}
        />
      )}

      {/* ── Centre detail drawer ───────────────────────────────────────────── */}
      {detailCentre && (
        <DetailDrawer
          centre={detailCentre}
          filters={filters}
          onClose={() => setDetailCentre(null)}
          onDrillDown={onDrillDown}
        />
      )}
    </div>
  );
}
