'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { FILTERS } = require('../utils/filters');
const { classifyAssessment } = require('../utils/assessmentState');

// Access Zoho via the sanctioned api surface only.
const zoho = require('../zoho');
const api = zoho.api;
const { buildFunnel, getConversionGap, _isConverted, _computeAge } = require('../zoho/funnel');

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
    audit_activity AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type != 'CaseAssigned'
    ),
    result_generated AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'AssessmentResultGenerated'
    ),
    report_added AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportAdded'
    ),
    report_pdf AS (
      SELECT DISTINCT AllocatePatientId AS apId
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportPDFGenerated'
    ),
    goal_request AS (
      SELECT DISTINCT pgar.AllocatePatientId AS apId
      FROM PatientGoalApprovalRequest pgar
      WHERE pgar.AllocatePatientId IN (SELECT apId FROM ap_scope)
    ),
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

// ── Stage velocity helpers ─────────────────────────────────────────────────

/**
 * Fetch all assessment timeline timestamps for patients within a time window.
 * Returns an array of patient objects with stage timestamps.
 */
async function _queryStageTimestamps(pool, months) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffISO = cutoff.toISOString().slice(0, 19).replace('T', ' ');

  const result = await pool.request().query(`
    WITH ap_scope AS (
      SELECT
        ap.Id AS apId,
        ap.PatientId,
        ap.CreatedDateTimeUtc AS registeredAt,
        ap.Status AS apStatus,
        p.PatientID AS PatientCode,
        p.FirstName,
        p.LastName,
        c.CentreName
      FROM AllocatePatient ap
      JOIN Patient p ON p.Id = ap.PatientId
      LEFT JOIN Centre c ON c.Id = p.CentreId
      WHERE ap.CreatedDateTimeUtc >= '${cutoffISO}'
        AND ${FILTERS.centreExclusion('c')}
        AND ${FILTERS.patientExclusion('p')}
    ),
    -- First non-CaseAssigned audit event = assessment started
    assessment_started AS (
      SELECT AllocatePatientId AS apId, MIN(CreatedDateTime) AS startedAt
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type != 'CaseAssigned'
      GROUP BY AllocatePatientId
    ),
    -- AssessmentResultGenerated
    result_generated AS (
      SELECT AllocatePatientId AS apId, MIN(CreatedDateTime) AS resultAt
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'AssessmentResultGenerated'
      GROUP BY AllocatePatientId
    ),
    -- ReportAdded
    report_added AS (
      SELECT AllocatePatientId AS apId, MIN(CreatedDateTime) AS reportAt
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportAdded'
      GROUP BY AllocatePatientId
    ),
    -- ReportPDFGenerated
    report_pdf AS (
      SELECT AllocatePatientId AS apId, MIN(CreatedDateTime) AS pdfAt
      FROM PatientAuditLog
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
        AND Type = 'ReportPDFGenerated'
      GROUP BY AllocatePatientId
    ),
    -- PatientGoalApprovalRequest created
    goal_request AS (
      SELECT AllocatePatientId AS apId, MIN(CreatedDateTimeUtc) AS goalReqAt
      FROM PatientGoalApprovalRequest
      WHERE AllocatePatientId IN (SELECT apId FROM ap_scope)
      GROUP BY AllocatePatientId
    ),
    -- Approved goal
    approved_goal AS (
      SELECT pgar.AllocatePatientId AS apId, MIN(pgarg.UpdatedDateTimeUtc) AS approvedAt
      FROM PatientGoalApprovalRequestGoal pgarg
      JOIN PatientGoalApprovalRequest pgar ON pgar.Id = pgarg.PatientGoalApprovalRequestId
      WHERE pgarg.Status = 'Approved'
        AND pgar.AllocatePatientId IN (SELECT apId FROM ap_scope)
      GROUP BY pgar.AllocatePatientId
    )
    SELECT
      ap.apId,
      ap.PatientId,
      ap.PatientCode,
      ap.FirstName,
      ap.LastName,
      ap.CentreName,
      ap.registeredAt,
      ast.startedAt,
      rg.resultAt,
      ra.reportAt,
      rp.pdfAt,
      gr.goalReqAt,
      ag.approvedAt,
      ap.apStatus
    FROM ap_scope ap
    LEFT JOIN assessment_started ast ON ast.apId = ap.apId
    LEFT JOIN result_generated rg ON rg.apId = ap.apId
    LEFT JOIN report_added ra ON ra.apId = ap.apId
    LEFT JOIN report_pdf rp ON rp.apId = ap.apId
    LEFT JOIN goal_request gr ON gr.apId = ap.apId
    LEFT JOIN approved_goal ag ON ag.apId = ap.apId
  `);

  return result.recordset;
}

/**
 * Compute days between two timestamps. Returns null if either is null.
 */
function _diffDays(ts1, ts2) {
  if (!ts1 || !ts2) return null;
  const d1 = new Date(ts1).getTime();
  const d2 = new Date(ts2).getTime();
  return (d2 - d1) / (1000 * 60 * 60 * 24);
}

/**
 * Compute median of a sorted array.
 */
function _median(arr) {
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
}

/**
 * Compute p90 of a sorted array.
 */
function _p90(arr) {
  if (arr.length === 0) return null;
  const idx = Math.ceil(arr.length * 0.9) - 1;
  return arr[Math.max(0, Math.min(idx, arr.length - 1))];
}

/**
 * Compute stage velocity — median and p90 days between consecutive funnel
 * stages across all patients registered within the time window.
 *
 * Stage pairs (Unity-side only):
 *   1. registered → assessment_started
 *   2. assessment_started → report_or_goal
 *   3. report_or_goal → completed
 *
 * For each pair, all patients who have both timestamps contribute their
 * duration to the distribution. Median and p90 are computed across the
 * collected durations.
 */
async function computeStageVelocity(pool, months) {
  const rows = await _queryStageTimestamps(pool, months);

  const registered_to_started = [];
  const started_to_report_or_goal = [];
  const report_or_goal_to_completed = [];

  for (const r of rows) {
    // Stage 1: registered → assessment started
    const d1 = _diffDays(r.registeredAt, r.startedAt);
    if (d1 !== null && d1 >= 0) registered_to_started.push(d1);

    // Stage 2: assessment started → report or goal
    // "Report or goal" = min(ReportAdded timestamp, GoalRequest timestamp)
    const reportOrGoalAt = r.reportAt && r.goalReqAt
      ? (new Date(r.reportAt) <= new Date(r.goalReqAt) ? r.reportAt : r.goalReqAt)
      : (r.reportAt || r.goalReqAt);

    if (r.startedAt && reportOrGoalAt) {
      const d2 = _diffDays(r.startedAt, reportOrGoalAt);
      if (d2 !== null && d2 >= 0) started_to_report_or_goal.push(d2);
    }

    // Stage 3: report_or_goal → completed
    // "Completed" = min(ReportPDFGenerated, GoalApproved)
    const completedAt = r.pdfAt && r.approvedAt
      ? (new Date(r.pdfAt) <= new Date(r.approvedAt) ? r.pdfAt : r.approvedAt)
      : (r.pdfAt || r.approvedAt || (r.apStatus === 'Completed' ? r.registeredAt : null));

    if (reportOrGoalAt && completedAt && r.apStatus === 'Completed') {
      const d3 = _diffDays(reportOrGoalAt, completedAt);
      if (d3 !== null && d3 >= 0) report_or_goal_to_completed.push(d3);
    }
  }

  const toStats = (arr, label) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return {
      stage: label,
      count: sorted.length,
      medianDays: Math.round((_median(sorted) || 0) * 10) / 10,
      p90Days: Math.round((_p90(sorted) || 0) * 10) / 10,
    };
  };

  return [
    toStats(registered_to_started, 'registered → assessment started'),
    toStats(started_to_report_or_goal, 'assessment started → report or goal'),
    toStats(report_or_goal_to_completed, 'report or goal → completed'),
  ];
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * GET /api/funnel/summary?months=6
 * Per-cohort-month stage counts with per-cohort totalValueAtRisk:
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

    const { codeSet, idMap } = await _getUnityPatientCache(pool);

    const funnel = buildFunnel(months, codeSet);

    if (funnel.warming) {
      return res.status(503).json({ warming: true });
    }

    // ── Get all leads, find which converted ones have Unity matches ────────
    const leadsMod = api.getModule('leads');
    const leads = leadsMod.data;

    const convertedWithMatch = [];

    for (const lead of leads) {
      if (!_isConverted(lead) || !lead.patientCode) continue;
      if (!codeSet.has(lead.patientCode)) continue;

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
    const unityPatientIdByLead = new Map();
    for (const item of convertedWithMatch) {
      const unityId = idMap.get(item.normCode);
      if (unityId) {
        patientIds.push(unityId);
        unityPatientIdByLead.set(item.leadId, unityId);
      }
    }

    // ── Query Unity assessments for those patients ─────────────────────────
    const assessmentsByPatient = await _queryUnityAssessments(pool, patientIds);

    const leadStage = new Map();
    for (const [leadId, unityPatientId] of unityPatientIdByLead) {
      const assessments = assessmentsByPatient.get(unityPatientId) || [];

      let bestStage = 'none';

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
          break;
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
      unityAcc.set(c.month, {
        assessmentStarted: 0,
        reportOrGoal: 0,
        completed: 0,
        totalValueAtRisk: 0,
      });
    }

    // Build gap list for totalValueAtRisk per-cohort computation
    const conversionGap = getConversionGap(months, codeSet);
    const gapByCohort = new Map();
    for (const g of conversionGap.gap) {
      const key = _monthKey(g.registrationDate);
      if (!key) continue;
      if (!gapByCohort.has(key)) gapByCohort.set(key, []);
      gapByCohort.get(key).push(g);
    }

    for (const [key, entries] of gapByCohort) {
      const bucket = unityAcc.get(key);
      if (!bucket) continue;
      bucket.totalValueAtRisk = entries.reduce((sum, e) => {
        const amt = parseFloat(e.enrollmentAmount);
        return sum + (isNaN(amt) ? 0 : amt);
      }, 0);
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
      ...(unityAcc.get(c.month) || { assessmentStarted: 0, reportOrGoal: 0, completed: 0, totalValueAtRisk: 0 }),
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
 * GET /api/funnel/gap?months=6&limit=50&offset=0&ageBucket=8-30
 * The actionable list of converted leads with NO Unity match.
 * Paginated. Supports ageBucket filter.
 * Includes totalValueAtRisk calculated across the FULL filtered set, not
 * just the current page.
 */
router.get('/gap', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;
    const ageBucket = req.query.ageBucket || null;

    const { codeSet } = await _getUnityPatientCache(pool);
    const result = getConversionGap(months, codeSet, ageBucket);

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
      totalValueAtRisk: result.totalValueAtRisk,
      limit,
      offset,
      asOf: result.asOf,
      fallbackNameMatch: result.fallbackNameMatch,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funnel/gap/by-centre?months=6
 * Group the gap set by centreHeadName.
 * Returns { centreHeadName, count, totalValueAtRisk, oldestAgeDays }
 * sorted by totalValueAtRisk descending.
 */
router.get('/gap/by-centre', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;

    const { codeSet } = await _getUnityPatientCache(pool);
    const result = getConversionGap(months, codeSet);

    if (result.warming) {
      return res.status(503).json({ warming: true });
    }

    // Group by centreHeadName
    const groups = new Map();
    for (const entry of result.gap) {
      const key = entry.centreHeadName || 'Unassigned';
      if (!groups.has(key)) {
        groups.set(key, { count: 0, totalValueAtRisk: 0, oldestAgeDays: null });
      }
      const g = groups.get(key);
      g.count++;
      const amt = parseFloat(entry.enrollmentAmount);
      if (!isNaN(amt)) g.totalValueAtRisk += amt;
      if (entry.ageDays !== null && (g.oldestAgeDays === null || entry.ageDays > g.oldestAgeDays)) {
        g.oldestAgeDays = entry.ageDays;
      }
    }

    const byCentre = [];
    for (const [centreHeadName, stats] of groups) {
      byCentre.push({ centreHeadName, ...stats });
    }

    // Sort by totalValueAtRisk descending
    byCentre.sort((a, b) => b.totalValueAtRisk - a.totalValueAtRisk);

    res.json({
      byCentre,
      totalCentres: byCentre.length,
      asOf: result.asOf,
      fallbackNameMatch: result.fallbackNameMatch,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funnel/velocity?months=N
 * Returns median and p90 days-in-stage for each consecutive stage pair.
 */
router.get('/velocity', async (req, res, next) => {
  try {
    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;

    const stages = await computeStageVelocity(pool, months);

    res.json({
      stages,
      months,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funnel/stalled?thresholdDays=30&months=6
 * Patients who registered in Unity but have NOT started assessment after
 * thresholdDays. This is a different list from the gap list (gap = never
 * registered; stalled = registered but stuck).
 *
 * Cross-references with Zoho leads to add enrollmentAmount where available
 * (best-effort — not every Unity patient has a matching Zoho lead).
 */
router.get('/stalled', async (req, res, next) => {
  try {
    const thresholdDays = Math.max(1, parseInt(req.query.thresholdDays, 10) || 30);
    const months = parseMonthsParam(req.query.months);
    const pool = await poolPromise;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffISO = cutoff.toISOString().slice(0, 19).replace('T', ' ');

    // Query Unity for stalled patients: registered, no assessment activity,
    // beyond threshold.
    const request = pool.request();
    request.input('thresholdDays', sql.Float, thresholdDays);

    const result = await request.query(`
      SELECT
        sub.patientId,
        sub.PatientCode,
        sub.FirstName,
        sub.LastName,
        sub.CentreName,
        sub.registeredAt,
        sub.daysSinceRegistration
      FROM (
        SELECT
          p.Id AS patientId,
          p.PatientID AS PatientCode,
          p.FirstName,
          p.LastName,
          c.CentreName,
          ap.CreatedDateTimeUtc AS registeredAt,
          CAST(DATEDIFF_BIG(SECOND, ap.CreatedDateTimeUtc, GETUTCDATE()) / 86400.0 AS DECIMAL(10,1)) AS daysSinceRegistration
        FROM AllocatePatient ap
        JOIN Patient p ON p.Id = ap.PatientId
        LEFT JOIN Centre c ON c.Id = p.CentreId
        WHERE NOT EXISTS (
          SELECT 1 FROM PatientAuditLog pal
          WHERE pal.AllocatePatientId = ap.Id
            AND pal.Type != 'CaseAssigned'
        )
        AND ap.CreatedDateTimeUtc >= '${cutoffISO}'
        AND ap.Status NOT IN ('Completed', 'Cancelled')
        AND ${FILTERS.centreExclusion('c')}
        AND ${FILTERS.patientExclusion('p')}
      ) sub
      WHERE sub.daysSinceRegistration > @thresholdDays
      ORDER BY sub.daysSinceRegistration DESC
    `);

    // Build patient-code → lead lookup for enrollmentAmount cross-reference
    const leadsMod = api.getModule('leads');
    const leadByNormCode = new Map();
    if (leadsMod && leadsMod.data.length > 0) {
      for (const lead of leadsMod.data) {
        if (lead.patientCode) {
          leadByNormCode.set(lead.patientCode, lead);
        }
      }
    }

    const stalled = result.recordset.map((row) => {
      const normCode = _normalizeCode(row.PatientCode);
      const lead = normCode ? leadByNormCode.get(normCode) : null;
      return {
        patientCode: row.PatientCode || null,
        name: [row.FirstName, row.LastName].filter(Boolean).join(' '),
        centreName: row.CentreName || null,
        daysSinceRegistration: Number(row.daysSinceRegistration),
        enrollmentAmount: lead ? lead.enrollmentAmount : null,
      };
    });

    res.json({
      stalled,
      total: stalled.length,
      thresholdDays,
      months,
      asOf: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
