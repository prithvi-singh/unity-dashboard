'use client';

import { useState } from 'react';
import type { PipelineStuckCase } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  cases: PipelineStuckCase[];
  loading: boolean;
  highlightStage?: string | null;
}

const ASSESSMENT_BADGE: Record<string, string> = {
  SPM:   'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60',
  DP3:   'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60',
  REELS: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100/60',
  ISAA:  'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200/60',
};

function AssessmentBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-gray-300 text-xs">—</span>;
  const cls = ASSESSMENT_BADGE[type] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${cls}`}>
      {type}
    </span>
  );
}

const STAGE_COLORS: Record<string, string> = {
  'Assessment In Progress':   'bg-sky-100 text-sky-700',
  'Report Drafted':           'bg-teal-100 text-teal-700',
  'Report Pending Approval':  'bg-amber-100 text-amber-700',
  'Goals Set':                'bg-indigo-100 text-indigo-700',
  'Goals Pending Approval':   'bg-orange-100 text-orange-700',
};

function DaysBadge({ days }: { days: number }) {
  const severe = days > 14;
  return (
    <span className={[
      'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black',
      severe
        ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
        : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
    ].join(' ')}>
      {severe && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0 animate-pulse" />}
      {days}d
    </span>
  );
}

function StagePill({ stage }: { stage: string }) {
  const color = STAGE_COLORS[stage] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {stage}
    </span>
  );
}

export default function PipelineStuckCases({ cases, loading, highlightStage }: Props) {
  const [hover, setHover] = useState<number | null>(null);

  const filtered = highlightStage
    ? cases.filter((c) => c.currentStage === highlightStage)
    : cases;

  if (loading && !cases.length) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="h-4 w-40 bg-gray-100 rounded animate-pulse mb-5" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              <h2 className="text-[15px] font-bold text-gray-900 tracking-[-0.01em]">
                Stuck Cases
              </h2>
              {filtered.length > 0 && (
                <span className="px-2 py-0.5 bg-rose-50 text-rose-600 text-[11px] font-bold rounded-full">
                  {filtered.length}
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-400 mt-0.5">
              No movement in 7+ days.{' '}
              <span className="text-amber-600 font-semibold">7–14d: nudge clinician.</span>{' '}
              <span className="text-rose-600 font-semibold">&gt;14d: escalate.</span>
            </p>
          </div>
          {highlightStage && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
              Filtered: {highlightStage}
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 py-6">
            <span className="text-lg">✓</span>
            <p className="text-sm text-emerald-600 font-semibold">
              {highlightStage
                ? `No stuck cases at "${highlightStage}" stage.`
                : 'No cases stuck for 7+ days. Good work!'}
            </p>
          </div>
        </div>
      ) : (
        <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
          <table className="w-full text-sm" role="table" aria-label="Stuck cases requiring attention">
            <thead>
              <tr className="border-t border-gray-50">
                <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Patient</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Centre</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Assessment</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Current Stage</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Days Stuck</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Clinician</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-[0.07em]">Manager</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const isHovered = hover === i;
                const isCritical = c.daysStuck > 14;
                return (
                  <tr
                    key={`${c.patientId}-${i}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    className={[
                      'border-t border-gray-50 transition-colors duration-100',
                      isHovered ? 'bg-gray-50/80' : '',
                      isCritical && !isHovered ? 'bg-rose-50/40' : '',
                    ].join(' ')}
                  >
                    <td className="px-6 py-3.5">
                      <div className="font-semibold text-gray-800 text-[13px]">
                        {c.firstName} {c.lastName}
                      </div>
                      {c.patientDisplayId && (
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5">{c.patientDisplayId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-gray-500 max-w-[140px]">
                      <span className="truncate block">{c.centreName}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <AssessmentBadge type={c.assessmentType} />
                    </td>
                    <td className="px-4 py-3.5">
                      <StagePill stage={c.currentStage} />
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <DaysBadge days={c.daysStuck} />
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-gray-600">
                      {c.clinicianName ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3.5 text-[12px] text-gray-600">
                      {c.managerName ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </div>
  );
}
