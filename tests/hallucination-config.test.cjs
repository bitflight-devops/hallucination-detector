'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  loadWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIG,
} = require('../scripts/hallucination-config.cjs');

// =============================================================================
// DEFAULT_WEIGHTS
// =============================================================================
describe('DEFAULT_WEIGHTS', () => {
  it('has the expected 5 categories', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(DEFAULT_WEIGHTS).not.toHaveProperty('fabricated_source');
    expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(5);
  });

  it('values sum to 1.3 (evaluative_design_claim: 0.4 added to base 0.9)', () => {
    // aggregateWeightedScore normalizes by weightSum, so aggregate scores remain in [0, 1].
    // fabricated_source (0.1) removed — reserved for future implementation (issue #18).
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.3)).toBeLessThan(1e-9);
  });
});

// =============================================================================
// DEFAULT_THRESHOLDS
// =============================================================================
describe('DEFAULT_THRESHOLDS', () => {
  it('has uncertain: 0.3', () => {
    expect(DEFAULT_THRESHOLDS.uncertain).toBe(0.3);
  });

  it('has hallucinated: 0.6', () => {
    expect(DEFAULT_THRESHOLDS.hallucinated).toBe(0.6);
  });

  it('has exactly two keys: uncertain and hallucinated', () => {
    expect(Object.keys(DEFAULT_THRESHOLDS).sort()).toEqual(['hallucinated', 'uncertain']);
  });

  it('uncertain is less than hallucinated', () => {
    expect(DEFAULT_THRESHOLDS.uncertain).toBeLessThan(DEFAULT_THRESHOLDS.hallucinated);
  });
});

// =============================================================================
// DEFAULT_CONFIG
// =============================================================================
describe('DEFAULT_CONFIG', () => {
  it('has a weights property equal to DEFAULT_WEIGHTS', () => {
    expect(DEFAULT_CONFIG.weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('has a thresholds property equal to DEFAULT_THRESHOLDS', () => {
    expect(DEFAULT_CONFIG.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('has introspect: false', () => {
    expect(DEFAULT_CONFIG.introspect).toBe(false);
  });

  it('has introspectOutputPath: null', () => {
    expect(DEFAULT_CONFIG.introspectOutputPath).toBeNull();
  });
});

// =============================================================================
// loadConfig — defaults only (no rc file)
// =============================================================================
describe('loadConfig', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-cfg-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no rc file exists', () => {
    const config = loadConfig();
    expect(config.weights).toEqual(DEFAULT_WEIGHTS);
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.introspect).toBe(false);
    expect(config.introspectOutputPath).toBeNull();
  });

  it('config is frozen', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.weights)).toBe(true);
    expect(Object.isFrozen(config.thresholds)).toBe(true);
  });

  it('returns introspect: false by default', () => {
    const config = loadConfig();
    expect(config.introspect).toBe(false);
  });

  it('returns introspectOutputPath: null by default', () => {
    const config = loadConfig();
    expect(config.introspectOutputPath).toBeNull();
  });

  it('returns defaults when rc file throws on require (syntax error)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'this is not valid javascript }{{{',
    );
    const config = loadConfig();
    expect(config.weights).toEqual(DEFAULT_WEIGHTS);
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(config.introspect).toBe(false);
  });

  it('reads valid thresholds from rc file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: { uncertain: 0.2, hallucinated: 0.5 } };`,
    );
    const config = loadConfig();
    expect(config.thresholds.uncertain).toBe(0.2);
    expect(config.thresholds.hallucinated).toBe(0.5);
  });

  it('reads only uncertain threshold when hallucinated is omitted', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: { uncertain: 0.2 } };`,
    );
    const config = loadConfig();
    expect(config.thresholds.uncertain).toBe(0.2);
    expect(config.thresholds.hallucinated).toBe(DEFAULT_THRESHOLDS.hallucinated);
  });

  it('reads only hallucinated threshold when uncertain is omitted', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: { hallucinated: 0.8 } };`,
    );
    const config = loadConfig();
    expect(config.thresholds.uncertain).toBe(DEFAULT_THRESHOLDS.uncertain);
    expect(config.thresholds.hallucinated).toBe(0.8);
  });

  it('falls back to defaults when thresholds are inverted (uncertain > hallucinated)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: { uncertain: 0.8, hallucinated: 0.2 } };`,
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to defaults when threshold values are out of range', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: { uncertain: -1, hallucinated: 2 } };`,
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to defaults when thresholds is not an object', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { thresholds: 'invalid' };`,
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });
});

// =============================================================================
// loadWeights — defaults only (no rc file)
// =============================================================================
describe('loadWeights', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-wt-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_WEIGHTS when no rc file exists', () => {
    const weights = loadWeights();
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('returns an object with the same keys as DEFAULT_WEIGHTS', () => {
    const weights = loadWeights();
    const expectedKeys = Object.keys(DEFAULT_WEIGHTS).sort();
    const actualKeys = Object.keys(weights).sort();
    expect(actualKeys).toEqual(expectedKeys);
  });
});
