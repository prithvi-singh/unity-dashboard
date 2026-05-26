'use strict';

/**
 * Parse an ISO date string from a query parameter.
 * Returns a Date object if valid, or null if falsy / invalid.
 */
function parseDateParam(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Build the SQL WHERE fragment for an optional date range on a column.
 * Uses IS NULL trick so a single query handles both filtered and unfiltered cases.
 *
 * @param {string} column    - e.g. 'pal.CreatedDateTime'
 * @param {string} fromParam - e.g. '@dateFrom'
 * @param {string} toParam   - e.g. '@dateTo'
 */
function buildDateFilter(column, fromParam, toParam) {
  // dateTo is start-of-day; use < next day so the full "to" calendar day is included
  return `(${fromParam} IS NULL OR ${column} >= ${fromParam}) AND (${toParam} IS NULL OR ${column} < DATEADD(day, 1, ${toParam}))`;
}

/** Exclude test/demo and deleted centres (matches overview.js). */
function buildCentreExclusion(alias = 'c') {
  return `LOWER(${alias}.CentreName) NOT LIKE '%test%'
      AND LOWER(${alias}.CentreName) NOT LIKE '%delete%'`;
}

/** Exclude patients whose first or last name contains "test" (case-insensitive). */
function buildPatientExclusion(alias = 'pt') {
  return `${alias}.FirstName NOT LIKE '%test%'
      AND ${alias}.LastName NOT LIKE '%test%'`;
}

module.exports = { parseDateParam, buildDateFilter, buildCentreExclusion, buildPatientExclusion };
