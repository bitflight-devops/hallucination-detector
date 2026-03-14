#!/usr/bin/env node
/**
 * Shared configuration loader for hallucination-detector hooks.
 * Zero dependencies — Node.js built-ins only.
 *
 * Reads `.hallucination-detectorrc.cjs` from process.cwd() and returns a
 * validated, frozen config object with defaults merged in for any missing or
 * invalid fields.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Default weights for each detection category.
 * Weights are relative severity signals; `aggregateWeightedScore` normalizes
 * by their sum so aggregate scores always remain in [0, 1] regardless of
 * whether the weights themselves sum to 1.0.
 */
const DEFAULT_WEIGHTS = {
  speculation_language: 0.25,
  causality_language: 0.3,
  pseudo_quantification: 0.15,
  completeness_claim: 0.2,
  // fabricated_source: reserved for future implementation (issue #18)
  evaluative_design_claim: 0.4,
  internal_contradiction: 0.35,
};

/**
 * Default full configuration object.
 */
const DEFAULT_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  introspect: false,
  introspectOutputPath: null,
};

/**
 * Load and validate the full configuration from `.hallucination-detectorrc.cjs`
 * in the current working directory. Returns a frozen config object with
 * defaults merged for any missing or invalid fields.
 *
 * @returns {{ weights: object, introspect: boolean, introspectOutputPath: string|null }}
 */
function loadConfig() {
  const rcPath = path.join(process.cwd(), '.hallucination-detectorrc.cjs');
  let rc = null;

  try {
    if (fs.existsSync(rcPath)) {
      // eslint-disable-next-line import/no-dynamic-require
      rc = require(rcPath);
    }
  } catch {
    // ignore errors loading config — fall back to defaults
  }

  // --- weights ---
  const weights = { ...DEFAULT_WEIGHTS };
  if (rc?.weights && typeof rc.weights === 'object' && !Array.isArray(rc.weights)) {
    for (const category of Object.keys(DEFAULT_WEIGHTS)) {
      const val = rc.weights[category];
      if (Number.isFinite(val) && val >= 0) {
        weights[category] = val;
      }
    }
  }

  // --- introspect ---
  const introspect = typeof rc?.introspect === 'boolean' ? rc.introspect : false;

  // --- introspectOutputPath ---
  const introspectOutputPath =
    typeof rc?.introspectOutputPath === 'string' ? rc.introspectOutputPath : null;

  return Object.freeze({ weights: Object.freeze(weights), introspect, introspectOutputPath });
}

/**
 * Load only weights — backward-compatible wrapper around loadConfig().
 *
 * @returns {object} Validated weights map.
 */
function loadWeights() {
  return loadConfig().weights;
}

module.exports = { loadConfig, loadWeights, DEFAULT_WEIGHTS, DEFAULT_CONFIG };
