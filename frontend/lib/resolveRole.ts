/**
 * resolveRole — single source of truth for deriving a canonical role slug,
 * display label, and badge style from any combination of user fields.
 *
 * Rules (in priority order):
 *   1. Name contains "(ops)" (case-insensitive) → centre-admin
 *      This is the system-wide convention for ops/Centre Admin users who have
 *      no distinct DB role.
 *   2. roleName / role string contains "clinician" → clinician
 *   3. roleName / role string contains "manager"   → manager
 *   4. roleName / role string contains "admin"     → centre-admin
 *   5. Fallback → clinician
 */

export type UserRoleSlug = 'clinician' | 'manager' | 'centre-admin';

export interface UserRoleInput {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;     // combined name fallback (e.g. from APIs that return a single field)
  roleName?: string | null; // DB role name e.g. "Centre Manager", "Clinician"
  role?: string | null;     // slug if already known e.g. "manager", "clinician", or a label
}

export function resolveRoleSlug(user: UserRoleInput): UserRoleSlug {
  const fullName = [user.firstName, user.lastName, user.name]
    .filter(Boolean)
    .join(' ');

  // (Ops) in name takes priority over everything — this is the only reliable
  // signal for Centre Admins whose DB role is often "Centre Manager".
  if (fullName.toLowerCase().includes('(ops)')) return 'centre-admin';

  const roleStr = (user.roleName ?? user.role ?? '').toLowerCase();
  if (roleStr.includes('clinician')) return 'clinician';
  if (roleStr.includes('manager'))   return 'manager';
  if (roleStr.includes('admin'))     return 'centre-admin';

  return 'clinician';
}

export function resolveRoleLabel(slug: UserRoleSlug): string {
  switch (slug) {
    case 'clinician':    return 'Clinician';
    case 'manager':      return 'Manager';
    case 'centre-admin': return 'Centre Admin';
  }
}

export function resolveRoleBadgeStyle(slug: UserRoleSlug): { bg: string; color: string } {
  switch (slug) {
    case 'clinician':    return { bg: '#E6F1FB', color: '#0C447C' };
    case 'manager':      return { bg: '#EAF3DE', color: '#3B6D11' };
    case 'centre-admin': return { bg: '#E1F5EE', color: '#0F6E56' };
  }
}
