'use client';

import { useRef, useMemo, useState } from 'react';
import type { Manager } from '@/lib/types';
import { useSlideOverPanel } from '@/hooks/useSlideOverPanel';
import { shortCentreName } from '@/lib/centreNames';

interface Props {
  managers: Manager[];
  onClose: () => void;
}

interface CentreRow {
  centreId: number | null;
  centreName: string;
  active: number;
  total: number;
}

type Urgency = 'ok' | 'warn' | 'danger' | 'never';

function lastSeenLabel(daysAgo: number | null): { label: string; urgency: Urgency } {
  if (daysAgo == null) return { label: 'Never active', urgency: 'never' };
  if (daysAgo === 0)   return { label: 'Today',        urgency: 'ok' };
  if (daysAgo === 1)   return { label: 'Yesterday',    urgency: 'ok' };
  if (daysAgo <= 6)    return { label: `${daysAgo}d ago`, urgency: 'warn' };
  return { label: `${daysAgo}d ago`, urgency: 'danger' };
}

const URGENCY_STYLES: Record<Urgency, string> = {
  ok:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  warn:   'text-orange-700 bg-orange-50 border-orange-200',
  danger: 'text-rose-700 bg-rose-50 border-rose-200',
  never:  'text-gray-500 bg-gray-50 border-gray-200',
};

export default function ActiveManagersPanel({ managers, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'centres' | 'not-active'>('centres');

  useSlideOverPanel(true, onClose, panelRef);

  const visible = managers.filter((m) => m.roleName !== 'Super Admin');

  const { centreRows, notActiveManagers, activeCount, total } = useMemo(() => {
    // Deduplicate — backend now returns one row per manager, but guard anyway
    const deduped = new Map<number, Manager>();
    for (const m of visible) {
      const existing = deduped.get(m.id);
      if (!existing || (m.lastActivityDate ?? '') > (existing.lastActivityDate ?? '')) {
        deduped.set(m.id, m);
      }
    }
    const unique = [...deduped.values()];

    const isActive = (m: Manager) => (m.coreJobDays ?? 0) > 0;

    // Build centre rows — a manager contributes to every centre they're assigned to
    const centreMap = new Map<string, CentreRow>();
    for (const m of unique) {
      const centres = m.centres?.length
        ? m.centres
        : m.centreId != null
          ? [{ centreId: m.centreId, centreName: m.centreName ?? 'Unknown' }]
          : [];

      for (const c of centres) {
        const key = String(c.centreId);
        if (!centreMap.has(key)) {
          centreMap.set(key, {
            centreId:   c.centreId,
            centreName: c.centreName,
            active:     0,
            total:      0,
          });
        }
        const row = centreMap.get(key)!;
        row.total += 1;
        if (isActive(m)) row.active += 1;
      }
    }

    // Sort: lowest engagement first
    const centreRows = [...centreMap.values()].sort((a, b) => {
      const pA = a.total > 0 ? a.active / a.total : 1;
      const pB = b.total > 0 ? b.active / b.total : 1;
      return pA - pB;
    });

    const notActiveManagers = unique
      .filter((m) => !isActive(m))
      .sort((a, b) => (b.lastActiveDaysAgo ?? 9999) - (a.lastActiveDaysAgo ?? 9999));

    const activeCount = unique.filter(isActive).length;

    return { centreRows, notActiveManagers, activeCount, total: unique.length };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePct   = total > 0 ? Math.round((activeCount / total) * 100) : 0;
  const notActive   = total - activeCount;

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
        aria-labelledby="active-managers-title"
        className="relative w-full sm:max-w-2xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">
              Drill-down
            </p>
            <h2 id="active-managers-title" className="text-base font-semibold text-gray-900">
              Active Managers Breakdown
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Managers who performed core job in selected period
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
            <div className="bg-white border border-violet-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-500 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{activeCount}</p>
                <p className="text-[11px] text-gray-500">Active this period</p>
              </div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-gray-300 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{notActive}</p>
                <p className="text-[11px] text-gray-500">Not active</p>
              </div>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-300 flex-shrink-0" />
              <div>
                <p className="text-xl font-bold text-gray-900 tabular-nums leading-tight">{total}</p>
                <p className="text-[11px] text-gray-500">Total managers</p>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-[10px] font-semibold text-gray-400 mb-1">
              <span>Active rate</span>
              <span>{activePct}% active</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${activePct}%`, backgroundColor: '#7C3AED' }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>{activeCount} active</span>
              <span>{notActive} not active</span>
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
                ? 'text-violet-700 border-b-2 border-violet-600 bg-violet-50/40'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            By Centre ({centreRows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('not-active')}
            className={[
              'flex-1 py-2.5 text-xs font-semibold transition-colors',
              tab === 'not-active'
                ? 'text-rose-700 border-b-2 border-rose-600 bg-rose-50/40'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            Not Active ({notActive})
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {tab === 'centres' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[380px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="px-4 sm:px-6 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                      Centre
                    </th>
                    <th className="px-4 py-3 text-right text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                      Active
                    </th>
                    <th className="px-4 py-3 text-right text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                      Total
                    </th>
                    <th className="px-4 sm:px-6 py-3 text-right text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                      Rate
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {centreRows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-10 text-center text-gray-400 text-sm">
                        No centre data available
                      </td>
                    </tr>
                  ) : (
                    centreRows.map((row) => {
                      const pct   = row.total > 0 ? Math.round((row.active / row.total) * 100) : 0;
                      const color = pct >= 50 ? '#7C3AED' : pct >= 20 ? '#D97706' : '#EF4444';
                      return (
                        <tr
                          key={String(row.centreId)}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                        >
                          <td
                            className="px-4 sm:px-6 py-3 font-medium text-gray-800 max-w-[200px] truncate"
                            title={row.centreName}
                          >
                            {shortCentreName(row.centreName)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-bold" style={{ color: '#7C3AED' }}>
                            {row.active > 0 ? row.active : <span className="text-gray-300 font-normal">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                            {row.total}
                          </td>
                          <td
                            className="px-4 sm:px-6 py-3 text-right tabular-nums text-sm font-semibold"
                            style={{ color }}
                          >
                            {pct}%
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'not-active' && (
            <div className="overflow-x-auto">
              {notActiveManagers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-violet-400" />
                  <p className="text-sm font-medium text-gray-700">All managers active</p>
                  <p className="text-[12px] text-gray-500">
                    Every manager performed their core job in the selected period.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm min-w-[440px]">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="px-4 sm:px-6 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                        Manager
                      </th>
                      <th className="px-4 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                        Centre
                      </th>
                      <th className="px-4 py-3 text-left text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                        Role
                      </th>
                      <th className="px-4 sm:px-6 py-3 text-right text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                        Last Active
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {notActiveManagers.map((m) => {
                      const { label, urgency } = lastSeenLabel(m.lastActiveDaysAgo ?? null);
                      const primaryCentre = m.centres?.[0]?.centreName ?? m.centreName;
                      const extraCentres  = (m.centres?.length ?? 0) > 1
                        ? ` +${(m.centres?.length ?? 1) - 1}`
                        : '';
                      return (
                        <tr
                          key={m.id}
                          className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors"
                        >
                          <td className="px-4 sm:px-6 py-3 font-medium text-gray-800">
                            {m.firstName} {m.lastName}
                          </td>
                          <td
                            className="px-4 py-3 text-gray-500 max-w-[140px] truncate text-xs"
                            title={m.centres?.map((c) => c.centreName).join(', ') ?? m.centreName ?? ''}
                          >
                            {shortCentreName(primaryCentre ?? null)}
                            {extraCentres && (
                              <span className="text-blue-500 ml-1">{extraCentres}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {m.roleName ?? '—'}
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
                <span className="w-2.5 h-1.5 rounded-full bg-violet-600 inline-block" />
                ≥50% active
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                20–49% active
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                &lt;20% active
              </span>
              <span className="ml-auto text-gray-400">sorted by lowest engagement first</span>
            </div>
          </div>
        )}
        {tab === 'not-active' && notActiveManagers.length > 0 && (
          <div className="px-4 sm:px-6 py-3 border-t border-gray-100 flex-shrink-0">
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.warn}`}>
                1–6d ago — check in
              </span>
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.danger}`}>
                7d+ — follow up
              </span>
              <span className={`px-2 py-0.5 rounded-md border font-semibold ${URGENCY_STYLES.never}`}>
                Never — verify access
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
