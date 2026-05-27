'use client';

/**
 * RoleBadge — canonical role badge component.
 *
 * Colours match the design-token spec:
 *   Clinician      #E6F1FB / #0C447C
 *   Centre Manager #EAF3DE / #3B6D11
 *   Centre Admin   #E1F5EE / #0F6E56
 *   Super Admin    #EEEDFE / #3C3489
 *   Default        #F3F4F6 / #6B7280
 *
 * Always 11px, padding 2px 8px, border-radius 99px, no ring/outline.
 */

interface RoleBadgeProps {
  role: string | null | undefined;
  className?: string;
}

type BadgeStyle = { bg: string; fg: string };

function getBadgeStyle(role: string): BadgeStyle {
  const lower = role.toLowerCase();
  if (lower.includes('super')) return { bg: '#EEEDFE', fg: '#3C3489' };
  if (lower.includes('clinician'))                             return { bg: '#E6F1FB', fg: '#0C447C' };
  if (lower.includes('centre manager') || lower.includes('centerManager') || lower.includes('centremanager'))
    return { bg: '#EAF3DE', fg: '#3B6D11' };
  if (lower.includes('manager'))                               return { bg: '#EAF3DE', fg: '#3B6D11' };
  if (lower.includes('centre admin') || lower.includes('centreadmin') || lower.includes('ops'))
    return { bg: '#E1F5EE', fg: '#0F6E56' };
  if (lower.includes('admin'))                                 return { bg: '#E1F5EE', fg: '#0F6E56' };
  return { bg: '#F3F4F6', fg: '#6B7280' };
}

/** Convert CamelCase / PascalCase role names to spaced words: "CentreManager" → "Centre Manager" */
export function formatRoleName(role: string): string {
  return role.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

export default function RoleBadge({ role, className = '' }: RoleBadgeProps) {
  if (!role) return null;
  const { bg, fg } = getBadgeStyle(role);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-none ${className}`}
      style={{ backgroundColor: bg, color: fg }}
    >
      {formatRoleName(role)}
    </span>
  );
}
