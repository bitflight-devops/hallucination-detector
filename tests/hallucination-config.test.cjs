'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  loadWeights,
  DEFAULT_WEIGHTS,
  DEFAULT_CONFIG,
} = require('../scripts/hallucination-config.cjs');

// =============================================================================
// DEFAULT_WEIGHTS
// =============================================================================
describe('DEFAULT_WEIGHTS', () => {
  it('has the expected 6 categories', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('fabricated_source');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(6);
  });

  it('values sum to 1.4 (evaluative_design_claim: 0.4 added to base 1.0)', () => {
    // aggregateWeightedScore normalizes by weightSum, so aggregate scores remain in [0, 1].
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.4)).toBeLessThan(1e-9);
  });
});

// =============================================================================
// DEFAULT_CONFIG
// =============================================================================
describe('DEFAULT_CONFIG', () => {
  it('has a weights property equal to DEFAULT_WEIGHTS', () => {
    expect(DEFAULT_CONFIG.weights).toEqual(DEFAULT_WEIGHTS);
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
    expect(config.introspect).toBe(false);
    expect(config.introspectOutputPath).toBeNull();
  });

  it('config is frozen', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.weights)).toBe(true);
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
    expect(config.introspect).toBe(false);
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
