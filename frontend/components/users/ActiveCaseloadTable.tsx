'use client';

import { useMemo } from 'react';
import type { UserProfileActiveCase, PipelineState } from '@/lib/types';
import { shortCentreName } from '@/lib/centreNames';
import ScrollRegion from '@/components/shared/ScrollRegion';

interface Props {
  cases: UserProfileActiveCase[];
  loading: boolean;
}

// Pipeline state display config
const PIPELINE_STATE_CONFIG: Record<PipelineState, { label: string; badge: string; stuckThresholdDays: number }> = {
  not_started:              { label: 'Not started',        badge: 'bg-gray-100 text-gray-500',           stuckThresholdDays: 14 },
  in_progress:              { label: 'Scoring',            badge: 'bg-blue-50 text-blue-700',            stuckThresholdDays: 14 },
  report_not_drafted:       { label: 'Report pending',     badge: 'bg-amber-50 text-amber-700',          stuckThresholdDays: 7  },
  report_pending_approval:  { label: 'Awaiting approval',  badge: 'bg-orange-50 text-orange-700',        stuckThresholdDays: 5  },
  goals_not_added:          { label: 'Goals to add',       badge: 'bg-rose-50 text-rose-700',            stuckThresholdDays: 7  },
  goals_pending_approval:   { label: 'Goals approval',     badge: 'bg-purple-50 text-purple-700',        stuckThresholdDays: 5  },
  completed:                { label: 'Completed',          badge: 'bg-emerald-50 text-emerald-700',      stuckThresholdDays: 999 },
  excluded:                 { label: 'Excluded',           badge: 'bg-gray-50 text-gray-400',            stuckThresholdDays: 999 },
};

// Sort order: stuck states (scoring / not_started) first, then by days desc
const PIPELINE_STATE_SORT_ORDER: Record<PipelineState, number> = {
  not_started:              0,
  in_progress:              1,
  report_not_drafted:       2,
  report_pending_approval:  3,
  goals_not_added:          4,
  goals_pending_approval:   5,
  completed:                6,
  excluded:                 7,
};

function stalenessClass(days: number): string {
  if (days <= 7)  return 'text-green-600';
  if (days <= 14) return 'text-amber-500';
  if (days <= 30) return 'text-orange-500 font-medium';
  return 'text-rose-600 font-bold';
}

function isStuck(state: PipelineState, days: number): boolean {
  const cfg = PIPELINE_STATE_CONFIG[state];
  return days > cfg.stuckThresholdDays;
}

export default function ActiveCaseloadTable({ cases, loading }: Props) {
  // Sort: stuck states first (not_started/in_progress), then pipeline order, then days desc within group
  const sorted = useMemo(() => {
    if (loading) return cases;
    return [...cases].sort((a, b) => {
      const aOrder = PIPELINE_STATE_SORT_ORDER[a.pipelineState] ?? 99;
      const bOrder = PIPELINE_STATE_SORT_ORDER[b.pipelineState] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.daysSinceAssigned - a.daysSinceAssigned;
    });
  }, [cases, loading]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-medium text-gray-900">Active Caseload</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">
            Stuck cases first · red = overdue threshold exceeded
          </p>
        </div>
        {!loading && (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {cases.length} case{cases.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <ScrollRegion maxHeightClass="max-h-[480px]" label="table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-[11px] font-medium text-gray-500 uppercase tracking-[0.04em] bg-gray-50/60">
              <th className="px-6 py-3 text-left">Patient</th>
              <th className="px-4 py-3 text-left">Assessment</th>
              <th className="px-4 py-3 text-left">State</th>
              <th className="px-4 py-3 text-left">Centre</th>
              <th className="px-4 py-3 text-right">Days Open</th>
              <th className="px-4 py-3 text-left">Last Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-10 text-center text-gray-400">
                  No active cases
                </td>
              </tr>
            ) : (
              sorted.map((c) => {
                const cfg = PIPELINE_STATE_CONFIG[c.pipelineState] ?? PIPELINE_STATE_CONFIG.in_progress;
                const stuck = isStuck(c.pipelineState, c.daysSinceAssigned);
                return (
                  <tr
                    key={`${c.patientId}-${c.assessmentType}`}
                    className={`hover:bg-gray-50/70 transition-colors ${stuck ? 'bg-rose-50/20' : ''}`}
                  >
                    <td className="px-6 py-3.5">
                      {c.patientName ? (
                        <div>
                          <div className="font-medium text-gray-800 text-sm">{c.patientName}</div>
                          <div className="text-xs text-gray-400 mt-0.5">#{c.patientId}</div>
                        </div>
                      ) : (
                        <span className="font-medium text-gray-700 tabular-nums">#{c.patientId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {c.assessmentType ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">
                          {c.assessmentType}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        {stuck && (
                          <span className="text-[10px] font-semibold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-full">
                            overdue
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500 text-xs" title={c.centreName ?? ''}>
                      {shortCentreName(c.centreName)}
                    </td>
                    <td className={`px-4 py-3.5 text-right tabular-nums text-sm ${stalenessClass(c.daysSinceAssigned)}`}>
                      {c.daysSinceAssigned}d
                    </td>
                    <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                      {c.lastAction
                        ? new Date(c.lastAction).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                        : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
