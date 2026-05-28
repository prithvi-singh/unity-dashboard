'use client';

import { useEffect, useState } from 'react';
import type { IdleCentreDetail } from '@/lib/types';

interface Props {
  open: boolean;
  idleCentres: IdleCentreDetail[];
  dateFrom?: string;
  dateTo?: string;
  onClose: () => void;
}

function formatDateLabel(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatLastActivity(iso: string | null): { primary: string; muted: string } {
  if (!iso) return { primary: 'Never recorded activity', muted: '' };

  const date = new Date(iso);
  if (isNaN(date.getTime())) return { primary: 'Unknown', muted: '' };

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const formatted = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  let relative: string;
  if (diffDays === 0) relative = 'today';
  else if (diffDays === 1) relative = '1 day ago';
  else if (diffDays < 30) relative = `${diffDays} days ago`;
  else if (diffDays < 60) relative = '~1 month ago';
  else if (diffDays < 365) relative = `~${Math.round(diffDays / 30)} months ago`;
  else if (diffDays < 730) relative = '~1 year ago';
  else relative = `~${Math.round(diffDays / 365)} years ago`;

  return { primary: formatted, muted: relative };
}

export default function IdleCentresDrawer({ open, idleCentres, dateFrom, dateTo, onClose }: Props) {
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

  if (!open) return null;

  const dateRangeLabel = [formatDateLabel(dateFrom), formatDateLabel(dateTo)]
    .filter(Boolean)
    .join(' – ') || 'this period';

  const q = search.trim().toLowerCase();
  const filtered = q
    ? idleCentres.filter((c) => c.name.toLowerCase().includes(q))
    : idleCentres;

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
        aria-labelledby="idle-centres-title"
        className="relative w-full sm:max-w-[640px] h-[92dvh] sm:h-full bg-white shadow-2xl flex flex-col rounded-t-2xl sm:rounded-none border-l border-gray-200/60"
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-start justify-between gap-4 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400 mb-1">Drill-down</p>
            <h2 id="idle-centres-title" className="text-[18px] font-medium text-gray-900 leading-tight">
              Idle centres — {dateRangeLabel}
            </h2>
            <p className="text-[13px] text-gray-500 mt-0.5 leading-snug">
              These centres had no recorded clinical activity in Unity during this period.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-xs font-semibold text-gray-700 ring-1 ring-gray-200">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                {idleCentres.length} idle {idleCentres.length === 1 ? 'centre' : 'centres'}
              </span>
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
        {idleCentres.length > 5 && (
          <div className="px-4 sm:px-6 py-3 border-b border-gray-100 flex-shrink-0">
            <label className="sr-only" htmlFor="idle-centres-search">Search idle centres</label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
              <input
                id="idle-centres-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by centre name…"
                className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:border-blue-300"
              />
            </div>
          </div>
        )}

        {/* Column headers */}
        {filtered.length > 0 && (
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center justify-between px-4 sm:px-6 py-2">
              <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">Centre</span>
              <span className="text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em]">Last activity</span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {filtered.length > 0 ? (
            <ul role="list" aria-label="Idle centre list">
              {filtered.map((centre) => {
                const { primary, muted } = formatLastActivity(centre.lastActivityDate);
                return (
                  <li
                    key={centre.name}
                    className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-gray-50 hover:bg-gray-50/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" aria-hidden="true" />
                      <span className="text-sm font-medium text-gray-700 truncate" title={centre.name}>
                        {centre.name}
                      </span>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-xs text-gray-500 tabular-nums">{primary}</p>
                      {muted && (
                        <p className="text-[11px] text-gray-400">{muted}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
              {q ? (
                <>
                  <p className="text-sm font-medium text-gray-700">No matches</p>
                  <p className="text-[12px] text-gray-500">Try a different search term.</p>
                </>
              ) : (
                <>
                  <svg className="w-8 h-8 text-emerald-300 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm font-medium text-gray-700">All centres active</p>
                  <p className="text-[12px] text-gray-500">Every centre had at least one action this period.</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="flex-shrink-0 px-4 sm:px-6 py-3 border-t border-gray-100 bg-gray-50/50">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            A centre is idle when it has zero rows in PatientAuditLog for the period after excluding test patients, test users, and deleted centres. Last activity shown is the most recent record ever, regardless of the selected period.
          </p>
        </div>
      </div>
    </div>
  );
}
