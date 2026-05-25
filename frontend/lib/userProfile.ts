import type { UserProfileRole } from './types';

export interface ProfileLinkParams {
  centreId?: number | null;
  dateFrom?: string;
  dateTo?: string;
}

export function buildUserProfileUrl(
  userId: number,
  role: UserProfileRole,
  params: ProfileLinkParams = {},
): string {
  const q = new URLSearchParams();
  q.set('role', role);
  if (params.centreId != null) q.set('centreId', String(params.centreId));
  if (params.dateFrom) q.set('dateFrom', params.dateFrom);
  if (params.dateTo) q.set('dateTo', params.dateTo);
  return `/users/${userId}?${q.toString()}`;
}

/** Map a monitoring-table role + user identity to a profile role. */
export function inferProfileRole(
  roleName: string | null,
  email?: string,
  firstName?: string,
  lastName?: string,
): UserProfileRole | null {
  const identity = `${firstName ?? ''} ${lastName ?? ''} ${email ?? ''}`;
  if (/\(Ops\)/i.test(identity)) return 'centre-admin';

  if (!roleName) return null;
  const n = roleName.toLowerCase().replace(/\s/g, '');
  if (n === 'clinician') return 'clinician';
  if (n === 'superadmin') return null;
  return 'manager';
}

export const ROLE_LABELS: Record<UserProfileRole, string> = {
  clinician: 'Clinician',
  manager: 'Centre Manager',
  'centre-admin': 'Centre Admin',
};
