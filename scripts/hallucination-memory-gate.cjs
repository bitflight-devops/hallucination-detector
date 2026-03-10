'use strict';

/**
 * Compute the memory gate for a set of labeled claims.
 *
 * Only [VERIFIED] and [CAUSAL] claims may be retained in memory.
 * All other labels are blocked from persistence.
 *
 * @param {Array<{id: string, label: string}>} claims
 * @returns {{ allowed: string[], blocked: string[] }}
 */
// Single source of truth for which labels may be retained in memory.
const RETAINABLE_LABELS = new Set(['VERIFIED', 'CAUSAL']);

function computeMemoryGate(claims) {
  const RETAINABLE = RETAINABLE_LABELS;
  const allowed = [];
  const blocked = [];

  for (const claim of claims) {
    if (RETAINABLE.has(claim.label)) {
      allowed.push(claim.id);
    } else {
      blocked.push(claim.id);
    }
  }

  return { allowed, blocked };
}

module.exports = { computeMemoryGate, RETAINABLE_LABELS };
