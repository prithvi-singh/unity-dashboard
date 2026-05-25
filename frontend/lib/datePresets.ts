/** Shared date helpers for dashboard filters and URL state. */

export function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Sensible go-live default: last 30 days through today. */
export function defaultDashboardPeriod(): { from: string; to: string } {
  return { from: shiftDays(-29), to: todayISO() };
}

export function formatPeriodLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  const fmt = (s: string) => {
    const d = new Date(`${s}T00:00`);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  if (from && to && from === to) return fmt(from);
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return `Until ${fmt(to)}`;
}
