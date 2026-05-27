'use strict';

/**
 * metricsService — single source of truth for all core dashboard metrics.
 *
 * Exposes one public function:
 *
 *   getCoreMetrics({ dateFrom, dateTo, centreId })
 *
 * All core queries run in a single parallel batch. The result is cached for
 * 60 seconds per unique { dateFrom, dateTo, centreId } combination, so two
 * tabs that load simultaneously with the same filters only hit the DB once
 * and are guaranteed to see identical numbers.
 *
 * FILTER CONTRACT — every query here applies all four exclusion rules:
 *   1. Test patients  (FirstName/LastName LIKE '%test%')
 *   2. Test users     (name/email pattern, webority, mailinator)
 *   3. Super Admin    (ar.Name NOT IN ('SuperAdmin','Super Admin'))
 *   4. Deleted centres (CentreName LIKE '%test%' or '%delete%')
 */

const { sql, poolPromise } = require('../db');
const { buildDateFilter } = require('../lib/queryHelpers');
const { buildClinicalPipelineQuery, mapPipelineRow } = require('../lib/clinicalPipelineQueries');
const { FILTERS } = require('../utils/metrics');

// ── In-memory cache ──────────────────────────────────────────────────────────
const _cache = new Map();

// TTL strategy: historical periods (end date > 24 hours ago) never change,
// so cache them much longer. Today/current periods are cached for 60 seconds.
const CACHE_TTL_LIVE_MS        =  60_000;  //  60 s — live / current period
const CACHE_TTL_HISTORICAL_MS  = 30 * 60_000; // 30 min — past periods

function _ttlForPeriod(dateTo) {
  if (!dateTo) return CACHE_TTL_LIVE_MS;
  const endMs = dateTo.getTime();
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return endMs < oneDayAgo ? CACHE_TTL_HISTORICAL_MS : CACHE_TTL_LIVE_MS;
}

function _cacheKey({ dateFrom, dateTo, centreId }) {
  return JSON.stringify({
    df: dateFrom ? dateFrom.toISOString() : null,
    dt: dateTo   ? dateTo.toISOString()   : null,
    cid: centreId ?? null,
  });
}

function _setCached(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function _getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { _cache.delete(key); return null; }
  return entry.data;
}

/** Purge the entire cache. Useful in tests. */
function clearCache() { _cache.clear(); }

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Bind the three standard parameters onto a mssql Request. */
function _bind(req, { dateFrom, dateTo, centreId }) {
  return req
    .input('centreId', sql.BigInt,        centreId)
    .input('dateFrom', sql.DateTimeOffset, dateFrom)
    .input('dateTo',   sql.DateTimeOffset, dateTo);
}

/** Trim and normalise a full-name string from DB rows. */
function _name(first, last) {
  return `${first ?? ''} ${last ?? ''}`.trim() || null;
}

// ── Dev-mode assertion helper ────────────────────────────────────────────────
function _assert(condition, message) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.assert(condition, `[metricsService] ${message}`);
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * getCoreMetrics({ dateFrom, dateTo, centreId })
 *
 * @param {Date|null}   dateFrom
 * @param {Date|null}   dateTo
 * @param {number|null} centreId
 * @returns {Promise<CoreMetrics>}
 */
async function getCoreMetrics({ dateFrom = null, dateTo = null, centreId = null } = {}) {
  const key = _cacheKey({ dateFrom, dateTo, centreId });

  const cached = _getCached(key);
  if (cached) return cached;

  const pool = await poolPromise;
  const p    = { dateFrom, dateTo, centreId };

  // Reusable SQL fragments
  const CF  = FILTERS.centreFilter();           // (@centreId IS NULL OR c.Id = @centreId)
  const CE  = FILTERS.centreExclusion();        // test/deleted centre guard
  const PE  = FILTERS.patientExclusion('pt');   // test patient guard
  const UES = FILTERS.userExclusionStrict('au');// strict user exclusion (no NULL guard)
  const SA  = FILTERS.superAdminExclusion('ar');// super-admin exclusion
  const DF  = buildDateFilter('pal.CreatedDateTime', '@dateFrom', '@dateTo');

  // Helpers for building per-entity date filters
  const df = (col) => buildDateFilter(col, '@dateFrom', '@dateTo');

  // ── Run all queries in parallel ─────────────────────────────────────────────
  const [
    pipelineRes,          // Q1  – full clinical pipeline funnel
    casesByCentreRes,     // Q2  – cases per centre
    casesByActorRes,      // Q3  – cases registered per user (all roles)
    assessByCentreRes,    // Q4  – assessments assigned/scored per centre
    assessByClinicianRes, // Q5  – assessments per clinician
    assessByTypeRes,      // Q6  – assessments by type
    reportsByCentreRes,   // Q7  – reports per centre
    reportsByClinicianRes,// Q8  – reports per clinician
    reportsByManagerRes,  // Q9  – reports approved per manager
    goalsByCentreRes,     // Q10 – goals per centre
    goalsByClinicianRes,  // Q11 – goals per clinician
    goalsByManagerRes,    // Q12 – goals approved per manager
    usersByRoleRes,       // Q13 – user totals + by role
    usersByCentreRes,     // Q14 – user totals by centre
    centreActivityRes,    // Q15 – active/idle centres
  ] = await Promise.all([

    // ── Q1: Clinical pipeline funnel ────────────────────────────────────────
    // Reuses the same query builder used by overview and bottlenecks,
    // so those two will now share identical numbers from this single call.
    _bind(pool.request(), p).query(buildClinicalPipelineQuery()),

    // ── Q2: Cases registered per centre ─────────────────────────────────────
    _bind(pool.request(), p).query(`
      SELECT
        pt.CentreId          AS centreId,
        c.CentreName,
        COUNT(DISTINCT pal.PatientId) AS count
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      WHERE pal.Type = 'CaseRegistered'
        AND ${CF}
        AND ${CE}
        AND ${PE}
        AND ${DF}
      GROUP BY pt.CentreId, c.CentreName
    `),

    // ── Q3: Cases registered per user (used to split byManager / byOps) ─────
    _bind(pool.request(), p).query(`
      SELECT
        au.Id                   AS userId,
        au.FirstName,
        au.LastName,
        ar.Name                 AS roleName,
        CASE WHEN au.FirstName LIKE '%(Ops)%'
              OR  au.LastName  LIKE '%(Ops)%' THEN 1 ELSE 0 END AS isOps,
        COUNT(DISTINCT pal.PatientId) AS count
      FROM PatientAuditLog pal
      JOIN Patient pt ON pt.Id = pal.PatientId
      JOIN Centre  c  ON c.Id  = pt.CentreId
      JOIN AdminUser au ON au.Id = pal.AdminUserId
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE pal.Type = 'CaseRegistered'
        AND ${CF}
        AND ${CE}
        AND ${PE}
        AND ${DF}
        AND ${UES}
        AND (ar.Name IS NULL OR ${SA})
      GROUP BY au.Id, au.FirstName, au.LastName, ar.Name,
               CASE WHEN au.FirstName LIKE '%(Ops)%' OR au.LastName LIKE '%(Ops)%' THEN 1 ELSE 0 END
      ORDER BY count DESC
    `),

    // ── Q4: Assessments assigned / scored per centre ─────────────────────────
    _bind(pool.request(), p).query(`
      WITH cl AS (
        SELECT c.Id AS centreId, c.CentreName
        FROM Centre c
        WHERE ${CE} AND ${FILTERS.centreFilter('c')}
      ),
      asgn AS (
        SELECT pt.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS assigned
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE pal.Type = 'CaseAssigned'
          AND pal.AllocatePatientId IS NOT NULL
          AND ${CF} AND ${CE} AND ${PE} AND ${DF}
        GROUP BY pt.CentreId
      ),
      scrd AS (
        SELECT pt.CentreId, COUNT(DISTINCT pal.AllocatePatientId) AS scored
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE pal.Type = 'AssessmentResultGenerated'
          AND pal.AllocatePatientId IS NOT NULL
          AND ${CF} AND ${CE} AND ${PE} AND ${DF}
        GROUP BY pt.CentreId
      )
      SELECT
        cl.centreId,
        cl.CentreName,
        ISNULL(a.assigned, 0) AS assigned,
        ISNULL(s.scored,   0) AS scored
      FROM cl
      LEFT JOIN asgn a ON a.CentreId = cl.centreId
      LEFT JOIN scrd s ON s.CentreId = cl.centreId
    `),

    // ── Q5: Assessments assigned / scored per clinician ──────────────────────
    _bind(pool.request(), p).query(`
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'
              THEN pal.AllocatePatientId END) AS assigned,
        COUNT(DISTINCT CASE WHEN pal.Type = 'AssessmentResultGenerated'
              THEN pal.AllocatePatientId END) AS scored
      FROM PatientAuditLog pal
      JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
      JOIN Patient  pt ON pt.Id = ap.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      JOIN AdminUser au ON au.Id = ap.ClinicianUserId
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole     ar  ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
      WHERE pal.Type IN ('CaseAssigned', 'AssessmentResultGenerated')
        AND pal.AllocatePatientId IS NOT NULL
        AND ${CF} AND ${CE} AND ${PE}
        AND ${df('pal.CreatedDateTime')}
        AND ${FILTERS.userExclusionStrict('au')}
      GROUP BY au.Id, au.FirstName, au.LastName
      ORDER BY scored DESC
    `),

    // ── Q6: Assessments by type ──────────────────────────────────────────────
    _bind(pool.request(), p).query(`
      SELECT
        ISNULL(ap.Assessment, 'Unknown') AS type,
        COUNT(DISTINCT CASE WHEN pal.Type = 'CaseAssigned'
              THEN pal.AllocatePatientId END) AS assigned,
        COUNT(DISTINCT CASE WHEN pal.Type = 'AssessmentResultGenerated'
              THEN pal.AllocatePatientId END) AS scored
      FROM PatientAuditLog pal
      JOIN AllocatePatient ap ON ap.Id = pal.AllocatePatientId
      JOIN Patient  pt ON pt.Id = ap.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      WHERE pal.Type IN ('CaseAssigned', 'AssessmentResultGenerated')
        AND pal.AllocatePatientId IS NOT NULL
        AND ${CF} AND ${CE} AND ${PE} AND ${DF}
      GROUP BY ap.Assessment
      ORDER BY assigned DESC
    `),

    // ── Q7: Reports per centre (drafted, edits, approved) ───────────────────
    _bind(pool.request(), p).query(`
      WITH cl AS (
        SELECT c.Id AS centreId, c.CentreName
        FROM Centre c
        WHERE ${CE} AND ${FILTERS.centreFilter('c')}
      ),
      rep AS (
        SELECT
          pt.CentreId,
          COUNT(CASE WHEN pal.Type = 'ReportAdded'  THEN 1 END) AS drafted,
          COUNT(CASE WHEN pal.Type = 'UpdateReport' THEN 1 END) AS edits,
          COUNT(DISTINCT CASE WHEN pal.Type = 'ReportPDFGenerated'
                THEN pal.AllocatePatientId END) AS approved
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE pal.Type IN ('ReportAdded', 'UpdateReport', 'ReportPDFGenerated')
          AND ${CF} AND ${CE} AND ${PE} AND ${DF}
        GROUP BY pt.CentreId
      )
      SELECT
        cl.centreId,
        cl.CentreName,
        ISNULL(r.drafted,  0) AS drafted,
        ISNULL(r.edits,    0) AS edits,
        ISNULL(r.approved, 0) AS approved
      FROM cl
      LEFT JOIN rep r ON r.CentreId = cl.centreId
    `),

    // ── Q8: Reports per clinician ────────────────────────────────────────────
    _bind(pool.request(), p).query(`
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        COUNT(CASE WHEN pal.Type = 'ReportAdded'  THEN 1 END) AS drafted,
        COUNT(CASE WHEN pal.Type = 'UpdateReport' THEN 1 END) AS edits
      FROM PatientAuditLog pal
      JOIN Patient  pt ON pt.Id = pal.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      JOIN AdminUser au ON au.Id = pal.AdminUserId
      JOIN AdminUserRole aur ON aur.UserId = au.Id
      JOIN AdminRole     ar  ON ar.Id = aur.RoleId AND ar.Name = 'Clinician'
      WHERE pal.Type IN ('ReportAdded', 'UpdateReport')
        AND ${CF} AND ${CE} AND ${PE} AND ${DF}
        AND ${FILTERS.userExclusionStrict('au')}
      GROUP BY au.Id, au.FirstName, au.LastName
      ORDER BY drafted DESC
    `),

    // ── Q9: Reports approved per manager (ReportPDFGenerated actor) ──────────
    _bind(pool.request(), p).query(`
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        COUNT(DISTINCT pal.AllocatePatientId) AS approved
      FROM PatientAuditLog pal
      JOIN Patient  pt ON pt.Id = pal.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      JOIN AdminUser au ON au.Id = pal.AdminUserId
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      WHERE pal.Type = 'ReportPDFGenerated'
        AND pal.AllocatePatientId IS NOT NULL
        AND ${CF} AND ${CE} AND ${PE} AND ${DF}
        AND ${FILTERS.userExclusionStrict('au')}
        AND (ar.Name IS NULL OR ar.Name NOT IN ('Clinician', 'SuperAdmin', 'Super Admin'))
      GROUP BY au.Id, au.FirstName, au.LastName
      ORDER BY approved DESC
    `),

    // ── Q10: Goals per centre (added, approved) ──────────────────────────────
    _bind(pool.request(), p).query(`
      WITH cl AS (
        SELECT c.Id AS centreId, c.CentreName
        FROM Centre c
        WHERE ${CE} AND ${FILTERS.centreFilter('c')}
      ),
      gls AS (
        SELECT
          pt.CentreId,
          COUNT(DISTINCT pgar.AllocatePatientId) AS added,
          COUNT(DISTINCT CASE WHEN pgarg.Status = 'Approved'
                THEN pgar.AllocatePatientId END) AS approved
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
        JOIN Patient  pt ON pt.Id = ap.PatientId
        JOIN Centre    c ON c.Id  = pt.CentreId
        WHERE ${CF} AND ${CE} AND ${FILTERS.patientExclusion('pt')}
          AND ${df('pgarg.CreatedDateTimeUtc')}
        GROUP BY pt.CentreId
      )
      SELECT
        cl.centreId,
        cl.CentreName,
        ISNULL(g.added,    0) AS added,
        ISNULL(g.approved, 0) AS approved
      FROM cl
      LEFT JOIN gls g ON g.CentreId = cl.centreId
    `),

    // ── Q11: Goals per clinician ─────────────────────────────────────────────
    _bind(pool.request(), p).query(`
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        COUNT(DISTINCT pgar.AllocatePatientId) AS added
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient  pt ON pt.Id = ap.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      JOIN AdminUser au ON au.Id = ap.ClinicianUserId
      WHERE ${CF} AND ${CE} AND ${FILTERS.patientExclusion('pt')}
        AND ${df('pgarg.CreatedDateTimeUtc')}
        AND ${FILTERS.userExclusionStrict('au')}
      GROUP BY au.Id, au.FirstName, au.LastName
      ORDER BY added DESC
    `),

    // ── Q12: Goals approved per manager ─────────────────────────────────────
    // PatientGoalApprovalRequestGoal has an UpdatedBy string (name), not a FK.
    // We match by CONCAT to identify the approving AdminUser.
    _bind(pool.request(), p).query(`
      SELECT
        au.Id AS userId,
        au.FirstName,
        au.LastName,
        COUNT(DISTINCT pgar.AllocatePatientId) AS approved
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient  pt ON pt.Id = ap.PatientId
      JOIN Centre    c ON c.Id  = pt.CentreId
      JOIN AdminUser au ON CONCAT(au.FirstName, ' ', au.LastName) = pgarg.UpdatedBy
      WHERE pgarg.Status = 'Approved'
        AND ${CF} AND ${CE} AND ${FILTERS.patientExclusion('pt')}
        AND ${df('pgarg.UpdatedDateTimeUtc')}
        AND ${FILTERS.userExclusionStrict('au')}
      GROUP BY au.Id, au.FirstName, au.LastName
      ORDER BY approved DESC
    `),

    // ── Q13: User totals + by-role breakdown ─────────────────────────────────
    // SuperAdmin role rows excluded from all counts.
    _bind(pool.request(), p).query(`
      WITH roster AS (
        SELECT DISTINCT au.Id AS userId, ISNULL(ar.Name, 'Unassigned') AS roleName
        FROM AdminUser au
        LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
        LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
        LEFT JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        LEFT JOIN Centre          c   ON c.Id = auc.CentreId
        WHERE ${FILTERS.userExclusionStrict('au')}
          AND (@centreId IS NULL OR c.Id = @centreId)
          AND (c.Id IS NULL OR (${CE}))
          AND (ar.Name IS NULL OR ${SA})
      ),
      period_active AS (
        SELECT DISTINCT pal.AdminUserId AS userId
        FROM PatientAuditLog pal
        WHERE ${df('pal.CreatedDateTime')}
      )
      SELECT
        r.roleName,
        COUNT(DISTINCT r.userId)                                              AS total,
        COUNT(DISTINCT CASE WHEN pa.userId IS NOT NULL THEN r.userId END)    AS active,
        COUNT(DISTINCT CASE WHEN pa.userId IS NULL     THEN r.userId END)    AS quiet
      FROM roster r
      LEFT JOIN period_active pa ON pa.userId = r.userId
      WHERE r.roleName NOT IN ('SuperAdmin', 'Super Admin')
      GROUP BY r.roleName
      ORDER BY total DESC
    `),

    // ── Q14: User totals by centre ───────────────────────────────────────────
    _bind(pool.request(), p).query(`
      WITH period_active AS (
        SELECT DISTINCT pal.AdminUserId AS userId
        FROM PatientAuditLog pal
        WHERE ${df('pal.CreatedDateTime')}
      )
      SELECT
        c.Id    AS centreId,
        c.CentreName,
        COUNT(DISTINCT au.Id)   AS total,
        COUNT(DISTINCT CASE WHEN LOWER(ar.Name) LIKE '%clinician%' THEN au.Id END) AS clinicians,
        COUNT(DISTINCT CASE WHEN LOWER(ar.Name) NOT LIKE '%clinician%'
                             AND ar.Name IS NOT NULL
                             AND ar.Name NOT IN ('SuperAdmin','Super Admin')
                        THEN au.Id END) AS managers,
        COUNT(DISTINCT CASE WHEN ar.Name LIKE '%(Ops)%'
                             OR  au.FirstName LIKE '%(Ops)%'
                             OR  au.LastName  LIKE '%(Ops)%'
                        THEN au.Id END) AS ops,
        COUNT(DISTINCT CASE WHEN pa.userId IS NOT NULL THEN au.Id END) AS active
      FROM AdminUser au
      JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
      JOIN Centre          c   ON c.Id = auc.CentreId
      LEFT JOIN AdminUserRole aur ON aur.UserId = au.Id
      LEFT JOIN AdminRole     ar  ON ar.Id = aur.RoleId
      LEFT JOIN period_active pa  ON pa.userId = au.Id
      WHERE ${FILTERS.userExclusionStrict('au')}
        AND ${CE}
        AND (@centreId IS NULL OR c.Id = @centreId)
        AND (ar.Name IS NULL OR ${SA})
      GROUP BY c.Id, c.CentreName
      ORDER BY total DESC
    `),

    // ── Q15: Active / idle centres (single source of truth) ──────────────────
    // Mirrors the "Query F" logic from overview.js.
    // A centre is ACTIVE if it has any non-test PatientAuditLog row in the period.
    _bind(pool.request(), p).query(`
      WITH centre_list AS (
        SELECT c.Id AS centreId, c.CentreName
        FROM Centre c
        WHERE ${CE} AND ${CF}
      ),
      active_set AS (
        SELECT DISTINCT pt.CentreId
        FROM PatientAuditLog pal
        JOIN Patient   pt ON pt.Id = pal.PatientId
        JOIN Centre     c ON c.Id  = pt.CentreId
        LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
        WHERE ${CE} AND ${CF}
          AND ${FILTERS.patientExclusion('pt')}
          AND ${FILTERS.userExclusion('au')}
          AND ${DF}
      ),
      last_ever AS (
        SELECT pt.CentreId, MAX(pal.CreatedDateTime) AS lastActivityDate
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        GROUP BY pt.CentreId
      )
      SELECT
        cl.centreId,
        cl.CentreName,
        CASE WHEN ac.CentreId IS NOT NULL THEN 1 ELSE 0 END AS isActive,
        le.lastActivityDate
      FROM centre_list cl
      LEFT JOIN active_set ac ON ac.CentreId = cl.centreId
      LEFT JOIN last_ever  le ON le.CentreId = cl.centreId
      ORDER BY cl.CentreName
    `),
  ]);

  // ── Assemble pipeline ────────────────────────────────────────────────────────
  const pipeline = mapPipelineRow(pipelineRes.recordset[0] || {});

  // ── Assemble cases ───────────────────────────────────────────────────────────
  const casesByCentre = casesByCentreRes.recordset.map((r) => ({
    centreId:   r.centreId,
    centreName: r.CentreName,
    count:      r.count,
  }));
  const casesTotal = casesByCentre.reduce((s, r) => s + r.count, 0);

  const casesByManager = [];
  const casesByOps     = [];
  const casesByClinician = [];

  for (const r of casesByActorRes.recordset) {
    const entry = { userId: r.userId, name: _name(r.FirstName, r.LastName), count: r.count };
    if (r.isOps) {
      casesByOps.push(entry);
    } else if ((r.roleName || '').toLowerCase().includes('clinician')) {
      casesByClinician.push(entry);
    } else {
      casesByManager.push(entry);
    }
  }

  // ── Assemble assessments ─────────────────────────────────────────────────────
  const assessByCentre = assessByCentreRes.recordset.map((r) => ({
    centreId:   r.centreId,
    centreName: r.CentreName,
    assigned:   r.assigned,
    scored:     r.scored,
  }));
  const assessAssigned = pipeline.assigned;
  const assessScored   = pipeline.scoringComplete;

  const assessByClinician = assessByClinicianRes.recordset.map((r) => ({
    userId:   r.userId,
    name:     _name(r.FirstName, r.LastName),
    assigned: r.assigned,
    scored:   r.scored,
  }));

  const assessByType = assessByTypeRes.recordset.map((r) => ({
    type:     r.type,
    assigned: r.assigned,
    scored:   r.scored,
    completionRate: r.assigned > 0
      ? parseFloat(((r.scored / r.assigned) * 100).toFixed(1))
      : 0,
  }));

  // ── Assemble reports ─────────────────────────────────────────────────────────
  const reportsByCentre = reportsByCentreRes.recordset.map((r) => ({
    centreId:   r.centreId,
    centreName: r.CentreName,
    drafted:    r.drafted,
    edits:      r.edits,
    approved:   r.approved,
  }));
  const reportsDrafted  = reportsByCentre.reduce((s, r) => s + r.drafted,  0);
  const reportsEdits    = reportsByCentre.reduce((s, r) => s + r.edits,    0);
  const reportsApproved = reportsByCentre.reduce((s, r) => s + r.approved, 0);

  const reportsByClinician = reportsByClinicianRes.recordset.map((r) => ({
    userId:  r.userId,
    name:    _name(r.FirstName, r.LastName),
    drafted: r.drafted,
    edits:   r.edits,
  }));

  const reportsByManager = reportsByManagerRes.recordset.map((r) => ({
    userId:   r.userId,
    name:     _name(r.FirstName, r.LastName),
    approved: r.approved,
  }));

  // ── Assemble goals ───────────────────────────────────────────────────────────
  const goalsByCentre = goalsByCentreRes.recordset.map((r) => ({
    centreId:   r.centreId,
    centreName: r.CentreName,
    added:      r.added,
    approved:   r.approved,
  }));
  const goalsAdded    = pipeline.goalsAdded;
  const goalsApproved = pipeline.goalsApproved;

  const goalsByClinician = goalsByClinicianRes.recordset.map((r) => ({
    userId: r.userId,
    name:   _name(r.FirstName, r.LastName),
    added:  r.added,
  }));

  const goalsByManager = goalsByManagerRes.recordset.map((r) => ({
    userId:   r.userId,
    name:     _name(r.FirstName, r.LastName),
    approved: r.approved,
  }));

  // ── Assemble users ───────────────────────────────────────────────────────────
  const usersByRole = usersByRoleRes.recordset.map((r) => ({
    roleName: r.roleName,
    total:    r.total,
    active:   r.active,
    quiet:    r.quiet,
  }));
  const usersTotal       = usersByRole.reduce((s, r) => s + r.total,  0);
  const usersActive      = usersByRole.reduce((s, r) => s + r.active, 0);
  const usersQuiet       = usersByRole.reduce((s, r) => s + r.quiet,  0);

  const usersByCentre = usersByCentreRes.recordset.map((r) => {
    const total    = r.total    ?? 0;
    const active   = r.active   ?? 0;
    const quiet    = total - active;
    return {
      centreId:   r.centreId,
      centreName: r.CentreName,
      total,
      active,
      quiet,
      clinicians: r.clinicians ?? 0,
      managers:   r.managers   ?? 0,
      ops:        r.ops        ?? 0,
    };
  });

  // "Never active" count — users in the roster with no PAL history at all.
  // We don't run a separate DB query for this here; it's available via
  // the full users/breakdown route which has its own dedicated query.
  const usersNeverActive = 0; // placeholder — see /api/users/breakdown

  // ── Assemble centres ─────────────────────────────────────────────────────────
  const activityRows      = centreActivityRes.recordset;
  const centresTotalCount = activityRows.length;
  const centresActiveCount = activityRows.filter((r) => r.isActive).length;
  const centresIdleCount   = centresTotalCount - centresActiveCount;
  const idleCentreNames    = activityRows
    .filter((r) => !r.isActive)
    .map((r) => r.CentreName);

  // ── Build the canonical metrics object ───────────────────────────────────────
  const metrics = {
    period: { dateFrom, dateTo },

    pipeline,

    cases: {
      total:        casesTotal,
      byCentre:     casesByCentre,
      byClinician:  casesByClinician,
      byManager:    casesByManager,
      byOps:        casesByOps,
    },

    assessments: {
      assigned:       assessAssigned,
      scored:         assessScored,
      completionRate: assessAssigned > 0
        ? parseFloat(((assessScored / assessAssigned) * 100).toFixed(1))
        : 0,
      byCentre:     assessByCentre,
      byType:       assessByType,
      byClinician:  assessByClinician,
    },

    reports: {
      drafted:  reportsDrafted,
      edits:    reportsEdits,
      approved: reportsApproved,
      byCentre:     reportsByCentre,
      byClinician:  reportsByClinician,
      byManager:    reportsByManager,
    },

    goals: {
      added:    goalsAdded,
      approved: goalsApproved,
      byCentre:    goalsByCentre,
      byClinician: goalsByClinician,
      byManager:   goalsByManager,
    },

    users: {
      total:       usersTotal,
      active:      usersActive,
      quiet:       usersQuiet,
      neverActive: usersNeverActive,
      byRole:      usersByRole,
      byCentre:    usersByCentre,
    },

    centres: {
      total:          centresTotalCount,
      active:         centresActiveCount,
      idle:           centresIdleCount,
      idleCentreNames,
    },
  };

  // ── Dev-mode sanity assertions ────────────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const casesCentreSum = metrics.cases.byCentre.reduce((a, b) => a + b.count, 0);
    _assert(
      casesCentreSum === metrics.cases.total,
      `cases.byCentre sum (${casesCentreSum}) !== cases.total (${metrics.cases.total})`,
    );

    const assessCentreAssigned = metrics.assessments.byCentre.reduce((a, b) => a + b.assigned, 0);
    _assert(
      assessCentreAssigned <= metrics.assessments.assigned + 1, // centre list may differ slightly from pipeline
      `assessments.byCentre assigned sum (${assessCentreAssigned}) unexpectedly exceeds total (${metrics.assessments.assigned})`,
    );

    const reportsCentreSum = metrics.reports.byCentre.reduce((a, b) => a + b.drafted, 0);
    _assert(
      reportsCentreSum === metrics.reports.drafted,
      `reports.byCentre drafted sum (${reportsCentreSum}) !== reports.drafted (${metrics.reports.drafted})`,
    );

    const usersRoleSum = metrics.users.byRole.reduce((a, b) => a + b.total, 0);
    _assert(
      usersRoleSum === metrics.users.total,
      `users.byRole sum (${usersRoleSum}) !== users.total (${metrics.users.total})`,
    );

    const centresSum = metrics.centres.active + metrics.centres.idle;
    _assert(
      centresSum === metrics.centres.total,
      `centres.active (${metrics.centres.active}) + idle (${metrics.centres.idle}) !== total (${metrics.centres.total})`,
    );
  }

  const ttl = _ttlForPeriod(dateTo);
  _setCached(key, metrics, ttl);
  return metrics;
}

module.exports = { getCoreMetrics, clearCache };
