export const DASHBOARD_TABS = [
  'Overview',
  'Live',
  'Team',
  'Issues',
] as const;

export const TAB_SLUGS = [
  'overview',
  'live',
  'team',
  'issues',
] as const;

export type DashboardTabSlug = (typeof TAB_SLUGS)[number];

/**
 * Legacy slug aliases — old ?tab= values resolve to the new slug.
 * Allows bookmarked URLs like ?tab=clinicians or ?tab=bottlenecks to keep working.
 */
export const TAB_SLUG_ALIASES: Record<string, DashboardTabSlug> = {
  monitoring: 'live',
  clinicians: 'team',
  managers:   'team',
  ops:        'team',
  users:      'team',
  bottlenecks:'issues',
  assessments:'issues',
  pipeline:   'overview',
};

export function tabIndexFromSlug(slug: string | null | undefined): number {
  if (!slug) return 0;
  const resolved = (TAB_SLUG_ALIASES[slug] ?? slug) as DashboardTabSlug;
  const i = TAB_SLUGS.indexOf(resolved);
  return i >= 0 ? i : 0;
}

export function tabSlugFromIndex(index: number): DashboardTabSlug {
  return TAB_SLUGS[index] ?? 'overview';
}
