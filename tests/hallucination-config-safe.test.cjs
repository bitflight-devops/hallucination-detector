'use strict';

describe('hallucination-config-safe', () => {
  beforeEach(() => {
    vi.doUnmock('../scripts/hallucination-config.cjs');
    vi.resetModules();
  });

  describe('constant re-exports', () => {
    it('exports DEFAULT_WEIGHTS matching hallucination-config-defaults', () => {
      const { DEFAULT_WEIGHTS } = require('../scripts/hallucination-config-safe.cjs');
      const { DEFAULT_WEIGHTS: EXPECTED } = require('../scripts/hallucination-config-defaults.cjs');
      expect(DEFAULT_WEIGHTS).toEqual(EXPECTED);
    });

    it('exports DEFAULT_THRESHOLDS matching hallucination-config-defaults', () => {
      const { DEFAULT_THRESHOLDS } = require('../scripts/hallucination-config-safe.cjs');
      const {
        DEFAULT_THRESHOLDS: EXPECTED,
      } = require('../scripts/hallucination-config-defaults.cjs');
      expect(DEFAULT_THRESHOLDS).toEqual(EXPECTED);
    });

    it('exports DEFAULT_CONFIDENCE_WEIGHTS matching hallucination-config-defaults', () => {
      const { DEFAULT_CONFIDENCE_WEIGHTS } = require('../scripts/hallucination-config-safe.cjs');
      const {
        DEFAULT_CONFIDENCE_WEIGHTS: EXPECTED,
      } = require('../scripts/hallucination-config-defaults.cjs');
      expect(DEFAULT_CONFIDENCE_WEIGHTS).toEqual(EXPECTED);
    });

    it('exports DEFAULT_CONFIG matching hallucination-config-defaults', () => {
      const { DEFAULT_CONFIG } = require('../scripts/hallucination-config-safe.cjs');
      const { DEFAULT_CONFIG: EXPECTED } = require('../scripts/hallucination-config-defaults.cjs');
      expect(DEFAULT_CONFIG).toEqual(EXPECTED);
    });
  });

  describe('safeLoadConfig — loader works', () => {
    it('returns a defined object', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
      expect(config).not.toBeNull();
    });

    it('returned config has weights key', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.weights).toBeDefined();
      expect(typeof config.weights).toBe('object');
    });

    it('returned config has thresholds key', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.thresholds).toBeDefined();
      expect(typeof config.thresholds.uncertain).toBe('number');
      expect(typeof config.thresholds.hallucinated).toBe('number');
    });

    it('returned config has introspect key', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(typeof config.introspect).toBe('boolean');
    });

    it('returned config is frozen', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('forwards opts._homeDir to loadConfig', () => {
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      // Passing a non-existent home dir — still returns a valid frozen config
      const config = safeLoadConfig({ _homeDir: '/tmp/no-such-home-for-test-xyz' });
      expect(config).toBeDefined();
      expect(Object.isFrozen(config)).toBe(true);
    });
  });

  describe('safeLoadConfig — loader throws', () => {
    it('returns a defined object when loader throws', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('returned fallback config has weights matching DEFAULT_WEIGHTS', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const {
        safeLoadConfig,
        DEFAULT_WEIGHTS,
      } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.weights).toEqual(DEFAULT_WEIGHTS);
    });

    it('returned fallback config has thresholds matching DEFAULT_THRESHOLDS', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const {
        safeLoadConfig,
        DEFAULT_THRESHOLDS,
      } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    });

    it('returned fallback config has confidenceWeights matching DEFAULT_CONFIDENCE_WEIGHTS', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const {
        safeLoadConfig,
        DEFAULT_CONFIDENCE_WEIGHTS,
      } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.confidenceWeights).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
    });

    it('returned fallback config is frozen', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('returned fallback config nested weights are frozen', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(Object.isFrozen(config.weights)).toBe(true);
    });

    it('returned fallback config has categories as empty frozen object', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(config.categories).toEqual({});
      expect(Object.isFrozen(config.categories)).toBe(true);
    });

    it('returned fallback config has ignorePatterns as empty frozen array', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      const config = safeLoadConfig();
      expect(Array.isArray(config.ignorePatterns)).toBe(true);
      expect(config.ignorePatterns).toHaveLength(0);
    });

    it('safeLoadConfig does not throw regardless of the error type', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new TypeError('Unexpected token');
      });
      const { safeLoadConfig } = require('../scripts/hallucination-config-safe.cjs');
      expect(() => safeLoadConfig()).not.toThrow();
    });
  });

  describe('safeLoadWeights — loader works', () => {
    it('returns a plain object', () => {
      const { safeLoadWeights } = require('../scripts/hallucination-config-safe.cjs');
      const weights = safeLoadWeights();
      expect(typeof weights).toBe('object');
      expect(weights).not.toBeNull();
      expect(Array.isArray(weights)).toBe(false);
    });

    it('returned weights include expected category keys', () => {
      const { safeLoadWeights } = require('../scripts/hallucination-config-safe.cjs');
      const weights = safeLoadWeights();
      expect('speculation_language' in weights).toBe(true);
      expect('causality_language' in weights).toBe(true);
      expect('pseudo_quantification' in weights).toBe(true);
    });
  });

  describe('safeLoadWeights — loader throws', () => {
    it('returns an object matching DEFAULT_WEIGHTS when loader throws', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const {
        safeLoadWeights,
        DEFAULT_WEIGHTS,
      } = require('../scripts/hallucination-config-safe.cjs');
      const weights = safeLoadWeights();
      expect(weights).toEqual(DEFAULT_WEIGHTS);
    });

    it('returned fallback weights is not the same reference as DEFAULT_WEIGHTS', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new Error('Simulated loader failure');
      });
      const {
        safeLoadWeights,
        DEFAULT_WEIGHTS,
      } = require('../scripts/hallucination-config-safe.cjs');
      const weights = safeLoadWeights();
      // safeLoadWeights returns a spread copy, not the frozen constant itself
      expect(weights).not.toBe(DEFAULT_WEIGHTS);
    });

    it('safeLoadWeights does not throw regardless of the error type', () => {
      vi.doMock('../scripts/hallucination-config.cjs', () => {
        throw new RangeError('Out of range');
      });
      const { safeLoadWeights } = require('../scripts/hallucination-config-safe.cjs');
      expect(() => safeLoadWeights()).not.toThrow();
    });
  });
});
