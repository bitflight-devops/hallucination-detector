'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
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
  it('has the expected 5 categories', () => {
    assert.ok('speculation_language' in DEFAULT_WEIGHTS);
    assert.ok('causality_language' in DEFAULT_WEIGHTS);
    assert.ok('pseudo_quantification' in DEFAULT_WEIGHTS);
    assert.ok('completeness_claim' in DEFAULT_WEIGHTS);
    assert.ok('fabricated_source' in DEFAULT_WEIGHTS);
    assert.equal(Object.keys(DEFAULT_WEIGHTS).length, 5);
  });

  it('values sum to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `Expected sum ~1.0, got ${sum}`);
  });
});

// =============================================================================
// DEFAULT_CONFIG
// =============================================================================
describe('DEFAULT_CONFIG', () => {
  it('has a weights property equal to DEFAULT_WEIGHTS', () => {
    assert.deepEqual(DEFAULT_CONFIG.weights, DEFAULT_WEIGHTS);
  });

  it('has introspect: false', () => {
    assert.equal(DEFAULT_CONFIG.introspect, false);
  });

  it('has introspectOutputPath: null', () => {
    assert.equal(DEFAULT_CONFIG.introspectOutputPath, null);
  });
});

// =============================================================================
// loadConfig — defaults only (no rc file)
// =============================================================================
describe('loadConfig', () => {
  let tmpDir;
  let originalCwd;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-cfg-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no rc file exists', () => {
    const config = loadConfig();
    assert.deepEqual(config.weights, DEFAULT_WEIGHTS);
    assert.equal(config.introspect, false);
    assert.equal(config.introspectOutputPath, null);
  });

  it('config is frozen', () => {
    const config = loadConfig();
    assert.ok(Object.isFrozen(config));
  });

  it('returns introspect: false by default', () => {
    const config = loadConfig();
    assert.equal(config.introspect, false);
  });

  it('returns introspectOutputPath: null by default', () => {
    const config = loadConfig();
    assert.equal(config.introspectOutputPath, null);
  });
});

// =============================================================================
// loadWeights — defaults only (no rc file)
// =============================================================================
describe('loadWeights', () => {
  let tmpDir;
  let originalCwd;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-wt-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_WEIGHTS when no rc file exists', () => {
    const weights = loadWeights();
    assert.deepEqual(weights, DEFAULT_WEIGHTS);
  });

  it('returns an object with the same keys as DEFAULT_WEIGHTS', () => {
    const weights = loadWeights();
    const expectedKeys = Object.keys(DEFAULT_WEIGHTS).sort();
    const actualKeys = Object.keys(weights).sort();
    assert.deepEqual(actualKeys, expectedKeys);
  });
});
