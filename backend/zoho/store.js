'use strict';
// Module data store: in-memory records + snapshot persistence.
// Snapshots survive restarts/deploys so a reboot costs ZERO Zoho API calls
// (the in-memory-only cache meant every deploy re-fetched everything —
// ~150 calls per restart on plans with 250-1000 calls/DAY).
//
// Set ZOHO_SNAPSHOT_DIR to a persistent mount (Azure Files). If unset or
// unwritable, runs memory-only with a warning — correctness unaffected.

const fs = require('fs');
const path = require('path');

const DIR = process.env.ZOHO_SNAPSHOT_DIR || null;
let _dirOk = false;

if (DIR) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.accessSync(DIR, fs.constants.W_OK);
    _dirOk = true;
    console.log(`[zoho/store] snapshots enabled at ${DIR}`);
  } catch (err) {
    console.warn(`[zoho/store] snapshot dir unusable (${err.message}) — running memory-only`);
  }
} else {
  console.warn('[zoho/store] ZOHO_SNAPSHOT_DIR not set — running memory-only (full re-fetch on every restart)');
}

// key → { byId: Map<id, record>, asOf: number, lastFullSync: number }
const _modules = new Map();

function _file(key) {
  return path.join(DIR, `${key}.json`);
}

function loadSnapshots(keys) {
  if (!_dirOk) return;
  for (const key of keys) {
    try {
      if (!fs.existsSync(_file(key))) continue;
      const snap = JSON.parse(fs.readFileSync(_file(key), 'utf8'));
      const byId = new Map(snap.records.map((r) => [String(r.id), r]));
      _modules.set(key, { byId, asOf: snap.asOf, lastFullSync: snap.lastFullSync });
      console.log(`[zoho/store] ${key}: loaded ${byId.size} records from snapshot (asOf ${new Date(snap.asOf).toISOString()})`);
    } catch (err) {
      console.warn(`[zoho/store] ${key}: snapshot load failed:`, err.message);
    }
  }
}

function _save(key) {
  if (!_dirOk) return;
  const mod = _modules.get(key);
  if (!mod) return;
  try {
    const tmp = _file(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      asOf: mod.asOf,
      lastFullSync: mod.lastFullSync,
      records: [...mod.byId.values()],
    }));
    fs.renameSync(tmp, _file(key)); // atomic-ish: never a half-written snapshot
  } catch (err) {
    console.warn(`[zoho/store] ${key}: snapshot save failed:`, err.message);
  }
}

/** Full replace after a complete fetch. */
function replaceAll(key, records, now = Date.now()) {
  const byId = new Map(records.map((r) => [String(r.id), r]));
  _modules.set(key, { byId, asOf: now, lastFullSync: now });
  _save(key);
}

/** Merge a delta (changed/new records) into the existing set. */
function mergeDelta(key, records, now = Date.now()) {
  const mod = _modules.get(key);
  if (!mod) return replaceAll(key, records, now);
  for (const r of records) mod.byId.set(String(r.id), r);
  mod.asOf = now;
  _save(key);
}

function getModule(key) {
  const mod = _modules.get(key);
  if (!mod) return null;
  return { data: [...mod.byId.values()], asOf: mod.asOf, lastFullSync: mod.lastFullSync };
}

function status() {
  const out = {};
  for (const [key, mod] of _modules) {
    out[key] = {
      records: mod.byId.size,
      asOf: new Date(mod.asOf).toISOString(),
      lastFullSync: new Date(mod.lastFullSync).toISOString(),
    };
  }
  return out;
}

module.exports = { loadSnapshots, replaceAll, mergeDelta, getModule, status, snapshotsEnabled: () => _dirOk };
