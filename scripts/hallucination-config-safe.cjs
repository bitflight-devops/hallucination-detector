#!/usr/bin/env node
/**
 * Safe configuration loader — guarantees a valid config on any failure.
 *
 * Top-level requires are limited to pure-data modules that cannot throw.
 * The full config loader is required lazily inside function bodies so that
 * a syntax error or runtime failure in the loader chain never crashes a hook.
 *
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

const {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
} = require('./hallucination-config-defaults.cjs');
const { deepFreeze } = require('./hallucination-config-merge.cjs');

/**
 * Load config with guaranteed fallback to defaults.
 * Never throws — returns a frozen DEFAULT_CONFIG on any failure.
 * @param {object} [opts] - Options forwarded to loadConfig.
 * @returns {object} Frozen config object.
 */
function safeLoadConfig(opts) {
  try {
    const { loadConfig } = require('./hallucination-config.cjs');
    return loadConfig(opts);
  } catch {
    return deepFreeze({
      ...DEFAULT_CONFIG,
      weights: { ...DEFAULT_WEIGHTS },
      thresholds: { ...DEFAULT_THRESHOLDS },
      confidenceWeights: { ...DEFAULT_CONFIDENCE_WEIGHTS },
      categories: {},
      ignorePatterns: [],
      ignoreBlocks: [],
      evidenceMarkers: [],
      allowlist: [],
      responseTemplates: {},
    });
  }
}

/**
 * Load weights with guaranteed fallback.
 * @returns {object} Validated weights map.
 */
function safeLoadWeights() {
  try {
    const { loadWeights } = require('./hallucination-config.cjs');
    return loadWeights();
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

module.exports = {
  safeLoadConfig,
  safeLoadWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
};
