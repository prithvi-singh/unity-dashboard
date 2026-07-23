'use client';

import {
  resolveRoleSlug,
  resolveRoleLabel,
  resolveRoleBadgeStyle,
  type UserRoleInput,
} from '@/lib/resolveRole';

/**
 * RoleBadge — canonical role badge component.
 *
 * Accepts any combination of user fields and resolves the role slug via the
 * shared resolveRoleSlug() resolver.  The (ops) name convention is handled
 * automatically when firstName / lastName / name are supplied.
 *
 * Colours (design-token spec):
 *   Clinician    #E6F1FB / #0C447C
 *   Manager      #EAF3DE / #3B6D11
 *   Centre Admin #E1F5EE / #0F6E56
 *
 * Always 11px, padding 2px 8px, border-radius 99px, no ring/outline.
 */

interface RoleBadgeProps extends UserRoleInput {
  className?: string;
}

/**
 * Convert CamelCase / PascalCase role names to spaced words.
 * Kept as a named export for callers that use it for label formatting
 * outside of badge rendering (e.g. section headings).
 */
export function formatRoleName(role: string): string {
  return role.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

export default function RoleBadge({
  role,
  firstName,
  lastName,
  name,
  roleName,
  className = '',
}: RoleBadgeProps) {
  // Require at least one field to render
  if (!role && !firstName && !lastName && !name && !roleName) return null;

  const slug = resolveRoleSlug({ role, firstName, lastName, name, roleName });
  const { bg, color } = resolveRoleBadgeStyle(slug);
  const label = resolveRoleLabel(slug);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-none ${className}`}
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}
