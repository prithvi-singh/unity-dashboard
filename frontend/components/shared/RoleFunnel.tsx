'use client';

import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';

export interface FunnelStep {
  label: string;
  value: number;
  barColor: string;
  pctLabel?: string;
  ownerHint?: string;
  drillType?: string;
  drillLabel?: string;
}

interface Props {
  title: string;
  subtitle: string;
  steps: FunnelStep[];
  loading?: boolean;
  tooltip?: KpiDefinition;
  onDrillDown?: (request: { type: string; label?: string }) => void;
}

function pctOf(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined;
  return `${Math.round((part / whole) * 100)}% of assigned assessments`;
}

function FunnelRow({
  label, value, max, barColor, pctLabel, ownerHint, isFirst, clickable, onClick,
}: {
  label: string;
  value: number;
  max: number;
  barColor: string;
  pctLabel?: string;
  ownerHint?: string;
  isFirst?: boolean;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const width = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const Tag = clickable ? 'button' : 'div';

  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      aria-label={clickable ? `${label}: ${value.toLocaleString()}. ${DRILL_DOWN_HINT}` : undefined}
      aria-haspopup={clickable ? 'dialog' : undefined}
      className={`flex items-center gap-4 w-full text-left ${clickable ? 'rounded-xl p-1 -m-1 hover:bg-gray-50 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400' : ''}`}
    >
      <div className="w-[8.5rem] flex-shrink-0 text-right">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.06em] leading-snug">{label}</p>
        {ownerHint && (
          <p className="text-[9px] font-semibold text-gray-500 mt-0.5">{ownerHint}</p>
        )}
        <p className={`font-bold text-gray-900 tabular-nums leading-tight mt-1 ${isFirst ? 'text-2xl' : 'text-xl'}`}>
          {value.toLocaleString()}
        </p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-8 bg-gray-100 rounded-xl overflow-hidden">
          <div
            className={`h-full ${barColor} rounded-xl`}
            style={{ width: `${width}%`, transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </div>
        {pctLabel && <p className="text-[11px] text-gray-500 mt-1 ml-1">{pctLabel}</p>}
      </div>
    </Tag>
  );
}

export default function RoleFunnel({ title, subtitle, steps, loading, tooltip, onDrillDown }: Props) {
  const cardClass = 'bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] p-5';

  if (loading) {
    return (
      <div className={`${cardClass} flex flex-col gap-5 animate-pulse`} aria-busy="true" role="status">
        <span className="sr-only">Loading funnel</span>
        <div className="h-4 w-40 bg-gray-100 rounded" />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 bg-gray-100 rounded-xl" />
        ))}
      </div>
    );
  }

  const max = Math.max(...steps.map((s) => s.value), 1);
  const drillHint = onDrillDown ? ` · ${DRILL_DOWN_HINT} on any stage` : '';

  return (
    <div className={cardClass}>
      <div className="mb-5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}{drillHint}</p>
      </div>
      <div className="flex flex-col gap-4">
        {steps.map((step, i) => {
          const clickable = !!onDrillDown && !!step.drillType;
          return (
            <FunnelRow
              key={step.label}
              label={step.label}
              value={step.value}
              max={max}
              barColor={step.barColor}
              pctLabel={step.pctLabel}
              ownerHint={step.ownerHint}
              isFirst={i === 0}
              clickable={clickable}
              onClick={clickable ? () => onDrillDown!({
                type: step.drillType!,
                label: step.drillLabel ?? step.label,
              }) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export { pctOf };
