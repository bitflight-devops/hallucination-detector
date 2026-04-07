'use strict';

const {
  validateConfig,
  isValidThresholds,
  isValidCategoryThreshold,
} = require('../scripts/hallucination-config-validate.cjs');

describe('isValidThresholds', () => {
  it('returns true for valid thresholds', () => {
    expect(isValidThresholds({ uncertain: 0.3, hallucinated: 0.6 })).toBe(true);
  });

  it('returns true when uncertain equals hallucinated', () => {
    expect(isValidThresholds({ uncertain: 0.5, hallucinated: 0.5 })).toBe(true);
  });

  it('returns true for boundary values 0 and 1', () => {
    expect(isValidThresholds({ uncertain: 0, hallucinated: 1 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isValidThresholds(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidThresholds(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isValidThresholds('0.3')).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isValidThresholds([0.3, 0.6])).toBe(false);
  });

  it('returns false when uncertain is missing', () => {
    expect(isValidThresholds({ hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when hallucinated is missing', () => {
    expect(isValidThresholds({ uncertain: 0.3 })).toBe(false);
  });

  it('returns false when uncertain is a string', () => {
    expect(isValidThresholds({ uncertain: '0.3', hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when uncertain is NaN', () => {
    expect(isValidThresholds({ uncertain: NaN, hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when uncertain is Infinity', () => {
    expect(isValidThresholds({ uncertain: Infinity, hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when uncertain < 0', () => {
    expect(isValidThresholds({ uncertain: -0.1, hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when uncertain > 1', () => {
    expect(isValidThresholds({ uncertain: 1.1, hallucinated: 0.6 })).toBe(false);
  });

  it('returns false when hallucinated < 0', () => {
    expect(isValidThresholds({ uncertain: 0.3, hallucinated: -0.1 })).toBe(false);
  });

  it('returns false when hallucinated > 1', () => {
    expect(isValidThresholds({ uncertain: 0.3, hallucinated: 1.5 })).toBe(false);
  });

  it('returns false when uncertain > hallucinated (inverted)', () => {
    expect(isValidThresholds({ uncertain: 0.8, hallucinated: 0.3 })).toBe(false);
  });
});

describe('isValidCategoryThreshold', () => {
  it('delegates to isValidThresholds — valid input returns true', () => {
    expect(isValidCategoryThreshold({ uncertain: 0.2, hallucinated: 0.7 })).toBe(true);
  });

  it('delegates to isValidThresholds — invalid input returns false', () => {
    expect(isValidCategoryThreshold(null)).toBe(false);
    expect(isValidCategoryThreshold({ uncertain: 0.9, hallucinated: 0.1 })).toBe(false);
  });
});

describe('validateConfig', () => {
  describe('input guards', () => {
    it('returns empty object for null input', () => {
      expect(validateConfig(null, 'test')).toEqual({});
    });

    it('returns empty object for undefined input', () => {
      expect(validateConfig(undefined, 'test')).toEqual({});
    });

    it('returns empty object for non-object input', () => {
      expect(validateConfig('string', 'test')).toEqual({});
    });

    it('does not throw when source is omitted', () => {
      expect(() => validateConfig({ severity: 'error' })).not.toThrow();
    });
  });

  describe('severity validation', () => {
    it('preserves valid severity "error"', () => {
      const obj = { severity: 'error' };
      validateConfig(obj, 'test');
      expect(obj.severity).toBe('error');
    });

    it('preserves valid severity "warning"', () => {
      const obj = { severity: 'warning' };
      validateConfig(obj, 'test');
      expect(obj.severity).toBe('warning');
    });

    it('preserves valid severity "info"', () => {
      const obj = { severity: 'info' };
      validateConfig(obj, 'test');
      expect(obj.severity).toBe('info');
    });

    it('removes invalid severity value', () => {
      const obj = { severity: 'critical' };
      validateConfig(obj, 'test');
      expect('severity' in obj).toBe(false);
    });
  });

  describe('outputFormat validation', () => {
    it('preserves valid outputFormat "text"', () => {
      const obj = { outputFormat: 'text' };
      validateConfig(obj, 'test');
      expect(obj.outputFormat).toBe('text');
    });

    it('preserves valid outputFormat "json"', () => {
      const obj = { outputFormat: 'json' };
      validateConfig(obj, 'test');
      expect(obj.outputFormat).toBe('json');
    });

    it('preserves valid outputFormat "jsonl"', () => {
      const obj = { outputFormat: 'jsonl' };
      validateConfig(obj, 'test');
      expect(obj.outputFormat).toBe('jsonl');
    });

    it('removes invalid outputFormat value', () => {
      const obj = { outputFormat: 'xml' };
      validateConfig(obj, 'test');
      expect('outputFormat' in obj).toBe(false);
    });
  });

  describe('numeric field validation', () => {
    it('preserves valid maxTriggersPerResponse', () => {
      const obj = { maxTriggersPerResponse: 10 };
      validateConfig(obj, 'test');
      expect(obj.maxTriggersPerResponse).toBe(10);
    });

    it('removes non-integer maxTriggersPerResponse', () => {
      const obj = { maxTriggersPerResponse: 1.5 };
      validateConfig(obj, 'test');
      expect('maxTriggersPerResponse' in obj).toBe(false);
    });

    it('removes negative maxTriggersPerResponse', () => {
      const obj = { maxTriggersPerResponse: -1 };
      validateConfig(obj, 'test');
      expect('maxTriggersPerResponse' in obj).toBe(false);
    });

    it('preserves maxBlocksPerSession = null', () => {
      const obj = { maxBlocksPerSession: null };
      validateConfig(obj, 'test');
      expect(obj.maxBlocksPerSession).toBeNull();
    });

    it('removes non-integer maxBlocksPerSession', () => {
      const obj = { maxBlocksPerSession: 2.5 };
      validateConfig(obj, 'test');
      expect('maxBlocksPerSession' in obj).toBe(false);
    });

    it('preserves valid contextLines', () => {
      const obj = { contextLines: 3 };
      validateConfig(obj, 'test');
      expect(obj.contextLines).toBe(3);
    });

    it('removes negative contextLines', () => {
      const obj = { contextLines: -1 };
      validateConfig(obj, 'test');
      expect('contextLines' in obj).toBe(false);
    });

    it('preserves valid reportingThreshold', () => {
      const obj = { reportingThreshold: 75 };
      validateConfig(obj, 'test');
      expect(obj.reportingThreshold).toBe(75);
    });

    it('removes out-of-range reportingThreshold', () => {
      const obj = { reportingThreshold: 150 };
      validateConfig(obj, 'test');
      expect('reportingThreshold' in obj).toBe(false);
    });
  });

  describe('boolean field validation', () => {
    it('preserves boolean debug = true', () => {
      const obj = { debug: true };
      validateConfig(obj, 'test');
      expect(obj.debug).toBe(true);
    });

    it('removes non-boolean debug', () => {
      const obj = { debug: 'yes' };
      validateConfig(obj, 'test');
      expect('debug' in obj).toBe(false);
    });

    it('removes non-boolean introspect', () => {
      const obj = { introspect: 1 };
      validateConfig(obj, 'test');
      expect('introspect' in obj).toBe(false);
    });

    it('removes non-boolean dryRun', () => {
      const obj = { dryRun: 'true' };
      validateConfig(obj, 'test');
      expect('dryRun' in obj).toBe(false);
    });

    it('removes non-boolean warnOnly', () => {
      const obj = { warnOnly: 0 };
      validateConfig(obj, 'test');
      expect('warnOnly' in obj).toBe(false);
    });

    it('removes non-boolean blockSubagents', () => {
      const obj = { blockSubagents: null };
      validateConfig(obj, 'test');
      expect('blockSubagents' in obj).toBe(false);
    });

    it('removes non-boolean blockUserSessions', () => {
      const obj = { blockUserSessions: 'yes' };
      validateConfig(obj, 'test');
      expect('blockUserSessions' in obj).toBe(false);
    });

    it('removes non-boolean includeContext', () => {
      const obj = { includeContext: 1 };
      validateConfig(obj, 'test');
      expect('includeContext' in obj).toBe(false);
    });
  });

  describe('ignoreCategories validation', () => {
    it('preserves valid array', () => {
      const obj = { ignoreCategories: ['speculation_language'] };
      validateConfig(obj, 'test');
      expect(obj.ignoreCategories).toEqual(['speculation_language']);
    });

    it('removes non-array ignoreCategories', () => {
      const obj = { ignoreCategories: 'speculation_language' };
      validateConfig(obj, 'test');
      expect('ignoreCategories' in obj).toBe(false);
    });
  });

  describe('weights validation', () => {
    it('preserves valid weights object', () => {
      const obj = { weights: { speculation_language: 0.5 } };
      validateConfig(obj, 'test');
      expect(obj.weights).toEqual({ speculation_language: 0.5 });
    });

    it('removes non-object weights', () => {
      const obj = { weights: 'invalid' };
      validateConfig(obj, 'test');
      expect('weights' in obj).toBe(false);
    });

    it('removes array weights', () => {
      const obj = { weights: [0.5] };
      validateConfig(obj, 'test');
      expect('weights' in obj).toBe(false);
    });
  });

  describe('thresholds validation', () => {
    it('preserves valid thresholds', () => {
      const obj = { thresholds: { uncertain: 0.3, hallucinated: 0.6 } };
      validateConfig(obj, 'test');
      expect(obj.thresholds).toEqual({ uncertain: 0.3, hallucinated: 0.6 });
    });

    it('removes invalid thresholds', () => {
      const obj = { thresholds: { uncertain: 0.9, hallucinated: 0.1 } };
      validateConfig(obj, 'test');
      expect('thresholds' in obj).toBe(false);
    });
  });

  describe('confidenceWeights validation', () => {
    it('preserves valid confidenceWeights object', () => {
      const obj = {
        confidenceWeights: {
          patternStrength: 0.4,
          evidenceProximity: 0.25,
          categoryStacking: 0.2,
          contextDensity: 0.15,
        },
      };
      validateConfig(obj, 'test');
      expect(obj.confidenceWeights).toBeDefined();
      expect(obj.confidenceWeights.patternStrength).toBe(0.4);
    });

    it('removes confidenceWeights when it is not a plain object', () => {
      const obj = { confidenceWeights: 'invalid' };
      validateConfig(obj, 'test');
      expect('confidenceWeights' in obj).toBe(false);
    });

    it('removes individual invalid confidence weight keys', () => {
      const obj = { confidenceWeights: { patternStrength: 1.5, evidenceProximity: 0.25 } };
      validateConfig(obj, 'test');
      expect('patternStrength' in obj.confidenceWeights).toBe(false);
      expect(obj.confidenceWeights.evidenceProximity).toBe(0.25);
    });
  });

  describe('categories validation', () => {
    it('preserves valid categories object', () => {
      const obj = {
        categories: {
          speculation_language: { enabled: false },
        },
      };
      validateConfig(obj, 'test');
      expect(obj.categories.speculation_language).toEqual({ enabled: false });
    });

    it('removes non-object categories', () => {
      const obj = { categories: 'invalid' };
      validateConfig(obj, 'test');
      expect('categories' in obj).toBe(false);
    });

    it('preserves categories with valid threshold pairs', () => {
      const obj = {
        categories: {
          speculation_language: { uncertain: 0.2, hallucinated: 0.5 },
        },
      };
      validateConfig(obj, 'test');
      expect(obj.categories.speculation_language.uncertain).toBe(0.2);
      expect(obj.categories.speculation_language.hallucinated).toBe(0.5);
    });

    it('removes threshold fields but preserves other fields on invalid threshold pair', () => {
      const obj = {
        categories: {
          speculation_language: {
            uncertain: 0.9,
            hallucinated: 0.1,
            enabled: false,
          },
        },
      };
      validateConfig(obj, 'test');
      expect('uncertain' in obj.categories.speculation_language).toBe(false);
      expect('hallucinated' in obj.categories.speculation_language).toBe(false);
      expect(obj.categories.speculation_language.enabled).toBe(false);
    });
  });

  describe('valid fields preservation', () => {
    it('returns the mutated input object', () => {
      const obj = { severity: 'error' };
      const result = validateConfig(obj, 'test');
      expect(result).toBe(obj);
    });

    it('preserves fields not validated by validateConfig', () => {
      const obj = { severity: 'error', customField: 'kept' };
      validateConfig(obj, 'test');
      expect(obj.customField).toBe('kept');
    });
  });
});
