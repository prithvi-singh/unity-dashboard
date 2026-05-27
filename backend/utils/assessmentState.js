'use strict';

/**
 * Assessment State Classification
 * ================================
 * Single source of truth for how Unity determines the true state of each
 * assessment. Import classifyAssessment() everywhere — never re-implement
 * this logic in routes.
 *
 * ════════════════════════════════════════════════════════════════════════
 * STEP 0 INVESTIGATION FINDINGS (2026-05-27)
 * ════════════════════════════════════════════════════════════════════════
 *
 * AllocatePatient.Status — complete list of ALL values in the database:
 *   NotStarted  (292 rows) → ACTIVE
 *   InProgress  (211 rows) → ACTIVE
 *   Completed    (54 rows) → TERMINAL ← the ONLY terminal value
 *   OnHold       (14 rows) → ACTIVE
 *
 * No 'Closed', 'Cancelled', 'Inactive', or 'Resolved' values exist.
 *
 * THREE completion paths:
 *
 * Path 1 — Old direct completion:
 *   AllocatePatient.Status = 'Completed' set directly (pre-dates goal workflow).
 *   Assessment may lack AssessmentResultGenerated in audit log — MUST check
 *   status FIRST so these are never counted as "overdue scoring".
 *
 * Path 2 — New goal workflow:
 *   PatientGoalApprovalRequestGoal.Status = 'Approved' for a goal linked to
 *   this patient's assessment. 24 approved goals in the database.
 *
 * Path 3 — Manual close ("Close Assessment" button in Unity UI):
 *   Sets AllocatePatient.Status = 'Completed' — same terminal value as Path 1.
 *   Also fires a CaseStatusChanged event (8 events in PatientAuditLog).
 *   Checking Status = 'Completed' covers both Path 1 and Path 3.
 *
 * PatientGoalApprovalRequestGoal.Status values:
 *   Approved (24 rows), Rejected (1 row)
 *
 * ════════════════════════════════════════════════════════════════════════
 * STATUS CONSTANTS
 * ════════════════════════════════════════════════════════════════════════
 *
 * TERMINAL_STATUSES: assessments that are done — exclude from ALL issue
 * counts and pipeline stages (except the completed count).
 *
 * EXCLUDED_STATUSES: no cancellation/deletion statuses exist yet. Reserved
 * for future use if Unity adds 'Cancelled' etc.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IMPORTANT: Unity AllocatePatient.Status IS NOT a reliable state indicator
 * for pipeline stages. "InProgress" means at least one question was answered;
 * it does NOT mean scoring is incomplete — report may be approved and only
 * goals pending (Leo Arya DP3 example). PatientAuditLog events are the
 * authoritative source for pipeline stage beyond completion checks.
 * ════════════════════════════════════════════════════════════════════════
 *
 * Seven pipeline states (in progression order):
 *
 * STATE 1 — not_started
 *   Definition:  CaseAssigned event exists but ZERO subsequent audit activity
 *                for this AllocatePatientId
 *   Responsible: Clinician
 *   Measure:     Days since assignment
 *
 * STATE 2 — in_progress
 *   Definition:  Audit log activity exists for this AllocatePatientId
 *                BUT AssessmentResultGenerated has NOT fired
 *   Note:        Clinician has started but has NOT completed scoring
 *   Responsible: Clinician
 *   Measure:     Days since assignment
 *
 * STATE 3 — report_not_drafted
 *   Definition:  AssessmentResultGenerated has fired
 *                BUT no ReportAdded event exists for this AllocatePatientId
 *   Responsible: Clinician
 *   Measure:     Days since AssessmentResultGenerated
 *
 * STATE 4 — report_pending_approval
 *   Definition:  ReportAdded exists BUT no ReportPDFGenerated event exists
 *   Responsible: Manager
 *   Measure:     Days since ReportAdded
 *
 * STATE 5 — goals_not_added  ← LEO ARYA DP3 CORRECT STATE
 *   Definition:  ReportPDFGenerated exists (report approved)
 *                BUT no PatientGoalApprovalRequest exists for this AllocatePatientId
 *   Responsible: Clinician
 *   Measure:     Days since ReportPDFGenerated
 *
 * STATE 6 — goals_pending_approval
 *   Definition:  PatientGoalApprovalRequest exists (goals submitted)
 *                BUT no goal has Status = 'Approved'
 *   Responsible: Manager
 *   Measure:     Days since PatientGoalApprovalRequest.CreatedDateTimeUtc
 *
 * STATE 7 — completed
 *   One of three conditions met (checked in priority order):
 *   a) AllocatePatient.Status IN TERMINAL_STATUSES ('Completed')  ← Path 1 & 3
 *   b) CaseStatusChanged event with close description             ← Path 3 audit
 *   c) PatientGoalApprovalRequestGoal.Status = 'Approved'         ← Path 2
 *
 * Issue thresholds:
 *   not_started / in_progress:
 *     watching  → 7–14 days since assignment
 *     warning   → 14–21 days since assignment
 *     critical  → > 21 days since assignment
 *
 *   report_not_drafted:
 *     warning   → 7–14 days since result generated
 *     critical  → > 14 days since result generated
 *
 *   report_pending_approval:
 *     warning   → 3–7 days since report drafted
 *     critical  → > 7 days since report drafted
 *
 *   goals_not_added:
 *     warning   → 7–14 days since PDF generated
 *     critical  → > 14 days since PDF generated
 *
 *   goals_pending_approval:
 *     warning   → 3–7 days since goals submitted
 *     critical  → > 7 days since goals submitted
 */

// ── Status constants ──────────────────────────────────────────────────────────

/**
 * AllocatePatient.Status values that mean "this assessment is done".
 * Covers Path 1 (direct) and Path 3 (manual close) completion.
 * Any assessment with Status IN TERMINAL_STATUSES must NEVER appear
 * in any issue group — check this BEFORE any audit-log-based logic.
 */
const TERMINAL_STATUSES = ['Completed'];

/**
 * AllocatePatient.Status values that mean "exclude from all counts entirely".
 * No such statuses exist in the current database (verified 2026-05-27).
 * Reserved for future use if Unity adds 'Cancelled', 'Deleted', etc.
 */
const EXCLUDED_STATUSES = [];

// ── State enum ────────────────────────────────────────────────────────────────

const ASSESSMENT_STATES = {
  NOT_STARTED:             'not_started',
  IN_PROGRESS:             'in_progress',
  REPORT_NOT_DRAFTED:      'report_not_drafted',
  REPORT_PENDING_APPROVAL: 'report_pending_approval',
  GOALS_NOT_ADDED:         'goals_not_added',
  GOALS_PENDING_APPROVAL:  'goals_pending_approval',
  COMPLETED:               'completed',
  EXCLUDED:                'excluded',
};

const STATE_LABELS = {
  not_started:             'Not started',
  in_progress:             'In progress',
  report_not_drafted:      'Report not drafted',
  report_pending_approval: 'Report awaiting approval',
  goals_not_added:         'Goals not added',
  goals_pending_approval:  'Goals awaiting approval',
  completed:               'Completed',
  excluded:                'Excluded',
};

const STATE_RESPONSIBLE = {
  not_started:             'Clinician',
  in_progress:             'Clinician',
  report_not_drafted:      'Clinician',
  report_pending_approval: 'Manager',
  goals_not_added:         'Clinician',
  goals_pending_approval:  'Manager',
  completed:               null,
  excluded:                null,
};

// ── Thresholds (days) for issue severity ─────────────────────────────────────

const THRESHOLDS = {
  overdueAssessment: { watching: 7, warning: 14, critical: 21 },
  reportNotDrafted:  { warning: 7,  critical: 14 },
  reportPending:     { warning: 3,  critical: 7 },
  goalsNotAdded:     { warning: 7,  critical: 14 },
  goalsPending:      { warning: 3,  critical: 7 },
};

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify an assessment into one of the seven pipeline states (or 'excluded').
 *
 * Completion is checked FIRST — in the following priority order:
 *   1. AllocatePatient.Status is in TERMINAL_STATUSES ('Completed')
 *      Covers Path 1 (direct) and Path 3 (manual close). These assessments
 *      may lack AssessmentResultGenerated in the audit log; checking status
 *      first prevents them from appearing as "overdue scoring" issues.
 *
 *   2. hasCaseClosedEvent: CaseStatusChanged audit event with a description
 *      indicating closure. Covers Path 3 cases where the status update may
 *      not yet be reflected (belt-and-suspenders with check #1).
 *
 *   3. hasApprovedGoal: at least one PatientGoalApprovalRequestGoal with
 *      Status = 'Approved' linked to this patient's assessment.
 *      Covers Path 2 (new goal workflow completion).
 *
 * @param {object} data
 * @param {string}  data.status              AllocatePatient.Status
 * @param {boolean} data.hasAuditActivity    Any audit event beyond CaseAssigned
 * @param {boolean} data.hasResultGenerated  AssessmentResultGenerated in log
 * @param {boolean} data.hasReportAdded      ReportAdded in log
 * @param {boolean} data.hasReportPDF        ReportPDFGenerated in log
 * @param {boolean} data.hasGoalRequest      PatientGoalApprovalRequest exists
 * @param {boolean} data.hasApprovedGoal     PatientGoalApprovalRequestGoal.Status = 'Approved'
 * @param {boolean} [data.hasCaseClosedEvent] CaseStatusChanged event (close description)
 * @returns {string} One of the ASSESSMENT_STATES values
 */
function classifyAssessment({
  status,
  hasAuditActivity   = false,
  hasResultGenerated = false,
  hasReportAdded     = false,
  hasReportPDF       = false,
  hasGoalRequest     = false,
  hasApprovedGoal    = false,
  hasCaseClosedEvent = false,
}) {
  // ── Completion checks (FIRST — highest priority) ──────────────────────────

  // Path 1 & 3: terminal AllocatePatient.Status
  if (TERMINAL_STATUSES.includes(status)) return ASSESSMENT_STATES.COMPLETED;

  // Path 3 audit trail: CaseStatusChanged with close description
  if (hasCaseClosedEvent) return ASSESSMENT_STATES.COMPLETED;

  // Path 2: approved goals via the new workflow
  if (hasApprovedGoal) return ASSESSMENT_STATES.COMPLETED;

  // ── Exclusion check ───────────────────────────────────────────────────────

  if (EXCLUDED_STATUSES.includes(status)) return ASSESSMENT_STATES.EXCLUDED;

  // ── Pipeline stage classification (audit-log based) ───────────────────────

  // Goals stage: report approved, goals submitted, awaiting approval
  if (hasReportPDF && hasGoalRequest) return ASSESSMENT_STATES.GOALS_PENDING_APPROVAL;

  // Goals stage: report approved but no goal request yet
  if (hasReportPDF) return ASSESSMENT_STATES.GOALS_NOT_ADDED;

  // Report stage: report drafted but awaiting PDF approval
  if (hasReportAdded) return ASSESSMENT_STATES.REPORT_PENDING_APPROVAL;

  // Report stage: scoring done but report not drafted yet
  if (hasResultGenerated) return ASSESSMENT_STATES.REPORT_NOT_DRAFTED;

  // Scoring stage: clinician has started but not finished scoring
  if (hasAuditActivity) return ASSESSMENT_STATES.IN_PROGRESS;

  // Scoring stage: assigned but no activity at all
  return ASSESSMENT_STATES.NOT_STARTED;
}

// ── Helper predicates ─────────────────────────────────────────────────────────

/**
 * Returns true if the assessment is stuck at the scoring stage for too long.
 * @param {string} state   Result of classifyAssessment()
 * @param {number} days    Days since assignment
 */
function isStuckAtScoring(state, days) {
  return (
    (state === ASSESSMENT_STATES.NOT_STARTED || state === ASSESSMENT_STATES.IN_PROGRESS) &&
    days > THRESHOLDS.overdueAssessment.warning
  );
}

/**
 * Returns true if the assessment is blocked on a manager action.
 * @param {string} state   Result of classifyAssessment()
 */
function isManagerBlocked(state) {
  return (
    state === ASSESSMENT_STATES.REPORT_PENDING_APPROVAL ||
    state === ASSESSMENT_STATES.GOALS_PENDING_APPROVAL
  );
}

/**
 * Returns true if the assessment is blocked on a clinician action.
 * @param {string} state   Result of classifyAssessment()
 */
function isClinicianBlocked(state) {
  return (
    state === ASSESSMENT_STATES.NOT_STARTED     ||
    state === ASSESSMENT_STATES.IN_PROGRESS     ||
    state === ASSESSMENT_STATES.REPORT_NOT_DRAFTED ||
    state === ASSESSMENT_STATES.GOALS_NOT_ADDED
  );
}

/**
 * SQL fragment to exclude terminal AllocatePatient rows from any query.
 * @param {string} alias   AllocatePatient table alias (default 'ap')
 */
function terminalStatusExclusion(alias = 'ap') {
  const list = TERMINAL_STATUSES.map((s) => `'${s}'`).join(', ');
  return `${alias}.Status NOT IN (${list})`;
}

module.exports = {
  // ── Constants ──────────────────────────────────────────────────────────────
  TERMINAL_STATUSES,
  EXCLUDED_STATUSES,
  ASSESSMENT_STATES,
  STATE_LABELS,
  STATE_RESPONSIBLE,
  THRESHOLDS,
  // ── Core classifier ────────────────────────────────────────────────────────
  classifyAssessment,
  // ── SQL helpers ────────────────────────────────────────────────────────────
  terminalStatusExclusion,
  // ── Predicate helpers ──────────────────────────────────────────────────────
  isStuckAtScoring,
  isManagerBlocked,
  isClinicianBlocked,
};
