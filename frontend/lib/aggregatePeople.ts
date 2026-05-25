/** Merge duplicate rows (multi-centre) by summing numeric metrics per person id. */

interface HasId {
  id: number;
}

type NumericKeys<T> = {
  [K in keyof T]: T[K] extends number ? K : never;
}[keyof T];

export function aggregateByPerson<T extends HasId>(
  rows: T[],
  sumKeys: NumericKeys<T>[],
  latestDateKey?: keyof T,
): T[] {
  const map = new Map<number, T>();

  for (const row of rows) {
    const existing = map.get(row.id);
    if (!existing) {
      map.set(row.id, { ...row });
      continue;
    }

    const merged = { ...existing } as T;
    for (const key of sumKeys) {
      const a = (merged[key] as number) || 0;
      const b = (row[key] as number) || 0;
      (merged as Record<string, unknown>)[key as string] = a + b;
    }

    if (latestDateKey) {
      const a = merged[latestDateKey] as string | null;
      const b = row[latestDateKey] as string | null;
      if (b && (!a || b > a)) {
        (merged as Record<string, unknown>)[latestDateKey as string] = b;
      }
    }

    map.set(row.id, merged);
  }

  return [...map.values()];
}

export function shortPersonName(firstName: string, lastName: string, max = 18): string {
  const full = `${firstName} ${lastName}`.trim();
  if (full.length <= max) return full;
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0);
  const short = initial && initial !== '-' ? `${first} ${initial}.` : first;
  return short.length <= max ? short : `${short.slice(0, max - 1)}…`;
}

/** Chart label for a person at a specific centre (multi-centre staff appear once per centre). */
export function personCentreChartLabel(
  firstName: string,
  lastName: string,
  centreName: string | null | undefined,
  shortCentre: (name: string | null | undefined) => string,
): { shortLabel: string; fullLabel: string } {
  const person = shortPersonName(firstName, lastName, 14);
  const centre = shortCentre(centreName);
  const fullLabel = `${firstName} ${lastName}${centreName ? ` · ${centreName}` : ''}`;
  const shortLabel = centre && centre !== '—' ? `${person} · ${centre}` : person;
  return { shortLabel, fullLabel };
}

export function uniquePeopleCount<T extends HasId>(rows: T[]): number {
  return new Set(rows.map((r) => r.id)).size;
}
