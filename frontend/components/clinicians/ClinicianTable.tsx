'use client';

import { useState } from 'react';
import type { Clinician } from '@/lib/types';
import ScrollRegion from '@/components/shared/ScrollRegion';
import { shortCentreName } from '@/lib/centreNames';
import UserProfileLink from '@/components/users/UserProfileLink';
import type { ProfileLinkParams } from '@/lib/userProfile';
import type { OnRoleDrillDown } from '@/lib/roleDrillDown';
import { DRILL_DOWN_HINT } from '@/lib/roleDrillDown';
import SortableTh from '@/components/shared/SortableTh';
import { KPI } from '@/lib/kpiDefinitions';

interface Props {
  clinicians: Clinician[];
  loading: boolean;
  error: string | null;
  linkParams?: ProfileLinkParams;
  onDrillDown?: OnRoleDrillDown;
}

type SortDir = 'asc' | 'desc';
interface SortState { col: string; dir: SortDir }

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

function stalenessClass(iso: string | null): string {
  if (!iso) return 'text-gray-300';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 1) return 'text-green-600 font-medium';
  if (days <= 7) return 'text-amber-500';
  return 'text-rose-500';
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function YieldBadge({ results, caseload }: { results: number; caseload: number }) {
  const denom = results + caseload;
  if (denom === 0) return <span className="text-gray-300">—</span>;
  const pct = Math.round((results / denom) * 100);
  const color =
    pct >= 66 ? 'text-green-600 font-semibold'
    : pct >= 33 ? 'text-amber-500 font-medium'
    : 'text-rose-500 font-medium';
  return <span className={`tabular-nums ${color}`}>{pct}%</span>;
}

function scoringCount(c: Clinician): number {
  return c.scoringComplete ?? 0;
}

function reportPdfCount(c: Clinician): number {
  return c.reportPdfCreated ?? c.resultsGenerated ?? 0;
}

function getVal(c: Clinician, col: string): number | string {
  switch (col) {
    case 'name':              return `${c.lastName} ${c.firstName}`.toLowerCase();
    case 'centreName':        return (c.centreName ?? '').toLowerCase();
    case 'scoringComplete':   return scoringCount(c);
    case 'reportPdfCreated':  return reportPdfCount(c);
    case 'resultsGenerated':  return reportPdfCount(c);
    case 'activeCaseload':    return c.activeCaseload;
    case 'yield': {
      const d = reportPdfCount(c) + c.activeCaseload;
      return d > 0 ? reportPdfCount(c) / d : -1;
    }
    case 'totalAuditActions': return c.totalAuditActions;
    case 'lastActivityDate':  return c.lastActivityDate ?? '';
    case 'lastLoginDate':     return c.lastLoginDate ?? '';
    default:                  return 0;
  }
}

function applySort(rows: Clinician[], { col, dir }: SortState): Clinician[] {
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

export default function ClinicianTable({ clinicians, loading, error, linkParams, onDrillDown }: Props) {
  const [sort, setSort] = useState<SortState>({ col: 'reportPdfCreated', dir: 'desc' });

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
        Failed to load clinicians: {error}
      </div>
    );
  }

  const rows        = applySort(clinicians ?? [], sort);
  const peopleCount = new Set(rows.map((c) => c.id)).size;
  const maxScoring = Math.max(...rows.map(scoringCount), 1);
  const maxPdf = Math.max(...rows.map(reportPdfCount), 1);
  const maxCaseload = Math.max(...rows.map((c) => c.activeCaseload), 1);
  const maxActions  = Math.max(...rows.map((c) => c.totalAuditActions), 1);
  const colCount = 10;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Clinician Detail</h2>
          <p className="text-xs text-gray-500 mt-0.5">Scroll horizontally for more columns</p>
        </div>
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
          {rows.length} centre assignment{rows.length !== 1 ? 's' : ''}
          {peopleCount !== rows.length && ` · ${peopleCount} clinicians`}
        </span>
      </div>
      <ScrollRegion maxHeightClass="max-h-[520px]" label="table">
        <table className="w-full min-w-[980px] text-sm" role="table" aria-label="Clinician detail table">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-6 py-3 text-left w-6 text-[10px] font-bold text-gray-500 uppercase tracking-[0.08em]">#</th>
              <SortableTh col="name" label="Clinician" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="asc" />
              <SortableTh col="centreName" label="Centre" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="asc" />
              <SortableTh col="scoringComplete" label="Scoring" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right" />
              <SortableTh col="reportPdfCreated" label="Report PDF" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right" />
              <SortableTh col="activeCaseload" label="Active Caseload" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right" />
              <SortableTh col="yield" label="Completion" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right" title={KPI.CLINICIAN_YIELD.description} />
              <SortableTh col="totalAuditActions" label="Activity" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} align="right" title={KPI.CLINICIAN_AUDIT_ACTIONS.description} />
              <SortableTh col="lastActivityDate" label="Last Activity" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="desc" />
              <SortableTh col="lastLoginDate" label="Last Login" sortCol={sort.col} sortDir={sort.dir} onSort={handleSort} defaultDir="desc" />
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
              rows.map((c, idx) => (
                  <tr key={`${c.id}-${c.centreId ?? idx}`} className="hover:bg-gray-50/70 transition-colors">
                    <td className="px-6 py-3.5 text-[11px] font-bold text-gray-300 tabular-nums">{idx + 1}</td>
                    <td className="px-5 py-3.5 font-medium text-gray-800 whitespace-nowrap">
                      <UserProfileLink
                        userId={c.id}
                        role="clinician"
                        params={{ ...linkParams, centreId: c.centreId }}
                        className="text-gray-800 hover:text-blue-600 hover:underline underline-offset-2 transition-colors"
                      >
                        {c.firstName} {c.lastName}
                      </UserProfileLink>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500 text-xs max-w-[160px] truncate" title={c.centreName ?? ''}>
                      {shortCentreName(c.centreName)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && scoringCount(c) > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-pipeline-scoring',
                            drillUserId: c.id,
                            drillCentreId: c.centreId ?? undefined,
                            label: `Scoring · ${c.firstName} ${c.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums font-semibold text-teal-700">
                            {scoringCount(c).toLocaleString()}
                          </span>
                          <MiniBar value={scoringCount(c)} max={maxScoring} color="bg-teal-500" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums font-semibold text-teal-700">
                            {scoringCount(c).toLocaleString()}
                          </span>
                          <MiniBar value={scoringCount(c)} max={maxScoring} color="bg-teal-500" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && reportPdfCount(c) > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-pipeline-report-pdf',
                            drillUserId: c.id,
                            drillCentreId: c.centreId ?? undefined,
                            label: `Report PDF · ${c.firstName} ${c.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums font-semibold text-[#378ADD]">
                            {reportPdfCount(c).toLocaleString()}
                          </span>
                          <MiniBar value={reportPdfCount(c)} max={maxPdf} color="bg-[#378ADD]" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums font-semibold text-[#378ADD]">
                            {reportPdfCount(c).toLocaleString()}
                          </span>
                          <MiniBar value={reportPdfCount(c)} max={maxPdf} color="bg-[#378ADD]" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {onDrillDown && c.activeCaseload > 0 ? (
                        <button
                          type="button"
                          title={DRILL_DOWN_HINT}
                          onClick={() => onDrillDown({
                            type: 'clinician-caseload',
                            drillUserId: c.id,
                            drillCentreId: c.centreId ?? undefined,
                            label: `Caseload · ${c.firstName} ${c.lastName}`,
                          })}
                          className="text-right rounded-lg hover:bg-gray-100 px-1 -mx-1 py-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                        >
                          <span className="tabular-nums text-[#1D9E75]">
                            {c.activeCaseload.toLocaleString()}
                          </span>
                          <MiniBar value={c.activeCaseload} max={maxCaseload} color="bg-[#1D9E75]" />
                        </button>
                      ) : (
                        <>
                          <span className="tabular-nums text-[#1D9E75]">
                            {c.activeCaseload.toLocaleString()}
                          </span>
                          <MiniBar value={c.activeCaseload} max={maxCaseload} color="bg-[#1D9E75]" />
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <YieldBadge results={reportPdfCount(c)} caseload={c.activeCaseload} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="tabular-nums text-gray-500">
                        {c.totalAuditActions.toLocaleString()}
                      </span>
                      <MiniBar value={c.totalAuditActions} max={maxActions} color="bg-gray-300" />
                    </td>
                    <td className={`px-5 py-3.5 whitespace-nowrap text-sm ${stalenessClass(c.lastActivityDate)}`}>
                      {timeAgo(c.lastActivityDate)}
                    </td>
                    <td className="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm">
                      {timeAgo(c.lastLoginDate)}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </ScrollRegion>
    </div>
  );
}
