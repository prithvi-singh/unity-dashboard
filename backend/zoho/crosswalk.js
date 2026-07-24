'use strict';
// In-memory patient crosswalk index — maps Unity Patient.PatientID to Zoho
// patient records. Rebuilds lazily when the store's patients module is newer.
//
// Isolation rule: this file lives inside backend/zoho/, so it MUST NOT import
// from ../utils/, ../services/, or ../routes/. Data comes from ./store.js only.

const store = require('./store');

const MODULE_KEY = 'patients';
const ID_CANDIDATES = ['Patient_ID', 'PatientID', 'Patient_ID1'];
const DIGIT_RE = /\D/g;

let _detectedField = null;
let _indexBuildTime = 0;
let _total = 0;
let _indexed = 0;
let _unmatchable = 0;
let _byCode = null; // Map<normalizedCode, record>

function _normalize(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return '';
  const str = typeof code === 'number' ? String(code) : code;
  const digits = str.trim().replace(DIGIT_RE, '');
  // drop leading zeros; empty result → unmatchable
  const stripped = digits.replace(/^0+/, '');
  return stripped;
}

function _detectField(record) {
  for (const candidate of ID_CANDIDATES) {
    if (record[candidate] !== undefined && record[candidate] !== null && record[candidate] !== '') {
      return candidate;
    }
  }
  return null;
}

function _rebuildIfStale() {
  const mod = store.getModule(MODULE_KEY);
  if (!mod) {
    _detectedField = null;
    _indexBuildTime = 0;
    _total = 0;
    _indexed = 0;
    _unmatchable = 0;
    _byCode = null;
    return;
  }

  if (mod.asOf <= _indexBuildTime) return;

  _byCode = new Map();
  _detectedField = null;
  _total = mod.data.length;
  _indexed = 0;
  _unmatchable = 0;

  for (const record of mod.data) {
    if (!_detectedField) {
      _detectedField = _detectField(record);
      if (_detectedField) {
        console.log(`[zoho/crosswalk] detected patient ID field: "${_detectedField}"`);
      }
    }

    if (!_detectedField) {
      _unmatchable++;
      continue;
    }

    const rawCode = record[_detectedField];
    const code = _normalize(rawCode);
    if (!code) {
      _unmatchable++;
      continue;
    }

    _byCode.set(code, record);
    _indexed++;
  }

  _indexBuildTime = mod.asOf;
  console.log(`[zoho/crosswalk] index rebuilt: ${_total} total, ${_indexed} indexed, ${_unmatchable} unmatchable`);
}

function findByCode(code) {
  _rebuildIfStale();
  if (!_byCode) return null;
  const key = _normalize(code);
  if (!key) return null;
  return _byCode.get(key) || null;
}

function indexStats() {
  _rebuildIfStale();
  return {
    total: _total,
    indexed: _indexed,
    unmatchable: _unmatchable,
    field: _detectedField,
    asOf: _indexBuildTime,
  };
}

module.exports = { findByCode, indexStats };
