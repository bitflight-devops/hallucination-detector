#!/usr/bin/env node
/**
 * Schema validation for hallucination-detector configuration objects.
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

const {
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_THRESHOLDS,
} = require('./hallucination-config-defaults.cjs');

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);
const VALID_OUTPUT_FORMATS = new Set(['text', 'json', 'jsonl']);

/**
 * Returns true when `t` is a valid thresholds object: a non-null plain object
 * with both `uncertain` and `hallucinated` as finite numbers in [0,1] and
 * `uncertain <= hallucinated`.
 *
 * @param {*} t - Value to check.
 * @returns {boolean}
 */
function isValidThresholds(t) {
  return (
    t !== null &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    typeof t.uncertain === 'number' &&
    Number.isFinite(t.uncertain) &&
    t.uncertain >= 0 &&
    t.uncertain <= 1 &&
    typeof t.hallucinated === 'number' &&
    Number.isFinite(t.hallucinated) &&
    t.hallucinated >= 0 &&
    t.hallucinated <= 1 &&
    t.uncertain <= t.hallucinated
  );
}

/**
 * Returns true when `value` is a valid per-category threshold pair: a non-null
 * plain object with both `uncertain` and `hallucinated` as finite numbers in
 * [0,1] and `uncertain <= hallucinated`.  Delegates to `isValidThresholds`
 * because the shapes are identical.
 *
 * @param {*} value - Value to check.
 * @returns {boolean}
 */
function isValidCategoryThreshold(value) {
  return isValidThresholds(value);
}

/**
 * Validate a raw config object loaded from a source, logging warnings to stderr
 * for invalid field values and deleting them so they fall back to defaults during
 * the merge step.  Mutates the provided object in place.
 *
 * @param {object} obj    - Raw config object to validate.
 * @param {string} source - Human-readable source label used in warning messages.
 * @returns {object} The (mutated) object.
 */
function validateConfig(obj, source) {
  if (!obj || typeof obj !== 'object') return {};
  const src = source || 'unknown source';

  /**
   * Emit a validation warning to stderr.
   * @param {string} field
   * @param {*} val
   * @param {*} def
   */
  function warn(field, val, def) {
    process.stderr.write(
      `[hallucination-detector] Invalid ${field} "${val}" from ${src}; using default ${JSON.stringify(def)}\n`,
    );
  }

  if ('severity' in obj && !VALID_SEVERITIES.has(obj.severity)) {
    warn('severity', obj.severity, 'error');
    delete obj.severity;
  }
  if ('outputFormat' in obj && !VALID_OUTPUT_FORMATS.has(obj.outputFormat)) {
    warn('outputFormat', obj.outputFormat, 'text');
    delete obj.outputFormat;
  }
  if ('maxTriggersPerResponse' in obj) {
    if (!Number.isInteger(obj.maxTriggersPerResponse) || obj.maxTriggersPerResponse < 0) {
      warn('maxTriggersPerResponse', obj.maxTriggersPerResponse, 20);
      delete obj.maxTriggersPerResponse;
    }
  }
  if ('maxBlocksPerSession' in obj && obj.maxBlocksPerSession !== null) {
    if (!Number.isInteger(obj.maxBlocksPerSession) || obj.maxBlocksPerSession < 0) {
      warn('maxBlocksPerSession', obj.maxBlocksPerSession, null);
      delete obj.maxBlocksPerSession;
    }
  }
  if ('debug' in obj && typeof obj.debug !== 'boolean') {
    warn('debug', obj.debug, false);
    delete obj.debug;
  }
  if ('introspect' in obj && typeof obj.introspect !== 'boolean') {
    warn('introspect', obj.introspect, false);
    delete obj.introspect;
  }
  if ('dryRun' in obj && typeof obj.dryRun !== 'boolean') {
    warn('dryRun', obj.dryRun, false);
    delete obj.dryRun;
  }
  if ('warnOnly' in obj && typeof obj.warnOnly !== 'boolean') {
    warn('warnOnly', obj.warnOnly, false);
    delete obj.warnOnly;
  }
  if ('monitorSubagents' in obj && typeof obj.monitorSubagents !== 'boolean') {
    warn('monitorSubagents', obj.monitorSubagents, false);
    delete obj.monitorSubagents;
  }
  if ('blockSubagents' in obj) {
    if (typeof obj.blockSubagents !== 'boolean') {
      warn('blockSubagents', obj.blockSubagents, false);
      delete obj.blockSubagents;
    } else {
      // blockSubagents is deprecated. blockSubagents: true is aliased to monitorSubagents: true
      // for backward compatibility. Blocking is always suppressed for subagent sessions.
      process.stderr.write(
        `[hallucination-detector] blockSubagents (from ${src}) is deprecated; use monitorSubagents instead. Note: blocking is always suppressed for subagent sessions.\n`,
      );
      if (obj.blockSubagents === true && !('monitorSubagents' in obj)) {
        obj.monitorSubagents = true;
      }
    }
  }
  if ('blockUserSessions' in obj && typeof obj.blockUserSessions !== 'boolean') {
    warn('blockUserSessions', obj.blockUserSessions, true);
    delete obj.blockUserSessions;
  }
  if ('ignoreCategories' in obj) {
    if (!Array.isArray(obj.ignoreCategories)) {
      warn('ignoreCategories', obj.ignoreCategories, []);
      delete obj.ignoreCategories;
    }
  }
  if ('includeContext' in obj && typeof obj.includeContext !== 'boolean') {
    warn('includeContext', obj.includeContext, true);
    delete obj.includeContext;
  }
  if ('contextLines' in obj) {
    if (!Number.isInteger(obj.contextLines) || obj.contextLines < 0) {
      warn('contextLines', obj.contextLines, 2);
      delete obj.contextLines;
    }
  }
  // weights: object with numeric values
  if ('weights' in obj) {
    if (typeof obj.weights !== 'object' || obj.weights === null || Array.isArray(obj.weights)) {
      warn('weights', obj.weights, DEFAULT_WEIGHTS);
      delete obj.weights;
    } else {
      for (const key of Object.keys(obj.weights)) {
        const val = obj.weights[key];
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          const defaultVal = key in DEFAULT_WEIGHTS ? DEFAULT_WEIGHTS[key] : undefined;
          warn('weights.' + key, val, defaultVal);
          delete obj.weights[key];
        }
      }
    }
  }
  // thresholds: { uncertain, hallucinated } both numbers in [0,1], uncertain <= hallucinated
  if ('thresholds' in obj) {
    if (!isValidThresholds(obj.thresholds)) {
      warn('thresholds', JSON.stringify(obj.thresholds), DEFAULT_THRESHOLDS);
      delete obj.thresholds;
    }
  }
  // reportingThreshold: finite number in [0, 100]
  if ('reportingThreshold' in obj) {
    if (
      !Number.isFinite(obj.reportingThreshold) ||
      obj.reportingThreshold < 0 ||
      obj.reportingThreshold > 100
    ) {
      warn('reportingThreshold', obj.reportingThreshold, 50);
      delete obj.reportingThreshold;
    }
  }
  // confidenceWeights: plain object; each of 4 recognized keys must be finite number in [0,1];
  // unknown keys are preserved with a warning.
  if ('confidenceWeights' in obj) {
    if (
      typeof obj.confidenceWeights !== 'object' ||
      obj.confidenceWeights === null ||
      Array.isArray(obj.confidenceWeights)
    ) {
      process.stderr.write(
        `[hallucination-detector] Invalid confidenceWeights value from ${src}; must be a plain object. Using default\n`,
      );
      delete obj.confidenceWeights;
    } else {
      const KNOWN_CONFIDENCE_KEYS = new Set([
        'patternStrength',
        'evidenceProximity',
        'categoryStacking',
        'contextDensity',
      ]);
      for (const key of Object.keys(obj.confidenceWeights)) {
        if (!KNOWN_CONFIDENCE_KEYS.has(key)) {
          process.stderr.write(
            `[hallucination-detector] Unknown confidenceWeights key "${key}" from ${src}; preserved for future use\n`,
          );
          continue;
        }
        const val = obj.confidenceWeights[key];
        if (!Number.isFinite(val) || val < 0 || val > 1) {
          process.stderr.write(
            `[hallucination-detector] Invalid confidenceWeights.${key} "${val}" from ${src}; using default ${DEFAULT_CONFIDENCE_WEIGHTS[key]}\n`,
          );
          delete obj.confidenceWeights[key];
        }
      }
    }
  }
  // categories: per-category overrides — validate threshold pairs when present.
  // Unknown category names are preserved with a warning (they may be user-defined
  // or from a future version). Invalid threshold fields are deleted so they fall
  // back to global thresholds; other category fields (enabled, customPatterns,
  // replacePatterns) are always preserved.
  if ('categories' in obj) {
    if (
      typeof obj.categories !== 'object' ||
      obj.categories === null ||
      Array.isArray(obj.categories)
    ) {
      process.stderr.write(
        `[hallucination-detector] Invalid categories value from ${src}; must be a plain object. Using default {}\n`,
      );
      delete obj.categories;
    } else {
      const VALID_CATEGORIES = new Set(Object.keys(DEFAULT_WEIGHTS));
      for (const catName of Object.keys(obj.categories)) {
        if (!VALID_CATEGORIES.has(catName)) {
          process.stderr.write(
            `[hallucination-detector] Unknown category name "${catName}" from ${src}; entry preserved but may have no effect\n`,
          );
        }
        const catEntry = obj.categories[catName];
        if (catEntry === null || typeof catEntry !== 'object' || Array.isArray(catEntry)) {
          continue;
        }
        const hasUncertain = 'uncertain' in catEntry;
        const hasHallucinated = 'hallucinated' in catEntry;
        if (hasUncertain || hasHallucinated) {
          // Only validate when at least one threshold field is present.
          // Both fields must be present and valid together.
          if (
            !isValidCategoryThreshold({
              uncertain: catEntry.uncertain,
              hallucinated: catEntry.hallucinated,
            })
          ) {
            process.stderr.write(
              `[hallucination-detector] Invalid threshold pair for category "${catName}" from ${src} (uncertain=${catEntry.uncertain}, hallucinated=${catEntry.hallucinated}); threshold fields removed, other category fields preserved\n`,
            );
            delete catEntry.uncertain;
            delete catEntry.hallucinated;
          }
        }
      }
    }
  }
  return obj;
}

module.exports = { validateConfig, isValidThresholds, isValidCategoryThreshold };
