'use client';

import type { PipelineData, PipelineStage } from '@/lib/types';

interface Props {
  data: PipelineData | null;
  loading: boolean;
  onStageSelect?: (stage: string | null) => void;
  selectedStage?: string | null;
}

const STAGE_CONFIG: Record<string, { gradient: string; label: string }> = {
  'Onboarded':               { gradient: 'from-violet-500 to-violet-600',  label: 'Onboarded' },
  'Assessment Assigned':     { gradient: 'from-blue-500 to-blue-600',      label: 'Assigned' },
  'Assessment In Progress':  { gradient: 'from-sky-500 to-cyan-500',       label: 'In Progress' },
  'Report Drafted':          { gradient: 'from-teal-500 to-emerald-500',   label: 'Report Drafted' },
  'Report Pending Approval': { gradient: 'from-amber-400 to-amber-500',    label: 'Pending Approval' },
  'Goals Set':               { gradient: 'from-indigo-500 to-purple-500',  label: 'Goals Set' },
  'Goals Pending Approval':  { gradient: 'from-orange-400 to-rose-400',    label: 'Goals Pending' },
  'Closed':                  { gradient: 'from-emerald-500 to-green-500',  label: 'Closed' },
};

function stageHealth(stage: PipelineStage): 'green' | 'amber' | 'red' {
  if (!stage.stuckCount || stage.stuckCount === 0) return 'green';
  if (stage.count > 0 && stage.stuckCount / stage.count > 0.3) return 'red';
  return 'amber';
}

const HEALTH_DOT   = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-rose-500' };
const HEALTH_LABEL = { green: 'text-emerald-700', amber: 'text-amber-700', red: 'text-rose-700' };
const HEALTH_BG    = { green: 'bg-emerald-50',    amber: 'bg-amber-50',    red: 'bg-rose-50' };

function conversionColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-500';
  if (pct >= 50) return 'text-amber-500';
  return 'text-rose-500';
}

export default function PipelineFunnel({ data, loading, onStageSelect, selectedStage }: Props) {
  const stages = data?.stages ?? [];
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="h-5 w-40 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="flex flex-col items-center gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-10 bg-gray-50 rounded-xl animate-pulse"
              style={{ width: `${95 - i * 9}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!stages.length) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-[15px] font-bold text-gray-900 tracking-[-0.01em]">Clinical Pipeline</h2>
        <p className="text-[12px] text-gray-400 mt-0.5">
          Cases at each stage of the workflow · click a stage to highlight stuck cases below
        </p>
      </div>

      {/* Funnel stages */}
      <div className="flex flex-col">
        {stages.map((stage, i) => {
          const config = STAGE_CONFIG[stage.stage] ?? {
            gradient: 'from-gray-400 to-gray-500',
            label: stage.stage,
          };

          // Width relative to max; centered via left offset — creates the funnel taper
          const widthPct  = Math.max(20, Math.round((stage.count / maxCount) * 100));
          const leftPct   = (100 - widthPct) / 2;

          const health    = stage.stuckCount != null ? stageHealth(stage) : 'green';
          const isSelected = selectedStage === stage.stage;
          const hasStuck  = (stage.stuckCount ?? 0) > 0;

          // Conversion from the previous stage
          const prevCount = i > 0 ? stages[i - 1].count : null;
          const convPct   = prevCount != null && prevCount > 0
            ? Math.round((stage.count / prevCount) * 100)
            : null;

          return (
            <div key={stage.stage}>
              {/* ── Conversion connector ── */}
              {i > 0 && convPct !== null && (
                <div className="flex items-center gap-3 py-1.5 px-1">
                  <div className="flex-1 h-px bg-gray-100" />
                  <div className="flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap">
                    {/* Down arrow */}
                    <svg
                      className="w-2.5 h-3 text-gray-300 flex-shrink-0"
                      viewBox="0 0 10 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 1v10M1 7l4 5 4-5" />
                    </svg>
                    <span className={conversionColor(convPct)}>{convPct}%</span>
                    <span className="text-gray-300">passed through</span>
                  </div>
                  <div className="flex-1 h-px bg-gray-100" />
                </div>
              )}

              {/* ── Stage row ── */}
              <button
                type="button"
                onClick={() => onStageSelect?.(isSelected ? null : stage.stage)}
                className={[
                  'w-full text-left rounded-xl focus:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1',
                  'transition-all duration-150',
                  isSelected ? 'ring-2 ring-blue-400 ring-offset-1' : '',
                ].join(' ')}
                aria-pressed={isSelected}
                aria-label={`${stage.stage}: ${stage.count} cases${stage.stuckCount ? `, ${stage.stuckCount} stuck` : ''}`}
              >
                <div className="flex items-center gap-2 px-2 py-1">
                  {/* Left — stage number + label */}
                  <div className="flex items-center gap-1.5 w-36 flex-shrink-0">
                    <span className="w-5 h-5 flex-shrink-0 rounded-full bg-gray-100 text-[10px] font-bold text-gray-400 flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span className="text-[11px] font-semibold text-gray-700 truncate leading-tight">
                      {config.label}
                    </span>
                  </div>

                  {/* Center — funnel bar track with centered fill */}
                  <div className="flex-1 relative h-9 bg-gray-50 rounded-lg overflow-hidden">
                    {/* Centered fill — this is what creates the funnel taper */}
                    <div
                      className={`absolute top-0 h-full bg-gradient-to-r ${config.gradient} rounded-lg transition-all duration-500 ease-out`}
                      style={{ width: `${widthPct}%`, left: `${leftPct}%` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent rounded-lg" />
                    </div>

                    {/* Count always centred over the track */}
                    <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span
                        className={`text-[12px] font-bold tabular-nums ${widthPct > 28 ? 'text-white drop-shadow-sm' : 'text-gray-600'}`}
                      >
                        {stage.count.toLocaleString()}
                      </span>
                    </span>
                  </div>

                  {/* Right — stuck badge + avg days */}
                  <div className="w-28 flex-shrink-0 flex flex-col items-end gap-0.5">
                    {hasStuck && (
                      <span
                        className={[
                          'inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                          HEALTH_BG[health], HEALTH_LABEL[health],
                        ].join(' ')}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${HEALTH_DOT[health]}`} />
                        {stage.stuckCount} stuck
                      </span>
                    )}
                    {stage.avgDaysInStage != null && (
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {stage.avgDaysInStage.toFixed(1)}d avg
                      </span>
                    )}
                  </div>
                </div>

                {/* Selected underline */}
                {isSelected && (
                  <div className="h-0.5 mx-3 mb-1 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-5 pt-4 border-t border-gray-50 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" /> Healthy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" /> Some stuck (&lt;30%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500" /> Many stuck (&gt;30%)
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-emerald-500 font-semibold">≥80%</span>
          <span className="text-amber-500 font-semibold">≥50%</span>
          <span className="text-rose-500 font-semibold">&lt;50%</span>
          <span>conversion</span>
        </span>
      </div>
    </div>
  );
}
