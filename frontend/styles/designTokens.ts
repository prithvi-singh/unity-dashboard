/**
 * Design Tokens — Unity Ops Dashboard
 *
 * Single source of truth for all visual design values.
 * Import from here in components; never hard-code these values elsewhere.
 *
 * Usage example:
 *   import { ROLE_BADGE, STATE_COLOR } from '@/styles/designTokens';
 *   <span style={{ background: ROLE_BADGE.clinician.bg, color: ROLE_BADGE.clinician.fg }}>
 *     Clinician
 *   </span>
 */

// ── Role Badges ───────────────────────────────────────────────────────────────
// 11px, padding 2px 8px, border-radius 99px, no outline

export const ROLE_BADGE = {
  clinician: {
    bg:  '#E6F1FB',
    fg:  '#0C447C',
    className: 'text-[11px] font-medium px-2 py-0.5 rounded-full',
  },
  manager: {
    bg:  '#EAF3DE',
    fg:  '#3B6D11',
    className: 'text-[11px] font-medium px-2 py-0.5 rounded-full',
  },
  centreAdmin: {
    bg:  '#E1F5EE',
    fg:  '#0F6E56',
    className: 'text-[11px] font-medium px-2 py-0.5 rounded-full',
  },
  superAdmin: {
    bg:  '#EEEDFE',
    fg:  '#3C3489',
    className: 'text-[11px] font-medium px-2 py-0.5 rounded-full',
  },
  default: {
    bg:  '#F3F4F6',
    fg:  '#6B7280',
    className: 'text-[11px] font-medium px-2 py-0.5 rounded-full',
  },
} as const;

// ── State / Status Colours ────────────────────────────────────────────────────
// Use ONLY these four values for state indication

export const STATE_COLOR = {
  active:   '#1D9E75',  // teal green  — active / positive / engaged
  warning:  '#BA7517',  // amber       — warning / idle / attention
  error:    '#A32D2D',  // red         — error / inactive / critical
  neutral:  '#888780',  // grey        — secondary / unknown / disabled
} as const;

// ── Card Styles ───────────────────────────────────────────────────────────────

/**
 * 1. Metric card — summary numbers (Total Cases, Active Centres, etc.)
 *    bg-gray-50, no border, rounded-xl, p-4
 */
export const CARD_METRIC = 'bg-gray-50 rounded-xl p-4';

/**
 * 2. Content card — tables, charts, panels
 *    bg-white, border border-gray-200, rounded-xl, p-4
 */
export const CARD_CONTENT = 'bg-white rounded-xl border border-gray-200';

/**
 * 3. User card — swimlane entries, profile cards
 *    bg-white, 0.5px border, rounded-xl, coloured left border for state
 */
export const CARD_USER = 'bg-white rounded-xl border border-gray-100';

// Left-border variants for user cards
export const CARD_USER_LEFT_BORDER = {
  active:  'border-l-2 border-l-[#1D9E75]',
  warning: 'border-l-2 border-l-[#BA7517]',
  error:   'border-l-2 border-l-[#A32D2D]',
  neutral: 'border-l-2 border-l-[#888780]',
} as const;

// ── Table Styles ──────────────────────────────────────────────────────────────

export const TABLE_HEADER_CELL =
  'text-[12px] font-medium text-gray-500 uppercase tracking-[0.03em] py-[7px] px-[10px]';

export const TABLE_BODY_ROW =
  'text-[13px] text-gray-900 border-b border-gray-100 hover:bg-gray-50 transition-colors';

export const TABLE_BODY_CELL = 'py-[7px] px-[10px]';

export const TABLE_NUM_CELL  = `${TABLE_BODY_CELL} text-right tabular-nums`;
export const TABLE_TEXT_CELL = `${TABLE_BODY_CELL} text-left`;

// ── Section Titles ────────────────────────────────────────────────────────────

/**
 * Within-tab section header — not the tab title itself
 * 14px, font-weight 500, text-gray-900, margin-bottom 12px
 */
export const SECTION_TITLE    = 'text-[14px] font-medium text-gray-900';
export const SECTION_SUBTITLE = 'text-[12px] text-gray-500 mt-0.5';
export const SECTION_MB       = 'mb-3';  // 12px margin-bottom before content

// ── Empty State ───────────────────────────────────────────────────────────────

/**
 * Centred empty state: icon + primary text + hint subtext
 * Use inside a card with py-10 (40px padding top + bottom)
 */
export const EMPTY_STATE = {
  wrapper:   'flex flex-col items-center py-10 gap-2',
  iconColor: 'text-gray-300',
  iconSize:  'w-6 h-6',
  text:      'text-[14px] text-gray-500',
  subtext:   'text-[12px] text-gray-400',
  hint:      'Try adjusting the date range or centre filter',
} as const;

// ── Loading / Skeleton ────────────────────────────────────────────────────────

/**
 * Standard skeleton block — grey animated placeholder.
 * Apply animate-pulse to a parent wrapper.
 */
export const SKELETON_BASE  = 'bg-gray-100 rounded';
export const SKELETON_BLOCK = `${SKELETON_BASE} animate-pulse`;

// ── Top Bar ───────────────────────────────────────────────────────────────────

export const TOP_BAR = {
  bg:       'bg-slate-900',
  border:   'border-b border-slate-800',
  height:   'min-h-[52px]',
  text:     'text-slate-300',
  textMute: 'text-slate-500',
} as const;

// ── Tab Nav ───────────────────────────────────────────────────────────────────

export const TAB_NAV = {
  wrapper: 'flex bg-white border-b border-gray-200 overflow-x-auto scrollbar-none px-1 sm:px-5 shadow-sm',
  active:  'border-blue-500 text-blue-600',
  idle:    'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
} as const;
