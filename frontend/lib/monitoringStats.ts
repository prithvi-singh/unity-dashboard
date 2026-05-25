import type { MonitoringUser, HeatmapEntry, MonitoringData } from '@/lib/types';

export const isSuperAdmin = (role: string | null) =>
  !!role && role.toLowerCase().replace(/\s/g, '') === 'superadmin';

export function dedupeMonitoringUsers(users: MonitoringUser[]): MonitoringUser[] {
  const seen = new Set<number>();
  return users
    .filter((u) => !isSuperAdmin(u.roleName))
    .filter((u) => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
}

export function localDateISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function lastNDays(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(localDateISO(d));
  }
  return dates;
}

export type MonitoringRoleGroup = 'clinician' | 'manager' | 'centre-admin' | 'other';

export const MONITORING_ROLE_ORDER: MonitoringRoleGroup[] = [
  'clinician',
  'manager',
  'centre-admin',
  'other',
];

export const MONITORING_ROLE_LABELS: Record<MonitoringRoleGroup, string> = {
  clinician: 'Clinicians',
  manager: 'Centre managers',
  'centre-admin': 'Centre admins (Ops)',
  other: 'Other accounts',
};

/** Group Unity accounts into roles ops staff recognise. */
export function getMonitoringRoleGroup(user: MonitoringUser): MonitoringRoleGroup {
  const identity = `${user.firstName ?? ''} ${user.lastName ?? ''} ${user.email ?? ''}`;
  if (/\(Ops\)/i.test(identity)) return 'centre-admin';

  const role = (user.roleName ?? '').toLowerCase().replace(/\s/g, '');
  if (role === 'clinician') return 'clinician';
  if (role === 'manager' || role === 'centremanager') return 'manager';
  if (role === 'centreadmin') return 'centre-admin';
  return 'other';
}

export interface EngagementRoleRow {
  roleGroup: MonitoringRoleGroup;
  label: string;
  total: number;
  loggedIn: number;
  active: number;
  powerUsers: number;
  inactive: number;
  engagementPct: number;
}

export type MonitoringEngagementFilter =
  | { kind: 'all' }
  | { kind: 'logged-in' }
  | { kind: 'active' }
  | { kind: 'power-users' }
  | { kind: 'inactive' }
  | { kind: 'role'; roleGroup: MonitoringRoleGroup; tier: 'all' | 'logged-in' | 'active' | 'inactive' | 'power-users' };

export const MONITORING_FILTER_LABELS: Record<MonitoringEngagementFilter['kind'], string> = {
  all: 'All staff',
  'logged-in': 'Signed in today',
  active: 'Did case work today',
  'power-users': 'High activity (5+ actions)',
  inactive: 'No activity today',
  role: 'Filtered by role',
};

export function engagementFilterLabel(filter: MonitoringEngagementFilter): string {
  if (filter.kind === 'role') {
    const role = MONITORING_ROLE_LABELS[filter.roleGroup];
    switch (filter.tier) {
      case 'logged-in': return `${role} · signed in`;
      case 'active': return `${role} · active today`;
      case 'inactive': return `${role} · needs nudge`;
      case 'power-users': return `${role} · high activity`;
      default: return role;
    }
  }
  return MONITORING_FILTER_LABELS[filter.kind];
}

export function matchesEngagementFilter(user: MonitoringUser, filter: MonitoringEngagementFilter): boolean {
  if (filter.kind === 'all') return true;

  const roleGroup = getMonitoringRoleGroup(user);

  if (filter.kind === 'role') {
    if (roleGroup !== filter.roleGroup) return false;
    switch (filter.tier) {
      case 'logged-in': return user.loggedInToday;
      case 'active': return user.active;
      case 'inactive': return !user.active;
      case 'power-users': return user.actionCount >= 5;
      default: return true;
    }
  }

  switch (filter.kind) {
    case 'logged-in': return user.loggedInToday;
    case 'active': return user.active;
    case 'power-users': return user.actionCount >= 5;
    case 'inactive': return !user.active;
    default: return true;
  }
}

export function aggregateEngagementByRole(users: MonitoringUser[]): EngagementRoleRow[] {
  const deduped = dedupeMonitoringUsers(users);
  const buckets = new Map<MonitoringRoleGroup, EngagementRoleRow>();

  for (const group of MONITORING_ROLE_ORDER) {
    buckets.set(group, {
      roleGroup: group,
      label: MONITORING_ROLE_LABELS[group],
      total: 0,
      loggedIn: 0,
      active: 0,
      powerUsers: 0,
      inactive: 0,
      engagementPct: 0,
    });
  }

  for (const user of deduped) {
    const row = buckets.get(getMonitoringRoleGroup(user))!;
    row.total += 1;
    if (user.loggedInToday) row.loggedIn += 1;
    if (user.active) row.active += 1;
    if (user.actionCount >= 5) row.powerUsers += 1;
    if (!user.active) row.inactive += 1;
  }

  return MONITORING_ROLE_ORDER
    .map((group) => buckets.get(group)!)
    .filter((row) => row.total > 0)
    .map((row) => ({
      ...row,
      engagementPct: row.total > 0 ? (row.active / row.total) * 100 : 0,
    }));
}

export interface MonitoringDayStats {
  users: MonitoringUser[];
  total: number;
  loggedIn: number;
  active: number;
  powerUsers: number;
  needsAttention: number;
  totalActions: number;
  centresActive: number;
  engagementPct: number;
  byRole: EngagementRoleRow[];
  coreStaff: number;
  coreActive: number;
}

export function computeDayStats(data: MonitoringData | null): MonitoringDayStats | null {
  if (!data) return null;
  const users = dedupeMonitoringUsers(data.users);
  const total = users.length;
  const loggedIn = users.filter((u) => u.loggedInToday).length;
  const active = users.filter((u) => u.active).length;
  const powerUsers = users.filter((u) => u.actionCount >= 5).length;
  const needsAttention = users.filter((u) => !u.active).length;
  const totalActions = users.reduce((s, u) => s + u.actionCount, 0);
  const centresActive = new Set(
    users.filter((u) => u.active && u.centreName).map((u) => u.centreName),
  ).size;
  const engagementPct = total > 0 ? (active / total) * 100 : 0;
  const byRole = aggregateEngagementByRole(users);
  const coreStaff = byRole
    .filter((row) => row.roleGroup !== 'other')
    .reduce((sum, row) => sum + row.total, 0);
  const coreActive = byRole
    .filter((row) => row.roleGroup !== 'other')
    .reduce((sum, row) => sum + row.active, 0);

  return {
    users,
    total,
    loggedIn,
    active,
    powerUsers,
    needsAttention,
    totalActions,
    centresActive,
    engagementPct,
    byRole,
    coreStaff,
    coreActive,
  };
}

export interface CentreActionRow {
  centreName: string;
  actions: number;
  activeUsers: number;
}

export function aggregateByCentre(users: MonitoringUser[]): CentreActionRow[] {
  const map = new Map<string, { actions: number; activeUsers: number }>();
  for (const u of users) {
    const name = u.centreName ?? 'Unassigned';
    const row = map.get(name) ?? { actions: 0, activeUsers: 0 };
    row.actions += u.actionCount;
    if (u.active) row.activeUsers += 1;
    map.set(name, row);
  }
  return [...map.entries()]
    .map(([centreName, v]) => ({ centreName, ...v }))
    .sort((a, b) => b.actions - a.actions);
}

export function aggregateHeatmapByDate(
  heatmap: HeatmapEntry[],
  days: string[],
): { date: string; count: number }[] {
  const totals = new Map<string, number>(days.map((d) => [d, 0]));
  for (const entry of heatmap) {
    for (const day of entry.days) {
      if (totals.has(day.date)) {
        totals.set(day.date, (totals.get(day.date) ?? 0) + day.count);
      }
    }
  }
  return days.map((date) => ({ date, count: totals.get(date) ?? 0 }));
}

export function topUsersByHeatmap(
  users: MonitoringUser[],
  heatmap: HeatmapEntry[],
  limit: number,
): MonitoringUser[] {
  const totals = new Map<number, number>();
  for (const entry of heatmap) {
    totals.set(entry.userId, entry.days.reduce((s, d) => s + d.count, 0));
  }
  return [...dedupeMonitoringUsers(users)]
    .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
    .slice(0, limit);
}
