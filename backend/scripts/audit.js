#!/usr/bin/env node
'use strict';

/**
 * audit.js — Metrics consistency checker
 *
 * Calls /api/metrics (no filters) and runs the same assertions that
 * metricsService runs in dev mode, plus cross-tab checks.
 *
 * Usage:  npm run audit  (server must be running on PORT or localhost:3001)
 *
 * Exit code 0 = all checks passed.
 * Exit code 1 = one or more assertions failed.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3001}`;

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`\n[audit] Connecting to ${BASE}\n`);

  // ── Health check ────────────────────────────────────────────────────────────
  try {
    const { status, data } = await get('/api/health');
    check('API health check', status === 200 && data.dbConnected === true,
      `status=${status} dbConnected=${data?.dbConnected}`);
  } catch (e) {
    console.error(`[audit] Cannot reach server: ${e.message}`);
    process.exit(1);
  }

  // ── Fetch raw metrics ───────────────────────────────────────────────────────
  const { status: ms, data: m } = await get('/api/metrics');
  check('/api/metrics responds 200', ms === 200, `status=${ms}`);
  if (ms !== 200) {
    console.error('[audit] Cannot fetch metrics. Aborting.');
    process.exit(1);
  }

  console.log('\n── Cases ──────────────────────────────────────────────────────────');
  const casesCentreSum = (m.cases.byCentre || []).reduce((s, r) => s + r.count, 0);
  check(
    `cases.byCentre sum (${casesCentreSum}) === cases.total (${m.cases.total})`,
    casesCentreSum === m.cases.total,
  );

  console.log('\n── Assessments ────────────────────────────────────────────────────');
  check(
    `assessments.scored (${m.assessments.scored}) <= assessments.assigned (${m.assessments.assigned})`,
    m.assessments.scored <= m.assessments.assigned,
  );
  check(
    'assessments.completionRate matches scored/assigned ratio',
    m.assessments.assigned === 0 ||
      Math.abs(m.assessments.completionRate - parseFloat(((m.assessments.scored / m.assessments.assigned) * 100).toFixed(1))) < 0.2,
    `computed=${m.assessments.assigned > 0 ? ((m.assessments.scored / m.assessments.assigned) * 100).toFixed(1) : 0} stored=${m.assessments.completionRate}`,
  );
  const clinicianScoredSum = (m.assessments.byClinician || []).reduce((s, r) => s + r.scored, 0);
  check(
    `assessments.byClinician scored sum (${clinicianScoredSum}) <= total scored (${m.assessments.scored})`,
    clinicianScoredSum <= m.assessments.scored,
  );

  console.log('\n── Reports ────────────────────────────────────────────────────────');
  const repCentreDrafted = (m.reports.byCentre || []).reduce((s, r) => s + r.drafted, 0);
  check(
    `reports.byCentre drafted sum (${repCentreDrafted}) === reports.drafted (${m.reports.drafted})`,
    repCentreDrafted === m.reports.drafted,
  );
  const repCentreApproved = (m.reports.byCentre || []).reduce((s, r) => s + r.approved, 0);
  check(
    `reports.byCentre approved sum (${repCentreApproved}) === reports.approved (${m.reports.approved})`,
    repCentreApproved === m.reports.approved,
  );

  console.log('\n── Goals ──────────────────────────────────────────────────────────');
  check(
    `goals.approved (${m.goals.approved}) <= goals.added (${m.goals.added})`,
    m.goals.approved <= m.goals.added,
  );

  console.log('\n── Users ──────────────────────────────────────────────────────────');
  const usersRoleSum = (m.users.byRole || []).reduce((s, r) => s + r.total, 0);
  check(
    `users.byRole sum (${usersRoleSum}) === users.total (${m.users.total})`,
    usersRoleSum === m.users.total,
  );
  const usersActiveSum = (m.users.byRole || []).reduce((s, r) => s + r.active, 0);
  check(
    `users.byRole active sum (${usersActiveSum}) === users.active (${m.users.active})`,
    usersActiveSum === m.users.active,
  );

  console.log('\n── Centres ────────────────────────────────────────────────────────');
  check(
    `centres.active (${m.centres.active}) + idle (${m.centres.idle}) === total (${m.centres.total})`,
    m.centres.active + m.centres.idle === m.centres.total,
  );

  // ── Cross-tab check: overview vs metrics ────────────────────────────────────
  console.log('\n── Cross-tab: /api/overview vs /api/metrics ───────────────────────');
  const { status: os, data: ov } = await get('/api/overview');
  if (os === 200) {
    check(
      `overview.totalCases (${ov.totalCases}) === metrics.cases.total (${m.cases.total})`,
      ov.totalCases === m.cases.total,
    );
    check(
      `overview.totalAssessments (${ov.totalAssessments}) === metrics.assessments.assigned (${m.assessments.assigned})`,
      ov.totalAssessments === m.assessments.assigned,
    );
    check(
      `overview.activeCentreCount (${ov.activeCentreCount}) === metrics.centres.active (${m.centres.active})`,
      ov.activeCentreCount === m.centres.active,
    );
    check(
      `overview.idleCentreCount (${ov.idleCentreCount}) === metrics.centres.idle (${m.centres.idle})`,
      ov.idleCentreCount === m.centres.idle,
    );
  } else {
    console.warn(`  ⚠  Could not fetch /api/overview (status ${os}) — skipping cross-tab check`);
  }

  // ── Cross-tab: bottlenecks funnel vs metrics pipeline ───────────────────────
  console.log('\n── Cross-tab: /api/bottlenecks vs /api/metrics ────────────────────');
  const { status: bs, data: bn } = await get('/api/bottlenecks');
  if (bs === 200 && bn.funnel) {
    check(
      `bottlenecks.funnel.registered (${bn.funnel.registered}) === metrics.pipeline.registered (${m.pipeline.registered})`,
      bn.funnel.registered === m.pipeline.registered,
    );
    check(
      `bottlenecks.funnel.assigned (${bn.funnel.assigned}) === metrics.pipeline.assigned (${m.pipeline.assigned})`,
      bn.funnel.assigned === m.pipeline.assigned,
    );
    check(
      `bottlenecks.funnel.scoringComplete (${bn.funnel.scoringComplete}) === metrics.pipeline.scoringComplete (${m.pipeline.scoringComplete})`,
      bn.funnel.scoringComplete === m.pipeline.scoringComplete,
    );
  } else {
    console.warn(`  ⚠  Could not fetch /api/bottlenecks (status ${bs}) — skipping cross-tab check`);
  }

  // ── Cross-tab: clinicians vs metrics.assessments.byClinician ────────────────
  console.log('\n── Cross-tab: /api/clinicians vs metrics.assessments.byClinician ──');
  const { status: cs, data: clinData } = await get('/api/clinicians');
  if (cs === 200 && Array.isArray(clinData)) {
    const clinScored = clinData.reduce((s, c) => s + (c.scoringComplete ?? 0), 0);
    const metricScored = m.assessments.byClinician.reduce((s, c) => s + c.scored, 0);
    check(
      `clinicians total scoringComplete (${clinScored}) === metrics byClinician scored sum (${metricScored})`,
      clinScored === metricScored,
    );
  } else {
    console.warn(`  ⚠  Could not fetch /api/clinicians (status ${cs}) — skipping cross-tab check`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════════');
  const total = passed + failed;
  console.log(`[audit] ${passed}/${total} checks passed${failed > 0 ? ` — ${failed} FAILED` : ' ✓'}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[audit] Unexpected error:', e.message);
  process.exit(1);
});
