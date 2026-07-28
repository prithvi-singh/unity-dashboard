
'use client';

// FunnelChart — horizontal stage bars for lead-to-completion funnel.
// No donuts, no gauges, no decorative icons — horizontal bars only.
// Design system state colours: Green #1D9E75, Amber #BA7517, Red #A32D2D, Grey #888780.

import { useState } from 'react';
import { useFunnelSummary } from '@/lib/zoho/useFunnel';
import type { FunnelCohort } from '@/lib/zoho/funnel';
import { KpiTooltip } from '@/components/shared/KpiTooltip';

const MONTH_OPTIONS = [3, 6, 12] as const;

const STAGES: { key: keyof Omit<FunnelCohort, 'month'>; label: string }[] = [
  { key: 'leads', label: 'Leads' },
  { key: 'converted', label: 'Converted' },
  { key: 'registeredInUnity', label: 'Registered in Unity' },
  { key: 'assessmentStarted', label: 'Assessment Started' },
  { key: 'reportOrGoal', label: 'Report / Goal' },
  { key: 'completed', label: 'Completed' },
];

function stageBarColour(index: number): string {
  switch (index) {
    case 0: return '#888780'; // Leads — neutral
    case 1: return '#1D9E75'; // Converted — positive
    case 2: return '#BA7517'; // Registered in Unity — key adoption metric
    case 3: return '#1D9E75'; // Assessment Started
    case 4: return '#1D9E75'; // Report / Goal
    case 5: return '#1D9E75'; // Completed
    default: return '#888780';
  }
}

function formatDropOff(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = Math.round(((previous - current) / previous) * 100);
  if (pct <= 0) return null;
  return `−${pct}%`;
}

function CohortRow({ cohort }: { cohort: FunnelCohort }) {
  const max = cohort.leads || 1;

  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-[11px] uppercase tracking-[0.03em] text-gray-500 mb-2">
        {cohort.month}
      </p>

      <div className="space-y-1.5">
        {STAGES.map((stage, i) => {
          const count = cohort[stage.key] as number;
          const pct = max > 0 ? (count / max) * 100 : 0;
          const prevKey = i > 0 ? STAGES[i - 1].key : null;
          const prevCount = prevKey ? (cohort[prevKey] as number) : null;
          const dropOff = prevCount != null ? formatDropOff(count, prevCount) : null;
          const colour = stageBarColour(i);

          return (
            <div key={stage.key} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-400 w-[120px] flex-shrink-0 text-right leading-none">
                {stage.label}
              </span>
              <div className="flex-1 min-w-0 flex items-center gap-1.5">
                <div
                  className="h-[18px] rounded-sm transition-all duration-300"
                  style={{
                    width: `${Math.max(pct, 1)}%`,
                    backgroundColor: colour,
                    minWidth: count > 0 ? 4 : 0,
                  }}
                />
                <span className="text-[12px] tabular-nums text-gray-700 flex-shrink-0">
                  {count.toLocaleString('en-IN')}
                </span>
                {dropOff && (
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{dropOff}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0 animate-pulse">
      <div className="h-3 w-20 bg-gray-200 rounded mb-2" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <div className="h-3 w-[120px] bg-gray-100 rounded flex-shrink-0" />
          <div className="flex-1 h-[18px] bg-gray-100 rounded" />
          <div className="h-3 w-10 bg-gray-100 rounded flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

function formatAsOf(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

interface Props {
  months?: number;
  onMonthsChange?: (months: number) => void;
}

export default function FunnelChart({ months: monthsProp, onMonthsChange }: Props) {
  const [internalMonths, setInternalMonths] = useState<number>(6);
  const months = monthsProp ?? internalMonths;
  const setMonths = onMonthsChange ?? setInternalMonths;
  const { data, loading, error, warming } = useFunnelSummary(months);

  const cohorts = data?.cohorts ?? [];
  // Most recent month on top
  const sorted = [...cohorts].reverse();

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[15px] font-medium text-gray-900">Lead Funnel</h2>
          <KpiTooltip
            title="About Unity registration"
            description="Unity is a new system: Registered in Unity naturally ramps up for recent cohorts as centres adopt it, and is expected to be low for cohorts before ~May 2026 (pre-rollout, not a current gap)."
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Month selector — button group */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {MONTH_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  months === m
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                aria-pressed={months === m}
              >
                {m}m
              </button>
            ))}
          </div>

          {data?.asOf && (
            <span className="text-[11px] text-gray-400">
              as of {formatAsOf(data.asOf)}
            </span>
          )}
        </div>
      </div>

      {/* 503 warming */}
      {warming && (
        <div className="px-5 py-4 text-center text-[13px] text-amber-700 bg-amber-50 border-b border-amber-100">
          Zoho data still syncing — funnel data will appear shortly.
        </div>
      )}

      {/* Error */}
      {error && !data && (
        <div className="px-5 py-8 text-center text-[13px] text-gray-500">
          Funnel data unavailable.
        </div>
      )}

      {/* Body */}
      <div className="px-5 py-2">
        {/* Skeleton */}
        {loading && !data && (
          <div className="py-2">
            {Array.from({ length: months }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        )}

        {/* Empty / no cohorts */}
        {!loading && data && sorted.length === 0 && (
          <div className="py-8 text-center text-[13px] text-gray-500">
            No cohort data available for the selected period.
          </div>
        )}

        {/* Cohorts */}
        {data && sorted.length > 0 && (
          <div>
            {sorted.map((cohort) => (
              <CohortRow key={cohort.month} cohort={cohort} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
