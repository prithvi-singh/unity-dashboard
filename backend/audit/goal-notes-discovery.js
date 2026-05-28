'use strict';

/**
 * goal-notes-discovery.js
 *
 * READ-ONLY discovery script — no INSERT/UPDATE/DELETE/DDL.
 *
 * Answers:
 *   1. Which tables are related to goals, notes, progress, baseline, activity?
 *   2. What is the full Case→Assessment→GoalRequest→Goal→Note hierarchy?
 *   3. How much data exists and what are the usage patterns?
 *   4. Do audit log event types (BaselineAdded, ActivityAdded, ProgressAdded)
 *      correlate to dedicated tables or are they the only store?
 *   5. What is the compliance gap — goals with zero notes?
 *
 * Usage:
 *   node backend/audit/goal-notes-discovery.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options:  { encrypt: true, trustServerCertificate: false },
  requestTimeout:    45000,
  connectionTimeout: 30000,
  pool: { max: 3, min: 0, idleTimeoutMillis: 15000 },
};

function hr(title) {
  console.log('\n' + '═'.repeat(60));
  console.log(title);
  console.log('═'.repeat(60));
}

async function run() {
  console.log('Connecting to', process.env.DB_SERVER, '/', process.env.DB_NAME);
  const pool = await new sql.ConnectionPool(config).connect();
  console.log('Connected.\n');

  const q = (query, label) => pool.request().query(query)
    .then(r => { if (label) { hr(label); console.table(r.recordset); } return r; });

  // ── STEP 1: Tables matching goal/note/progress/observation/session/baseline/activity ──

  await q(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (
            TABLE_NAME LIKE '%goal%'
         OR TABLE_NAME LIKE '%note%'
         OR TABLE_NAME LIKE '%progress%'
         OR TABLE_NAME LIKE '%observation%'
         OR TABLE_NAME LIKE '%session%'
         OR TABLE_NAME LIKE '%baseline%'
         OR TABLE_NAME LIKE '%activity%'
      )
    ORDER BY TABLE_NAME
  `, 'STEP 1A: Tables matching goal/note/progress/observation/session/baseline/activity');

  // ── STEP 1B: ALL tables in DB (full list to spot any we missed) ──────────────

  await q(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `, 'STEP 1B: ALL tables in database');

  // ── STEP 2A: Columns for PatientGoalApprovalRequest ──────────────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientGoalApprovalRequest'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 2A: PatientGoalApprovalRequest — columns');

  // ── STEP 2B: Columns for PatientGoalApprovalRequestGoal ──────────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientGoalApprovalRequestGoal'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 2B: PatientGoalApprovalRequestGoal — columns');

  // ── STEP 2C: Columns for PatientAuditLog ─────────────────────────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientAuditLog'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 2C: PatientAuditLog — columns');

  // ── STEP 2D: Columns for AllocatePatient ──────────────────────────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'AllocatePatient'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 2D: AllocatePatient — columns');

  // ── STEP 2E: Columns for any table with goal/note/baseline/progress/activity ──
  // (Gets columns for ALL matched table names in one sweep)

  await q(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN (
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE = 'BASE TABLE'
        AND (
              TABLE_NAME LIKE '%goal%'
           OR TABLE_NAME LIKE '%note%'
           OR TABLE_NAME LIKE '%progress%'
           OR TABLE_NAME LIKE '%observation%'
           OR TABLE_NAME LIKE '%session%'
           OR TABLE_NAME LIKE '%baseline%'
           OR TABLE_NAME LIKE '%activity%'
        )
    )
    ORDER BY TABLE_NAME, ORDINAL_POSITION
  `, 'STEP 2E: All columns in goal/note/progress/baseline/activity tables');

  // ── STEP 2F: Foreign keys referencing PatientGoalApprovalRequestGoal ─────────

  await q(`
    SELECT
      fk.name              AS fk_name,
      tp.name              AS parent_table,
      cp.name              AS parent_column,
      tr.name              AS referenced_table,
      cr.name              AS referenced_column
    FROM sys.foreign_keys fk
    JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
    JOIN sys.tables tp  ON tp.object_id  = fkc.parent_object_id
    JOIN sys.columns cp ON cp.object_id  = fkc.parent_object_id  AND cp.column_id = fkc.parent_column_id
    JOIN sys.tables tr  ON tr.object_id  = fkc.referenced_object_id
    JOIN sys.columns cr ON cr.object_id  = fkc.referenced_object_id AND cr.column_id = fkc.referenced_column_id
    WHERE tr.name IN (
      'PatientGoalApprovalRequest',
      'PatientGoalApprovalRequestGoal',
      'AllocatePatient'
    )
    ORDER BY tp.name, cp.name
  `, 'STEP 2F: FK relationships pointing to goal/assessment tables');

  // ── STEP 3: Row counts and date ranges for hierarchy tables ──────────────────

  await q(`
    SELECT
      'AllocatePatient'                   AS tbl,
      COUNT(*)                            AS total_rows,
      MIN(CreatedDateTimeUtc)             AS earliest,
      MAX(CreatedDateTimeUtc)             AS latest
    FROM AllocatePatient
    UNION ALL
    SELECT
      'PatientGoalApprovalRequest'        AS tbl,
      COUNT(*)                            AS total_rows,
      MIN(CreatedDateTimeUtc)             AS earliest,
      MAX(CreatedDateTimeUtc)             AS latest
    FROM PatientGoalApprovalRequest
    UNION ALL
    SELECT
      'PatientGoalApprovalRequestGoal'    AS tbl,
      COUNT(*)                            AS total_rows,
      NULL                                AS earliest,
      NULL                                AS latest
    FROM PatientGoalApprovalRequestGoal
    UNION ALL
    SELECT
      'PatientAuditLog'                   AS tbl,
      COUNT(*)                            AS total_rows,
      MIN(CreatedDateTime)                AS earliest,
      MAX(CreatedDateTime)                AS latest
    FROM PatientAuditLog
  `, 'STEP 3A: Row counts for hierarchy tables');

  // ── STEP 3B: PatientGoalApprovalRequestGoal — status breakdown ───────────────

  await q(`
    SELECT Status, COUNT(*) AS cnt
    FROM PatientGoalApprovalRequestGoal
    GROUP BY Status
    ORDER BY cnt DESC
  `, 'STEP 3B: PatientGoalApprovalRequestGoal status distribution');

  // ── STEP 4A: BaselineAdded events — what columns are populated? ──────────────

  await q(`
    SELECT TOP 20
      pal.Id,
      pal.PatientId,
      pal.AllocatePatientId,
      pal.AdminUserId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      au.FirstName + ' ' + au.LastName AS actor
    FROM PatientAuditLog pal
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type = 'BaselineAdded'
    ORDER BY pal.CreatedDateTime DESC
  `, 'STEP 4A: Sample BaselineAdded audit events (top 20, newest first)');

  // ── STEP 4B: ActivityAdded events ────────────────────────────────────────────

  await q(`
    SELECT TOP 20
      pal.Id,
      pal.PatientId,
      pal.AllocatePatientId,
      pal.AdminUserId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      au.FirstName + ' ' + au.LastName AS actor
    FROM PatientAuditLog pal
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type = 'ActivityAdded'
    ORDER BY pal.CreatedDateTime DESC
  `, 'STEP 4B: Sample ActivityAdded audit events (top 20, newest first)');

  // ── STEP 4C: ProgressAdded events ────────────────────────────────────────────

  await q(`
    SELECT TOP 25
      pal.Id,
      pal.PatientId,
      pal.AllocatePatientId,
      pal.AdminUserId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      au.FirstName + ' ' + au.LastName AS actor
    FROM PatientAuditLog pal
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type = 'ProgressAdded'
    ORDER BY pal.CreatedDateTime DESC
  `, 'STEP 4C: Sample ProgressAdded audit events (all 22, newest first)');

  // ── STEP 4D: BaselineDeleted and ProgressDeleted for completeness ─────────────

  await q(`
    SELECT TOP 20
      pal.Id,
      pal.PatientId,
      pal.AllocatePatientId,
      pal.AdminUserId,
      pal.Type,
      pal.Description,
      pal.CreatedDateTime,
      au.FirstName + ' ' + au.LastName AS actor
    FROM PatientAuditLog pal
    LEFT JOIN AdminUser au ON au.Id = pal.AdminUserId
    WHERE pal.Type IN ('BaselineDeleted','ProgressDeleted','ActivityDeleted')
    ORDER BY pal.Type, pal.CreatedDateTime DESC
  `, 'STEP 4D: Baseline/Progress/Activity deleted events');

  // ── STEP 4E: Do BaselineAdded / ActivityAdded events have AllocatePatientId? ──
  // (checks if they link back to a specific assessment/goal chain)

  await q(`
    SELECT
      Type,
      COUNT(*) AS total,
      SUM(CASE WHEN AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS has_allocate_id,
      SUM(CASE WHEN PatientId         IS NOT NULL THEN 1 ELSE 0 END) AS has_patient_id,
      SUM(CASE WHEN AdminUserId       IS NOT NULL THEN 1 ELSE 0 END) AS has_admin_user_id
    FROM PatientAuditLog
    WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded',
                   'BaselineDeleted','ActivityDeleted','ProgressDeleted',
                   'BaselineUpdated','GoalAdded','GoalDeleted','GoalUpdated')
    GROUP BY Type
    ORDER BY total DESC
  `, 'STEP 4E: Null-check on key columns for note-related audit events');

  // ── STEP 4F: Check if AllocatePatient has columns for Baseline/Activity/Progress ─

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'AllocatePatient'
      AND (
            COLUMN_NAME LIKE '%baseline%'
         OR COLUMN_NAME LIKE '%activity%'
         OR COLUMN_NAME LIKE '%progress%'
         OR COLUMN_NAME LIKE '%note%'
         OR COLUMN_NAME LIKE '%observation%'
      )
    ORDER BY ORDINAL_POSITION
  `, 'STEP 4F: AllocatePatient columns that hint at notes/baseline/progress');

  // ── STEP 4G: PatientGoalApprovalRequestGoal — check for note/baseline columns ─

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientGoalApprovalRequestGoal'
      AND (
            COLUMN_NAME LIKE '%note%'
         OR COLUMN_NAME LIKE '%baseline%'
         OR COLUMN_NAME LIKE '%progress%'
         OR COLUMN_NAME LIKE '%observation%'
         OR COLUMN_NAME LIKE '%activity%'
         OR COLUMN_NAME LIKE '%comment%'
         OR COLUMN_NAME LIKE '%remark%'
      )
    ORDER BY ORDINAL_POSITION
  `, 'STEP 4G: PatientGoalApprovalRequestGoal columns hinting at notes');

  // ── STEP 5A: Compliance — approved goals vs goals with any note event ─────────
  // Proxy: count distinct AllocatePatientIds that have BaselineAdded vs all
  // that have approved goals

  await q(`
    SELECT
      COUNT(DISTINCT g.Id)   AS total_approved_goals,
      COUNT(DISTINCT g.PatientGoalApprovalRequestId) AS total_goal_requests,
      COUNT(DISTINCT pgar.AllocatePatientId) AS assessments_with_goals
    FROM PatientGoalApprovalRequestGoal g
    JOIN PatientGoalApprovalRequest pgar
      ON pgar.Id = g.PatientGoalApprovalRequestId
    WHERE g.Status = 'Approved'
  `, 'STEP 5A: Total approved goals / requests / assessments');

  // ── STEP 5B: Assessments with approved goals — how many have BaselineAdded? ───

  await q(`
    SELECT
      COUNT(DISTINCT ap_with_goals.Id) AS assessments_with_approved_goals,
      SUM(CASE WHEN bal.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS assessments_with_baseline_event,
      SUM(CASE WHEN act.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS assessments_with_activity_event,
      SUM(CASE WHEN pro.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS assessments_with_progress_event
    FROM (
      SELECT DISTINCT pgar.AllocatePatientId AS Id
      FROM PatientGoalApprovalRequest pgar
      JOIN PatientGoalApprovalRequestGoal g
        ON g.PatientGoalApprovalRequestId = pgar.Id
       AND g.Status = 'Approved'
    ) ap_with_goals
    LEFT JOIN (
      SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'BaselineAdded'
    ) bal ON bal.AllocatePatientId = ap_with_goals.Id
    LEFT JOIN (
      SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'ActivityAdded'
    ) act ON act.AllocatePatientId = ap_with_goals.Id
    LEFT JOIN (
      SELECT DISTINCT AllocatePatientId FROM PatientAuditLog WHERE Type = 'ProgressAdded'
    ) pro ON pro.AllocatePatientId = ap_with_goals.Id
  `, 'STEP 5B: Assessments with approved goals — coverage by note event type');

  // ── STEP 5C: Note frequency distribution — BaselineAdded per AllocatePatient ──

  await q(`
    WITH baseline_counts AS (
      SELECT
        AllocatePatientId,
        COUNT(*) AS note_count
      FROM PatientAuditLog
      WHERE Type = 'BaselineAdded'
        AND AllocatePatientId IS NOT NULL
      GROUP BY AllocatePatientId
    ),
    activity_counts AS (
      SELECT
        AllocatePatientId,
        COUNT(*) AS note_count
      FROM PatientAuditLog
      WHERE Type = 'ActivityAdded'
        AND AllocatePatientId IS NOT NULL
      GROUP BY AllocatePatientId
    ),
    progress_counts AS (
      SELECT
        AllocatePatientId,
        COUNT(*) AS note_count
      FROM PatientAuditLog
      WHERE Type = 'ProgressAdded'
        AND AllocatePatientId IS NOT NULL
      GROUP BY AllocatePatientId
    )
    SELECT 'BaselineAdded' AS type,
           COUNT(*) AS assessments,
           MIN(note_count) AS min_notes,
           MAX(note_count) AS max_notes,
           AVG(CAST(note_count AS FLOAT)) AS avg_notes,
           SUM(CASE WHEN note_count = 1 THEN 1 ELSE 0 END) AS exactly_1,
           SUM(CASE WHEN note_count BETWEEN 2 AND 5 THEN 1 ELSE 0 END) AS n2_to_5,
           SUM(CASE WHEN note_count BETWEEN 6 AND 10 THEN 1 ELSE 0 END) AS n6_to_10,
           SUM(CASE WHEN note_count > 10 THEN 1 ELSE 0 END) AS over_10
    FROM baseline_counts
    UNION ALL
    SELECT 'ActivityAdded',
           COUNT(*),
           MIN(note_count), MAX(note_count), AVG(CAST(note_count AS FLOAT)),
           SUM(CASE WHEN note_count = 1 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count BETWEEN 2 AND 5 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count BETWEEN 6 AND 10 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count > 10 THEN 1 ELSE 0 END)
    FROM activity_counts
    UNION ALL
    SELECT 'ProgressAdded',
           COUNT(*),
           MIN(note_count), MAX(note_count), AVG(CAST(note_count AS FLOAT)),
           SUM(CASE WHEN note_count = 1 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count BETWEEN 2 AND 5 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count BETWEEN 6 AND 10 THEN 1 ELSE 0 END),
           SUM(CASE WHEN note_count > 10 THEN 1 ELSE 0 END)
    FROM progress_counts
  `, 'STEP 5C: Note frequency distribution per assessment (by event type)');

  // ── STEP 5D: Distinct users adding notes ─────────────────────────────────────

  await q(`
    SELECT
      au.Id            AS userId,
      au.FirstName + ' ' + au.LastName AS name,
      ar.Name          AS role,
      COUNT(*)         AS note_events,
      MIN(pal.CreatedDateTime) AS first_note,
      MAX(pal.CreatedDateTime) AS last_note
    FROM PatientAuditLog pal
    JOIN AdminUser au  ON au.Id = pal.AdminUserId
    LEFT JOIN AdminUserRole aur ON aur.AdminUserId = au.Id
    LEFT JOIN AdminRole ar      ON ar.Id = aur.AdminRoleId
    WHERE pal.Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
      AND LOWER(au.Email) NOT LIKE '%@webority.com'
      AND LOWER(au.Email) NOT LIKE '%@mailinator.com'
      AND LOWER(au.FirstName) NOT LIKE '%test%'
      AND LOWER(au.LastName)  NOT LIKE '%test%'
    GROUP BY au.Id, au.FirstName, au.LastName, ar.Name
    ORDER BY note_events DESC
  `, 'STEP 5D: Users who added notes (excl. test users), with role');

  // ── STEP 5E: Role breakdown — Clinician vs Manager notes ─────────────────────

  await q(`
    SELECT
      ISNULL(ar.Name, 'Unknown') AS role,
      COUNT(*) AS total_note_events
    FROM PatientAuditLog pal
    JOIN AdminUser au  ON au.Id = pal.AdminUserId
    LEFT JOIN AdminUserRole aur ON aur.AdminUserId = au.Id
    LEFT JOIN AdminRole ar      ON ar.Id = aur.AdminRoleId
    WHERE pal.Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
      AND LOWER(au.Email) NOT LIKE '%@webority.com'
      AND LOWER(au.Email) NOT LIKE '%@mailinator.com'
    GROUP BY ar.Name
    ORDER BY total_note_events DESC
  `, 'STEP 5E: Note events by role (Clinician vs CentreManager vs other)');

  // ── STEP 5F: Date range and frequency of all note events ─────────────────────

  await q(`
    SELECT
      Type,
      COUNT(*) AS total,
      MIN(CreatedDateTime) AS earliest,
      MAX(CreatedDateTime) AS latest,
      DATEDIFF(day, MIN(CreatedDateTime), MAX(CreatedDateTime)) AS span_days,
      CAST(COUNT(*) AS FLOAT) / NULLIF(DATEDIFF(week, MIN(CreatedDateTime), MAX(CreatedDateTime)), 0) AS avg_per_week
    FROM PatientAuditLog
    WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
      AND AllocatePatientId IS NOT NULL
    GROUP BY Type
  `, 'STEP 5F: Date range and average weekly frequency by event type');

  // ── STEP 5G: Compliance gap — approved goal assessments with ZERO notes ───────

  await q(`
    WITH goal_assessments AS (
      SELECT DISTINCT pgar.AllocatePatientId
      FROM PatientGoalApprovalRequest pgar
      JOIN PatientGoalApprovalRequestGoal g
        ON g.PatientGoalApprovalRequestId = pgar.Id
       AND g.Status = 'Approved'
      JOIN AllocatePatient ap ON ap.Id = pgar.AllocatePatientId
      JOIN Patient pt ON pt.Id = ap.PatientId
      WHERE ap.Status IN ('NotStarted','InProgress','OnHold')
        AND pt.FirstName NOT LIKE '%test%'
        AND pt.LastName  NOT LIKE '%test%'
    ),
    note_events AS (
      SELECT DISTINCT AllocatePatientId
      FROM PatientAuditLog
      WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
        AND AllocatePatientId IS NOT NULL
    ),
    recent_7d AS (
      SELECT DISTINCT AllocatePatientId
      FROM PatientAuditLog
      WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
        AND AllocatePatientId IS NOT NULL
        AND CreatedDateTime >= DATEADD(day, -7, SYSDATETIMEOFFSET())
    ),
    recent_14d AS (
      SELECT DISTINCT AllocatePatientId
      FROM PatientAuditLog
      WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
        AND AllocatePatientId IS NOT NULL
        AND CreatedDateTime >= DATEADD(day, -14, SYSDATETIMEOFFSET())
    )
    SELECT
      COUNT(ga.AllocatePatientId)                                      AS total_active_assessments_with_approved_goals,
      SUM(CASE WHEN ne.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS has_at_least_one_note,
      SUM(CASE WHEN ne.AllocatePatientId IS NULL     THEN 1 ELSE 0 END) AS zero_notes_ever,
      SUM(CASE WHEN r7.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS has_note_last_7_days,
      SUM(CASE WHEN r14.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS has_note_last_14_days,
      CAST(SUM(CASE WHEN ne.AllocatePatientId IS NOT NULL THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(ga.AllocatePatientId), 0) * 100                  AS pct_with_any_note,
      CAST(SUM(CASE WHEN ne.AllocatePatientId IS NULL THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(ga.AllocatePatientId), 0) * 100                  AS pct_zero_notes
    FROM goal_assessments ga
    LEFT JOIN note_events  ne  ON ne.AllocatePatientId  = ga.AllocatePatientId
    LEFT JOIN recent_7d    r7  ON r7.AllocatePatientId  = ga.AllocatePatientId
    LEFT JOIN recent_14d   r14 ON r14.AllocatePatientId = ga.AllocatePatientId
  `, 'STEP 5G: Compliance gap — active assessments with approved goals vs note coverage');

  // ── STEP 5H: Average gap between consecutive note events per assessment ────────

  await q(`
    WITH note_events AS (
      SELECT
        AllocatePatientId,
        CreatedDateTime,
        LAG(CreatedDateTime) OVER (
          PARTITION BY AllocatePatientId
          ORDER BY CreatedDateTime
        ) AS prev_note
      FROM PatientAuditLog
      WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
        AND AllocatePatientId IS NOT NULL
    ),
    gaps AS (
      SELECT
        AllocatePatientId,
        DATEDIFF(day, prev_note, CreatedDateTime) AS gap_days
      FROM note_events
      WHERE prev_note IS NOT NULL
    )
    SELECT
      COUNT(*) AS total_gaps_measured,
      MIN(gap_days) AS min_gap_days,
      MAX(gap_days) AS max_gap_days,
      AVG(CAST(gap_days AS FLOAT)) AS avg_gap_days,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days) OVER () AS median_gap_days,
      SUM(CASE WHEN gap_days <= 3 THEN 1 ELSE 0 END) AS within_3_days,
      SUM(CASE WHEN gap_days BETWEEN 4 AND 7 THEN 1 ELSE 0 END) AS within_4_to_7,
      SUM(CASE WHEN gap_days > 7 THEN 1 ELSE 0 END) AS over_7_days
    FROM (SELECT DISTINCT AllocatePatientId, gap_days FROM gaps) sub
  `, 'STEP 5H: Average gap between consecutive note events (days)');

  // ── STEP 5I: Description samples — what is stored in the Description field? ───

  await q(`
    SELECT TOP 20
      Type,
      Description,
      CreatedDateTime,
      AllocatePatientId
    FROM PatientAuditLog
    WHERE Type IN ('BaselineAdded','ActivityAdded','ProgressAdded')
      AND AllocatePatientId IS NOT NULL
    ORDER BY NEWID()
  `, 'STEP 5I: Random sample of note event descriptions (content preview)');

  // ── STEP 5J: AllocatePatient — does it have BaselineScore / GoalProgress cols? ─

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'AllocatePatient'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 5J: AllocatePatient — FULL column list');

  // ── STEP 5K: PatientGoalApprovalRequestGoal — FULL column list ───────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientGoalApprovalRequestGoal'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 5K: PatientGoalApprovalRequestGoal — FULL column list');

  // ── STEP 5L: PatientGoalApprovalRequest — FULL column list ───────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientGoalApprovalRequest'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 5L: PatientGoalApprovalRequest — FULL column list');

  // ── STEP 5M: PatientAuditLog — FULL column list ───────────────────────────────

  await q(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'PatientAuditLog'
    ORDER BY ORDINAL_POSITION
  `, 'STEP 5M: PatientAuditLog — FULL column list');

  await pool.close();
  console.log('\n' + '═'.repeat(60));
  console.log('DISCOVERY COMPLETE');
  console.log('═'.repeat(60));
}

run().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
