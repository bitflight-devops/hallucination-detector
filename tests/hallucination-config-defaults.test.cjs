'use strict';

const {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
} = require('../scripts/hallucination-config-defaults.cjs');

describe('hallucination-config-defaults', () => {
  describe('exports', () => {
    it('exports all four constants', () => {
      expect(DEFAULT_WEIGHTS).toBeDefined();
      expect(DEFAULT_THRESHOLDS).toBeDefined();
      expect(DEFAULT_CONFIDENCE_WEIGHTS).toBeDefined();
      expect(DEFAULT_CONFIG).toBeDefined();
    });
  });

  describe('DEFAULT_WEIGHTS', () => {
    it('is a plain object', () => {
      expect(typeof DEFAULT_WEIGHTS).toBe('object');
      expect(Array.isArray(DEFAULT_WEIGHTS)).toBe(false);
      expect(DEFAULT_WEIGHTS).not.toBeNull();
    });

    it('has the required category keys', () => {
      expect('speculation_language' in DEFAULT_WEIGHTS).toBe(true);
      expect('causality_language' in DEFAULT_WEIGHTS).toBe(true);
      expect('pseudo_quantification' in DEFAULT_WEIGHTS).toBe(true);
      expect('completeness_claim' in DEFAULT_WEIGHTS).toBe(true);
      expect('evaluative_design_claim' in DEFAULT_WEIGHTS).toBe(true);
      expect('internal_contradiction' in DEFAULT_WEIGHTS).toBe(true);
      expect('unsupported_absence' in DEFAULT_WEIGHTS).toBe(true);
      expect('ungrounded_behavioral_assertion' in DEFAULT_WEIGHTS).toBe(true);
    });

    it('all values are finite positive numbers', () => {
      for (const [key, val] of Object.entries(DEFAULT_WEIGHTS)) {
        expect(typeof val, `DEFAULT_WEIGHTS.${key} type`).toBe('number');
        expect(Number.isFinite(val), `DEFAULT_WEIGHTS.${key} is finite`).toBe(true);
        expect(val > 0, `DEFAULT_WEIGHTS.${key} > 0`).toBe(true);
      }
    });

    it('has specific expected values', () => {
      expect(DEFAULT_WEIGHTS.speculation_language).toBe(0.25);
      expect(DEFAULT_WEIGHTS.causality_language).toBe(0.3);
      expect(DEFAULT_WEIGHTS.pseudo_quantification).toBe(0.15);
      expect(DEFAULT_WEIGHTS.completeness_claim).toBe(0.2);
      expect(DEFAULT_WEIGHTS.evaluative_design_claim).toBe(0.4);
      expect(DEFAULT_WEIGHTS.internal_contradiction).toBe(0.35);
      expect(DEFAULT_WEIGHTS.unsupported_absence).toBe(0.7);
      expect(DEFAULT_WEIGHTS.ungrounded_behavioral_assertion).toBe(0.5);
    });
  });

  describe('DEFAULT_THRESHOLDS', () => {
    it('is a plain object', () => {
      expect(typeof DEFAULT_THRESHOLDS).toBe('object');
      expect(Array.isArray(DEFAULT_THRESHOLDS)).toBe(false);
      expect(DEFAULT_THRESHOLDS).not.toBeNull();
    });

    it('has uncertain and hallucinated keys', () => {
      expect('uncertain' in DEFAULT_THRESHOLDS).toBe(true);
      expect('hallucinated' in DEFAULT_THRESHOLDS).toBe(true);
    });

    it('both values are numbers in [0,1]', () => {
      expect(typeof DEFAULT_THRESHOLDS.uncertain).toBe('number');
      expect(DEFAULT_THRESHOLDS.uncertain).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_THRESHOLDS.uncertain).toBeLessThanOrEqual(1);
      expect(typeof DEFAULT_THRESHOLDS.hallucinated).toBe('number');
      expect(DEFAULT_THRESHOLDS.hallucinated).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_THRESHOLDS.hallucinated).toBeLessThanOrEqual(1);
    });

    it('uncertain <= hallucinated', () => {
      expect(DEFAULT_THRESHOLDS.uncertain).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.hallucinated);
    });

    it('has expected values', () => {
      expect(DEFAULT_THRESHOLDS.uncertain).toBe(0.3);
      expect(DEFAULT_THRESHOLDS.hallucinated).toBe(0.6);
    });
  });

  describe('DEFAULT_CONFIDENCE_WEIGHTS', () => {
    it('is a plain object', () => {
      expect(typeof DEFAULT_CONFIDENCE_WEIGHTS).toBe('object');
      expect(Array.isArray(DEFAULT_CONFIDENCE_WEIGHTS)).toBe(false);
      expect(DEFAULT_CONFIDENCE_WEIGHTS).not.toBeNull();
    });

    it('has exactly 4 keys', () => {
      expect(Object.keys(DEFAULT_CONFIDENCE_WEIGHTS)).toHaveLength(4);
    });

    it('has patternStrength, evidenceProximity, categoryStacking, contextDensity', () => {
      expect('patternStrength' in DEFAULT_CONFIDENCE_WEIGHTS).toBe(true);
      expect('evidenceProximity' in DEFAULT_CONFIDENCE_WEIGHTS).toBe(true);
      expect('categoryStacking' in DEFAULT_CONFIDENCE_WEIGHTS).toBe(true);
      expect('contextDensity' in DEFAULT_CONFIDENCE_WEIGHTS).toBe(true);
    });

    it('all values are finite numbers', () => {
      for (const [key, val] of Object.entries(DEFAULT_CONFIDENCE_WEIGHTS)) {
        expect(typeof val, `DEFAULT_CONFIDENCE_WEIGHTS.${key} type`).toBe('number');
        expect(Number.isFinite(val), `DEFAULT_CONFIDENCE_WEIGHTS.${key} is finite`).toBe(true);
      }
    });

    it('has expected values', () => {
      expect(DEFAULT_CONFIDENCE_WEIGHTS.patternStrength).toBe(0.4);
      expect(DEFAULT_CONFIDENCE_WEIGHTS.evidenceProximity).toBe(0.25);
      expect(DEFAULT_CONFIDENCE_WEIGHTS.categoryStacking).toBe(0.2);
      expect(DEFAULT_CONFIDENCE_WEIGHTS.contextDensity).toBe(0.15);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('references DEFAULT_WEIGHTS by identity', () => {
      expect(DEFAULT_CONFIG.weights).toBe(DEFAULT_WEIGHTS);
    });

    it('references DEFAULT_THRESHOLDS by identity', () => {
      expect(DEFAULT_CONFIG.thresholds).toBe(DEFAULT_THRESHOLDS);
    });

    it('references DEFAULT_CONFIDENCE_WEIGHTS by identity', () => {
      expect(DEFAULT_CONFIG.confidenceWeights).toBe(DEFAULT_CONFIDENCE_WEIGHTS);
    });

    it('has boolean flags with correct types', () => {
      expect(typeof DEFAULT_CONFIG.introspect).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.dryRun).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.debug).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.warnOnly).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.blockSubagents).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.blockUserSessions).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.includeContext).toBe('boolean');
    });

    it('has expected boolean defaults', () => {
      expect(DEFAULT_CONFIG.introspect).toBe(false);
      expect(DEFAULT_CONFIG.dryRun).toBe(false);
      expect(DEFAULT_CONFIG.debug).toBe(false);
      expect(DEFAULT_CONFIG.warnOnly).toBe(false);
      expect(DEFAULT_CONFIG.blockSubagents).toBe(false);
      expect(DEFAULT_CONFIG.blockUserSessions).toBe(true);
      expect(DEFAULT_CONFIG.includeContext).toBe(true);
    });

    it('has string fields with correct types', () => {
      expect(typeof DEFAULT_CONFIG.severity).toBe('string');
      expect(typeof DEFAULT_CONFIG.outputFormat).toBe('string');
    });

    it('has numeric fields with correct types', () => {
      expect(typeof DEFAULT_CONFIG.maxTriggersPerResponse).toBe('number');
      expect(typeof DEFAULT_CONFIG.reportingThreshold).toBe('number');
      expect(typeof DEFAULT_CONFIG.contextLines).toBe('number');
    });

    it('has array fields as empty arrays', () => {
      expect(Array.isArray(DEFAULT_CONFIG.ignorePatterns)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.ignoreBlocks)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.evidenceMarkers)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.allowlist)).toBe(true);
      expect(Array.isArray(DEFAULT_CONFIG.ignoreCategories)).toBe(true);
    });

    it('has categories as empty object', () => {
      expect(typeof DEFAULT_CONFIG.categories).toBe('object');
      expect(DEFAULT_CONFIG.categories).not.toBeNull();
      expect(Object.keys(DEFAULT_CONFIG.categories)).toHaveLength(0);
    });
  });
});
