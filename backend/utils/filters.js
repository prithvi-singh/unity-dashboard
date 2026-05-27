'use strict';

/**
 * filters.js — Convenience re-export of FILTERS and EVENT_TYPES.
 *
 * The canonical definitions live in utils/metrics.js.
 * Import from either path — they resolve to the same object.
 *
 * Usage:
 *   const { FILTERS, EVENT_TYPES } = require('../utils/filters');
 */
module.exports = require('./metrics');
