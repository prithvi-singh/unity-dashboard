'use client';

import { useState } from 'react';
import type { ActivityByDay, ConsistencyScore } from '@/lib/types';
import {
  isSunday,
  generateDateRange,
  toLocalISO,
} from '@/lib/formatDate';

interface Props {
  activityByDay:    ActivityByDay[];
  consistencyScore: ConsistencyScore;
  /** Human-readable label shown in the card title, e.g. "Last 30 days". */
  dateRange?:       string;
  /** ISO date string for the start of the requested range, e.g. "2026-05-01". */
  dateFrom?:        string;
  /** ISO date string for the end of the requested range, e.g. "2026-05-27". */
  dateTo?:          string;
  loading:          boolean;
}

type ConsistencyStatus = ConsistencyScore['status'];

const STATUS_CONFIG: Record<ConsistencyStatus, { label: string; bg: string; text: string; ring: string }> = {
  consistent: { label: 'Consistent',  bg: 'bg-emerald-100',  text: 'text-emerald-800', ring: 'ring-emerald-200' },
  irregular:  { label: 'Irregular',   bg: 'bg-amber-100',    text: 'text-amber-800',   ring: 'ring-amber-200'   },
  inactive:   { label: 'Inactive',    bg: 'bg-rose-100',     text: 'text-rose-700',    ring: 'ring-rose-200'    },
  silent:     { label: 'Silent',      bg: 'bg-rose-100',     text: 'text-rose-800 font-bold', ring: 'ring-rose-200' },
};

function cellTitle(day: ActivityByDay | undefined, dateStr: string): string {
  if (!day || !day.didCoreJob) return `${fmtDateFull(dateStr)} — No core job activity`;
  const b = day.breakdown;
  const parts: string[] = [];
  if (b.assessmentsScored)  parts.push(`Assessments scored: ${b.assessmentsScored}`);
  if (b.reportsDrafted)     parts.push(`Reports drafted: ${b.reportsDrafted}`);
  if (b.goalsAdded)         parts.push(`Cases with goals: ${b.goalsAdded}`);
  if (b.reportsApproved)    parts.push(`Reports approved: ${b.reportsApproved}`);
  if (b.casesRegistered)    parts.push(`Cases registered: ${b.casesRegistered}`);
  if (b.cliniciansAssigned) parts.push(`Clinicians assigned: ${b.cliniciansAssigned}`);
  if (b.caseHistory)        parts.push(`Case history: ${b.caseHistory}`);
  return `${fmtDateFull(dateStr)}\n${parts.join('\n') || `Core actions: ${day.coreJobCount}`}`;
}

function fmtDateFull(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface TooltipState {
  day:  ActivityByDay;
  date: string;
  x:    number;
  y:    number;
}

export default function UserConsistencyHeatmap({
  activityByDay,
  consistencyScore,
  dateRange,
  dateFrom,
  dateTo,
  loading,
}: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const statusCfg = STATUS_CONFIG[consistencyScore.status];

  // Build a lookup map by date string
  const dayMap = new Map(activityByDay.map((d) => [d.date, d]));

  // Generate the full requested date range — never skip a date.
  //
  // IMPORTANT: use toLocalISO (not .toISOString()) when converting Date objects
  // back to YYYY-MM-DD strings. .toISOString() returns the UTC date, which is
  // one day behind for UTC+ users (e.g. IST midnight is May 26 18:30 UTC →
  // .toISOString() returns "2026-05-26" instead of "2026-05-27").
  const dates: string[] = (() => {
    const today = new Date();

    // Determine end date: explicit dateTo, or today
    const end = dateTo
      ? new Date(`${dateTo}T12:00:00`)   // noon to stay on the correct calendar day in any timezone
      : today;

    // Determine start date: explicit dateFrom, otherwise last 30 days relative to end
    let start: Date;
    if (dateFrom) {
      start = new Date(`${dateFrom}T12:00:00`);  // noon to stay on the correct calendar day
    } else {
      start = new Date(end);
      start.setDate(start.getDate() - 29);
    }

    return generateDateRange(start, end).map(toLocalISO);
  })();

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-[14px] font-medium text-gray-900">
          Activity consistency{dateRange ? ` — ${dateRange}` : ''}
        </h2>
        <p className="text-[12px] text-gray-500 mt-0.5">Days where core job was performed</p>
      </div>

      <div className="px-6 py-5">
        {loading ? (
          <div className="h-16 bg-gray-50 rounded-xl animate-pulse" />
        ) : dates.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-6">No activity in the selected period</div>
        ) : (
          <>
            {/* Heatmap grid */}
            <div className="overflow-x-auto">
              <div className="min-w-max">
                {/* Combined month + day header row */}
                <div className="flex gap-[3px] mb-1">
                  {dates.map((date, idx) => {
                    const isFirstOfMonth =
                      idx === 0 ||
                      new Date(`${date}T12:00:00`).getMonth() !==
                        new Date(`${dates[idx - 1]}T12:00:00`).getMonth();
                    const sun = isSunday(date);
                    const dayNum = new Date(`${date}T12:00:00`).getDate();
                    const monthLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { month: 'short' });

                    return (
                      <div
                        key={date}
                        className="w-7 flex-shrink-0 text-center"
                        style={{ width: '28px', minWidth: '28px' }}
                      >
                        {isFirstOfMonth && (
                          <div
                            style={{
                              fontSize: '10px',
                              color: 'var(--color-text-tertiary, #9ca3af)',
                              fontWeight: 500,
                              marginBottom: '1px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {monthLabel}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: '9px',
                            color: sun ? 'var(--sunday-text)' : '#d1d5db',
                          }}
                        >
                          {dayNum}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Cells */}
                <div className="flex gap-[3px] relative">
                  {dates.map((date) => {
                    const day     = dayMap.get(date);
                    const sun     = isSunday(date);
                    const didCore = day?.didCoreJob ?? false;
                    const count   = day?.coreJobCount ?? 0;

                    // Colour rules:
                    //   Active day (any day of week)  → green bg, white text
                    //   Empty Sunday                  → pink tint (#FFF5F5), visual week separator only
                    //   Empty day (incl. Saturday)    → secondary bg, no text
                    let bg: string;
                    let textColor: string;
                    if (didCore) {
                      bg        = '#1D9E75';
                      textColor = '#fff';
                    } else if (sun) {
                      bg        = '#FFF5F5';
                      textColor = 'transparent';
                    } else {
                      bg        = 'var(--color-background-secondary)';
                      textColor = 'transparent';
                    }

                    return (
                      <div
                        key={date}
                        style={{
                          width: '28px',
                          height: '28px',
                          minWidth: '28px',
                          flexShrink: 0,
                          borderRadius: '4px',
                          cursor: 'default',
                          backgroundColor: bg,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '9px',
                          fontWeight: 700,
                          color: textColor,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                        onMouseEnter={(e) => {
                          if (day) {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setTooltip({ day, date, x: rect.left, y: rect.bottom });
                          }
                        }}
                        onMouseLeave={() => setTooltip(null)}
                        title={cellTitle(day, date)}
                      >
                        {didCore && count > 0 ? count : null}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-3 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: '#1D9E75' }} />
                    <span className="text-[11px] text-gray-500">Core job done</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: 'var(--color-background-secondary)' }} />
                    <span className="text-[11px] text-gray-500">No core job</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded" style={{ backgroundColor: '#FFF5F5', border: '1px solid #fecaca' }} />
                    <span className="text-[11px]" style={{ color: 'var(--sunday-text)' }}>Sunday</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Hover tooltip */}
            {tooltip && (
              <div
                className="fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none max-w-[220px]"
                style={{ top: tooltip.y + 8, left: tooltip.x }}
              >
                <div className="font-semibold mb-0.5">{fmtDateFull(tooltip.date)}</div>
                {tooltip.day.didCoreJob ? (
                  <div className="space-y-0.5">
                    {tooltip.day.breakdown.assessmentsScored > 0 && (
                      <div>Assessments scored: {tooltip.day.breakdown.assessmentsScored}</div>
                    )}
                    {tooltip.day.breakdown.reportsDrafted > 0 && (
                      <div>Reports drafted: {tooltip.day.breakdown.reportsDrafted}</div>
                    )}
                    {tooltip.day.breakdown.goalsAdded > 0 && (
                      <div>Cases with goals: {tooltip.day.breakdown.goalsAdded}</div>
                    )}
                    {tooltip.day.breakdown.reportsApproved > 0 && (
                      <div>Reports approved: {tooltip.day.breakdown.reportsApproved}</div>
                    )}
                    {tooltip.day.breakdown.casesRegistered > 0 && (
                      <div>Cases registered: {tooltip.day.breakdown.casesRegistered}</div>
                    )}
                    {tooltip.day.breakdown.cliniciansAssigned > 0 && (
                      <div>Clinicians assigned: {tooltip.day.breakdown.cliniciansAssigned}</div>
                    )}
                    {tooltip.day.breakdown.caseHistory > 0 && (
                      <div>Case history: {tooltip.day.breakdown.caseHistory}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-gray-400">No core job activity</div>
                )}
              </div>
            )}

            {/* Score summary */}
            <div className="mt-5 flex flex-wrap items-center gap-3 pt-4 border-t border-gray-100">
              <span className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900">{consistencyScore.coreJobDays}</span>
                {' '}of{' '}
                <span className="font-semibold text-gray-900">{consistencyScore.totalWorkingDays}</span>
                {' '}working days with core job activity
                {' · '}
                <span className="font-semibold">{consistencyScore.consistencyPercent}% consistent</span>
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ${statusCfg.bg} ${statusCfg.text} ${statusCfg.ring}`}
              >
                {statusCfg.label}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
