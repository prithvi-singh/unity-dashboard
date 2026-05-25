export interface DrillDownRow {
  category: string | null;
  waitingHours: number | null;
  detail: string | null;
}

export interface DetailLine {
  label: string;
  value: string;
}

export interface StructuredDetail {
  assessment: string | null;
  clinician: string | null;
  actionLabel: string | null;
  actionBy: string | null;
  note: string | null;
}

/** Split backend detail strings like "SPM · Clinician: Jane · Assigned by: John". */
export function parseDrillDownDetail(detail: string | null): DetailLine[] {
  if (!detail?.trim()) return [];

  return detail
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const colonIdx = part.indexOf(': ');
      if (colonIdx > 0) {
        return {
          label: part.slice(0, colonIdx),
          value: part.slice(colonIdx + 2),
        };
      }
      return { label: 'Assessment', value: part };
    });
}

export function parseStructuredDetail(detail: string | null): StructuredDetail {
  const lines = parseDrillDownDetail(detail);
  if (lines.length === 0) {
    return { assessment: null, clinician: null, actionLabel: null, actionBy: null, note: null };
  }

  let assessment: string | null = null;
  let clinician: string | null = null;
  let actionLabel: string | null = null;
  let actionBy: string | null = null;

  for (const line of lines) {
    const label = line.label.toLowerCase();
    if (line.label === 'Assessment') {
      assessment = line.value;
    } else if (line.label === 'Clinician') {
      clinician = line.value;
    } else if (label.endsWith(' by')) {
      actionLabel = line.label;
      actionBy = line.value;
    }
  }

  const structured = assessment || clinician || actionBy;
  return {
    assessment,
    clinician,
    actionLabel,
    actionBy,
    note: structured ? null : detail,
  };
}

export function actionColumnHeader(items: DrillDownRow[]): string {
  for (const item of items) {
    const { actionLabel } = parseStructuredDetail(item.detail);
    if (actionLabel) return actionLabel;
  }
  return 'Actioned by';
}

export function useCompactPipelineLayout(items: DrillDownRow[]): boolean {
  if (showCategoryColumn(items) || hasWaitingData(items)) return false;
  return items.every((item) => {
    const { note } = parseStructuredDetail(item.detail);
    return note === null;
  });
}

export function hasWaitingData(items: DrillDownRow[]): boolean {
  return items.some((item) => item.waitingHours != null);
}

/** Hide category when every row shares the same label (e.g. pipeline stage drill-down). */
export function showCategoryColumn(items: DrillDownRow[]): boolean {
  if (items.length === 0) return false;
  const categories = new Set(items.map((item) => item.category).filter(Boolean));
  return categories.size > 1;
}

export function waitingColumnLabel(isUserList: boolean): string {
  return isUserList ? 'Idle' : 'Waiting';
}
