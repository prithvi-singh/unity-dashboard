'use client';

import { useRef, useMemo, useState } from 'react';
import type { Clinician } from '@/lib/types';
import { isInactive } from '@/lib/roleStats';
import { useSlideOverPanel } from '@/hooks/useSlideOverPanel';

interface Props {
  clinicians: Clinician[];
  onClose: () => void;
}

interface CentreRow {
  centreId: number | null;
  centreName: string;
  active: number;
  total: number;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

type Urgency = 'ok' | 'warn' | 'danger' | 'never';

function lastSeenLabel(iso: string | null): { label: string; urgency: Urgency } {
  const days = daysSince(iso);
  if (days === null) return { label: 'Never seen', urgency: 'never' };
  if (days === 0) return { label: 'Today', urgency: 'ok' };
  if (days === 1) return { label: 'Yesterday', urgency: 'ok' };
  if (days <= 6) return { label: `${days}d ago`, urgency: 'warn' };
  return { label: `${days}d ago`, urgency: 'danger' };
}

const URGENCY_STYLES: Record<Urgency, string> = {
  ok: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  warn: 'text-orange-700 bg-orange-50 border-orange-200',
  danger: 'text-rose-700 bg-rose-50 border-rose-200',
  never: 'text-gray-500 bg-gray-50 border-gray-200',
};

function MiniBar({ pct, color = '#1D9E75' }: { pct: number; color?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] font-bold tabular-nums text-gray-600 w-8 text-right">
        {pct}%
      </span>
    </div>
  );
}

export default function ActiveStaffPanel({ clinicians, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'centres' | 'idle'>('centres');

  useSlideOverPanel(true, onClose, panelRef);

  const { centreRows, idleClinicians, activeCount, total } = useMemo(() => {
    const deduped = new Map<number, Clinician>();
    for (const c of clinicians) {
      const existing = deduped.get(c.id);
      if (!existing || (c.lastActivityDate ?? '') > (existing.lastActivityDate ?? '')) {
        deduped.set(c.id, c);
      }
    }
    const unique = [...deduped.values()];

    const centreMap = new Map<string, CentreRow>();
    for (const c of unique) {
      const key = String(c.centreId ?? 'none');
      if (!centreMap.has(key)) {
        centreMap.set(key, {
          centreId: c.centreId,
          centreName: c.centreName ?? 'No centre',
          active: 0,
          total: 0,
        });
      }
      const row = centreMap.get(key)!;
      row.total += 1;
      if (!isInactive(c.lastActivityDate)) row.active += 1;
    }

    const centreRows = [...centreMap.values()].sort((a, b) => {
      const pctA = a.total > 0 ? a.active / a.total : 1;
      const pctB = b.total > 0 ? b.active / b.total : 1;
      return pctA - pctB;
    });

    const idleClinicians = unique
      .filter((c) => isInactive(c.lastActivityDate))
      .sort((a, b) => {
        const da = daysSince(a.lastActivityDate) ?? 9999;
        const db = daysSince(b.lastActivityDate) ?? 9999;
        return db - da;
      });

    const activeCount = unique.filter((c) => !isInactive(c.lastActivityDate)).length;

    return { centreRows, idleClinicians, activeCount, total: unique.length };
  }, [clinicians]);

  const activePct = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const idleCount = total - activeCount;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close panel"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-staff-title"
        className="relative w-full sm:max-w-2xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em] mb-1">
              Drill-down
            </p>
            <h2 id="active-staff-title" className="text-base font-semibold text-gray-900">
              Active Staff Breakdown
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Clinicians active in the last 7 days
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary bar */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 bg-gray-50/60 flex-shrink-0">
          <div className="flex flex-wrap gap-3 mb-3">
            {/* Active */}
            <div className="bg-white border border-teal-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{activeCount}</p>
                <p className="text-[11px] text-gray-500">Active (last 7d)</p>
              </div>
            </div>
            {/* Idle */}
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{idleCount}</p>
                <p className="text-[11px] text-gray-500">Not engaged</p>
              </div>
            </div>
            {/* Total */}
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-300 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{total}</p>
                <p className="text-[11px] text-gray-500">Total clinicians</p>
              </div>
            </div>
          </div>

          {/* Full-width engagement bar */}
          <div>
            <div className="flex justify-between text-[10px] font-semibold text-gray-400 mb-1">
              <span>Engagement</span>
              <span>{activePct}% active</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${activePct}%`, backgroundColor: '#1D9E75' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>{activeCount} engaged</span>
              <span>{idleCount} idle</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab('centres')}
            className={[
              'flex-1 py-2.5 text-xs font-semibold transition-colors',
              tab === 'centres'
                ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50/40'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            By Centre ({centreRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('idle')}
            className={[
              'flex-1 py-2.5 text-xs font-semibold transition-colors',
              tab === 'idle'
                ? 'text-rose-700 border-b-2 border-rose-600 bg-rose-50/40'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            Not Engaged ({idleCount})
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {tab === 'centres' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[380px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="px-4 sm:px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                      Centre
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                      Active
                    </th>
                    <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                      Total
                    </th>
                    <th className="px-4 sm:px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] w-40">
                      Engagement
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {centreRows.map((row, i) => {
                    const pct = row.total > 0 ? Math.round((row.active / row.total) * 100) : 0;
                    const color =
                      pct >= 50 ? '#1D9E75' : pct >= 20 ? '#F59E0B' : '#F43F5E';
                    return (
                      <tr
                        key={i}
                        className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                      >
                        <td
                          className="px-4 sm:px-6 py-3 font-medium text-gray-800 max-w-[180px] truncate"
                          title={row.centreName}
                        >
                          {row.centreName}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-bold text-teal-700">
                          {row.active > 0 ? row.active : <span className="text-gray-300 font-normal">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                          {row.total}
                        </td>
                        <td className="px-4 sm:px-6 py-3">
                          <MiniBar pct={pct} color={color} />
                        </td>
                      </tr>
                    );
                  })}
                  {centreRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-gray-400 text-sm">
                        No centre data available
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'idle' && (
            <div className="overflow-x-auto">
              {idleClinicians.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <p className="text-sm font-medium text-gray-700">All clinicians engaged</p>
                  <p className="text-xs text-gray-400">Every clinician has been active in the last 7 days.</p>
                </div>
              ) : (
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="px-4 sm:px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                        Clinician
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                        Centre
                      </th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                        Caseload
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                        Last seen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {idleClinicians.map((c) => {
                      const { label, urgency } = lastSeenLabel(c.lastActivityDate);
                      return (
                        <tr
                          key={c.id}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                        >
                          <td className="px-4 sm:px-6 py-3 font-medium text-gray-800">
                            {c.firstName} {c.lastName}
                          </td>
                          <td
                            className="px-4 py-3 text-gray-500 max-w-[140px] truncate text-xs"
                            title={c.centreName ?? undefined}
                          >
                            {c.centreName ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {c.activeCaseload > 0 ? (
                              <span className="font-semibold text-gray-800">{c.activeCaseload}</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right">
                            <span
                              className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md border ${URGENCY_STYLES[urgency]}`}
                            >
                              {label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Footer legend */}
        {tab === 'centres' && (
          <div className="px-4 sm:px-6 py-3 border-t border-gray-100 flex-shrink-0">
            <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 rounded-full bg-[#1D9E75] inline-block" />
                ≥50% engaged
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                20–49% engaged
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                &lt;20% engaged
              </span>
              <span className="ml-auto text-gray-400">sorted by lowest engagement first</span>
            </div>
          </div>
        )}
        {tab === 'idle' && idleClinicians.length > 0 && (
          <div className="px-4 sm:px-6 py-3 border-t border-gray-100 flex-shrink-0">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.warn}`}>
                2–6d ago — check in
              </span>
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.danger}`}>
                7d+ — escalate / reassign
              </span>
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.never}`}>
                Never seen — verify access
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
