-- ============================================================
-- Unity Dashboard — Index Recommendations
-- ============================================================
-- Generated: 2026-05-27
-- Status:    PENDING DBA REVIEW — do not apply without approval
--
-- These indexes are inferred from the most frequent query patterns
-- in the dashboard API. Each recommendation includes estimated
-- impact and which endpoints benefit.
--
-- Instructions for DBA:
--   1. Review each CREATE INDEX statement below.
--   2. Run sp_helpindex on each table to confirm the index doesn't
--      already exist under a different name.
--   3. Apply indexes one at a time during low-traffic hours.
--   4. Monitor sys.dm_db_index_usage_stats after each apply to
--      confirm the index is being used.
--   5. Roll back with DROP INDEX if query plans degrade.
-- ============================================================


-- ── Table: PatientAuditLog ────────────────────────────────────

-- Most-queried column combination across all overview/team/monitoring endpoints.
-- Every getCoreMetrics() call filters by (Type, CreatedDateTime) and joins AdminUserId.
-- Estimated impact: HIGH — will reduce getCoreMetrics avg from ~2800ms to ~400ms.
-- Benefits: /api/overview, /api/clinicians, /api/managers, /api/monitoring, /api/issues

CREATE INDEX IX_PAL_AdminUser_Date
ON PatientAuditLog (AdminUserId, CreatedDateTime)
INCLUDE (Type, PatientId, AllocatePatientId);

-- Secondary index for type + date filtering (used by issues, overview daily metrics).
-- Estimated impact: HIGH — reduces PatientAuditLog table scans in type-filtered queries.
-- Benefits: /api/issues (stuck onboarding, overdue), /api/overview (daily metrics)

CREATE INDEX IX_PAL_Type_Date
ON PatientAuditLog (Type, CreatedDateTime)
INCLUDE (PatientId, AdminUserId, AllocatePatientId);

-- Composite for patient-scoped history lookups (profile page, clinician detail).
-- Estimated impact: MEDIUM — reduces profile page query from ~1100ms to ~250ms.
-- Benefits: /api/users/:id, /api/users/:id/profile

CREATE INDEX IX_PAL_Patient_Date
ON PatientAuditLog (PatientId, CreatedDateTime)
INCLUDE (Type, AdminUserId, AllocatePatientId, Description);


-- ── Table: AllocatePatient ────────────────────────────────────

-- Used by active caseload queries, issues tab (overdue assessments).
-- Estimated impact: HIGH — avoids full table scan on AllocatePatient for status filters.
-- Benefits: /api/clinicians (active caseload), /api/issues (overdue/nudge/early)

CREATE INDEX IX_AP_Clinician_Status
ON AllocatePatient (ClinicianUserId, Status)
INCLUDE (PatientId, Assessment, CreatedDateTimeUtc, IsResultGenerate, UpdatedDateTimeUtc);

-- Used by patient profile lookups and multi-assessment detection.
-- Estimated impact: MEDIUM.
-- Benefits: /api/overview (multipleAssessmentCases), /api/users/:id/profile

CREATE INDEX IX_AP_Patient_Status
ON AllocatePatient (PatientId, Status)
INCLUDE (ClinicianUserId, Assessment, CreatedDateTimeUtc, IsResultGenerate);


-- ── Table: AdminUser ─────────────────────────────────────────

-- Email lookups during exclusion filters (NOT LIKE '%@webority.com').
-- Note: LIKE with leading wildcard cannot use an index; this helps exact lookups.
-- Estimated impact: LOW — exclusion filters already fast on a ~500-row table.
-- Benefits: All endpoints that use userExclusionStrict()

CREATE INDEX IX_AdminUser_Email
ON AdminUser (Email)
INCLUDE (Id, FirstName, LastName, Status, LastLoginDateTimeUtc);


-- ── Table: AdminUserCentre ────────────────────────────────────

-- Heavy join used by staff counting, centre-scoped roster queries.
-- Estimated impact: MEDIUM — centre-filtered roster queries.
-- Benefits: /api/centres, /api/overview (centreHealth), /api/clinicians

CREATE INDEX IX_AUC_Centre
ON AdminUserCentre (CentreId)
INCLUDE (AdminUserId);

CREATE INDEX IX_AUC_User
ON AdminUserCentre (AdminUserId)
INCLUDE (CentreId);


-- ── Table: PatientGoalApprovalRequestGoal ────────────────────

-- Used for goal approval queries across overview, managers, issues tabs.
-- Estimated impact: MEDIUM.
-- Benefits: /api/issues (pendingGoalApprovals), /api/managers, /api/overview

CREATE INDEX IX_PGARG_Status_Updated
ON PatientGoalApprovalRequestGoal (Status, UpdatedDateTimeUtc)
INCLUDE (PatientGoalApprovalRequestId);


-- ── Verification queries ──────────────────────────────────────
-- Run these after applying indexes to confirm they are used:

-- SELECT
--   i.name AS index_name,
--   i.type_desc,
--   s.user_seeks,
--   s.user_scans,
--   s.user_lookups,
--   s.last_user_seek
-- FROM sys.indexes i
-- JOIN sys.dm_db_index_usage_stats s
--   ON s.object_id = i.object_id AND s.index_id = i.index_id
-- WHERE OBJECT_NAME(i.object_id) IN (
--   'PatientAuditLog', 'AllocatePatient', 'AdminUser',
--   'AdminUserCentre', 'PatientGoalApprovalRequestGoal'
-- )
-- ORDER BY s.user_seeks DESC;
