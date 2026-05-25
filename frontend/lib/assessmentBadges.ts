const ASSESSMENT_STYLES: Record<string, string> = {
  SPM: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  DP3: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  REELS: 'bg-amber-50 text-amber-800 ring-amber-200/60',
  ISAA: 'bg-violet-50 text-violet-700 ring-violet-200/60',
};

const DEFAULT_STYLE = 'bg-gray-50 text-gray-700 ring-gray-200/60';

export function assessmentBadgeClass(type: string | null | undefined): string {
  if (!type) return DEFAULT_STYLE;
  const key = type.trim().toUpperCase();
  return ASSESSMENT_STYLES[key] ?? DEFAULT_STYLE;
}

export function normalizeAssessmentType(type: string | null | undefined): string {
  if (!type) return 'Unknown';
  return type.trim().toUpperCase();
}
