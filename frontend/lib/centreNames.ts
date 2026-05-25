const APOSTROPHE_VARIANTS = /[\u2018\u2019\u0027\u0060\u00B4]/g;

function normalizeCentreName(name: string): string {
  return name.replace(APOSTROPHE_VARIANTS, "'").trim();
}

/**
 * Shorten long Mom's Belief centre names for display (e.g. tables, charts).
 * Full names are unchanged in data; use title={name} for hover detail.
 */
export function shortCentreName(name: string | null | undefined): string {
  if (!name) return '—';

  const normalized = normalizeCentreName(name);

  return normalized
    .replace(
      /Mom'?s?\s+Belief\s+Athena\s+Child\s+Development\s+Cent(?:re|er)s?\s*/gi,
      'MBACDC ',
    )
    .replace(
      /Mom'?s?\s+Belief\s+Learning\s+Cent(?:re|er)s?\s*/gi,
      'MBLC ',
    )
    .replace(/Mom'?s?\s+Belief\s+/gi, 'MB ')
    .replace(/\s+/g, ' ')
    .trim();
}
