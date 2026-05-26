'use strict';

/**
 * Abbreviate long centre names in API responses.
 * Handles both ASCII apostrophe (') and Unicode right single quotation mark (').
 */
function abbreviateCentre(name) {
  if (!name) return name;
  return name
    .replace(/Mom.s Belief Learning Cent(?:re|er)/gi, 'MBLC')
    .replace(/Mom.s Belief/gi, 'MB');
}

module.exports = { abbreviateCentre };
