'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CentreBreakdown } from '@/lib/types';

interface Props {
  open: boolean;
  byCentre: CentreBreakdown[];
  onClose: () => void;
}

function isActive(c: CentreBreakdown) {
  return c.cases + c.assessments + c.reportsApproved > 0;
}

function totalActivity(c: CentreBreakdown) {
  return c.cases + c.assessments + c.reportsApproved;
}

/** True when the centre has assessments done but no PDFs approved yet — needs manager action */
function needsPdfAttention(c: CentreBreakdown) {
  return c.assessments > 0 && c.reportsApproved === 0;
}

function StatChip({
  value,
  colorCls,
  warnCls,
  warn,
  width,
}: {
  value: number;
  colorCls: string;
  warnCls?: string;
  warn?: boolean;
  width: string;
}) {
  const cls = warn && warnCls ? warnCls : colorCls;
  return (
    <span
      className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ring-1 ring-inset flex-shrink-0 ${cls} ${width}`}
    >
      {warn && (
        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      )}
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export default function ActiveCentresPanel({ open, byCentre, onClose }: Props) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const { active, idle } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? byCentre.filter((c) => c.centreName.toLowerCase().includes(q))
      : byCentre;

    const active = filtered
      .filter(isActive)
      .sort((a, b) => totalActivity(b) - totalActivity(a));

    const idle = filtered
      .filter((c) => !isActive(c))
      .sort((a, b) => a.centreName.localeCompare(b.centreName));

    return { active, idle };
  }, [byCentre, search]);

  if (!open) return null;

  const totalCentres    = byCentre.length;
  const activeCount     = byCentre.filter(isActive).length;
  const attentionCount  = byCentre.filter(needsPdfAttention).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-[1px]"
        aria-label="Close panel"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-centres-title"
        className="relative w-full sm:max-w-3xl h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] mb-1">Drill-down</p>
            <h2 id="active-centres-title" className="text-base font-semibold text-gray-900">
              Active Centres
            </h2>
            <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="font-semibold text-emerald-700">{activeCount}</span> active
              </span>
              <span className="text-gray-300">·</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <span className="w-2 h-2 rounded-full bg-gray-300" />
                <span className="font-semibold text-gray-600">{totalCentres - activeCount}</span> idle
              </span>
              <span className="text-gray-300">·</span>
              <span className="text-[12px] text-gray-500">{totalCentres} total</span>
              {attentionCount > 0 && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    </svg>
                    {attentionCount} need PDFs
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex-shrink-0">
          <label className="sr-only" htmlFor="active-centres-search">Search centres</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
            </svg>
            <input
              id="active-centres-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by centre name…"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {/* Column headers */}
          {(active.length > 0 || idle.length > 0) && (
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100">
              <div className="flex items-center justify-between gap-4 px-6 py-2">
                <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">Centre</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.08em] w-[72px] text-center hidden sm:block">Cases Added</span>
                  <span className="text-[10px] font-bold text-violet-400 uppercase tracking-[0.08em] w-[108px] text-center hidden sm:block">Assessments Done</span>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.08em] w-[88px] text-center hidden sm:block">PDFs Approved</span>
                </div>
              </div>
            </div>
          )}

          {/* Active centres */}
          {active.length > 0 && (
            <section>
              <div className="px-6 py-2 bg-emerald-50/60 border-b border-emerald-100">
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                  Active — {active.length}
                </span>
              </div>
              {active.map((c) => {
                const warn = needsPdfAttention(c);
                return (
                  <div
                    key={c.centreId}
                    className={`flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-50 transition-colors ${warn ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-gray-50/60'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-sm text-gray-900 truncate block" title={c.centreName}>
                        {c.centreName}
                      </span>
                      {warn && (
                        <span className="text-[11px] text-amber-600 font-medium">
                          Assessments done — no PDFs approved yet
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatChip
                        value={c.cases}
                        colorCls="bg-blue-50 text-blue-700 ring-blue-200"
                        width="w-[72px]"
                      />
                      <StatChip
                        value={c.assessments}
                        colorCls="bg-violet-50 text-violet-700 ring-violet-200"
                        width="w-[108px]"
                      />
                      <StatChip
                        value={c.reportsApproved}
                        colorCls="bg-emerald-50 text-emerald-700 ring-emerald-200"
                        warnCls="bg-amber-50 text-amber-700 ring-amber-300"
                        warn={warn}
                        width="w-[88px]"
                      />
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Idle centres */}
          {idle.length > 0 && (
            <section>
              <div className="px-6 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">
                  Idle — {idle.length}
                </span>
              </div>
              {idle.map((c) => (
                <div
                  key={c.centreId}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-gray-50 opacity-50"
                >
                  <span className="text-sm text-gray-500 truncate" title={c.centreName}>
                    {c.centreName}
                  </span>
                  <span className="text-xs text-gray-300 tabular-nums">No activity</span>
                </div>
              ))}
            </section>
          )}

          {active.length === 0 && idle.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
              <p className="text-sm font-medium text-gray-700">No centres found</p>
              <p className="text-[12px] text-gray-500">Try a different search.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
