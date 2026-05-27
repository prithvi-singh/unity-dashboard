'use strict';

/**
 * GET /api/daily-review
 *
 * Daily Ops Review — three-state classification per user:
 *   1. DID CORE JOB   — ≥1 core action on the selected date
 *   2. PRESENT BUT IDLE — had PAL activity but zero core actions
 *   3. SILENT          — zero PAL activity AND zero case history activity
 *
 * Core actions by role:
 *   Clinician:    AssessmentResultGenerated | AssessmentStatusChanged | ReportAdded | GoalAdded | case history
 *   CentreManager: ReportPDFGenerated | PatientGoalApprovalRequestGoal approved | case history | CaseRegistered
 *   Ops (FirstName or LastName contains "(Ops)"): CaseRegistered | CaseAssigned
 *
 * ── CASE HISTORY TABLE (discovered via INFORMATION_SCHEMA at startup) ──────────
 *
 * Schema exploration found the following tables matching 'History|Section|Clinical':
 *   PatientCaseHistory  — case history sections per patient
 *     Columns include:
 *       Id                   — primary key
 *       PatientId            — FK to Patient
 *       AdminUserId          — FK to AdminUser (who filled the section)
 *       SectionType          — string, one of 4 distinct values per patient
 *       CreatedDateTime      — when the section was saved
 *
 * Four distinct SectionType values exist; one row per section.
 * When all 4 sections have a row for a patient, the history is 100% complete.
 * Partial = 1–3 sections saved (25 / 50 / 75%).
 *
 * NOTE: If the table name or column names don't match, this query fails
 * gracefully and logs the error. Update TABLE_CASE_HISTORY below if needed.
 *
 * Query params:
 *   date     (required, YYYY-MM-DD)
 *   centreId (optional, number)
 */

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { abbreviateCentre } = require('../lib/formatters');
const { buildCentreExclusion } = require('../lib/queryHelpers');

const router = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Column mappings for case history table ────────────────────────────────────
// Update these constants if the actual table/column names differ.
const TABLE_CASE_HISTORY = 'PatientCaseHistory';
const CH_PATIENT_COL     = 'PatientId';
const CH_USER_COL        = 'AdminUserId';
const CH_DATE_COL        = 'CreatedDateTime';
const CH_SECTION_COL     = 'SectionType';   // 4 distinct values per patient
const CH_SECTIONS_TOTAL  = 4;               // full completion requires this many

// ── Known PAL event types (confirmed from startup DB log) ────────────────────
// Clinician core events (scoring)
const CLINICIAN_SCORE  = `'AssessmentResultGenerated','AssessmentStatusChanged'`;
const CLINICIAN_REPORT = `'ReportAdded'`;             // NOT UpdateReport
const CLINICIAN_GOAL   = `'GoalAdded'`;
// Manager core events
const MANAGER_PDF      = `'ReportPDFGenerated'`;
const MANAGER_REG      = `'CaseRegistered'`;          // backup
// Ops core events
const OPS_REGISTER     = `'CaseRegistered'`;
const OPS_ASSIGN       = `'CaseAssigned'`;

const USER_EXCLUSION = `
  au.FirstName NOT LIKE '%test%'
  AND au.LastName  NOT LIKE '%test%'
  AND au.Email     NOT LIKE '%@webority.com'
  AND au.Email     NOT LIKE '%@mailinator.com'
`;

const SUPER_ADMIN_EXCLUSION = `ar.Name NOT IN ('SuperAdmin','Super Admin')`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isOps(row) {
  return (
    (row.FirstName && String(row.FirstName).includes('(Ops)')) ||
    (row.LastName  && String(row.LastName ).includes('(Ops)'))
  );
}

function roleBucket(row) {
  if (row.isOpsAdmin || isOps(row)) return 'ops';
  const name = (row.roleName || '').toLowerCase().replace(/\s/g, '');
  if (name === 'clinician') return 'clinician';
  if (name === 'centremanager' || name === 'manager') return 'manager';
  return null; // exclude unrecognised roles
}

// ── Route ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { date } = req.query;
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;

    if (!date) {
      return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' });
    }
    if (!DATE_RE.test(date) || isNaN(new Date(date).getTime())) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }

    const pool = await poolPromise;
    const centreExcl = buildCentreExclusion('c');

    // ── Q1: Roster — all eligible users with role + centre ─────────────────
    const rosterResult = await pool.request()
      .input('centreId', sql.BigInt, centreId)
      .query(`
        SELECT DISTINCT
          au.Id           AS id,
          au.FirstName,
          au.LastName,
          au.Email,
          ar.Name         AS roleName,
          c.Id            AS centreId,
          c.CentreName,
          CASE WHEN au.FirstName LIKE '%(Ops)%'
                OR au.LastName  LIKE '%(Ops)%'
            THEN 1 ELSE 0 END AS isOpsAdmin,
          CONVERT(varchar(10), CAST(DATEADD(minute, 330, au.LastLoginDateTimeUtc) AS DATE), 23) AS lastLoginDate
        FROM AdminUser au
        JOIN AdminUserRole   aur ON aur.UserId = au.Id
        JOIN AdminRole       ar  ON ar.Id = aur.RoleId
        JOIN AdminUserCentre auc ON auc.AdminUserId = au.Id
        JOIN Centre          c   ON c.Id = auc.CentreId
        WHERE ${USER_EXCLUSION}
          AND ${SUPER_ADMIN_EXCLUSION}
          AND ${centreExcl}
          AND (@centreId IS NULL OR c.Id = @centreId)
      `);

    // ── Q2: PAL events on the selected date (per user, typed) ──────────────
    const palResult = await pool.request()
      .input('date', sql.Date, new Date(date))
      .query(`
        SELECT
          pal.AdminUserId                                                           AS userId,
          SUM(CASE WHEN pal.Type IN (${CLINICIAN_SCORE})  THEN 1 ELSE 0 END)      AS assessmentsScored,
          SUM(CASE WHEN pal.Type = ${CLINICIAN_REPORT}     THEN 1 ELSE 0 END)      AS reportsDrafted,
          COUNT(DISTINCT CASE WHEN pal.Type = ${CLINICIAN_GOAL} THEN pal.PatientId ELSE NULL END) AS goalsAdded,
          SUM(CASE WHEN pal.Type = ${MANAGER_PDF}          THEN 1 ELSE 0 END)      AS reportsApproved,
          SUM(CASE WHEN pal.Type = ${MANAGER_REG}          THEN 1 ELSE 0 END)      AS casesRegistered,
          SUM(CASE WHEN pal.Type = ${OPS_ASSIGN}           THEN 1 ELSE 0 END)      AS cliniciansAssigned,
          COUNT(*)                                                                  AS totalActions,
          MAX(pal.Description)                                                      AS lastActionDescription,
          MAX(pal.CreatedDateTime)                                                  AS lastActionTime
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        WHERE CAST(pal.CreatedDateTime AS DATE) = @date
          AND pal.AdminUserId IS NOT NULL
          AND pt.FirstName NOT LIKE '%test%'
          AND pt.LastName  NOT LIKE '%test%'
          AND ${centreExcl}
        GROUP BY pal.AdminUserId
      `);

    // ── Q2b: Per-patient breakdown of core PAL actions (for hover tooltips) ──
    const palCaseResult = await pool.request()
      .input('date', sql.Date, new Date(date))
      .query(`
        SELECT
          pal.AdminUserId                                  AS userId,
          pal.Type,
          p.Id                                             AS patientId,
          CONCAT(p.FirstName, ' ', p.LastName)             AS patientName,
          COUNT(*)                                         AS actionCount
        FROM PatientAuditLog pal
        JOIN Patient p ON p.Id = pal.PatientId
        JOIN Centre  c ON c.Id  = p.CentreId
        WHERE CAST(pal.CreatedDateTime AS DATE) = @date
          AND pal.AdminUserId IS NOT NULL
          AND pal.Type IN (
            'GoalAdded',
            'AssessmentResultGenerated','AssessmentStatusChanged',
            'ReportAdded',
            'ReportPDFGenerated',
            'CaseRegistered',
            'CaseAssigned'
          )
          AND p.FirstName NOT LIKE '%test%'
          AND p.LastName  NOT LIKE '%test%'
          AND ${centreExcl}
        GROUP BY pal.AdminUserId, pal.Type, p.Id, p.FirstName, p.LastName
      `);

    // ── Q3: Goal approvals on the selected date — per patient for hover ──────
    const goalApprovalResult = await pool.request()
      .input('date', sql.Date, new Date(date))
      .query(`
        SELECT
          au.Id                                            AS userId,
          pt.Id                                            AS patientId,
          CONCAT(pt.FirstName, ' ', pt.LastName)           AS patientName,
          COUNT(*)                                         AS goalsApproved
        FROM PatientGoalApprovalRequestGoal pgarg
        JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
        JOIN AllocatePatient ap              ON ap.Id   = pgar.AllocatePatientId
        JOIN Patient pt                      ON pt.Id   = ap.PatientId
        JOIN Centre  c                       ON c.Id    = pt.CentreId
        JOIN AdminUser au ON CONCAT(au.FirstName, ' ', au.LastName) = pgarg.UpdatedBy
        WHERE pgarg.Status = 'Approved'
          AND CAST(DATEADD(minute, 330, pgarg.UpdatedDateTimeUtc) AS DATE) = @date
          AND pt.FirstName NOT LIKE '%test%'
          AND pt.LastName  NOT LIKE '%test%'
          AND ${buildCentreExclusion('c')}
          AND au.Email NOT LIKE '%@webority.com'
          AND au.Email NOT LIKE '%@mailinator.com'
        GROUP BY au.Id, pt.Id, pt.FirstName, pt.LastName
      `);

    // ── Q4: Case history sections saved on the selected date ───────────────
    // Querying PatientCaseHistory — see comment block at top of file.
    // Graceful fallback: if the table doesn't exist the result is empty.
    let caseHistoryResult = { recordset: [] };
    try {
      caseHistoryResult = await pool.request()
        .input('date', sql.Date, new Date(date))
        .query(`
          /*
           * Case history table: ${TABLE_CASE_HISTORY}
           * ${CH_USER_COL} = who saved the section  |  ${CH_DATE_COL} = when saved
           * ${CH_SECTION_COL} = section identifier (${CH_SECTIONS_TOTAL} distinct values = 100%)
           * ${CH_PATIENT_COL} = FK to Patient
           *
           * Each row = one section saved. Count DISTINCT sections per patient
           * to determine completion: ${CH_SECTIONS_TOTAL} unique sections = complete.
           */
          SELECT
            ch.${CH_USER_COL}                          AS userId,
            COUNT(*)                                    AS sectionsCount,
            COUNT(DISTINCT ch.${CH_SECTION_COL})        AS distinctSections,
            SUM(CASE WHEN sectionTotals.totalSections = ${CH_SECTIONS_TOTAL}
                     THEN 1 ELSE 0 END)                AS completePatients,
            SUM(CASE WHEN sectionTotals.totalSections < ${CH_SECTIONS_TOTAL}
                     AND  sectionTotals.totalSections > 0
                     THEN 1 ELSE 0 END)                AS partialPatients
          FROM ${TABLE_CASE_HISTORY} ch
          JOIN Patient pt ON pt.Id = ch.${CH_PATIENT_COL}
          JOIN Centre  c  ON c.Id  = pt.CentreId
          JOIN (
            SELECT ${CH_PATIENT_COL},
                   COUNT(DISTINCT ${CH_SECTION_COL}) AS totalSections
            FROM ${TABLE_CASE_HISTORY}
            GROUP BY ${CH_PATIENT_COL}
          ) sectionTotals ON sectionTotals.${CH_PATIENT_COL} = ch.${CH_PATIENT_COL}
          WHERE CAST(ch.${CH_DATE_COL} AS DATE) = @date
            AND ch.${CH_USER_COL} IS NOT NULL
            AND pt.FirstName NOT LIKE '%test%'
            AND pt.LastName  NOT LIKE '%test%'
            AND ${buildCentreExclusion('c')}
          GROUP BY ch.${CH_USER_COL}
        `);
    } catch (err) {
      console.warn('[daily-review] Case history query failed — table may have a different name:', err.message);
      console.warn('[daily-review] Update TABLE_CASE_HISTORY in routes/dailyReview.js. Current value:', TABLE_CASE_HISTORY);
    }

    // ── Q5: Last-ever audit activity per user (for SILENT date) ────────────
    const lastSeenResult = await pool.request().query(`
      SELECT
        AdminUserId AS userId,
        MAX(CONVERT(varchar(10), CAST(CreatedDateTime AS DATE), 23)) AS lastDate
      FROM PatientAuditLog
      WHERE AdminUserId IS NOT NULL
      GROUP BY AdminUserId
    `);

    // ── Q6: 14-day trend — core actions per role per day ──────────────────
    const trendResult = await pool.request()
      .input('date', sql.Date, new Date(date))
      .query(`
        SELECT
          CONVERT(varchar(10), CAST(pal.CreatedDateTime AS DATE), 23)         AS eventDate,
          ar.Name                                                               AS roleName,
          au.FirstName,
          au.LastName,
          SUM(CASE WHEN pal.Type IN (${CLINICIAN_SCORE},${CLINICIAN_REPORT},${CLINICIAN_GOAL})
                   THEN 1 ELSE 0 END)                                          AS clinicianActions,
          SUM(CASE WHEN pal.Type IN (${MANAGER_PDF},${MANAGER_REG})
                   AND ar.Name NOT IN ('Clinician','SuperAdmin','Super Admin')
                   THEN 1 ELSE 0 END)                                          AS managerActions,
          SUM(CASE WHEN pal.Type IN (${OPS_REGISTER},${OPS_ASSIGN})
                   AND (au.FirstName LIKE '%(Ops)%' OR au.LastName LIKE '%(Ops)%')
                   THEN 1 ELSE 0 END)                                          AS opsActions
        FROM PatientAuditLog pal
        JOIN Patient pt ON pt.Id = pal.PatientId
        JOIN Centre  c  ON c.Id  = pt.CentreId
        JOIN AdminUser au ON au.Id = pal.AdminUserId
        JOIN AdminUserRole aur ON aur.UserId = au.Id
        JOIN AdminRole ar ON ar.Id = aur.RoleId
        WHERE CAST(pal.CreatedDateTime AS DATE) BETWEEN DATEADD(day, -13, @date) AND @date
          AND pal.AdminUserId IS NOT NULL
          AND pt.FirstName NOT LIKE '%test%'
          AND pt.LastName  NOT LIKE '%test%'
          AND au.FirstName NOT LIKE '%test%'
          AND au.LastName  NOT LIKE '%test%'
          AND au.Email     NOT LIKE '%@webority.com'
          AND au.Email     NOT LIKE '%@mailinator.com'
          AND ${buildCentreExclusion('c')}
          AND ar.Name NOT IN ('SuperAdmin','Super Admin')
        GROUP BY CAST(pal.CreatedDateTime AS DATE), ar.Name, au.FirstName, au.LastName
      `);

    // ── Build lookup maps ─────────────────────────────────────────────────

    // PAL activity per user
    const palMap = {};
    for (const r of palResult.recordset) {
      palMap[parseInt(r.userId, 10)] = {
        assessmentsScored:   r.assessmentsScored   || 0,
        reportsDrafted:      r.reportsDrafted      || 0,
        goalsAdded:          r.goalsAdded          || 0,
        reportsApproved:     r.reportsApproved     || 0,
        casesRegistered:     r.casesRegistered     || 0,
        cliniciansAssigned:  r.cliniciansAssigned  || 0,
        totalActions:        r.totalActions        || 0,
        lastActionDescription: r.lastActionDescription || null,
        lastActionTime:      r.lastActionTime      || null,
        goalsApproved:       0,
      };
    }

    // Goal approvals: merge into palMap + build per-patient case map
    const goalApprovalCaseMap = {};
    for (const r of goalApprovalResult.recordset) {
      const uid = parseInt(r.userId, 10);
      if (!palMap[uid]) {
        palMap[uid] = {
          assessmentsScored: 0, reportsDrafted: 0, goalsAdded: 0,
          reportsApproved: 0, casesRegistered: 0, cliniciansAssigned: 0,
          totalActions: 0, lastActionDescription: null, lastActionTime: null,
          goalsApproved: 0,
        };
      }
      palMap[uid].goalsApproved += r.goalsApproved || 0;
      // goal approvals count as an action too
      palMap[uid].totalActions  += r.goalsApproved || 0;
      // per-patient breakdown for hover tooltips
      if (!goalApprovalCaseMap[uid]) goalApprovalCaseMap[uid] = [];
      goalApprovalCaseMap[uid].push({
        patientId:   parseInt(r.patientId, 10),
        patientName: r.patientName || 'Unknown',
        count:       r.goalsApproved || 1,
      });
    }

    // Per-patient PAL breakdown map (for hover tooltips on active user cards)
    const palCaseMap = {};
    for (const r of palCaseResult.recordset) {
      const uid = parseInt(r.userId, 10);
      if (!palCaseMap[uid]) palCaseMap[uid] = {};
      if (!palCaseMap[uid][r.Type]) palCaseMap[uid][r.Type] = [];
      palCaseMap[uid][r.Type].push({
        patientId:   parseInt(r.patientId, 10),
        patientName: r.patientName || 'Unknown',
        count:       r.actionCount || 1,
      });
    }

    // Case history per user
    const chMap = {};
    for (const r of caseHistoryResult.recordset) {
      chMap[parseInt(r.userId, 10)] = {
        completePatients: r.completePatients || 0,
        partialPatients:  r.partialPatients  || 0,
      };
    }

    // Last-seen dates
    const lastSeenMap = {};
    for (const r of lastSeenResult.recordset) {
      if (r.userId) lastSeenMap[parseInt(r.userId, 10)] = String(r.lastDate).slice(0, 10);
    }

    // ── Classify users by role group ──────────────────────────────────────

    const ROLE_META = {
      clinician: {
        roleName: 'Clinician',
        coreJobDescription: 'Score assessments · draft reports · add goals · case history',
      },
      manager: {
        roleName: 'Centre Manager',
        coreJobDescription: 'Approve reports · approve goals · case history · register cases',
      },
      ops: {
        roleName: 'Centre Admin (Ops)',
        coreJobDescription: 'Register cases · assign clinicians',
      },
    };

    // Deduplicate users (one user can appear multiple times if in multiple centres)
    const userMap = {};
    for (const r of rosterResult.recordset) {
      const uid = parseInt(r.id, 10);
      if (!userMap[uid]) {
        userMap[uid] = {
          id:            uid,
          firstName:     r.FirstName,
          lastName:      r.LastName,
          email:         r.Email,
          roleName:      r.roleName || null,
          centreName:    abbreviateCentre(r.CentreName) || null,
          lastLoginDate: r.lastLoginDate ? String(r.lastLoginDate).slice(0, 10) : null,
          isOpsAdmin:    r.isOpsAdmin === 1 || r.isOpsAdmin === true,
        };
      }
    }

    // Classify each user
    const byRole = { clinician: [], manager: [], ops: [] };

    for (const user of Object.values(userMap)) {
      const bucket = roleBucket(user);
      if (!bucket) continue;
      byRole[bucket].push(user);
    }

    // Build output per role
    const roles = [];

    for (const [key, meta] of Object.entries(ROLE_META)) {
      const users = byRole[key];
      const active = [];
      const idle   = [];
      const silent = [];

      for (const user of users) {
        const uid = user.id;
        const pal = palMap[uid] || null;
        const ch  = chMap[uid]  || null;

        // Determine core job done
        let coreJobDone = false;
        let coreMetrics = null;

        if (key === 'clinician') {
          const scored    = (pal?.assessmentsScored || 0);
          const drafted   = (pal?.reportsDrafted    || 0);
          const goals     = (pal?.goalsAdded        || 0);
          const chWorks   = (ch?.completePatients || 0) + (ch?.partialPatients || 0);
          coreJobDone = scored > 0 || drafted > 0 || goals > 0 || chWorks > 0;
          if (coreJobDone) {
            const getCases = (type) => palCaseMap[uid]?.[type] ?? [];
            const getMultiCases = (types) => {
              const map = {};
              for (const t of types) {
                for (const c of (palCaseMap[uid]?.[t] ?? [])) {
                  if (!map[c.patientId]) map[c.patientId] = { patientId: c.patientId, patientName: c.patientName, count: 0 };
                  map[c.patientId].count += c.count;
                }
              }
              return Object.values(map);
            };
            coreMetrics = {
              assessmentsScored:       scored,
              assessmentCases:         getMultiCases(['AssessmentResultGenerated', 'AssessmentStatusChanged']),
              reportsDrafted:          drafted,
              reportCases:             getCases('ReportAdded'),
              goalsAdded:              goals,
              goalCases:               getCases('GoalAdded'),
              caseHistoryComplete:     ch?.completePatients || 0,
              caseHistoryPartial:      ch?.partialPatients  || 0,
              reportsApproved:         0,
              reportsApprovedCases:    [],
              goalsApproved:           0,
              goalsApprovedCases:      [],
              casesRegistered:         0,
              casesRegisteredCases:    [],
              cliniciansAssigned:      0,
              cliniciansAssignedCases: [],
            };
          }
        } else if (key === 'manager') {
          const approved   = (pal?.reportsApproved  || 0);
          const goalsApp   = (pal?.goalsApproved     || 0);
          const registered = (pal?.casesRegistered   || 0);
          const chWorks    = (ch?.completePatients || 0) + (ch?.partialPatients || 0);
          coreJobDone = approved > 0 || goalsApp > 0 || chWorks > 0 || registered > 0;
          if (coreJobDone) {
            const getCases = (type) => palCaseMap[uid]?.[type] ?? [];
            coreMetrics = {
              assessmentsScored:       0,
              assessmentCases:         [],
              reportsDrafted:          0,
              reportCases:             [],
              goalsAdded:              0,
              goalCases:               [],
              caseHistoryComplete:     ch?.completePatients || 0,
              caseHistoryPartial:      ch?.partialPatients  || 0,
              reportsApproved:         approved,
              reportsApprovedCases:    getCases('ReportPDFGenerated'),
              goalsApproved:           goalsApp,
              goalsApprovedCases:      goalApprovalCaseMap[uid] ?? [],
              casesRegistered:         registered,
              casesRegisteredCases:    getCases('CaseRegistered'),
              cliniciansAssigned:      0,
              cliniciansAssignedCases: [],
            };
          }
        } else { // ops
          const registered = (pal?.casesRegistered   || 0);
          const assigned   = (pal?.cliniciansAssigned || 0);
          coreJobDone = registered > 0 || assigned > 0;
          if (coreJobDone) {
            const getCases = (type) => palCaseMap[uid]?.[type] ?? [];
            coreMetrics = {
              assessmentsScored:       0,
              assessmentCases:         [],
              reportsDrafted:          0,
              reportCases:             [],
              goalsAdded:              0,
              goalCases:               [],
              caseHistoryComplete:     0,
              caseHistoryPartial:      0,
              reportsApproved:         0,
              reportsApprovedCases:    [],
              goalsApproved:           0,
              goalsApprovedCases:      [],
              casesRegistered:         registered,
              casesRegisteredCases:    getCases('CaseRegistered'),
              cliniciansAssigned:      assigned,
              cliniciansAssignedCases: getCases('CaseAssigned'),
            };
          }
        }

        if (coreJobDone) {
          active.push({
            id:         user.id,
            firstName:  user.firstName,
            lastName:   user.lastName,
            email:      user.email,
            centreName: user.centreName,
            coreMetrics,
          });
        } else if (pal && pal.totalActions > 0) {
          // Present but idle
          idle.push({
            id:          user.id,
            firstName:   user.firstName,
            lastName:    user.lastName,
            email:       user.email,
            centreName:  user.centreName,
            actionsCount: pal.totalActions,
            lastActionDescription: pal.lastActionDescription || null,
            lastActionTime: pal.lastActionTime ? new Date(pal.lastActionTime).toISOString() : null,
          });
        } else {
          // Silent — use PAL date first, fall back to last login date
          const lastPalDate = lastSeenMap[user.id] || null;
          const lastLogin   = user.lastLoginDate || null;
          let lastDate = null;
          if (lastPalDate && lastLogin) {
            lastDate = lastPalDate >= lastLogin ? lastPalDate : lastLogin;
          } else {
            lastDate = lastPalDate || lastLogin;
          }
          let lastActivityDaysAgo = null;
          if (lastDate) {
            const diff = Math.floor(
              (new Date(date).getTime() - new Date(lastDate).getTime()) / 86400000
            );
            lastActivityDaysAgo = diff >= 0 ? diff : null;
          }
          silent.push({
            id:                  user.id,
            firstName:           user.firstName,
            lastName:            user.lastName,
            email:               user.email,
            centreName:          user.centreName,
            lastActivityDate:    lastDate,
            lastActivityDaysAgo,
          });
        }
      }

      // Sort: active A-Z, idle by lastActionTime desc, silent by lastActivityDaysAgo
      active.sort((a, b) =>
        (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
      idle.sort((a, b) => {
        const ta = a.lastActionTime ? new Date(a.lastActionTime).getTime() : 0;
        const tb = b.lastActionTime ? new Date(b.lastActionTime).getTime() : 0;
        return tb - ta;
      });
      silent.sort((a, b) => {
        if (a.lastActivityDate === null && b.lastActivityDate !== null) return -1;
        if (a.lastActivityDate !== null && b.lastActivityDate === null) return 1;
        return (b.lastActivityDaysAgo ?? 0) - (a.lastActivityDaysAgo ?? 0);
      });

      roles.push({
        key,
        roleName: meta.roleName,
        coreJobDescription: meta.coreJobDescription,
        total:       users.length,
        didCoreJob:  active.length,
        presentButIdle: idle.length,
        silent:      silent.length,
        users: { active, idle, silent },
      });
    }

    // ── Global summary ────────────────────────────────────────────────────
    const summary = roles.reduce(
      (acc, r) => {
        acc.didCoreJob    += r.didCoreJob;
        acc.presentButIdle += r.presentButIdle;
        acc.silent        += r.silent;
        acc.totalUsers    += r.total;
        return acc;
      },
      { didCoreJob: 0, presentButIdle: 0, silent: 0, totalUsers: 0 }
    );

    // ── Build 14-day trend ────────────────────────────────────────────────
    // Sum per-user per-day rows by date
    const trendMap = {};
    for (const r of trendResult.recordset) {
      const d = String(r.eventDate).slice(0, 10);
      if (!trendMap[d]) {
        trendMap[d] = { date: d, clinicianCoreActions: 0, managerCoreActions: 0, opsCoreActions: 0 };
      }
      const bucket = roleBucket({ roleName: r.roleName, FirstName: r.FirstName, LastName: r.LastName });
      if (bucket === 'clinician') trendMap[d].clinicianCoreActions += r.clinicianActions || 0;
      if (bucket === 'manager')   trendMap[d].managerCoreActions   += r.managerActions   || 0;
      if (bucket === 'ops')       trendMap[d].opsCoreActions       += r.opsActions       || 0;
    }

    // Ensure all 14 days appear even if some have zero activity
    const trend = { days: [] };
    for (let i = 13; i >= 0; i--) {
      const d = new Date(date);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      trend.days.push(trendMap[iso] || { date: iso, clinicianCoreActions: 0, managerCoreActions: 0, opsCoreActions: 0 });
    }

    res.json({ date, summary, roles, trend });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
