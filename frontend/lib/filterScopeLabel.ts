import type { Centre } from '@/lib/types';
import { formatPeriodLabel } from '@/lib/datePresets';
import { shortCentreName } from '@/lib/centreNames';

export function filterScopeLabel(
  centres: Centre[],
  centreId: number | undefined,
  dateFrom: string,
  dateTo: string,
): string {
  const centre = centreId ? centres.find((c) => c.id === centreId) : null;
  const centrePart = centre ? shortCentreName(centre.name) : 'All centres';
  const periodPart = formatPeriodLabel(dateFrom, dateTo);
  return `${centrePart} · ${periodPart}`;
}
