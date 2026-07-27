'use strict';

const { Router } = require('express');
const { sql, poolPromise } = require('../db');
const { FILTERS } = require('../utils/filters');

// Access Zoho via the sanctioned api surface only.
const zoho = require('../zoho');
const api = zoho.api;

const router = Router();

const DIGIT_RE = /\D/g;

// Module-local in-memory cache for the summary report (10 min TTL).
// Deliberately does NOT use the global cacheService or the Zoho store —
// this is a lightweight, self-contained cache scoped to this route.
let _reportCache = null;
let _reportCacheTime = 0;
const REPORT_CACHE_MS = 10 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function normalize(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return '';
  const str = typeof code === 'number' ? String(code) : code;
  const digits = str.trim().replace(DIGIT_RE, '');
  return digits.replace(/^0+/, '');
}

/** Check whether the Zoho store has patients loaded yet. */
function zohoWarming() {
  const mod = api.getModule('patients');
  return !mod || mod.data.length === 0;
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * GET /api/patient-link/:code
 * Returns the Unity and Zoho records linked by patient code (normalized on
 * digits so "14114", "014114", and "PAT-14114" all match the same patient).
 */
router.get('/:code', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    const inputCode = req.params.code;
    const normalized = normalize(inputCode);
    if (!normalized) {
      return res.json({ unity: null, zoho: null });
    }

    const pool = await poolPromise;

    // Unity lookup: find the Patient row whose PatientID normalizes to the
    // same digits. Join Centre for the centre name.
    const unityResult = await pool.request().query(`
      SELECT
        p.Id,
        p.PatientID,
        p.FirstName,
        p.LastName,
        p.Gender,
        p.DateOfBirth,
        p.Status,
        c.Id AS CentreId,
        c.CentreName
      FROM Patient p
      LEFT JOIN Centre c ON c.Id = p.CentreId
      WHERE ${FILTERS.centreExclusion('c')}
        AND ${FILTERS.patientExclusion('p')}
      ORDER BY p.Id
    `);

    let unityPatient = null;
    for (const row of unityResult.recordset) {
      if (normalize(row.PatientID) === normalized) {
        unityPatient = row;
        break;
      }
    }

    const zohoPatient = api.findByCode(inputCode);

    res.json({
      unity: unityPatient || null,
      zoho: zohoPatient || null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/patient-link/report/summary
 * Match-quality report comparing Unity patients against Zoho patients.
 * Cached 10 min in module-local memory.
 */
router.get('/report/summary', async (req, res, next) => {
  try {
    if (zohoWarming()) {
      return res.status(503).json({ warming: true });
    }

    // Serve from cache if fresh.
    const now = Date.now();
    if (_reportCache && (now - _reportCacheTime) < REPORT_CACHE_MS) {
      return res.json({ ..._reportCache, cached: true });
    }

    const pool = await poolPromise;

    // Fetch all Unity patients with centre info, applying standard filters.
    const unityResult = await pool.request().query(`
      SELECT
        p.Id,
        p.PatientID,
        p.FirstName,
        p.LastName,
        c.Id AS CentreId,
        c.CentreName
      FROM Patient p
      LEFT JOIN Centre c ON c.Id = p.CentreId
      WHERE ${FILTERS.centreExclusion('c')}
        AND ${FILTERS.patientExclusion('p')}
      ORDER BY p.Id
    `);

    const unityPatients = unityResult.recordset;

    let emptyPatientId = 0;
    const matched = [];
    const unmatchedUnity = [];

    for (const p of unityPatients) {
      const norm = normalize(p.PatientID);
      if (!norm) {
        emptyPatientId++;
        continue;
      }

      const zohoMatch = api.findByCode(norm);
      if (zohoMatch) {
        matched.push(p);
      } else {
        unmatchedUnity.push(p);
      }
    }

    // Zoho patients without a Unity match.
    const stats = api.indexStats();
    const allZohoCodes = new Set();
    // Re-read the store data to collect all indexed Zoho codes.
    const mod = api.getModule('patients');
    if (mod) {
      for (const record of mod.data) {
        // Re-derive the normalized code the same way crosswalk does it.
        const raw = record[stats.field];
        if (raw !== undefined && raw !== null && raw !== '') {
          const norm = normalize(raw);
          if (norm) allZohoCodes.add(norm);
        }
      }
    }

    // Collect Unity normalized codes to compare.
    const unityNormalized = new Set();
    for (const p of unityPatients) {
      const norm = normalize(p.PatientID);
      if (norm) unityNormalized.add(norm);
    }

    // Zoho codes not present in Unity.
    const unmatchedZoho = [];
    for (const code of allZohoCodes) {
      if (!unityNormalized.has(code)) {
        unmatchedZoho.push(code);
      }
    }

    const report = {
      unityWithZohoMatch: matched.length,
      unityWithoutZohoMatch: unmatchedUnity.length,
      zohoWithoutUnityMatch: unmatchedZoho.length,
      unityEmptyPatientId: emptyPatientId,
      unmatchedUnitySample: unmatchedUnity.slice(0, 100).map((p) => ({
        Id: p.Id,
        PatientID: p.PatientID,
        FirstName: p.FirstName,
        LastName: p.LastName,
        CentreName: p.CentreName,
      })),
      unmatchedZohoCodes: unmatchedZoho.slice(0, 100),
      cached: false,
      generatedAt: new Date().toISOString(),
    };

    _reportCache = report;
    _reportCacheTime = now;

    res.json(report);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
