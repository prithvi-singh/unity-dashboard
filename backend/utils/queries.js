'use strict';

const { buildCentreExclusion, buildPatientExclusion } = require('../lib/queryHelpers');

/**
 * The Status values that make an AllocatePatient record "active".
 * A case is active while any of these statuses is set; it is closed
 * (or inactive) once it leaves this set.
 *
 * Single source of truth — used in BOTH the aggregate count (clinicians.js)
 * and the drill-down case list (roleDrillDown.js).
 *
 * Known status values observed in AllocatePatient.Status:
 *   NotStarted  — assigned but work not yet begun       → ACTIVE
 *   InProgress  — assessment underway                   → ACTIVE
 *   OnHold      — paused, still open                    → ACTIVE
 *   Closed      — completed / discharged                → INACTIVE (excluded)
 *
 * Any status value NOT in ACTIVE_CASE_STATUSES is treated as closed/inactive.
 */
const ACTIVE_CASE_STATUSES = ['NotStarted', 'InProgress', 'OnHold'];
const ACTIVE_CASE_STATUSES_SQL = ACTIVE_CASE_STATUSES.map((s) => `'${s}'`).join(', ');

/**
 * Canonical WHERE clause for "active caseload" queries.
 *
 * BOTH the aggregate count (clinicians.js) and the drill-down list
 * (roleDrillDown.js) MUST use this function so COUNT(*) in the table
 * always equals the number of rows returned by the drill-down. Always.
 * No exceptions.
 *
 * Required SQL parameter bindings:
 *   @centreId   BigInt, nullable — scopes to a single centre when set
 *
 * The caller is responsible for adding any extra predicates (e.g. the
 * @drillUserId clinician filter in the drill-down detail query).
 *
 * @param {string} ap - AllocatePatient table alias (default 'ap')
 * @param {string} pt - Patient table alias         (default 'pt')
 * @param {string} c  - Centre table alias          (default 'c')
 */
function activeCaseloadWhere(ap = 'ap', pt = 'pt', c = 'c') {
  return [
    `${ap}.Status IN (${ACTIVE_CASE_STATUSES_SQL})`,
    `(@centreId IS NULL OR ${c}.Id = @centreId)`,
    buildCentreExclusion(c),
    buildPatientExclusion(pt),
  ].join('\n      AND ');
}

module.exports = { ACTIVE_CASE_STATUSES, ACTIVE_CASE_STATUSES_SQL, activeCaseloadWhere };
