'use client';

import type { OnRoleDrillDown, RoleDrillDownType } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { KpiTooltip, type KpiDefinition } from '@/components/shared/KpiTooltip';

// ── Types ──────────────────────────────────────────────────────────────────

export interface FunnelStep {
  label: string;
  value: number;
  barColor: string;   // stage identity colour — maps to connector dot hex
  pct?: number;       // 0–100: value as % of the pipeline base (e.g. assigned)
  pctLabel?: string;  // legacy string form, preserved for callers that still set it
  ownerHint?: string;
  drillType?: string;
  drillLabel?: string;
  pending?: number;   // cases not yet progressed past this stage
  stuck?: number;     // cases beyond the stuck threshold at this stage
}

interface Props {
  title: string;
  subtitle: string;
  /** Short subtitle shown on narrow screens (< md). Falls back to `subtitle` if omitted. */
  mobileSubtitle?: string;
  steps: FunnelStep[];
  loading?: boolean;
  tooltip?: KpiDefinition;
  onDrillDown?: OnRoleDrillDown;
}

// ── Kept for callers that import this helper (BottleneckFunnel, etc.) ──────

function pctOf(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined;
  return `${Math.round((part / whole) * 100)}% of assigned assessments`;
}

// ── Colour helpers ─────────────────────────────────────────────────────────

const BAR_TO_HEX: Record<string, string> = {
  'bg-emerald-500': '#10b981',
  'bg-teal-500':    '#14b8a6',
  'bg-blue-500':    '#3b82f6',
  'bg-indigo-500':  '#6366f1',
  'bg-violet-500':  '#8b5cf6',
  'bg-purple-500':  '#a855f7',
  'bg-purple-600':  '#9333ea',
  'bg-cyan-500':    '#06b6d4',
  'bg-sky-500':     '#0ea5e9',
  'bg-rose-500':    '#f43f5e',
  'bg-orange-500':  '#f97316',
};

function dotHex(barColor: string): string {
  return BAR_TO_HEX[barColor] ?? '#9ca3af';
}

function countColor(pct?: number): string {
  if (pct === undefined) return '#111827';
  if (pct >= 70) return '#111827';
  if (pct >= 50) return '#BA7517';
  return '#A32D2D';
}

interface BadgeStyle { bg: string; fg: string }

function badgeStyle(ownerHint?: string): BadgeStyle {
  const h = (ownerHint ?? '').toLowerCase();
  if (h === 'clinician')          return { bg: '#ccfbf1', fg: '#0f766e' };
  if (h.startsWith('manager or')) return { bg: '#e0e7ff', fg: '#4338ca' };
  if (h === 'manager')            return { bg: '#dbeafe', fg: '#1d4ed8' };
  return { bg: '#f3f4f6', fg: '#6b7280' };
}

// ── Badge element (reused in mobile and desktop renders) ───────────────────

function Badge({ ownerHint, className = '' }: { ownerHint: string; className?: string }) {
  const s = badgeStyle(ownerHint);
  return (
    <span
      className={`inline-block flex-shrink-0 text-[10px] font-semibold tracking-[0.02em] px-[7px] py-0.5 rounded-full whitespace-nowrap overflow-hidden text-ellipsis max-w-[5rem] ${className}`}
      style={{ background: s.bg, color: s.fg }}
    >
      {ownerHint}
    </span>
  );
}

// ── Single pipeline row ────────────────────────────────────────────────────

function PipelineRow({
  step, isLast, clickable, onClick,
}: {
  step: FunnelStep;
  isLast: boolean;
  clickable: boolean;
  onClick?: () => void;
}) {
  const Tag = clickable ? 'button' : 'div';
  const dot  = dotHex(step.barColor);
  const badge = badgeStyle(step.ownerHint);
  const cColor = countColor(step.pct);

  // Shared Tailwind classes ------------------------------------------------
  // Mobile:  2-col grid [connector | flex-col content]
  // Desktop: 4-col grid [connector | label | badge | count]
  const rowClass = [
    'w-full text-left',
    'grid grid-cols-[20px_minmax(0,1fr)]',
    'md:grid-cols-[20px_minmax(0,1fr)_auto_minmax(76px,auto)]',
    'items-start md:items-center',
    'gap-x-2.5',
    'py-2 md:py-[7px]',
    'rounded-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
    clickable ? 'hover:bg-gray-50 active:bg-gray-50/80 cursor-pointer transition-colors duration-100' : '',
  ].filter(Boolean).join(' ');

  return (
    <Tag
      {...(clickable ? {
        type: 'button' as const,
        onClick,
        'aria-label': `${step.label}: ${step.value.toLocaleString()}. ${DRILL_DOWN_HINT}`,
        'aria-haspopup': 'dialog' as const,
      } : {})}
      className={rowClass}
      style={{
        // Three-side border reset for <button> (Tailwind preflight handles most,
        // but explicit is safer), then border-bottom as the row separator.
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: isLast ? 'none' : '0.5px solid #f3f4f6',
      }}
    >
      {/* ── Col 1: Connector dot + dashed line to next row ──────────── */}
      <div className="relative self-stretch" style={{ minHeight: 20 }}>
        {/* Dot: centred horizontally; on desktop rows it sits at 50% height,
            on mobile rows (taller, 2 lines) it sits between the two lines
            which reads naturally as "this row's stage marker". */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          zIndex: 1,
          flexShrink: 0,
        }} />
        {!isLast && (
          <div style={{
            position: 'absolute',
            left: '50%',
            top: 'calc(50% + 6px)',
            bottom: -1,
            transform: 'translateX(-50%)',
            width: 1,
            borderLeft: '1px dashed #e5e7eb',
          }} />
        )}
      </div>

      {/* ── Col 2: Mobile = flex-col two-liner. Desktop = label only ──── */}
      <div className="flex flex-col gap-0.5 min-w-0 pt-0.5 md:pt-0">

        {/* Line 1: label + badge (badge shown only on mobile) */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-[11px] uppercase tracking-[0.04em] text-gray-500 font-medium
                       overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1
                       md:whitespace-nowrap"
            style={{ maxWidth: 'calc(100vw - 120px)' }}
          >
            {step.label}
          </span>
          {/* Badge: visible on mobile inline with label; hidden on desktop
              (desktop badge is rendered separately in Col 3 below) */}
          {step.ownerHint && (
            <Badge ownerHint={step.ownerHint} className="md:hidden" />
          )}
        </div>

        {/* Line 2: count + pct — mobile only */}
        <div className="flex items-center gap-1 md:hidden">
          <span
            className="text-[13px] font-semibold tabular-nums leading-none"
            style={{ color: cColor }}
          >
            {step.value.toLocaleString()}
          </span>
          {step.pct !== undefined && (
            <span className="text-[11px] text-gray-400 leading-none">
              ({step.pct}%)
            </span>
          )}
        </div>
      </div>

      {/* ── Col 3: Role badge — desktop only ──────────────────────────── */}
      {step.ownerHint ? (
        <Badge ownerHint={step.ownerHint} className="hidden md:inline-block" />
      ) : (
        <span className="hidden md:block" />
      )}

      {/* ── Col 4: Count + pct — desktop only ────────────────────────── */}
      <div className="hidden md:flex items-baseline gap-1 justify-end">
        <span style={{
          fontSize: 15,
          fontWeight: 600,
          color: cColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}>
          {step.value.toLocaleString()}
        </span>
        {step.pct !== undefined && (
          <span style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1 }}>
            ({step.pct}%)
          </span>
        )}
      </div>
    </Tag>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function RoleFunnel({
  title,
  subtitle,
  mobileSubtitle,
  steps,
  loading,
  tooltip,
  onDrillDown,
}: Props) {
  // Slightly less padding on mobile
  const cardClass = 'bg-white rounded-xl border border-gray-200 p-3 md:p-4';

  if (loading) {
    return (
      <div className={`${cardClass} animate-pulse`} aria-busy="true" role="status">
        <span className="sr-only">Loading pipeline</span>
        <div className="h-4 w-36 bg-gray-100 rounded mb-2" />
        <div className="h-3 w-52 bg-gray-100 rounded mb-4" />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 bg-gray-100 rounded mb-1" />
        ))}
      </div>
    );
  }

  const drillHintDesktop = onDrillDown ? ' · Click any row to drill down' : '';
  const drillHintMobile  = onDrillDown ? ' · Tap any row for details' : '';
  const shortSubtitle    = mobileSubtitle ?? subtitle;

  return (
    <div className={cardClass}>
      <div className="mb-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[14px] font-medium text-gray-900">{title}</h2>
          {tooltip && <KpiTooltip {...tooltip} />}
        </div>

        {/* Desktop subtitle — full text, truncated to one line */}
        <p className="hidden md:block text-[11px] text-gray-500 mt-0.5 truncate">
          {subtitle}{drillHintDesktop}
        </p>
        {/* Mobile subtitle — short version */}
        <p className="md:hidden text-[11px] text-gray-500 mt-0.5 truncate">
          {shortSubtitle}{drillHintMobile}
        </p>
      </div>

      <div>
        {steps.map((step, i) => {
          const clickable = !!onDrillDown && !!step.drillType;
          return (
            <PipelineRow
              key={step.label}
              step={step}
              isLast={i === steps.length - 1}
              clickable={clickable}
              onClick={clickable ? () => onDrillDown!({
                type: step.drillType! as RoleDrillDownType,
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
