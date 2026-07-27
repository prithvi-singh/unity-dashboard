'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { FILTERS } = require('../utils/filters');
const { classifyAssessment } = require('../utils/assessmentState');

// Access Zoho via the sanctioned api surface only.
const zoho = require('../zoho');
const api = zoho.api;
const { buildFunnel, getConversionGap, _isConverted } = require('../zoho/funnel');

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

/** Check whether the Zoho store has leads or patients loaded yet. */
function zohoWarming() {
  const leadsMod = api.getModule('leads');
  const patientsMod = api.getModule('patients');
  return !leadsMod || leadsMod.data.length === 0 || !patientsMod || patientsMod.data.length === 0;
}

function parseMonthsParam(val) {
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 24) return 6;
  return n;
}

// ── Unity Patient Code Set + ID Map (5-min cache) ─────────────────────────
// The registeredInUnity count and gap list must check Unity's actual Patient
// table — NOT the Zoho crosswalk index (which checks Zoho's own Patients
// module, auto-created on conversion, nearly always present). Same 5-min TTL
// pattern as patientLink.js's report/summary cache.
let _unityCache = null;      // { codeSet: Set<string>, idMap: Map<normalizedCode, PatientId> }
let _unityCacheTime = 0;
const UNITY_CACHE_TTL = 5 * 60 * 1000;

const DIGIT_RE = /\D/g;

function _normalizeCode(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const str = typeof raw === 'number' ? String(raw) : String(raw);
  const digits = str.trim().replace(DIGIT_RE, '');
  return digits.replace(/^0+/, '') || null;
}

/**
 * Returns { codeSet: Set<string>, idMap: Map<normalizedCode, PatientId> }
 * from Unity's Patient table, cached for 5 min.
 * Applies standard centre/patient exclusion filters.
 */
async function _getUnityPatientCache(pool) {
  const now = Date.now();
  if (_unityCache && (now - _unityCacheTime) < UNITY_CACHE_TTL) {
    return _unityCache;
  }

  const result = await pool.request().query(`
    SELECT p.Id, p.PatientID
    FROM Patient p
    LEFT JOIN Centre c ON c.Id = p.CentreId
    WHERE ${FILTERS.centreExclusion('c')}
      AND ${FILTERS.patientExclusion('p')}
  `);

  const codeSet = new Set();
  const idMap = new Map();
  for (const row of result.recordset) {
    const norm = _normalizeCode(row.PatientID);
    if (norm) {
      codeSet.add(norm);
      idMap.set(norm, row.Id);
    }
  }

  _unityCache = { codeSet, idMap };
  _unityCacheTime = now;
  return _unityCache;
}

// ── Unity-side stage classification (per-lead) ─────────────────────────────

/**
 * Query Unity for all assessment-relevant data for a set of Patient.Ids.
 * Returns a Map<patientId, assessments[]> where each assessment has the
 * flags classifyAssessment() needs.
 */
async function _queryUnityAssessments(pool, patientIds) {
  if (patientIds.length === 0) return new Map();

  // Query AllocatePatient + pre-joined audit event flags + goal approval status.
  // Follows the pipeline.js CTE pattern for event timestamps.
  const result = await pool.request().query(`
    WITH ap_scope AS (
      SELECT
        ap.Id AS apId,
        ap.PatientId,
        ap.Status,
        ap.CreatedDateTimeUtc AS assignedAt
      FROM AllocatePatient ap
      WHERE ap.PatientId IN (${patientIds.join(', ')})
    ),
    -- Has any audit activity beyond CaseAssigned?
    audit_activity AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type != 'CaseAssigned'
    ),
    -- AssessmentResultGenerated
    result_generated AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'AssessmentResultGenerated'
    ),
    -- ReportAdded
    report_added AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportAdded'
    ),
    -- ReportPDFGenerated
    report_pdf AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportPDFGenerated'
    ),
    -- PatientGoalApprovalRequest exists
    goal_request AS (
      SELECT DISTINCT pgar.AllocatePatientId AS apId
      FROM PatientGoalApprovalRequest pgar
      WHERE pgar.AllocatePatientId IN (SELECT apId FROM ap_scope)
    ),
    -- At least one Approved goal
    approved_goal AS (
      SELECT DISTINCT pgar.AllocatePatientId AS apId
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      WHERE pgarg.Status = 'Approved'
        AND pgar.AllocatePatientId IN (SELECT apId FROM ap_scope)
    )
    SELECT
      ap.apId,
      ap.PatientId,
      ap.Status,
      ap.assignedAt,
      CASE WHEN aa.apId IS NOT NULL THEN 1 ELSE 0 END AS hasAuditActivity,
      CASE WHEN rg.apId IS NOT NULL THEN 1 ELSE 0 END AS hasResultGenerated,
      CASE WHEN ra.apId IS NOT NULL THEN 1 ELSE 0 END AS hasReportAdded,
      CASE WHEN rp.apId IS NOT NULL THEN 1 ELSE 0 END AS hasReportPDF,
      CASE WHEN gr.apId IS NOT NULL THEN 1 ELSE 0 END AS hasGoalRequest,
      CASE WHEN ag.apId IS NOT NULL THEN 1 ELSE 0 END AS hasApprovedGoal
    FROM ap_scope ap
    LEFT JOIN audit_activity  aa ON aa.apId = ap.apId
    LEFT JOIN result_generated rg ON rg.apId = ap.apId
    LEFT JOIN report_added    ra ON ra.apId = ap.apId
    LEFT JOIN report_pdf      rp ON rp.apId = ap.apId
    LEFT JOIN goal_request    gr ON gr.apId = ap.apId
    LEFT JOIN approved_goal   ag ON ag.apId = ap.apId
  `);

  const map = new Map();
  for (const row of result.recordset) {
    if (!map.has(row.PatientId)) map.set(row.PatientId, []);
    map.get(row.PatientId).push(row);
  }
  return map;
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * GET /api/funnel/summary?months=6
 * Per-cohort-month stage counts:
 *   leads → converted → registeredInUnity → assessmentStarted →
 *   reportOrGoal → completed
 */
router.get('/summary', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;

    // ── Unity patient code set (5-min cached) ────────────────────────────
    // Must be queried BEFORE buildFunnel so the registeredInUnity count
    // checks Unity's actual Patient table, not the Zoho crosswalk index.
    const { codeSet, idMap } = await _getUnityPatientCache(pool);

    const funnel = buildFunnel(months, codeSet);

    if (funnel.warming) {
      return res.status(503).json({ warming: true });
    }

    // ── Get all leads, find which converted ones have Unity matches ────────
    const leadsMod = api.getModule('leads');
    const leads = leadsMod.data;

    // Build: normalizedPatientCode → { leadId, normCode, registrationDate }
    const convertedWithMatch = [];

    for (const lead of leads) {
      if (!_isConverted(lead) || !lead.patientCode) continue;
      // Check Unity patient match via cached Set (same normalization).
      if (!codeSet.has(lead.patientCode)) continue;

      // Find the Zoho patient to get its patientCode for norm lookup.
      const zohoPatient = api.findByCode(lead.patientCode);
      if (!zohoPatient) continue;

      const normCode = _normalizeCode(zohoPatient.patientCode);
      if (!normCode) continue;

      convertedWithMatch.push({
        leadId: lead.id,
        normCode,
        registrationDate: lead.registrationDate,
      });
    }

    // Resolve: lead → Unity Patient.Id via cached idMap
    const patientIds = [];
    const unityPatientIdByLead = new Map(); // leadId → unityPatientId
    for (const item of convertedWithMatch) {
      const unityId = idMap.get(item.normCode);
      if (unityId) {
        patientIds.push(unityId);
        unityPatientIdByLead.set(item.leadId, unityId);
      }
    }

    // ── Query Unity assessments for those patients ─────────────────────────
    const assessmentsByPatient = await _queryUnityAssessments(pool, patientIds);

    // ── Classify each assessment and determine the lead's best stage ───────
    // For each lead with a Unity match, determine:
    //   assessmentStarted: at least one AllocatePatient record exists
    //   reportOrGoal: at least one assessment has ReportAdded OR GoalRequest
    //   completed: at least one assessment is completed per classifyAssessment()
    //
    // We take the "best" (furthest) stage across all assessments for a patient.
    // Build: leadId → bestStage
    const leadStage = new Map();
    for (const [leadId, unityPatientId] of unityPatientIdByLead) {
      const assessments = assessmentsByPatient.get(unityPatientId) || [];

      let bestStage = 'none'; // none < started < reportOrGoal < completed

      for (const a of assessments) {
        const state = classifyAssessment({
          status: a.Status,
          hasAuditActivity: a.hasAuditActivity === 1,
          hasResultGenerated: a.hasResultGenerated === 1,
          hasReportAdded: a.hasReportAdded === 1,
          hasReportPDF: a.hasReportPDF === 1,
          hasGoalRequest: a.hasGoalRequest === 1,
          hasApprovedGoal: a.hasApprovedGoal === 1,
        });

        if (state === 'completed') {
          bestStage = 'completed';
          break; // can't go further
        }
        if (state === 'goals_pending_approval' || state === 'goals_not_added' ||
            state === 'report_pending_approval') {
          if (bestStage !== 'completed') bestStage = 'reportOrGoal';
        }
        if (bestStage === 'none') bestStage = 'started';
      }

      leadStage.set(leadId, bestStage);
    }

    // ── Build per-cohort Unity stage counts ────────────────────────────────
    // Re-derive month keys to match funnel.cohorts
    function _monthKey(dateStr) {
      if (!dateStr) return null;
      const m = /(\d{4})-(\d{2})-\d{2}/.exec(dateStr);
      if (m) return `${m[1]}-${m[2]}`;
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      return null;
    }

    // Initialize Unity stage accumulators per cohort
    const unityAcc = new Map();
    for (const c of funnel.cohorts) {
      unityAcc.set(c.month, { assessmentStarted: 0, reportOrGoal: 0, completed: 0 });
    }

    // For each converted+registered lead, tally its Unity stage under its cohort month
    for (const lead of leads) {
      if (!_isConverted(lead)) continue;
      const stage = leadStage.get(lead.id);
      if (!stage || stage === 'none') continue;

      const key = _monthKey(lead.registrationDate);
      const bucket = unityAcc.get(key);
      if (!bucket) continue;

      if (stage === 'started' || stage === 'reportOrGoal' || stage === 'completed') {
        bucket.assessmentStarted++;
      }
      if (stage === 'reportOrGoal' || stage === 'completed') {
        bucket.reportOrGoal++;
      }
      if (stage === 'completed') {
        bucket.completed++;
      }
    }

    // ── Merge Unity stages into funnel cohorts ─────────────────────────────
    const cohorts = funnel.cohorts.map((c) => ({
      ...c,
      ...(unityAcc.get(c.month) || { assessmentStarted: 0, reportOrGoal: 0, completed: 0 }),
    }));

    res.json({
      cohorts,
      asOf: funnel.asOf,
      fallbackNameMatch: funnel.fallbackNameMatch,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funnel/gap?months=6&limit=50&offset=0
 * The actionable list of converted leads with NO Unity match.
 * Paginated like other Zoho routes.
 */
router.get('/gap', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;

    // Pass the Unity code set so getConversionGap checks Unity's actual
    // Patient table, not the Zoho crosswalk index.
    const { codeSet } = await _getUnityPatientCache(pool);
    const result = getConversionGap(months, codeSet);

    if (result.warming) {
      return res.status(503).json({ warming: true });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const page = result.gap.slice(offset, offset + limit);

    res.json({
      gap: page,
      total: result.gap.length,
      totalConverted: result.totalConverted,
      limit,
      offset,
      asOf: result.asOf,
      fallbackNameMatch: result.fallbackNameMatch,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
