/**
 * Date formatting utilities for the Unity Dashboard.
 *
 * All functions accept ISO 8601 strings (including full datetimes) and return
 * human-readable labels. Never call `new Date(str).toString()` or raw
 * `.toLocaleDateString()` directly in components — use these helpers instead.
 */

/**
 * Format a full datetime string as a relative/contextual label with time.
 * Used in Recent Actions and any timestamp that includes both date and time.
 *
 * Examples:
 *   "Today, 14:28"
 *   "Yesterday, 09:05"
 *   "Mon, 11:30"
 *   "12 May, 08:00"
 *   "3 Jan 2025, 16:44"
 */
export function formatActionDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  if (dateOnly.getTime() === today.getTime())     return `Today, ${time}`;
  if (dateOnly.getTime() === yesterday.getTime()) return `Yesterday, ${time}`;

  const diffDays = Math.floor((today.getTime() - dateOnly.getTime()) / 86_400_000);
  if (diffDays < 7) {
    return `${date.toLocaleDateString('en-IN', { weekday: 'short' })}, ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
  }
  return `${date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })}, ${time}`;
}

/**
 * Format a date-only string as a relative label (no time).
 * Used for "last active", "assigned date", etc.
 *
 * Examples:
 *   "Today", "Yesterday", "3 days ago", "2w ago", "12 May", "3 Jan 2025"
 */
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - dateOnly.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) {
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * Returns a short date label used for day-group dividers in the timeline.
 * Examples: "Today", "Yesterday", "19 May", "3 Jan 2025"
 */
export function formatDateGroupLabel(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '—';

  const now      = new Date();
  const today    = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly.getTime() === today.getTime())     return 'Today';
  if (dateOnly.getTime() === yesterday.getTime()) return 'Yesterday';
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/**
 * Returns true if the given date falls on a Sunday.
 * Accepts either an ISO date string or a Date object.
 * When a string is passed, appends T12:00:00 to avoid DST-edge midnight issues.
 */
export function isSunday(date: Date | string): boolean {
  const d = typeof date === 'string'
    ? new Date(`${date.slice(0, 10)}T12:00:00`)
    : date;
  return !isNaN(d.getTime()) && d.getDay() === 0;
}

/** Returns true if the given date falls on a Saturday. */
export function isSaturday(date: Date | string): boolean {
  const d = typeof date === 'string'
    ? new Date(`${date.slice(0, 10)}T12:00:00`)
    : date;
  return !isNaN(d.getTime()) && d.getDay() === 6;
}

/** Returns true if the given date falls on a Saturday or Sunday. */
export function isWeekend(date: Date | string): boolean {
  return isSunday(date) || isSaturday(date);
}

/** Returns true if the given date is a working day (Mon–Fri). */
export function isWorkingDay(date: Date | string): boolean {
  return !isWeekend(date);
}

/** Returns the day-of-month as a string, e.g. "27". */
export function formatCalendarDate(date: Date): string {
  return date.getDate().toString();
}

/** Returns a short month label in en-IN locale, e.g. "May". */
export function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short' });
}

/**
 * Generates an inclusive array of Date objects from startDate to endDate.
 * Iteration uses LOCAL date arithmetic (getDate/setDate) to stay correct
 * across DST boundaries. Each pushed Date represents midnight LOCAL time
 * for that calendar day.
 */
export function generateDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Converts a Date object to a YYYY-MM-DD string using LOCAL date components.
 *
 * NEVER use `date.toISOString().slice(0, 10)` for calendar work — that returns
 * the UTC date which is one day behind for UTC+ timezones (e.g. IST at midnight
 * is already the previous UTC day).
 */
export function toLocalISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
