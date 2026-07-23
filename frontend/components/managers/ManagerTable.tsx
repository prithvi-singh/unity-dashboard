'use client';

import React, { useState } from 'react';
import type { Manager } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import UserProfileLink from '@/components/users/UserProfileLink';
import type { ProfileLinkParams } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import { goalsDisplay } from '@/lib/roleStats';

interface Props {
  managers:    Manager[];
  loading:     boolean;
  error:       string | null;
  linkParams?: ProfileLinkParams;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

// ── Centre cell — +X more pattern ────────────────────────────────────────────

function CentreCell({ manager }: { manager: Manager }) {
  const [open, setOpen] = useState(false);

  const centres = manager.centres?.length
    ? manager.centres
    : manager.centreId != null
      ? [{ centreId: manager.centreId, centreName: manager.centreName ?? 'Unknown' }]
      : [];

  if (centres.length === 0) {
    return <span className="text-gray-300">—</span>;
  }

  if (centres.length === 1) {
    return (
      <span className="text-gray-600 text-xs" title={centres[0].centreName}>
        {shortCentreName(centres[0].centreName)}
      </span>
    );
  }

  if (centres.length === 2) {
    const label = `${shortCentreName(centres[0].centreName)} · ${shortCentreName(centres[1].centreName)}`;
    const full  = centres.map((c) => c.centreName).join(' · ');
    return (
      <span className="text-gray-600 text-xs truncate block max-w-[180px]" title={full}>
        {label}
      </span>
    );
  }

  const rest = centres.slice(1);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="text-gray-600 text-xs flex items-center gap-1 hover:text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`${centres[0].centreName} and ${rest.length} more centres`}
      >
        <span className="truncate max-w-[100px]">{shortCentreName(centres[0].centreName)}</span>
        <span className="text-blue-500 font-medium whitespace-nowrap">+{rest.length} more</span>
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 z-50 bg-gray-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-xl pointer-events-none leading-relaxed min-w-[160px]"
          role="tooltip"
        >
          {centres.map((c) => (
            <div key={c.centreId} className="py-0.5">{c.centreName}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function SortTh({
  col, label, sort, onSort, align = 'left', isText = false, title,
}: {
  col: string; label: string; sort: SortState;
  onSort: (col: string, def: SortDir) => void;
  align?: 'left' | 'right'; isText?: boolean; title?: string;
}) {
  const active = sort.col === col;
  return (
    <th
      className={[
        'px-3 py-[10px] text-[11px] font-medium uppercase tracking-[0.03em] cursor-pointer select-none transition-colors whitespace-nowrap',
        `text-${align}`,
        active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-700',
      ].join(' ')}
      title={title}
      onClick={() => onSort(col, isText ? 'asc' : 'desc')}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {title && (
          <span className="text-[9px] text-gray-400 hover:text-gray-600 cursor-help font-normal normal-case tracking-normal" title={title}>
            ⓘ
          </span>
        )}
        {active && (
          <span className="text-[10px] text-gray-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  );
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string | null, hasLogin?: boolean): string {
  if (!iso) return hasLogin ? 'Zero activity' : 'Never active';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)   return `${days}d ago`;
  if (days < 30)  return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function lastActiveColor(iso: string | null): string {
  if (!iso) return 'text-[#A32D2D] font-bold';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'text-[#1D9E75]';
  if (days === 1) return 'text-gray-900';
  if (days <= 3)  return 'text-gray-500';
  if (days <= 6)  return 'text-[#BA7517]';
  return 'text-[#A32D2D]';
}

function avgApprovalColor(days: number | null | undefined): string {
  if (days == null) return 'text-gray-400';
  if (days < 2)  return 'text-[#1D9E75] font-semibold';
  if (days <= 5) return 'text-[#BA7517]';
  return 'text-[#A32D2D] font-semibold';
}

// ── Sort value extractor ──────────────────────────────────────────────────────

function getVal(m: Manager, col: string): number | string {
  switch (col) {
    case 'name':              return `${m.lastName} ${m.firstName}`.toLowerCase();
    case 'centreName':        return (m.centreName ?? '').toLowerCase();
    case 'reportsToApprove':  return m.reportsToApprove ?? 0;
    case 'goalsToApprove':    return m.goalsToApprove   ?? 0;
    case 'reportsApproved':   return m.reportsApproved  ?? 0;
    case 'goalsApproved':     return m.goalsApproved    ?? 0;
    case 'avgApprovalDays':   return m.avgApprovalDays  ?? -1;
    case 'assessmentsScored': return m.assessmentsScored ?? 0;
    case 'reportsDrafted':    return m.reportsDrafted    ?? 0;
    case 'progressNotes':     return m.progressNotes     ?? 0;
    case 'cases':             return m.casesRegistered;
    case 'assessments':       return m.assessmentsAssigned;
    case 'lastActivity':      return m.lastActiveDate ?? '';
    case 'lastLogin':         return m.lastLoginDate ?? '';
    default:                  return 0;
  }
}

function applySort(rows: Manager[], { col, dir }: SortState): Manager[] {
  return [...rows].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av === bv) return 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      if (!av) return 1;
      if (!bv) return -1;
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return dir === 'asc' ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
  });
}

// ── Table ─────────────────────────────────────────────────────────────────────

function ManagerTableInner({ managers, loading, error, linkParams, onDrillDown }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'reportsToApprove', dir: 'desc' });

  const handleSort = (col: string, def: SortDir) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: def }
    );

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load managers: {error}
      </div>
    );
  }

  const visible = managers.filter((m) => m.roleName !== 'Super Admin');
  const deduped = [...new Map(visible.map((m) => [m.id, m])).values()];
  const rows    = applySort(deduped, sort);

  // col count: # Manager Centre | RtA GtA RApproved GApproved AvgTime | Scored Drafted Notes | Registered Assigned | LastActive LastLogin
  const colCount = 15;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap min-h-[40px]">
        {loading ? (
          <div className="h-6 w-24 bg-gray-100 rounded-full animate-pulse" />
        ) : (
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {rows.length} manager{rows.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full text-sm min-w-[1200px]" role="table" aria-label="Manager detail table">
          <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
            <tr>
              <th className="px-6 py-[10px] text-left text-[11px] font-medium text-gray-500 uppercase tracking-[0.03em] w-6">#</th>
              <SortTh col="name"             label="Manager"              sort={sort} onSort={handleSort} isText />
              <SortTh col="centreName"       label="Centre"               sort={sort} onSort={handleSort} isText />
              {/* ── APPROVAL ── */}
              <SortTh col="reportsToApprove" label="Reports to Approve"   sort={sort} onSort={handleSort} align="right"
                      title="Reports drafted by clinicians awaiting this manager's approval. Click to see list." />
              <SortTh col="goalsToApprove"   label="Goals to Approve"     sort={sort} onSort={handleSort} align="right"
                      title="Goals awaiting this manager's approval. Click to see list." />
              <SortTh col="reportsApproved"  label="Reports Approved"     sort={sort} onSort={handleSort} align="right"
                      title="Reports signed off by this manager in the selected period." />
              <SortTh col="goalsApproved"    label="Goals Approved"       sort={sort} onSort={handleSort} align="right"
                      title="Goals signed off by this manager in the selected period." />
              <SortTh col="avgApprovalDays"  label="Avg Approval Time"    sort={sort} onSort={handleSort} align="right"
                      title="Average days from report draft to manager approval in the period." />
              {/* ── CLINICIAN OUTPUT ── */}
              <SortTh col="assessmentsScored" label="Assessments Scored"  sort={sort} onSort={handleSort} align="right"
                      title="Assessments scored directly by this manager in the period." />
              <SortTh col="reportsDrafted"   label="Reports Drafted"      sort={sort} onSort={handleSort} align="right"
                      title="Reports drafted directly by this manager in the period." />
              <SortTh col="progressNotes"    label="Progress Notes"       sort={sort} onSort={handleSort} align="right"
                      title="Therapy progress notes added by this manager in the period." />
              {/* ── OPS OUTPUT ── */}
              <SortTh col="cases"            label="Cases Registered"     sort={sort} onSort={handleSort} align="right"
                      title="Cases registered by this manager in the period." />
              <SortTh col="assessments"      label="Assessments Assigned" sort={sort} onSort={handleSort} align="right"
                      title="Assessments routed to clinicians by this manager in the period." />
              {/* ── ACTIVITY ── */}
              <SortTh col="lastActivity"     label="Last Active"          sort={sort} onSort={handleSort}
                      title="Last audit action performed by this user — ever, not limited to the selected period. Login alone does not count as activity." />
              <SortTh col="lastLogin"        label="Last Login"           sort={sort} onSort={handleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-5 py-3.5">
                      <div className="h-4 bg-gray-100 rounded w-16" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-6 py-10 text-center text-gray-400">
                  No manager data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((m, idx) => {
                const rta = m.reportsToApprove ?? 0;
                const gta = m.goalsToApprove   ?? 0;

                return (
                  <tr key={m.id} className="hover:bg-gray-50/70 transition-colors">
                    {/* # */}
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>

                    {/* Manager name */}
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={m.id}
                        role="manager"
                        params={{ ...linkParams, centreId: m.centreId ?? undefined }}
                        firstName={m.firstName}
                      >
                        {m.firstName} {m.lastName}
                      </UserProfileLink>
                    </td>

                    {/* Centre */}
                    <td className="px-5 py-3.5 max-w-[200px]">
                      <CentreCell manager={m} />
                    </td>

                    {/* Reports to Approve — #A32D2D if > 0, clickable */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && rta > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-pending-reports',
                            drillUserId: m.id,
                            label: `Reports to approve · ${m.firstName} ${m.lastName}`,
                          })}
                          className="tabular-nums font-bold text-[#A32D2D] rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {rta.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${rta > 0 ? 'font-bold text-[#A32D2D]' : 'text-gray-300'}`}>
                          {rta > 0 ? rta.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Goals to Approve — #A32D2D if > 0, clickable */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && gta > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-pending-goals',
                            drillUserId: m.id,
                            label: `Goals to approve · ${m.firstName} ${m.lastName}`,
                          })}
                          className="tabular-nums font-bold text-[#A32D2D] rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {gta.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${gta > 0 ? 'font-bold text-[#A32D2D]' : 'text-gray-300'}`}>
                          {gta > 0 ? gta.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Reports Approved */}
                    <td className="px-5 py-3.5 text-right">
                      <NumCell value={m.reportsApproved ?? 0} />
                    </td>

                    {/* Goals Approved — X (Y) format */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && (m.goalsApproved ?? 0) > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-pipeline-goals-approved',
                            drillUserId: m.id,
                            label: `Goals approved · ${m.firstName} ${m.lastName}`,
                          })}
                          className="tabular-nums text-emerald-700 rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {goalsDisplay(m.goalsApproved ?? 0, m.goalsApprovedItems ?? 0)}
                        </button>
                      ) : (
                        <span className="tabular-nums text-gray-300">—</span>
                      )}
                    </td>

                    {/* Avg Approval Time */}
                    <td className={`px-5 py-3.5 text-right tabular-nums whitespace-nowrap ${avgApprovalColor(m.avgApprovalDays)}`}>
                      {m.avgApprovalDays != null
                        ? `${m.avgApprovalDays.toFixed(1)}d`
                        : <span className="text-gray-300">N/A</span>}
                    </td>

                    {/* Assessments Scored (manager acting as clinician) */}
                    <td className="px-5 py-3.5 text-right">
                      <NumCell value={m.assessmentsScored ?? 0} />
                    </td>

                    {/* Reports Drafted (manager acting as clinician) */}
                    <td className="px-5 py-3.5 text-right">
                      <NumCell value={m.reportsDrafted ?? 0} />
                    </td>

                    {/* Progress Notes */}
                    <td className="px-5 py-3.5 text-right">
                      <NumCell value={m.progressNotes ?? 0} />
                    </td>

                    {/* Cases Registered */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && m.casesRegistered > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-registered',
                            drillUserId: m.id,
                            label: `Registered · ${m.firstName} ${m.lastName}`,
                          })}
                          className="tabular-nums font-semibold text-violet-600 rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {m.casesRegistered.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${m.casesRegistered > 0 ? 'font-semibold text-violet-600' : 'text-gray-300'}`}>
                          {m.casesRegistered > 0 ? m.casesRegistered.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Assessments Assigned */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && m.assessmentsAssigned > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'manager-assigned',
                            drillUserId: m.id,
                            label: `Assigned · ${m.firstName} ${m.lastName}`,
                          })}
                          className="tabular-nums text-blue-600 rounded hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {m.assessmentsAssigned.toLocaleString()}
                        </button>
                      ) : (
                        <span className={`tabular-nums ${m.assessmentsAssigned > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                          {m.assessmentsAssigned > 0 ? m.assessmentsAssigned.toLocaleString() : '—'}
                        </span>
                      )}
                    </td>

                    {/* Last Active */}
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${lastActiveColor(m.lastActiveDate ?? null)}`}>
                      {timeAgo(m.lastActiveDate ?? null, !!m.lastLoginDate)}
                    </td>

                    {/* Last Login */}
                    <td className="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm">
                      {timeAgo(m.lastLoginDate)}
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

const ManagerTable = React.memo(ManagerTableInner, (prev, next) =>
  prev.managers    === next.managers    &&
  prev.loading     === next.loading     &&
  prev.error       === next.error       &&
  prev.linkParams  === next.linkParams  &&
  prev.onDrillDown === next.onDrillDown
);

export default ManagerTable;

function NumCell({ value }: { value: number }) {
  return (
    <span className="tabular-nums font-bold text-gray-900">
      {value > 0 ? value.toLocaleString() : <span className="text-gray-300 font-normal">—</span>}
    </span>
  );
}
