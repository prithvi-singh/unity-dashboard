import type { Clinician, Manager, CentreAdmin } from './types';
import type { RoleCentreRow } from './roleDrillDown';
import { uniquePeopleCount } from './aggregatePeople';

const INACTIVE_DAYS = 7;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function isInactive(lastActivityDate: string | null): boolean {
  const days = daysSince(lastActivityDate);
  return days === null || days > INACTIVE_DAYS;
}

export function aggregateCliniciansByCentre(rows: Clinician[]): RoleCentreRow[] {
  const map = new Map<number, RoleCentreRow>();
  for (const r of rows) {
    if (r.centreId == null) continue;
    const existing = map.get(r.centreId);
    if (!existing) {
      map.set(r.centreId, {
        centreId: r.centreId,
        centreName: r.centreName ?? 'Unknown',
        metric1: r.activeCaseload ?? 0,
        metric2: r.resultsGenerated ?? 0,
        metric3: r.totalAuditActions ?? 0,
      });
    } else {
      existing.metric1 += r.activeCaseload ?? 0;
      existing.metric2 += r.resultsGenerated ?? 0;
      existing.metric3 += r.totalAuditActions ?? 0;
    }
  }
  return [...map.values()].sort((a, b) => centreRowTotal(b) - centreRowTotal(a));
}

export function aggregateManagersByCentre(rows: Manager[]): RoleCentreRow[] {
  const visible = rows.filter((m) => m.roleName !== 'Super Admin');
  const map = new Map<number, RoleCentreRow>();
  for (const r of visible) {
    if (r.centreId == null) continue;
    const existing = map.get(r.centreId);
    if (!existing) {
      map.set(r.centreId, {
        centreId: r.centreId,
        centreName: r.centreName ?? 'Unknown',
        metric1: r.casesRegistered ?? 0,
        metric2: r.assessmentsAssigned ?? 0,
        metric3: 0,
      });
    } else {
      existing.metric1 += r.casesRegistered ?? 0;
      existing.metric2 += r.assessmentsAssigned ?? 0;
    }
  }
  return [...map.values()].sort((a, b) => centreRowTotal(b) - centreRowTotal(a));
}

export function aggregateAdminsByCentre(rows: CentreAdmin[]): RoleCentreRow[] {
  const map = new Map<number, RoleCentreRow>();
  for (const r of rows) {
    if (r.centreId == null) continue;
    const existing = map.get(r.centreId);
    if (!existing) {
      map.set(r.centreId, {
        centreId: r.centreId,
        centreName: r.centreName ?? 'Unknown',
        metric1: r.casesRegistered ?? 0,
        metric2: r.casesAssignedToClinical ?? 0,
        metric3: Math.max(0, (r.casesRegistered ?? 0) - (r.casesAssignedToClinical ?? 0)),
      });
    } else {
      existing.metric1 += r.casesRegistered ?? 0;
      existing.metric2 += r.casesAssignedToClinical ?? 0;
      existing.metric3 += Math.max(0, (r.casesRegistered ?? 0) - (r.casesAssignedToClinical ?? 0));
    }
  }
  return [...map.values()].sort((a, b) => centreRowTotal(b) - centreRowTotal(a));
}

function centreRowTotal(row: RoleCentreRow): number {
  return row.metric1 + row.metric2 + row.metric3;
}

/**
 * Format a goals count as "N (total)" for display.
 * N = distinct assessments, total = individual goal items.
 * Never suppressed — always shows both numbers.
 */
export function goalsDisplay(n: number, total: number): string {
  return `${n.toLocaleString()} (${total.toLocaleString()})`;
}

export function clinicianKpis(rows: Clinician[]) {
  const people = uniquePeopleCount(rows);

  // Clinicians appear once per centre assignment. Per-clinician metrics (activeCaseload,
  // resultsGenerated, goalsAdded) must be summed only once per unique clinician ID.
  const seenIds = new Set<number>();
  let totalCaseload = 0;
  let totalResults  = 0;
  let totalGoalsAdded      = 0;
  let totalGoalsAddedItems = 0;
  for (const r of rows) {
    if (seenIds.has(r.id)) continue;
    seenIds.add(r.id);
    totalCaseload       += r.activeCaseload   ?? 0;
    totalResults        += r.resultsGenerated ?? 0;
    totalGoalsAdded      += r.goalsAdded      ?? 0;
    totalGoalsAddedItems += r.goalsAddedItems ?? 0;
  }

  const activeCount = new Set(rows.filter((r) => (r.coreJobDays ?? 0) > 0).map((r) => r.id)).size;
  const yieldPct = totalCaseload + totalResults > 0
    ? Math.round((totalResults / (totalCaseload + totalResults)) * 100)
    : 0;
  return {
    people, totalCaseload, totalResults, activeCount, yieldPct, assignments: rows.length,
    totalGoalsAdded, totalGoalsAddedItems,
  };
}

export function managerKpis(rows: Manager[]) {
  const visible = rows.filter((m) => m.roleName !== 'Super Admin');
  const people = uniquePeopleCount(visible);
  const totalCases = visible.reduce((s, r) => s + (r.casesRegistered ?? 0), 0);
  const totalAssigned = visible.reduce((s, r) => s + (r.assessmentsAssigned ?? 0), 0);
  const totalReportsApproved = visible.reduce((s, r) => s + (r.reportsApproved ?? 0), 0);
  const totalGoalsApproved      = visible.reduce((s, r) => s + (r.goalsApproved ?? 0), 0);
  const totalGoalsApprovedItems = visible.reduce((s, r) => s + (r.goalsApprovedItems ?? 0), 0);
  // Active = performed core job in period (coreJobDays > 0 is the right signal)
  const activeCount = new Set(visible.filter((r) => (r.coreJobDays ?? 0) > 0).map((r) => r.id)).size;
  const assignPct = totalCases > 0 ? Math.min(Math.round((totalAssigned / totalCases) * 100), 100) : 0;
  return {
    people, totalCases, totalAssigned, totalReportsApproved,
    totalGoalsApproved, totalGoalsApprovedItems,
    activeCount, assignPct, assignments: visible.length,
  };
}

export function adminKpis(rows: CentreAdmin[]) {
  const people = uniquePeopleCount(rows);
  const totalRegistered = rows.reduce((s, r) => s + (r.casesRegistered ?? 0), 0);
  const totalAssigned = rows.reduce((s, r) => s + (r.casesAssignedToClinical ?? 0), 0);
  const activeCount = new Set(rows.filter((r) => !isInactive(r.lastActivityDate)).map((r) => r.id)).size;
  const routingPct = totalRegistered > 0 ? Math.min(Math.round((totalAssigned / totalRegistered) * 100), 100) : 0;
  return { people, totalRegistered, totalAssigned, activeCount, routingPct, assignments: rows.length };
}

export function clinicianFunnel(rows: Clinician[]) {
  const caseload = rows.reduce((s, r) => s + (r.activeCaseload ?? 0), 0);
  const active = rows.filter((r) => (r.totalAuditActions ?? 0) > 0).reduce((s, r) => s + (r.activeCaseload ?? 0), 0);
  const results = rows.reduce((s, r) => s + (r.resultsGenerated ?? 0), 0);
  return { caseload, active, results };
}

export function managerFunnel(rows: Manager[]) {
  const visible = rows.filter((m) => m.roleName !== 'Super Admin');
  const registered = visible.reduce((s, r) => s + (r.casesRegistered ?? 0), 0);
  const assigned = visible.reduce((s, r) => s + (r.assessmentsAssigned ?? 0), 0);
  const activeManagers = new Set(visible.filter((r) => !isInactive(r.lastActivityDate)).map((r) => r.id)).size;
  return { registered, assigned, activeManagers };
}

export function adminFunnel(rows: CentreAdmin[]) {
  const registered = rows.reduce((s, r) => s + (r.casesRegistered ?? 0), 0);
  const assigned = rows.reduce((s, r) => s + (r.casesAssignedToClinical ?? 0), 0);
  const activeAdmins = new Set(rows.filter((r) => !isInactive(r.lastActivityDate)).map((r) => r.id)).size;
  return { registered, assigned, activeAdmins };
}
