'use strict';
/**
 * apply-indexes.js
 * Checks which indexes from index-recommendations.sql already exist,
 * then applies the missing ones one at a time.
 *
 * Usage:
 *   node backend/scripts/apply-indexes.js
 *
 * Requires DB credentials with CREATE INDEX / ALTER TABLE permissions.
 * If the read-only DB_USER is used it will report "permission denied" for
 * the CREATE INDEX step — provide a DBA-level credential via env override:
 *   DB_USER=dba_user DB_PASSWORD=secret node backend/scripts/apply-indexes.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 120000,
  connectionTimeout: 30000,
};

// ---------------------------------------------------------------------------
// Index definitions — sourced from audit/index-recommendations.sql
// ---------------------------------------------------------------------------
const INDEXES = [
  // ── HIGH PRIORITY (3 critical from audit) ──────────────────────────────
  {
    name:  'IX_PAL_AdminUser_Date',
    table: 'PatientAuditLog',
    ddl:   `CREATE INDEX IX_PAL_AdminUser_Date
              ON PatientAuditLog (AdminUserId, CreatedDateTime)
              INCLUDE (Type, PatientId, AllocatePatientId)`,
  },
  {
    name:  'IX_PAL_Type_Date',
    table: 'PatientAuditLog',
    ddl:   `CREATE INDEX IX_PAL_Type_Date
              ON PatientAuditLog (Type, CreatedDateTime)
              INCLUDE (PatientId, AdminUserId, AllocatePatientId)`,
  },
  {
    name:  'IX_AP_Clinician_Status',
    table: 'AllocatePatient',
    ddl:   `CREATE INDEX IX_AP_Clinician_Status
              ON AllocatePatient (ClinicianUserId, Status)
              INCLUDE (PatientId, Assessment, CreatedDateTimeUtc, IsResultGenerate, UpdatedDateTimeUtc)`,
  },
  // ── MEDIUM PRIORITY ────────────────────────────────────────────────────
  {
    name:  'IX_PAL_Patient_Date',
    table: 'PatientAuditLog',
    ddl:   `CREATE INDEX IX_PAL_Patient_Date
              ON PatientAuditLog (PatientId, CreatedDateTime)
              INCLUDE (Type, AdminUserId, AllocatePatientId, Description)`,
  },
  {
    name:  'IX_AP_Patient_Status',
    table: 'AllocatePatient',
    ddl:   `CREATE INDEX IX_AP_Patient_Status
              ON AllocatePatient (PatientId, Status)
              INCLUDE (ClinicianUserId, Assessment, CreatedDateTimeUtc, IsResultGenerate)`,
  },
  {
    name:  'IX_AUC_Centre',
    table: 'AdminUserCentre',
    ddl:   `CREATE INDEX IX_AUC_Centre
              ON AdminUserCentre (CentreId)
              INCLUDE (AdminUserId)`,
  },
  {
    name:  'IX_AUC_User',
    table: 'AdminUserCentre',
    ddl:   `CREATE INDEX IX_AUC_User
              ON AdminUserCentre (AdminUserId)
              INCLUDE (CentreId)`,
  },
  {
    name:  'IX_PGARG_Status_Updated',
    table: 'PatientGoalApprovalRequestGoal',
    ddl:   `CREATE INDEX IX_PGARG_Status_Updated
              ON PatientGoalApprovalRequestGoal (Status, UpdatedDateTimeUtc)
              INCLUDE (PatientGoalApprovalRequestId)`,
  },
  // ── LOW PRIORITY ───────────────────────────────────────────────────────
  {
    name:  'IX_AdminUser_Email',
    table: 'AdminUser',
    ddl:   `CREATE INDEX IX_AdminUser_Email
              ON AdminUser (Email)
              INCLUDE (Id, FirstName, LastName, Status, LastLoginDateTimeUtc)`,
  },
];

const CRITICAL = new Set(['IX_PAL_AdminUser_Date', 'IX_PAL_Type_Date', 'IX_AP_Clinician_Status']);

async function main() {
  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`\n[db] Connected to ${process.env.DB_SERVER} / ${process.env.DB_NAME}\n`);

  // ── STEP 1: Check which indexes already exist ──────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('STEP 1 — Checking existing indexes');
  console.log('═══════════════════════════════════════════════');

  const names = INDEXES.map(i => `'${i.name}'`).join(', ');
  const existsResult = await pool.request().query(`
    SELECT i.name, OBJECT_NAME(i.object_id) AS table_name
    FROM sys.indexes i
    WHERE i.name IN (${names})
  `);

  const existing = new Set(existsResult.recordset.map(r => r.name));

  console.log('\nAll indexes in recommendation file:');
  for (const idx of INDEXES) {
    const status   = existing.has(idx.name) ? '✓ EXISTS' : '✗ MISSING';
    const priority = CRITICAL.has(idx.name) ? ' ← CRITICAL' : '';
    console.log(`  ${status}  ${idx.name}  (${idx.table})${priority}`);
  }

  const missing = INDEXES.filter(i => !existing.has(i.name));
  const missingCritical = missing.filter(i => CRITICAL.has(i.name));

  console.log(`\nSummary: ${existing.size} exist, ${missing.length} missing`);
  if (missingCritical.length > 0) {
    console.log(`WARNING: ${missingCritical.length} critical index(es) missing: ${missingCritical.map(i => i.name).join(', ')}`);
  }

  if (missing.length === 0) {
    console.log('\nAll indexes already present. Nothing to apply.');
    await pool.close();
    return;
  }

  // ── STEP 2: Apply missing indexes one at a time ────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  console.log('STEP 2 — Applying missing indexes (critical first)');
  console.log('═══════════════════════════════════════════════\n');

  // Apply critical ones first, then the rest
  const orderedMissing = [
    ...missing.filter(i => CRITICAL.has(i.name)),
    ...missing.filter(i => !CRITICAL.has(i.name)),
  ];

  const applied = [];
  const failed  = [];

  for (const idx of orderedMissing) {
    const tag = CRITICAL.has(idx.name) ? '[CRITICAL]' : '[standard]';
    console.log(`Applying ${tag} ${idx.name} on ${idx.table} ...`);
    const t0 = Date.now();
    try {
      await pool.request().query(idx.ddl);
      const elapsed = Date.now() - t0;
      console.log(`  ✓ Applied in ${elapsed}ms\n`);
      applied.push(idx.name);
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}\n`);
      failed.push({ name: idx.name, error: err.message });
    }
  }

  // ── STEP 3: Summary ───────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('RESULT SUMMARY');
  console.log('═══════════════════════════════════════════════');
  if (applied.length)  console.log(`Applied (${applied.length}): ${applied.join(', ')}`);
  if (failed.length) {
    console.log(`Failed  (${failed.length}):`);
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.error}`);
    console.log('\nNOTE: CREATE INDEX requires ALTER TABLE or db_ddladmin permission.');
    console.log('If the above errors mention "permission", re-run with a DBA-level credential:');
    console.log('  $env:DB_USER="your_dba_login"; $env:DB_PASSWORD="secret"; node backend/scripts/apply-indexes.js');
  }

  await pool.close();
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
