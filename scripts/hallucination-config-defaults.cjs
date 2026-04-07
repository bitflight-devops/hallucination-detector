#!/usr/bin/env node
/**
 * Default configuration constants for hallucination-detector hooks.
 * Zero dependencies — Node.js built-ins only.
 */

'use strict';

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
  unsupported_absence: 0.7,
  ungrounded_behavioral_assertion: 0.5,
};

/**
 * Default score thresholds for three-tier label classification.
 * - uncertain: scores >= this value are labelled UNCERTAIN (not GROUNDED)
 * - hallucinated: scores > this value are labelled HALLUCINATED
 */
const DEFAULT_THRESHOLDS = {
  uncertain: 0.3,
  hallucinated: 0.6,
};

/**
 * Default weights for the four confidence-score components.
 * These control how much each factor contributes to the per-match
 * confidence integer in [0, 100].
 *
 * - patternStrength:    contribution of the pattern's inherent severity
 * - evidenceProximity: contribution of evidence markers near the match
 * - categoryStacking:  bonus when multiple categories fire in the same sentence
 * - contextDensity:    bonus when multiple matches cluster within 200 chars
 */
const DEFAULT_CONFIDENCE_WEIGHTS = {
  patternStrength: 0.4,
  evidenceProximity: 0.25,
  categoryStacking: 0.2,
  contextDensity: 0.15,
};

/**
 * Default full configuration object.
 */
const DEFAULT_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  introspect: false,
  introspectOutputPath: null,
  // Shadow mode: log would-block events without actually blocking.
  dryRun: false,
  // Global settings
  severity: 'error',
  maxTriggersPerResponse: 20,
  maxBlocksPerSession: null,
  outputFormat: 'text',
  debug: false,
  // Per-category settings (keyed by category name)
  categories: {},
  // Filtering settings
  ignorePatterns: [],
  ignoreBlocks: [],
  evidenceMarkers: [],
  allowlist: [],
  // Response settings
  responseTemplates: {},
  includeContext: true,
  contextLines: 2,
  // Session-type gating
  warnOnly: false, // log telemetry but never emit a block to stdout
  ignoreCategories: [], // category names skipped entirely (still written to telemetry with was_ignored=1)
  blockSubagents: false, // block when hook_event_name is SubagentStop
  blockUserSessions: true, // block when hook_event_name is Stop (user-facing session)
  // Confidence scoring
  confidenceWeights: DEFAULT_CONFIDENCE_WEIGHTS,
  reportingThreshold: 50, // minimum confidence [0,100] for a match to appear in block reason text
};

module.exports = {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
};
