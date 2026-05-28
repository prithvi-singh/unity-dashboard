'use client';

import { useEffect, useRef } from 'react';
import { useUserSummaryProfile } from '@/hooks/useUserSummaryProfile';
import type { UserSummaryAssessmentBreakdown, UserSummaryActivity } from '@/lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDaysAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff}d ago`;
}

function isClinician(roleName: string | null | undefined): boolean {
  return (roleName ?? '').toLowerCase().includes('clinician');
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, string> = {
  clinician:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  manager:     'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  'centre admin': 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  admin:       'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
};

function roleBadgeStyle(roleName: string | null): string {
  if (!roleName) return 'bg-gray-50 text-gray-500 ring-1 ring-gray-200';
  const lower = roleName.toLowerCase();
  for (const [key, style] of Object.entries(ROLE_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return 'bg-gray-50 text-gray-500 ring-1 ring-gray-200';
}

// ── Audit-based activity status ───────────────────────────────────────────────
// Derives a canonical activity state from profile data (no period context here;
// uses all-time audit count + recency heuristic).
type ActivityStatus = 'active' | 'idle' | 'quiet' | 'never-active';

function deriveActivityStatus(
  totalAuditActions: number,
  lastActivityDate: string | null,
  lastLoginDate: string | null,
): ActivityStatus {
  if (totalAuditActions === 0) return 'never-active';
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lastActivity = lastActivityDate ? new Date(lastActivityDate).getTime() : 0;
  const lastLogin    = lastLoginDate    ? new Date(lastLoginDate).getTime()    : 0;
  if (lastActivity > now - THIRTY_DAYS_MS) return 'active';
  if (lastLogin    > now - THIRTY_DAYS_MS) return 'idle';
  return 'quiet';
}

const ACTIVITY_BADGE: Record<ActivityStatus, { label: string; ring: string; dot: string }> = {
  'active':       { label: 'Active',        ring: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200', dot: 'bg-emerald-500' },
  'idle':         { label: 'Idle',          ring: 'bg-amber-50   text-amber-700   ring-1 ring-amber-200',   dot: 'bg-amber-500'   },
  'quiet':        { label: 'Quiet',         ring: 'bg-gray-50    text-gray-500    ring-1 ring-gray-200',    dot: 'bg-gray-400'    },
  'never-active': { label: 'Never active',  ring: 'bg-rose-50    text-rose-700    ring-1 ring-rose-200',    dot: 'bg-rose-500'    },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = 'blue' }: {
  label: string; value: string | number; sub?: string;
  accent?: 'blue' | 'violet' | 'emerald' | 'amber' | 'rose';
}) {
  const accentMap = {
    blue:    'text-blue-600',
    violet:  'text-violet-600',
    emerald: 'text-emerald-600',
    amber:   'text-amber-600',
    rose:    'text-rose-600',
  };
  return (
    <div className="bg-gray-50 rounded-xl p-3.5 flex flex-col gap-1">
      <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">{label}</p>
      <p className={`text-2xl font-bold leading-none tabular-nums ${accentMap[accent]}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function AssessmentRow({ row }: { row: UserSummaryAssessmentBreakdown }) {
  const pct = row.completionRate;
  const barColor =
    pct >= 80 ? 'bg-emerald-400' :
    pct >= 50 ? 'bg-blue-400' :
    'bg-amber-400';

  return (
    <tr className="hover:bg-gray-50/70 transition-colors">
      <td className="py-3 pl-4 pr-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700">
          {row.assessmentType}
        </span>
      </td>
      <td className="py-3 px-3 text-sm text-gray-700 tabular-nums">{row.assigned}</td>
      <td className="py-3 px-3 text-sm text-gray-700 tabular-nums">{row.completed}</td>
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden min-w-[48px]">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="text-xs font-semibold tabular-nums text-gray-700 w-8 text-right">{pct}%</span>
        </div>
      </td>
      <td className="py-3 pl-3 pr-4 text-sm text-gray-500 tabular-nums text-right">
        {row.avgDaysToComplete != null ? `${row.avgDaysToComplete}d` : '—'}
      </td>
    </tr>
  );
}

function ActivityItem({ item }: { item: UserSummaryActivity }) {
  return (
    <li className="flex gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-300 mt-1.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-800 leading-snug truncate">
          {item.description || item.type}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5">
          <span>{fmtDaysAgo(item.date)}</span>
          {item.patientId && (
            <>
              <span className="text-gray-200">·</span>
              <span className="font-mono">PT {item.patientId}</span>
            </>
          )}
        </p>
      </div>
    </li>
  );
}

function DrawerSkeleton() {
  return (
    <div className="p-6 space-y-5 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-full bg-gray-100 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-40 bg-gray-100 rounded" />
          <div className="h-3.5 w-28 bg-gray-100 rounded" />
          <div className="flex gap-2 mt-2">
            <div className="h-5 w-20 bg-gray-100 rounded-full" />
            <div className="h-5 w-16 bg-gray-100 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-gray-50 rounded-xl" />
        ))}
      </div>
      <div className="h-48 bg-gray-50 rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-50 rounded" />
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  userId: number | null;
  onClose: () => void;
}

export default function UserProfileDrawer({ userId, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useUserSummaryProfile(userId);
  const isOpen = userId != null;

  // Keyboard + scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const clinician = data ? isClinician(data.roleName) : false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close profile"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-drawer-title"
        className="relative w-full max-w-[640px] h-full bg-white shadow-2xl flex flex-col
                   border-l border-gray-200/60 animate-[slideInRight_220ms_cubic-bezier(0.22,1,0.36,1)]"
        style={{ willChange: 'transform' }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {loading || !data ? (
                <div className="h-6 w-40 bg-gray-100 rounded animate-pulse" />
              ) : (
                <>
                  <h2
                    id="user-drawer-title"
                    className="text-lg font-bold text-gray-900 leading-tight"
                  >
                    {data.firstName} {data.lastName}
                  </h2>
                  <p className="text-sm text-gray-400 mt-0.5 truncate">{data.email}</p>
                  {(() => {
                    const activityStatus = deriveActivityStatus(
                      data.totalAuditActions,
                      data.lastActivityDate,
                      data.lastLoginDate,
                    );
                    const badge = ACTIVITY_BADGE[activityStatus];
                    return (
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        {data.roleName && (
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${roleBadgeStyle(data.roleName)}`}>
                            {data.roleName}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.ring}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                        {data.centreName && (
                          <span className="text-xs text-gray-500 bg-gray-50 px-2.5 py-0.5 rounded-full ring-1 ring-gray-200">
                            {data.centreName}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Last login + last active strip */}
          {data && (
            <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-400">
              <span>Last login: <span className="text-gray-600 font-medium">{fmtDate(data.lastLoginDate)}</span></span>
              <span className="text-gray-200">·</span>
              <span>Last active: <span className="text-gray-600 font-medium">{fmtDaysAgo(data.lastActivityDate)}</span></span>
              <span className="text-gray-200">·</span>
              <span><span className="text-gray-600 font-medium">{data.totalAuditActions.toLocaleString()}</span> actions</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading && <DrawerSkeleton />}

          {error && (
            <div className="m-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && data && (
            <div className="px-6 py-5 space-y-6">

              {/* ── Clinician stats ── */}
              {clinician && (
                <>
                  <section aria-label="Caseload summary">
                    <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-3">Caseload</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <StatCard label="Active Cases" value={data.activeCaseload ?? 0} accent="blue" />
                      <StatCard label="All-time Cases" value={data.totalCasesAllTime ?? 0} accent="violet" />
                      <StatCard label="Total Actions" value={data.totalAuditActions.toLocaleString()} accent="emerald" />
                    </div>
                  </section>

                  {data.assessmentBreakdown && data.assessmentBreakdown.length > 0 && (
                    <section aria-label="Assessment breakdown">
                      <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-3">Assessment Breakdown</p>
                      <div className="rounded-xl border border-gray-100 overflow-hidden">
                        <table className="w-full text-sm" role="table">
                          <thead className="bg-gray-50 border-b border-gray-100">
                            <tr className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                              <th className="py-2.5 pl-4 pr-3 text-left">Type</th>
                              <th className="py-2.5 px-3 text-left">Assigned</th>
                              <th className="py-2.5 px-3 text-left">Done</th>
                              <th className="py-2.5 px-3 text-left">Rate</th>
                              <th className="py-2.5 pl-3 pr-4 text-right">Avg days</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 bg-white">
                            {data.assessmentBreakdown.map((row) => (
                              <AssessmentRow key={row.assessmentType} row={row} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* ── Manager / Admin stats ── */}
              {!clinician && (
                <section aria-label="Activity summary">
                  <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-3">Activity Summary</p>
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard label="Cases Registered" value={data.casesRegistered ?? 0} accent="blue" />
                    <StatCard label="Assessments Assigned" value={data.assessmentsAssigned ?? 0} accent="violet" />
                    <StatCard
                      label="Goal Approvals Pending"
                      value={data.goalApprovalsPending ?? 0}
                      accent={data.goalApprovalsPending ? 'amber' : 'emerald'}
                      sub={data.goalApprovalsPending ? 'Needs attention' : 'All clear'}
                    />
                    <StatCard
                      label="Goals Approved"
                      value={data.goalApprovalsCompleted ?? 0}
                      accent="emerald"
                      sub={
                        data.avgApprovalTurnaroundHours != null
                          ? `Avg ${data.avgApprovalTurnaroundHours}h turnaround`
                          : undefined
                      }
                    />
                  </div>
                </section>
              )}

              {/* ── Recent activity ── */}
              <section aria-label="Recent activity">
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-3">
                  Recent Activity
                  <span className="ml-1.5 font-normal normal-case text-gray-400">last 20 events</span>
                </p>
                {data.recentActivity.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-200" />
                    <p className="text-sm text-gray-400">No activity recorded</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white px-4">
                    {data.recentActivity.map((item, i) => (
                      <ActivityItem key={`${item.date}-${i}`} item={item} />
                    ))}
                  </ul>
                )}
              </section>

              {/* Last activity timestamp */}
              {data.lastActivityDate && (
                <p className="text-[11px] text-gray-400 text-center pb-2">
                  Last recorded action: {fmtDateTime(data.lastActivityDate)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
