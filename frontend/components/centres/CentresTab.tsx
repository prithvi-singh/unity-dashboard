'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import type {
  CentresOverviewData,
  CentreOverviewRow,
  CentreStatus,
  CentreDetailData,
  FilterParams,
  WorkloadCentreRow,
  UserProfileRole,
  CentrePipelineBreakdown,
} from '@/lib/types';
import { fetchCentreDetail } from '@/lib/api';
import ScrollRegion from '@/components/shared/ScrollRegion';
import WorkloadByCentreTable from '@/components/clinicians/WorkloadByCentreTable';
import PersonLink from '@/components/PersonLink';
import { inferProfileRole } from '@/lib/userProfile';

// ── Colour constants (spec) ────────────────────────────────────────────────────
const STATUS_COLOUR: Record<CentreStatus, { dot: string; badge: string; text: string }> = {
  'on-track':        { dot: '#1D9E75', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',   text: 'On track' },
  'needs-attention': { dot: '#BA7517', badge: 'bg-amber-50  text-amber-700  border-amber-200',       text: 'Needs attention' },
  'blocked':         { dot: '#A32D2D', badge: 'bg-rose-50   text-rose-700   border-rose-200',        text: 'Blocked' },
};

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

function approvalTimeColour(days: number | null): string {
  if (days == null) return 'text-gray-400';
  if (days > 7) return 'text-rose-600 font-semibold';
  if (days > 3) return 'text-amber-600 font-semibold';
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
  return (
    <div
      title={tooltip}
      onClick={onClick}
      className={[
        'bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-col gap-1',
        onClick ? 'cursor-pointer hover:border-gray-300 hover:shadow-sm transition-all' : '',
      ].join(' ')}
    >
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{context}</p>
    </div>
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
  centre:     CentreOverviewRow;
  filters:    FilterParams;
  onClose:    () => void;
}
function DetailDrawer({ centre, filters, onClose }: DetailDrawerProps) {
  const [detail, setDetail]   = useState<CentreDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [activeCasesOpen, setActiveCasesOpen]       = useState(false);
  const [overdueOpen, setOverdueOpen]               = useState(false);

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

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">

        {/* Header */}
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
            {[
              { label: 'Active Caseload', value: centre.throughput.activeCaseload },
              { label: 'In Scoring',      value: centre.pipeline.scoring,
                valueClass: centre.pipeline.scoring > 0 ? 'text-blue-600' : 'text-gray-900' },
              { label: 'Staff Active',    value: `${centre.staff.activeThisPeriod}/${centre.staff.total}` },
              { label: 'Stuck Cases',     value: centre.intake.stuckUnassigned,
                valueClass: centre.intake.stuckUnassigned > 0 ? 'text-rose-600' : 'text-gray-900' },
            ].map((m) => (
              <div key={m.label} className="bg-gray-50 rounded-lg px-3 py-3 text-center">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider leading-none mb-1">{m.label}</p>
                <p className={`text-xl font-bold tabular-nums ${(m as { valueClass?: string }).valueClass ?? 'text-gray-900'}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Section 1b — Pipeline breakdown */}
          {loading ? null : (
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl px-4 py-3">
              <p className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider mb-2">Pipeline snapshot</p>
              {detail ? (
                <PipelineBreakdownBar pb={detail.pipelineBreakdown} />
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {['In scoring', 'Awaiting report', 'Awaiting approval', 'Goals pending', 'Completed'].map((l) => (
                    <div key={l} className="h-4 w-24 bg-blue-100 rounded animate-pulse" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Section 2 — Intake & Throughput */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Intake & Throughput</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Intake</p>
                <Row label="Cases registered"   value={centre.intake.casesRegistered} />
                <Row
                  label="Avg days to assign"
                  value={centre.intake.avgDaysToAssign != null ? `${centre.intake.avgDaysToAssign}d` : '—'}
                  valueClass={centre.intake.avgDaysToAssign != null && centre.intake.avgDaysToAssign > 2 ? 'text-rose-600 font-semibold' : undefined}
                />
                <Row
                  label="Stuck unassigned"
                  value={centre.intake.stuckUnassigned}
                  valueClass={centre.intake.stuckUnassigned > 0 ? 'text-rose-600 font-semibold' : undefined}
                />
              </div>
              <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Throughput</p>
                <Row label="Assessments assigned" value={centre.throughput.assessmentsAssigned} />
                <Row label="Assessments scored"   value={centre.throughput.assessmentsScored} />
                <Row
                  label="Pending approval"
                  value={centre.pipeline.pendingApproval}
                  valueClass={centre.pipeline.pendingApproval > 0 ? 'text-amber-600 font-semibold' : undefined}
                />
              </div>
            </div>
          </div>

          {/* Section 3 — Output */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Output</h3>
            <div className="grid grid-cols-2 gap-3 mb-2">
              {[
                { label: 'Reports Drafted',   value: centre.output.reportsDrafted },
                { label: 'Reports Approved',  value: centre.output.reportsApproved },
                { label: 'Cases w/ Goals',    value: centre.output.goalsAdded },
                { label: 'Goals Approved',    value: centre.output.goalsApproved },
              ].map((m) => (
                <div key={m.label} className="bg-gray-50 rounded-lg px-3 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-gray-500">{m.label}</span>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{m.value}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <p className={`text-xs flex-1 px-3 py-2 rounded-lg bg-gray-50 ${approvalTimeColour(centre.output.avgDaysToApproveReport)}`}>
                Avg {centre.output.avgDaysToApproveReport != null ? `${centre.output.avgDaysToApproveReport}d` : 'N/A'} to approve reports
              </p>
              <p className={`text-xs flex-1 px-3 py-2 rounded-lg bg-gray-50 ${approvalTimeColour(centre.output.avgDaysToApproveGoal)}`}>
                Avg {centre.output.avgDaysToApproveGoal != null ? `${centre.output.avgDaysToApproveGoal}d` : 'N/A'} to approve goals
              </p>
            </div>
          </div>

          {/* Section 4 — Staff */}
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
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Role</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Last Active</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Last Login</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sortedStaff.map((s) => {
                      const st = staffStatusLabel[s.status];
                      const profileRole: UserProfileRole | null = inferProfileRole(s.roleName);
                      return (
                        <tr key={s.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap">
                            {profileRole ? (
                              <PersonLink
                                userId={s.id}
                                role={profileRole}
                                firstName={s.firstName}
                                lastName={s.lastName}
                              />
                            ) : (
                              <>{s.firstName} {s.lastName}</>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">{s.roleName || '—'}</td>
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

          {/* Section 5 — Active cases (collapsed) */}
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
                <div className="mt-3 rounded-xl border border-gray-100 overflow-hidden">
                  {detail.activeCases.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">No active cases</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Patient ID</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clinician</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider">Days Open</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {detail.activeCases.map((ac) => (
                          <tr key={ac.patientId} className="hover:bg-gray-50/60">
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-600">{ac.patientDisplayId || ac.patientId}</td>
                            <td className="px-4 py-2.5 text-gray-700">{ac.clinicianName || '—'}</td>
                            <td className="px-4 py-2.5 text-xs text-gray-500">{ac.status}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${ac.daysOpen > 30 ? 'text-rose-600' : 'text-gray-700'}`}>
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

          {/* Section 6 — Overdue assessments (collapsed) */}
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
                <div className="mt-3 rounded-xl border border-rose-100 overflow-hidden">
                  {detail.overdueAssessments.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-gray-400">No overdue assessments</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-rose-50 border-b border-rose-100">
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-rose-400 uppercase tracking-wider">Patient ID</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-rose-400 uppercase tracking-wider">Clinician</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-bold text-rose-400 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-bold text-rose-400 uppercase tracking-wider">Days Pending</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-50">
                        {detail.overdueAssessments.map((oa) => (
                          <tr key={oa.patientId} className="text-rose-700 hover:bg-rose-50/40">
                            <td className="px-4 py-2.5 font-mono text-xs">{oa.patientDisplayId || oa.patientId}</td>
                            <td className="px-4 py-2.5">{oa.clinicianName || '—'}</td>
                            <td className="px-4 py-2.5 text-xs">{oa.assessmentStatus}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-bold">{oa.daysPending}</td>
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

// ── Helper row component ──────────────────────────────────────────────────────
function Row({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string | number;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm tabular-nums ${valueClass ?? 'text-gray-900 font-medium'}`}>{value}</span>
    </div>
  );
}

// ── Pipeline breakdown bar ────────────────────────────────────────────────────
function PipelineBreakdownBar({ pb }: { pb: CentrePipelineBreakdown }) {
  const items = [
    { label: 'In scoring',        value: pb.inScoring,        bg: 'bg-blue-500' },
    { label: 'Awaiting report',   value: pb.awaitingReport,   bg: 'bg-amber-400' },
    { label: 'Awaiting approval', value: pb.awaitingApproval, bg: 'bg-orange-500' },
    { label: 'Goals pending',     value: pb.goalsNotAdded,    bg: 'bg-rose-500' },
    { label: 'Completed',         value: pb.completed,        bg: 'bg-emerald-500' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${item.bg}`} />
            <span className="text-gray-400">{item.label}:</span>
            <span className="font-semibold tabular-nums text-gray-800">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main CentresTab component ─────────────────────────────────────────────────

interface CentresTabProps {
  data:            CentresOverviewData | null;
  loading:         boolean;
  error:           string | null;
  filters:         FilterParams;
  workload:        WorkloadCentreRow[] | null;
  workloadLoading: boolean;
}

export default function CentresTab({ data, loading, error, filters, workload, workloadLoading }: CentresTabProps) {
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

  const colCount = 13;

  const openStatusDrawer = useCallback((status: CentreStatus | 'idle') => {
    if (status === 'idle') {
      setStatusDrawer({
        title:   'Idle Centres',
        centres: allRows.filter((c) => c.lastActivityDate === null),
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

  const totalStuckScoring = useMemo(
    () => allRows.reduce((s, c) => s + (c.pipeline?.stuckScoring14d ?? 0), 0),
    [allRows],
  );

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
        <SummaryCard
          label="Stuck in scoring"
          value={loading ? '—' : totalStuckScoring}
          context="14+ days, no result yet"
          tooltip="Total assessments stuck in scoring (14+ days without a result generated) across all centres."
          valueClass={totalStuckScoring > 0 ? 'text-rose-600' : 'text-gray-900'}
        />
      </div>

      {/* ── Status table ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-[14px] font-medium text-gray-900">Centre Status</h2>
            <p className="text-xs text-gray-500 mt-0.5">Blocked first · click any row to drill down</p>
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
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-5 py-3 text-left w-6 text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">#</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Centre</th>
                <th className="px-5 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Status</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Stuck</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Caseload</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]" title="Cases in scoring (not_started/in_progress)">Scoring</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]" title="Cases in report/approval/goals stages">Pipeline</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Rpts Drafted</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Rpts Approved</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Goals Apprvd</th>
                <th className="px-5 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Staff</th>
                <th className="px-5 py-3 text-left  text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">Last Activity</th>
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
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.output.reportsDrafted || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.output.reportsApproved || <span className="text-gray-200">—</span>}</td>
                      <td className={`px-5 py-3 text-right tabular-nums ${rowClass}`}>{c.output.goalsApproved || <span className="text-gray-200">—</span>}</td>
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
      <WorkloadByCentreTable rows={workload} loading={workloadLoading} />

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
        />
      )}
    </div>
  );
}
