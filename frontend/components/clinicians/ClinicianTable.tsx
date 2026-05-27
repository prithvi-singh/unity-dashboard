'use client';

import { useState, useMemo } from 'react';
import type { Clinician } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import UserProfileLink from '@/components/users/UserProfileLink';
import type { ProfileLinkParams } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import SortableTh from '@/components/shared/SortableTh';

interface Props {
  clinicians: Clinician[];
  loading: boolean;
  error: string | null;
  linkParams?: ProfileLinkParams;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

// ── Grouped clinician (one row per person, merged across centres) ─────────────

interface CentreSlot {
  centreId:   number | null;
  centreName: string | null;
}

interface GroupedClinician {
  id:               number;
  firstName:        string;
  lastName:         string;
  email:            string;
  centres:          CentreSlot[];
  scoringComplete:  number;
  reportsDrafted:   number;
  reportEdits:      number;
  activeCaseload:   number;
  totalAuditActions: number;
  lastActivityDate: string | null;
  lastLoginDate:    string | null;
  // Pipeline state counts (point-in-time)
  pipelineScoring:    number;
  pipelineReports:    number;
  pipelineGoals:      number;
  stuckCases:         number;
}

/** Merge per-centre assignment rows into one row per clinician. */
function groupByClinician(rows: Clinician[]): GroupedClinician[] {
  const map = new Map<number, GroupedClinician>();

  for (const c of rows) {
    const existing = map.get(c.id);
    if (existing) {
      // Only add the centre slot if not already present
      if (!existing.centres.some((s) => s.centreId === c.centreId)) {
        existing.centres.push({ centreId: c.centreId, centreName: c.centreName });
      }
      existing.scoringComplete  += c.scoringComplete  ?? 0;
      existing.reportsDrafted   += c.reportsDrafted   ?? 0;
      existing.reportEdits      += c.reportEdits      ?? 0;
      existing.activeCaseload   += c.activeCaseload;
      existing.totalAuditActions += c.totalAuditActions;
      if (c.lastActivityDate && (!existing.lastActivityDate || c.lastActivityDate > existing.lastActivityDate)) {
        existing.lastActivityDate = c.lastActivityDate;
      }
      if (c.lastLoginDate && (!existing.lastLoginDate || c.lastLoginDate > existing.lastLoginDate)) {
        existing.lastLoginDate = c.lastLoginDate;
      }
    } else {
      map.set(c.id, {
        id:               c.id,
        firstName:        c.firstName,
        lastName:         c.lastName,
        email:            c.email,
        centres:          [{ centreId: c.centreId, centreName: c.centreName }],
        scoringComplete:  c.scoringComplete  ?? 0,
        reportsDrafted:   c.reportsDrafted   ?? 0,
        reportEdits:      c.reportEdits      ?? 0,
        activeCaseload:   c.activeCaseload,
        totalAuditActions: c.totalAuditActions,
        lastActivityDate: c.lastActivityDate,
        lastLoginDate:    c.lastLoginDate,
        // Pipeline: aggregated by userId in backend, same value across all centre rows
        pipelineScoring:  c.pipelineBreakdown?.scoring ?? 0,
        pipelineReports:  (c.pipelineBreakdown?.reportsToWrite ?? 0) + (c.pipelineBreakdown?.pendingApproval ?? 0),
        pipelineGoals:    c.pipelineBreakdown?.goalsToAdd ?? 0,
        stuckCases:       c.stuckCases ?? 0,
      });
    }
  }

  return Array.from(map.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function lastActiveClass(iso: string | null): string {
  if (!iso) return 'text-gray-300';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'text-green-600 font-medium';
  if (days <= 3)  return 'text-amber-500';
  return 'text-rose-500';
}

function getVal(g: GroupedClinician, col: string): number | string {
  switch (col) {
    case 'name':              return `${g.lastName} ${g.firstName}`.toLowerCase();
    case 'centreName':        return (g.centres[0]?.centreName ?? '').toLowerCase();
    case 'scoringComplete':   return g.scoringComplete;
    case 'reportsDrafted':    return g.reportsDrafted;
    case 'reportEdits':       return g.reportEdits;
    case 'activeCaseload':    return g.activeCaseload;
    case 'pipelineScoring':   return g.pipelineScoring;
    case 'pipelineReports':   return g.pipelineReports;
    case 'pipelineGoals':     return g.pipelineGoals;
    case 'stuckCases':        return g.stuckCases;
    case 'lastActivityDate':  return g.lastActivityDate ?? '';
    case 'lastLoginDate':     return g.lastLoginDate ?? '';
    default:                  return 0;
  }
}

function applySort(rows: GroupedClinician[], { col, dir }: SortState): GroupedClinician[] {
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

// ── Centre cell ───────────────────────────────────────────────────────────────

function CentreCell({ centres }: { centres: CentreSlot[] }) {
  const [open, setOpen] = useState(false);

  if (centres.length <= 1) {
    return (
      <span className="text-gray-500 text-xs truncate max-w-[160px] block" title={centres[0]?.centreName ?? ''}>
        {shortCentreName(centres[0]?.centreName ?? null)}
      </span>
    );
  }

  const allNames = centres.map((s) => shortCentreName(s.centreName)).join('\n');

  return (
    <span
      className="relative inline-flex items-center gap-1.5 cursor-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="text-xs text-gray-500 truncate max-w-[100px]">
        {shortCentreName(centres[0]?.centreName ?? null)}
      </span>
      <span className="flex-shrink-0 text-[10px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
        +{centres.length - 1}
      </span>
      {open && (
        <span
          className="absolute left-0 top-6 z-50 bg-gray-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 w-48 pointer-events-none whitespace-pre-line leading-relaxed"
          title={allNames}
        >
          {centres.map((s, i) => (
            <span key={i} className="block">{shortCentreName(s.centreName)}</span>
          ))}
        </span>
      )}
    </span>
  );
}

// ── Main table ────────────────────────────────────────────────────────────────

export default function ClinicianTable({ clinicians, loading, error, linkParams, onDrillDown }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'scoringComplete', dir: 'desc' });

  const handleSort = (col: string, def: SortDir) =>
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: def }
    );

  // Group on every render — stable as long as clinicians array ref is stable
  const grouped = useMemo(() => groupByClinician(clinicians ?? []), [clinicians]);
  const rows    = useMemo(() => applySort(grouped, sort), [grouped, sort]);

  // col count: # Clinician Centre Scored Drafted Edits Cases Scoring Reports Goals LastActive LastLogin
  const colCount = 12;

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Failed to load clinicians: {error}
      </div>
    );
  }

  const multiCentreCount = rows.filter((r) => r.centres.length > 1).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-[14px] font-medium text-gray-900">Clinician Detail</h2>
        <p className="text-xs text-gray-500 mt-0.5">Scroll horizontally for more columns · metrics summed across all centres</p>
        <p className="section-click-hint">Click any name to view their full profile</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
            {rows.length} clinician{rows.length !== 1 ? 's' : ''}
          </span>
          {multiCentreCount > 0 && (
            <span className="text-xs font-semibold text-blue-500 bg-blue-50 px-2.5 py-1 rounded-full">
              {multiCentreCount} across multiple centres
            </span>
          )}
        </div>
      </div>

      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full min-w-[1040px] text-sm" role="table" aria-label="Clinician detail table">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3 text-left w-6 text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">#</th>
              <SortableTh col="name" label="Clinician" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="asc" />
              <SortableTh col="centreName" label="Centre" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="asc" />
              <SortableTh
                col="scoringComplete"
                label="Assessments Scored"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="Assessments scored in the selected period, summed across all centres"
              />
              <SortableTh
                col="reportsDrafted"
                label="Reports Drafted"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="ReportAdded events in the selected period, summed across all centres"
              />
              <SortableTh
                col="reportEdits"
                label="Report Edits"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                className="text-gray-400"
                title="UpdateReport events — informational only, not a performance metric"
              />
              <SortableTh
                col="activeCaseload"
                label="Active Cases"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="Active cases currently assigned to this clinician, summed across all centres"
              />
              <SortableTh
                col="pipelineScoring"
                label="Scoring"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="Cases where assessment scoring is pending (not_started or in_progress state)"
              />
              <SortableTh
                col="pipelineReports"
                label="Reports"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="Cases where report needs drafting or approval (report_not_drafted + report_pending_approval)"
              />
              <SortableTh
                col="pipelineGoals"
                label="Goals"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right"
                title="Cases where report is approved but goals not yet added (goals_not_added state)"
              />
              <SortableTh
                col="lastActivityDate"
                label="Last Active"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="desc"
                title="Most recent action across all centres"
              />
              <SortableTh
                col="lastLoginDate"
                label="Last Login"
                sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="desc"
                title="Last time this clinician logged into Unity"
              />
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
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
                  No clinician data for the selected filters
                </td>
              </tr>
            ) : (
              rows.map((g, idx) => {
                // For drill-down and profile link: omit centreId when multi-centre so we
                // get the clinician's full cross-centre view.
                const primaryCentreId = g.centres.length === 1 ? (g.centres[0].centreId ?? undefined) : undefined;

                return (
                  <tr key={g.id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>

                    {/* Clinician */}
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={g.id}
                        role="clinician"
                        params={{ ...linkParams, centreId: primaryCentreId }}
                        firstName={g.firstName}
                      >
                        {g.firstName} {g.lastName}
                      </UserProfileLink>
                    </td>

                    {/* Centre — shows badge when multi-centre */}
                    <td className="px-5 py-3.5">
                      <CentreCell centres={g.centres} />
                    </td>

                    {/* Assessments Scored */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && g.scoringComplete > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-pipeline-scoring',
                            drillUserId: g.id,
                            drillCentreId: primaryCentreId,
                            label: `Scoring · ${g.firstName} ${g.lastName}`,
                          })}
                          className="tabular-nums font-bold text-gray-900 rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {g.scoringComplete.toLocaleString()}
                        </button>
                      ) : (
                        <NumCell value={g.scoringComplete} />
                      )}
                    </td>

                    {/* Reports Drafted */}
                    <td className="px-5 py-3.5 text-right">
                      <NumCell value={g.reportsDrafted} />
                    </td>

                    {/* Report Edits — secondary, grey */}
                    <td className="px-5 py-3.5 text-right tabular-nums text-gray-400">
                      {g.reportEdits > 0
                        ? g.reportEdits.toLocaleString()
                        : <span className="text-gray-200">—</span>}
                    </td>

                    {/* Active Cases */}
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && g.activeCaseload > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-caseload',
                            drillUserId: g.id,
                            drillCentreId: primaryCentreId,
                            label: `Active Cases · ${g.firstName} ${g.lastName}`,
                          })}
                          className="tabular-nums font-bold text-gray-900 rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          {g.activeCaseload.toLocaleString()}
                        </button>
                      ) : (
                        <NumCell value={g.activeCaseload} />
                      )}
                    </td>

                    {/* Scoring (pipeline state) */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`tabular-nums font-bold ${g.stuckCases > 0 ? 'text-rose-600' : g.pipelineScoring > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {g.pipelineScoring > 0 ? g.pipelineScoring.toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Reports (report_not_drafted + pending approval) */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`tabular-nums font-bold ${g.pipelineReports > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {g.pipelineReports > 0 ? g.pipelineReports.toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Goals (goals_not_added) */}
                    <td className="px-5 py-3.5 text-right">
                      <span className={`tabular-nums font-bold ${g.pipelineGoals > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                        {g.pipelineGoals > 0 ? g.pipelineGoals.toLocaleString() : '—'}
                      </span>
                    </td>

                    {/* Last Active — colour coded */}
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${lastActiveClass(g.lastActivityDate)}`}>
                      {timeAgo(g.lastActivityDate)}
                    </td>

                    {/* Last Login */}
                    <td className="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm">
                      {timeAgo(g.lastLoginDate)}
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

function NumCell({ value }: { value: number }) {
  return (
    <span className="tabular-nums font-bold text-gray-900">
      {value > 0 ? value.toLocaleString() : <span className="text-gray-300 font-normal">—</span>}
    </span>
  );
}
