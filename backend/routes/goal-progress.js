'use strict';

const { Router } = require('express');
const { parseDateParam } = require('../lib/queryHelpers');
const {
  getGoalProgressSummary,
  getGoalProgressForAssessment,
} = require('../utils/goalProgress');

const router = Router();

/**
 * GET /api/goal-progress
 * Query params: dateFrom, dateTo, centreId (all optional)
 * Returns: getGoalProgressSummary result
 */
router.get('/', async (req, res, next) => {
  try {
    const centreId = req.query.centreId ? parseInt(req.query.centreId, 10) : null;
    const dateFrom = parseDateParam(req.query.dateFrom);
    const dateTo   = parseDateParam(req.query.dateTo);

    if (req.query.centreId && isNaN(centreId)) {
      return res.status(400).json({ error: 'centreId must be a number' });
    }
    if (req.query.dateFrom && !dateFrom) {
      return res.status(400).json({ error: 'dateFrom must be a valid ISO date (YYYY-MM-DD)' });
    }
    if (req.query.dateTo && !dateTo) {
      return res.status(400).json({ error: 'dateTo must be a valid ISO date (YYYY-MM-DD)' });
    }

    const summary = await getGoalProgressSummary(dateFrom, dateTo, centreId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/goal-progress/assessment/:id
 * Returns: getGoalProgressForAssessment result (includes note content)
 */
router.get('/assessment/:id', async (req, res, next) => {
  try {
    const allocatePatientId = parseInt(req.params.id, 10);
    if (isNaN(allocatePatientId)) {
      return res.status(400).json({ error: 'id must be a number' });
    }

    const data = await getGoalProgressForAssessment(allocatePatientId);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
