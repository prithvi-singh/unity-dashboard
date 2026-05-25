'use client';

import type { CentreBreakdown } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';

interface Props {
  centres: CentreBreakdown[];
  loading: boolean;
}

// Stages ordered from furthest-along → least done so the bar reads left=complete, right=in-progress
const STAGES = [
  { key: 'shared'  as const, label: 'Shared',    bg: 'bg-indigo-500', dot: 'bg-indigo-400',  text: 'text-indigo-600' },
  { key: 'pdf'     as const, label: 'PDF done',  bg: 'bg-blue-500',   dot: 'bg-blue-400',    text: 'text-blue-600'   },
  { key: 'scored'  as const, label: 'Scored',    bg: 'bg-teal-400',   dot: 'bg-teal-400',    text: 'text-teal-600'   },
  { key: 'pending' as const, label: 'Pending',   bg: 'bg-gray-200',   dot: 'bg-gray-300',    text: 'text-gray-500'   },
] as const;

type SegKey = (typeof STAGES)[number]['key'];

interface Segments {
  total: number;
  shared:  number;
  pdf:     number;
  scored:  number;
  pending: number;
}

function getSegments(row: CentreBreakdown): Segments {
  const total  = row.snapAssigned ?? 0;
  const scored = Math.min(row.snapScored  ?? 0, total);
  const pdf    = Math.min(row.snapPdf     ?? 0, scored);
  const shared = Math.min(row.snapShared  ?? 0, pdf);
  return {
    total,
    shared,
    pdf:     Math.max(0, pdf - shared),
    scored:  Math.max(0, scored - pdf),
    pending: Math.max(0, total - scored),
  };
}

function pdfCompletionRate(row: CentreBreakdown): number | null {
  const total = row.snapAssigned ?? 0;
  const pdf   = row.snapPdf      ?? 0;
  if (total === 0) return null;
  return Math.round((pdf / total) * 100);
}

export default function PipelineByCentre({ centres, loading }: Props) {
  const sorted = [...centres]
    .filter((c) => (c.snapAssigned ?? 0) > 0)
    .sort((a, b) => (b.snapAssigned ?? 0) - (a.snapAssigned ?? 0));

  if (loading && !centres.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="h-5 w-48 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-2">
              <div className="flex justify-between">
                <div className="h-3.5 w-36 bg-gray-100 rounded" />
                <div className="h-3.5 w-12 bg-gray-50 rounded" />
              </div>
              <div className="h-6 bg-gray-50 rounded-lg" style={{ opacity: 1 - i * 0.15 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-[15px] font-bold text-gray-900 mb-2">Pipeline by Centre</h2>
        <p className="text-sm text-gray-400">No open caseload to display.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-[15px] font-bold text-gray-900 tracking-[-0.01em]">Pipeline by Centre</h2>
          <p className="text-[12px] text-gray-400 mt-0.5">
            Current open caseload per centre · live snapshot, not date-filtered
          </p>
        </div>
        {/* Legend */}
        <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-[11px] flex-shrink-0">
          {STAGES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-gray-500 whitespace-nowrap">
              <span className={`w-2 h-2 rounded-sm ${s.dot}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-4">
        {sorted.map((row) => {
          const segs = getSegments(row);
          const completionRate = pdfCompletionRate(row);

          return (
            <div key={row.centreId}>
              {/* Centre name + metadata */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] font-semibold text-gray-800 truncate max-w-[260px]" title={row.centreName}>
                  {shortCentreName(row.centreName)}
                </span>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  {completionRate !== null && (
                    <span className={`text-[11px] font-semibold tabular-nums ${
                      completionRate >= 75 ? 'text-emerald-600'
                      : completionRate >= 40 ? 'text-amber-500'
                      : 'text-rose-500'
                    }`}>
                      {completionRate}% PDF
                    </span>
                  )}
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums">
                    {segs.total} open
                  </span>
                </div>
              </div>

              {/* Segmented progress bar */}
              <div
                className="flex h-7 rounded-lg overflow-hidden gap-px bg-gray-100"
                role="img"
                aria-label={`${row.centreName}: ${segs.shared} shared, ${segs.pdf} PDF only, ${segs.scored} scored, ${segs.pending} pending`}
              >
                {STAGES.map((s) => {
                  const count = segs[s.key as SegKey];
                  const pct   = segs.total > 0 ? (count / segs.total) * 100 : 0;
                  if (pct === 0) return null;
                  return (
                    <div
                      key={s.key}
                      className={`${s.bg} flex items-center justify-center transition-all duration-500 flex-shrink-0`}
                      style={{ width: `${pct}%` }}
                      title={`${s.label}: ${count}`}
                    >
                      {pct >= 10 && (
                        <span className={`text-[11px] font-bold tabular-nums select-none ${s.key === 'pending' ? 'text-gray-500' : 'text-white'}`}>
                          {count}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Stage counts below bar for narrow segments */}
              <div className="flex items-center gap-3 mt-1">
                {STAGES.map((s) => {
                  const count = segs[s.key as SegKey];
                  const pct   = segs.total > 0 ? (count / segs.total) * 100 : 0;
                  if (count === 0) return null;
                  return (
                    <span key={s.key} className={`text-[10px] tabular-nums font-medium ${pct < 10 ? s.text : 'text-gray-300'}`}>
                      {pct < 10 ? `${count} ${s.label.toLowerCase()}` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer note */}
      <p className="mt-5 pt-4 border-t border-gray-50 text-[11px] text-gray-400">
        Bar shows proportion of work at each stage · hover a segment for exact count · sorted by open caseload
      </p>
    </div>
  );
}
