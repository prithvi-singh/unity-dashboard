'use strict';

/**
 * Canonical filter-building helpers and event-type constants.
 *
 * Every query that touches core metrics MUST use these rather than
 * writing inline exclusion strings. This is the single source of
 * truth for which rows are "test" data and which aren't.
 */

const FILTERS = {
  /**
   * Exclude test/demo and soft-deleted centres.
   * @param {string} alias - SQL table alias, default 'c'
   */
  centreExclusion: (alias = 'c') =>
    `LOWER(${alias}.CentreName) NOT LIKE '%test%'
      AND LOWER(${alias}.CentreName) NOT LIKE '%delete%'`,

  /**
   * Exclude patients whose first or last name contains "test".
   * @param {string} alias - SQL table alias, default 'pt'
   */
  patientExclusion: (alias = 'pt') =>
    `${alias}.FirstName NOT LIKE '%test%'
      AND ${alias}.LastName  NOT LIKE '%test%'`,

  /**
   * Exclude test/dev AdminUser accounts.
   * Wrapped in (IS NULL OR ...) so LEFT-joined user aliases are safe —
   * system-generated PAL rows with no AdminUserId are still included.
   * @param {string} alias - SQL table alias, default 'au'
   */
  userExclusion: (alias = 'au') =>
    `(${alias}.Id IS NULL OR (
        ${alias}.FirstName NOT LIKE '%test%'
        AND ${alias}.LastName  NOT LIKE '%test%'
        AND ${alias}.Email     NOT LIKE '%@webority.com'
        AND ${alias}.Email     NOT LIKE '%@mailinator.com'
      ))`,

  /**
   * Hard exclusion (no NULL guard) — use on INNER JOINed user rows.
   * @param {string} alias - SQL table alias, default 'au'
   */
  userExclusionStrict: (alias = 'au') =>
    `${alias}.FirstName NOT LIKE '%test%'
      AND ${alias}.LastName  NOT LIKE '%test%'
      AND ${alias}.Email     NOT LIKE '%@webority.com'
      AND ${alias}.Email     NOT LIKE '%@mailinator.com'`,

  /**
   * Exclude SuperAdmin role rows.
   * @param {string} alias - SQL table alias for AdminRole, default 'ar'
   */
  superAdminExclusion: (alias = 'ar') =>
    `${alias}.Name NOT IN ('SuperAdmin', 'Super Admin')`,

  /**
   * Optional centre scope filter.
   * @param {string} tableAlias - Centre table alias, default 'c'
   */
  centreFilter: (tableAlias = 'c') =>
    `(@centreId IS NULL OR ${tableAlias}.Id = @centreId)`,
};

/**
 * Canonical set of PatientAuditLog.Type values used across all routes.
 * Use these string constants everywhere instead of bare string literals.
 */
const EVENT_TYPES = {
  CASE_REGISTERED:              'CaseRegistered',
  CASE_ASSIGNED:                'CaseAssigned',
  CASE_TRANSFER:                'CaseTransfer',
  CASE_STATUS_CHANGED:          'CaseStatusChanged',
  ASSESSMENT_RESULT_GENERATED:  'AssessmentResultGenerated',
  ASSESSMENT_STATUS_CHANGED:    'AssessmentStatusChanged',
  ASSESSMENT_ADD:               'AssessmentAdd',
  REPORT_ADDED:                 'ReportAdded',
  UPDATE_REPORT:                'UpdateReport',
  REPORT_PDF_GENERATED:         'ReportPDFGenerated',
  GOAL_ADDED:                   'GoalAdded',
  GOAL_UPDATED:                 'GoalUpdated',
  ACTIVITY_ADDED:               'ActivityAdded',
  BASELINE_ADDED:               'BaselineAdded',
  PROGRESS_ADDED:               'ProgressAdded',
};

/**
 * Build a SQL IN-list literal from one or more EVENT_TYPES values.
 * Usage: toSqlIn(EVENT_TYPES.GOAL_ADDED, EVENT_TYPES.GOAL_UPDATED)
 * Returns: "'GoalAdded','GoalUpdated'"
 */
function toSqlIn(...types) {
  return types.map((t) => `'${t}'`).join(',');
}

module.exports = { FILTERS, EVENT_TYPES, toSqlIn };
