'use client';

import type { OnRoleDrillDown, ClinicalPipelineData, RoleDrillDownType } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { buildClinicalPipelineSteps } from '@/lib/clinicalPipelineSteps';
import type { FunnelStep } from '@/components/shared/RoleFunnel';
import { KPI } from '@/lib/kpiDefinitions';
import { KpiTooltip } from '@/components/shared/KpiTooltip';

interface Props {
  pipeline: ClinicalPipelineData | null | undefined;
  loading?: boolean;
  onDrillDown?: OnRoleDrillDown;
  title?: string;
  subtitle?: string;
  className?: string;
}

// ── Badge helpers ──────────────────────────────────────────────────────────

function badgeLabel(ownerHint: string): string {
  const h = ownerHint.toLowerCase();
  if (h === 'clinician') return 'Clinician';
  if (h === 'manager') return 'Manager';
  if (h.includes('manager') && h.includes('admin')) return 'Ops / Mgr';
  if (h.includes('clinician') && h.includes('manager')) return 'Clin / Mgr';
  return ownerHint;
}

function badgeColors(ownerHint: string): { bg: string; fg: string } {
  const h = ownerHint.toLowerCase();
  if (h === 'clinician') return { bg: '#E6F1FB', fg: '#0C447C' };
  if (h === 'manager') return { bg: '#EAF3DE', fg: '#3B6D11' };
  return { bg: '#E1F5EE', fg: '#0F6E56' };
}

function dotColor(stuck?: number): string {
  if (!stuck) return '#888780';
  if (stuck <= 3) return '#BA7517';
  return '#A32D2D';
}

function countColor(pct?: number): string {
  if (pct === undefined) return '#111827';
  if (pct >= 70) return '#111827';
  if (pct >= 50) return '#BA7517';
  return '#A32D2D';
}

// ── Single pipeline row ────────────────────────────────────────────────────

function PipelineRow({
  step,
  isLast,
  clickable,
  onClick,
}: {
  step: FunnelStep;
  isLast: boolean;
  clickable: boolean;
  onClick?: () => void;
}) {
  const stuck   = step.stuck;
  const pending = step.pending;
  const dot     = dotColor(stuck);
  const cColor  = countColor(step.pct);
  const bc      = step.ownerHint ? badgeColors(step.ownerHint) : null;
  const bl      = step.ownerHint ? badgeLabel(step.ownerHint) : null;
  const Tag     = clickable ? 'button' : 'div';

  return (
    // Outer wrapper holds the separator border and the connector line anchor.
    // Border lives here (not on the button) so hover's negative-margin expansion
    // doesn't stretch the separator.
    <div
      className="relative"
      style={{ borderBottom: isLast ? 'none' : '0.5px solid var(--color-border-tertiary, #f3f4f6)' }}
    >
      {/* Connector line: vertically bridges this row's dot to the next row's dot */}
      {!isLast && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 3,
            top: 14,
            bottom: -6,
            borderLeft: '1px dashed var(--color-border-secondary, #e5e7eb)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
      )}

      <Tag
        {...(clickable ? {
          type: 'button' as const,
          onClick,
          'aria-label': `${step.label}: ${step.value.toLocaleString()}. ${DRILL_DOWN_HINT}`,
          'aria-haspopup': 'dialog' as const,
        } : {})}
        className={[
          'relative z-10',
          'w-full text-left flex items-center',
          'py-[6px]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400',
          clickable
            ? 'hover:bg-[#f9fafb] hover:-mx-2 hover:px-2 hover:rounded cursor-pointer transition-colors duration-100'
            : '',
        ].filter(Boolean).join(' ')}
        style={{
          gap: 8,
          // Reset default <button> borders; separator is on the wrapper above
          borderTop: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
        }}
      >
        {/* 1. Status dot (8 px circle, flex-shrink 0) */}
        <div
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: dot, flexShrink: 0, zIndex: 1,
          }}
        />

        {/* 2. Stage label */}
        <span
          style={{
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--color-text-secondary, #6b7280)',
            width: 130,
            flexShrink: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.label}
        </span>

        {/* 3. Role badge */}
        {bc && bl ? (
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 99,
              background: bc.bg,
              color: bc.fg,
              flexShrink: 0,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {bl}
          </span>
        ) : (
          <span style={{ flexShrink: 0 }} />
        )}

        {/* 4. Spacer */}
        <span style={{ flex: 1 }} />

        {/* 5. Count */}
        <span
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: cColor,
            flexShrink: 0,
            minWidth: 28,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {step.value.toLocaleString()}
        </span>

        {/* 6. Percentage — hidden below 400 px via .pl-pct rule in <style> */}
        <span
          className="pl-pct"
          style={{
            fontSize: 12,
            color: 'var(--color-text-tertiary, #9ca3af)',
            flexShrink: 0,
            minWidth: 38,
            textAlign: 'right',
          }}
        >
          {step.pct !== undefined ? `(${step.pct}%)` : ''}
        </span>

        {/* 7. Pending */}
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-text-tertiary, #9ca3af)',
            flexShrink: 0,
            minWidth: 65,
            textAlign: 'right',
          }}
        >
          {pending && pending > 0 ? `${pending} pending` : '—'}
        </span>

        {/* 8. Stuck — visibility:hidden (not display:none) preserves column width */}
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: '#A32D2D',
            flexShrink: 0,
            minWidth: 50,
            textAlign: 'right',
            visibility: stuck && stuck > 0 ? 'visible' : 'hidden',
          }}
        >
          {stuck ?? 0} stuck
        </span>
      </Tag>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ClinicalPipelineCard({
  pipeline,
  loading,
  onDrillDown,
  title    = 'Clinical pipeline',
  subtitle = 'Each step counts cases · pending = not yet progressed · stuck = beyond threshold',
  className,
}: Props) {
  const cardClass = 'bg-white rounded-xl border border-gray-200 p-3 md:p-4';

  const steps    = buildClinicalPipelineSteps(pipeline);
  const mid      = Math.ceil(steps.length / 2);
  const leftSteps  = steps.slice(0, mid);
  const rightSteps = steps.slice(mid);

  const isClickable = (step: FunnelStep) => !!onDrillDown && !!step.drillType;
  const handleClick = (step: FunnelStep) => {
    if (onDrillDown && step.drillType) {
      onDrillDown({
        type:  step.drillType as RoleDrillDownType,
        label: step.drillLabel ?? step.label,
      });
    }
  };

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className={`${cardClass} animate-pulse${className ? ` ${className}` : ''}`}
        aria-busy="true"
        role="status"
      >
        <span className="sr-only">Loading pipeline</span>
        <div className="h-4 w-36 bg-gray-100 rounded mb-1" />
        <div className="h-3 w-56 bg-gray-100 rounded mb-3" />
        {/* Desktop skeleton: two columns */}
        <div className="hidden md:grid grid-cols-2 gap-x-6">
          {[0, 1].map((col) => (
            <div key={col} className="space-y-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 bg-gray-100 rounded" />
              ))}
            </div>
          ))}
        </div>
        {/* Mobile skeleton: single column */}
        <div className="md:hidden space-y-1">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-7 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  // ── Rendered card ────────────────────────────────────────────────────────

  return (
    <div className={`${cardClass}${className ? ` ${className}` : ''}`}>
      {/*
        Scoped rule: hide the percentage column on very small screens.
        display:none is preferable to visibility:hidden here so the
        column doesn't leave a gap on 375 px screens.
      */}
      <style>{`@media (max-width: 400px) { .pl-pct { display: none !important; } }`}</style>

      {/* Header */}
      <div className="mb-2">
        <div className="flex items-center gap-1.5">
          <h2
            className="text-gray-900"
            style={{ fontSize: 15, fontWeight: 500 }}
          >
            {title}
          </h2>
          {KPI.CLINICAL_PIPELINE && <KpiTooltip {...KPI.CLINICAL_PIPELINE} />}
        </div>
        <p
          className="text-[11px] text-gray-500 mt-0.5 truncate"
          title={subtitle}
        >
          {subtitle}
        </p>
      </div>

      {/* ── Desktop: two-column grid ≥ 769 px ─────────────────────────────── */}
      <div
        className="hidden md:grid"
        style={{ gridTemplateColumns: '1fr 1fr', gap: '0 24px' }}
      >
        {/* Left column — stages 1 … n/2 */}
        <div
          style={{
            borderRight: '0.5px solid var(--color-border-tertiary, #f3f4f6)',
            paddingRight: 16,
          }}
        >
          {leftSteps.map((step, i) => (
            <PipelineRow
              key={step.label}
              step={step}
              isLast={i === leftSteps.length - 1}
              clickable={isClickable(step)}
              onClick={() => handleClick(step)}
            />
          ))}
        </div>

        {/* Right column — stages n/2+1 … n */}
        <div style={{ paddingLeft: 16 }}>
          {rightSteps.map((step, i) => (
            <PipelineRow
              key={step.label}
              step={step}
              isLast={i === rightSteps.length - 1}
              clickable={isClickable(step)}
              onClick={() => handleClick(step)}
            />
          ))}
        </div>
      </div>

      {/* ── Mobile: single column ≤ 768 px ───────────────────────────────── */}
      <div className="md:hidden">
        {steps.map((step, i) => (
          <PipelineRow
            key={step.label}
            step={step}
            isLast={i === steps.length - 1}
            clickable={isClickable(step)}
            onClick={() => handleClick(step)}
          />
        ))}
      </div>
    </div>
  );
}
