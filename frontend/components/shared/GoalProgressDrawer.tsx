'use client';

/**
 * GoalProgressDrawer
 *
 * Accessible from:
 *   - Progress Notes card on Clinicians tab
 *   - Progress Notes card on Managers tab
 *   - Goal Coverage card on Centres tab
 *   - Individual clinician profile page
 *
 * Shows goal progress coverage: which approved goals have notes and which don't.
 * FSP goals are excluded — no progress table available.
 */

import { useState, useEffect, useCallback } from 'react';
import type { GoalProgressSummary, GoalProgressByAssessmentType, GoalProgressUndocumented } from '@/lib/types';
import RoleBadge from '@/components/shared/RoleBadge';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Props {
  dateFrom?: string | null;
  dateTo?:   string | null;
  centreId?: number | null;
  onClose:   () => void;
}

function MiniCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3 flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">{label}</span>
      <span className="text-2xl font-medium text-gray-900 tabular-nums leading-none">{value}</span>
      {sub && <span className="text-[11px] text-gray-400 mt-0.5">{sub}</span>}
    </div>
  );
}

function CoverageRow({ row }: { row: GoalProgressByAssessmentType }) {
  if (!row.hasProgressTable) {
    return (
      <tr className="border-b border-gray-50 last:border-0">
        <td className="px-4 py-3 text-sm text-gray-700 font-medium">{row.type}</td>
        <td className="px-4 py-3 text-sm text-gray-400 italic" colSpan={4}>
          No progress table available
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.type}</td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-700">{row.approvedGoals}</td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        <span className={row.goalsWithNotes > 0 ? 'text-emerald-700 font-medium' : 'text-gray-400'}>
          {row.goalsWithNotes > 0 ? row.goalsWithNotes : '—'}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-500">{row.totalNotes}</td>
      <td className="px-4 py-3 text-sm text-right tabular-nums">
        {row.approvedGoals > 0 ? (
          <span
            className={
              row.coveragePercent === 0
                ? 'text-gray-400'
                : row.coveragePercent >= 80
                ? 'text-emerald-700 font-medium'
                : row.coveragePercent >= 50
                ? 'text-amber-700'
                : 'text-rose-600'
            }
          >
            {row.coveragePercent}%
          </span>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
    </tr>
  );
}

function UndocumentedRow({ row }: { row: GoalProgressUndocumented }) {
  const hasDot = row.notesCount === 0;
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
      <td className="px-4 py-3 text-sm text-gray-900">
        <p className="font-medium truncate max-w-[150px]" title={row.patientName}>{row.patientName}</p>
        {row.patientDisplayId && (
          <p className="text-[11px] text-gray-400">{row.patientDisplayId}</p>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500">{row.assessmentType}</td>
      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[120px]" title={row.clinicianName ?? undefined}>
        {row.clinicianName ?? <span className="text-gray-300">—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 truncate max-w-[120px]" title={row.centreName}>
        {row.centreName}
      </td>
      <td className="px-4 py-3 text-right">
        {hasDot ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-gray-400"
            aria-label="No notes"
          >
            <span className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
            None
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            {row.notesCount}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right text-[11px]">
        {row.lastNoteDate ? (
          <span className={row.daysSinceLastNote != null && row.daysSinceLastNote > 14 ? 'text-amber-600' : 'text-gray-500'}>
            {row.daysSinceLastNote === 0 ? 'Today'
              : row.daysSinceLastNote === 1 ? 'Yesterday'
              : row.daysSinceLastNote != null ? `${row.daysSinceLastNote}d ago`
              : '—'}
          </span>
        ) : (
          <span className="text-gray-300">Never</span>
        )}
      </td>
    </tr>
  );
}

export default function GoalProgressDrawer({ dateFrom, dateTo, centreId, onClose }: Props) {
  const [data,    setData]    = useState<GoalProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo)   params.set('dateTo',   dateTo);
      if (centreId) params.set('centreId', String(centreId));

      const res = await fetch(`${API_BASE}/api/goal-progress?${params}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json: GoalProgressSummary = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load goal progress');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, centreId]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const dateLabel = dateFrom && dateTo
    ? `${dateFrom} – ${dateTo}`
    : dateFrom ? `From ${dateFrom}` : dateTo ? `To ${dateTo}` : 'All time';

  // Filter to non-FSP types for the main coverage table
  const coverableTypes = data?.byAssessmentType.filter((t) => t.hasProgressTable) ?? [];
  const fspNote = data?.byAssessmentType.find((t) => !t.hasProgressTable);

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Goal progress coverage">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-3xl bg-white flex flex-col h-full shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-[16px] font-semibold text-gray-900">Goal progress coverage</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Progress notes per approved goal · {dateLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {loading && (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
              Loading goal progress…
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
              {error}
            </div>
          )}

          {data && !loading && (
            <>
              {/* Summary mini cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniCard label="Approved goals" value={data.totalApprovedGoals} sub="SPM + ISA + REELS" />
                <MiniCard label="Goals with notes" value={data.goalsWithNotes} />
                <MiniCard label="Coverage" value={`${data.coveragePercent}%`} />
                <MiniCard label="Total notes" value={data.totalNotes} sub="in selected period" />
              </div>

              {/* Coverage by assessment type */}
              <div>
                <h3 className="text-[13px] font-semibold text-gray-700 mb-3 uppercase tracking-[0.04em]">
                  Coverage by assessment type
                </h3>
                <div className="rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Type</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Goals</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">With notes</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Total notes</th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Coverage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.byAssessmentType.map((row) => (
                        <CoverageRow key={row.type} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {fspNote && (
                  <p className="mt-2 text-[11px] text-gray-400 italic">
                    FSP goals excluded — no progress table available. Coverage metrics cover SPM, ISA, and REELS only.
                  </p>
                )}
              </div>

              {/* By user */}
              {data.byUser.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-gray-700 mb-3 uppercase tracking-[0.04em]">
                    Notes by staff member
                  </h3>
                  <div className="rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-sm" role="table">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Name</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Role</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Notes added</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Goals documented</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Last note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {data.byUser.map((u) => (
                          <tr key={u.userId} className="hover:bg-gray-50/50">
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-gray-900">{u.userName}</p>
                              <p className="text-[11px] text-gray-400">{u.userEmail}</p>
                            </td>
                            <td className="px-4 py-3">
                              <RoleBadge role={u.role} name={u.userName} />
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                              {u.notesAdded}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                              {u.goalsDocumented}
                            </td>
                            <td className="px-4 py-3 text-right text-[12px] text-gray-500">
                              {u.lastNoteDate
                                ? new Date(u.lastNoteDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recently undocumented */}
              {data.recentlyUndocumented.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-semibold text-gray-700 mb-2 uppercase tracking-[0.04em]">
                    Goals with no or oldest notes first
                  </h3>
                  <p className="text-[12px] text-gray-400 mb-3">
                    Assessments with approved goals — sorted by note count then last note date (stalest first)
                  </p>
                  <div className="rounded-xl border border-gray-100 overflow-hidden">
                    <table className="w-full text-sm min-w-[600px]" role="table">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Patient</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Type</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Clinician</th>
                          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Centre</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Notes</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">Last note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentlyUndocumented.map((row, i) => (
                          <UndocumentedRow key={`${row.patientName}-${row.assessmentType}-${i}`} row={row} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {data.totalApprovedGoals === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  No approved goals yet. Goal approval started 7 days ago.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

