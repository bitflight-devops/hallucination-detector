'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  loadWeights,
  mergeConfig,
  isValidCategoryThreshold,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
  getProjectConfigPath,
} = require('../scripts/hallucination-config.cjs');

// =============================================================================
// DEFAULT_WEIGHTS
// =============================================================================
describe('DEFAULT_WEIGHTS', () => {
  it('has the expected 8 categories', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('internal_contradiction');
    expect(DEFAULT_WEIGHTS).toHaveProperty('unsupported_absence');
    expect(DEFAULT_WEIGHTS).toHaveProperty('ungrounded_behavioral_assertion');
    expect(DEFAULT_WEIGHTS).not.toHaveProperty('fabricated_source');
    expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(8);
  });

  it('values sum to 2.85 (ungrounded_behavioral_assertion: 0.5 added to prior 2.35)', () => {
    // aggregateWeightedScore normalizes by weightSum, so aggregate scores remain in [0, 1].
    // fabricated_source (0.1) removed — reserved for future implementation (issue #18).
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 2.85)).toBeLessThan(1e-9);
  });

  it('internal_contradiction weight is 0.35', () => {
    expect(DEFAULT_WEIGHTS.internal_contradiction).toBe(0.35);
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

// =============================================================================
// DEFAULT_CONFIG — new fields
// =============================================================================
describe('DEFAULT_CONFIG new fields', () => {
  it('has severity: "error"', () => {
    expect(DEFAULT_CONFIG.severity).toBe('error');
  });

  it('has maxTriggersPerResponse: 20', () => {
    expect(DEFAULT_CONFIG.maxTriggersPerResponse).toBe(20);
  });

  it('has maxBlocksPerSession: null', () => {
    expect(DEFAULT_CONFIG.maxBlocksPerSession).toBeNull();
  });

  it('has outputFormat: "text"', () => {
    expect(DEFAULT_CONFIG.outputFormat).toBe('text');
  });

  it('has debug: false', () => {
    expect(DEFAULT_CONFIG.debug).toBe(false);
  });

  it('has empty categories object', () => {
    expect(DEFAULT_CONFIG.categories).toEqual({});
  });

  it('has empty allowlist array', () => {
    expect(Array.isArray(DEFAULT_CONFIG.allowlist)).toBe(true);
    expect(DEFAULT_CONFIG.allowlist).toHaveLength(0);
  });

  it('has includeContext: true', () => {
    expect(DEFAULT_CONFIG.includeContext).toBe(true);
  });

  it('has contextLines: 2', () => {
    expect(DEFAULT_CONFIG.contextLines).toBe(2);
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

  it('has exactly 2 keys', () => {
    expect(Object.keys(DEFAULT_THRESHOLDS).length).toBe(2);
  });

  it('DEFAULT_THRESHOLDS is an object', () => {
    expect(typeof DEFAULT_THRESHOLDS).toBe('object');
  });
});

// =============================================================================
// loadConfig — zero-config produces defaults
// =============================================================================
describe('loadConfig zero-config', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-zc-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('zero-config produces the same defaults as DEFAULT_CONFIG', () => {
    const config = loadConfig();
    expect(config.severity).toBe(DEFAULT_CONFIG.severity);
    expect(config.maxTriggersPerResponse).toBe(DEFAULT_CONFIG.maxTriggersPerResponse);
    expect(config.outputFormat).toBe(DEFAULT_CONFIG.outputFormat);
    expect(config.debug).toBe(DEFAULT_CONFIG.debug);
    expect(config.includeContext).toBe(DEFAULT_CONFIG.includeContext);
    expect(config.contextLines).toBe(DEFAULT_CONFIG.contextLines);
    expect(config.allowlist).toEqual(DEFAULT_CONFIG.allowlist);
    expect(config.categories).toEqual(DEFAULT_CONFIG.categories);
  });
});

// =============================================================================
// loadConfig — project.json source
// =============================================================================
describe('loadConfig from project.json', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-pj-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads hallucination-detector key from project.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { debug: true, severity: 'warning' } }),
    );
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.severity).toBe('warning');
  });

  it('ignores project.json when hallucination-detector key is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'), JSON.stringify({ name: 'my-project' }));
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });

  it('ignores project.json with invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'project.json'), '{ invalid json ]]]');
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });
});

// =============================================================================
// loadConfig — pyproject.toml source
// =============================================================================
describe('loadConfig from pyproject.toml', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-toml-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('reads [tool.hallucination-detector] section from pyproject.toml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.hallucination-detector]\ndebug = true\nseverity = "warning"\n',
    );
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.severity).toBe('warning');
  });

  it('ignores pyproject.toml when section is absent', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.black]\nline-length = 88\n');
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });

  it('reads integer values from pyproject.toml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.hallucination-detector]\nmaxTriggersPerResponse = 5\ncontextLines = 3\n',
    );
    const config = loadConfig();
    expect(config.maxTriggersPerResponse).toBe(5);
    expect(config.contextLines).toBe(3);
  });

  it('reads array values from pyproject.toml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[tool.hallucination-detector]\nallowlist = ["probably", "likely"]\n',
    );
    const config = loadConfig();
    expect(config.allowlist).toEqual(['probably', 'likely']);
  });

  it('gracefully handles malformed pyproject.toml', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), 'not = [toml');
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });
});

// =============================================================================
// loadConfig — HALLUCINATION_DETECTOR_CONFIG env var
// =============================================================================
describe('loadConfig from HALLUCINATION_DETECTOR_CONFIG env var', () => {
  let tmpDir;
  let originalCwd;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-env-test-${Date.now()}-`));
    originalCwd = process.cwd();
    originalEnv = process.env.HALLUCINATION_DETECTOR_CONFIG;
    process.chdir(tmpDir);
    delete process.env.HALLUCINATION_DETECTOR_CONFIG;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalEnv === undefined) {
      delete process.env.HALLUCINATION_DETECTOR_CONFIG;
    } else {
      process.env.HALLUCINATION_DETECTOR_CONFIG = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('loads JSON config from env var path', () => {
    const cfgPath = path.join(tmpDir, 'custom-config.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ debug: true, severity: 'info' }));
    process.env.HALLUCINATION_DETECTOR_CONFIG = cfgPath;
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.severity).toBe('info');
  });

  it('loads CJS config from env var path', () => {
    const cfgPath = path.join(tmpDir, `custom-${Date.now()}.cjs`);
    fs.writeFileSync(cfgPath, 'module.exports = { debug: true, maxTriggersPerResponse: 5 };');
    process.env.HALLUCINATION_DETECTOR_CONFIG = cfgPath;
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.maxTriggersPerResponse).toBe(5);
  });

  it('loads TOML config from env var path', () => {
    const cfgPath = path.join(tmpDir, 'custom.toml');
    fs.writeFileSync(cfgPath, 'debug = true\nseverity = "warning"\n');
    process.env.HALLUCINATION_DETECTOR_CONFIG = cfgPath;
    const config = loadConfig();
    expect(config.debug).toBe(true);
    expect(config.severity).toBe('warning');
  });

  it('env var config takes priority over project.json', () => {
    // project.json sets severity=warning; env var sets severity=info
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { severity: 'warning' } }),
    );
    const cfgPath = path.join(tmpDir, 'override.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ severity: 'info' }));
    process.env.HALLUCINATION_DETECTOR_CONFIG = cfgPath;
    const config = loadConfig();
    expect(config.severity).toBe('info');
  });

  it('falls back to defaults when env var path does not exist', () => {
    process.env.HALLUCINATION_DETECTOR_CONFIG = path.join(tmpDir, 'does-not-exist.json');
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });
});

// =============================================================================
// loadConfig — home directory source
// =============================================================================
describe('loadConfig from home directory', () => {
  let tmpDir;
  let tmpHome;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-home-test-${Date.now()}-`));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `hd-homedir-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('reads .hallucination-detectorrc.cjs from home directory (_opts._homeDir)', () => {
    const homeRcPath = path.join(tmpHome, '.hallucination-detectorrc.cjs');
    fs.writeFileSync(homeRcPath, 'module.exports = { debug: true };');
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.debug).toBe(true);
  });

  it('home dir config is overridden by project.json', () => {
    const homeRcPath = path.join(tmpHome, '.hallucination-detectorrc.cjs');
    fs.writeFileSync(homeRcPath, 'module.exports = { severity: "warning" };');
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { severity: 'info' } }),
    );
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.severity).toBe('info');
  });

  it('gracefully handles parse error in home rc file', () => {
    const homeRcPath = path.join(tmpHome, '.hallucination-detectorrc.cjs');
    fs.writeFileSync(homeRcPath, 'this is { not valid cjs }{{{');
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.debug).toBe(false);
  });
});

// =============================================================================
// mergeConfig — deep merge behaviour
// =============================================================================
describe('mergeConfig', () => {
  it('is exported from hallucination-config.cjs', () => {
    expect(typeof mergeConfig).toBe('function');
  });

  it('returns base when override is empty', () => {
    const base = { a: 1, b: 2 };
    expect(mergeConfig(base, {})).toEqual(base);
  });

  it('override wins for scalar properties', () => {
    const merged = mergeConfig({ severity: 'error' }, { severity: 'warning' });
    expect(merged.severity).toBe('warning');
  });

  it('preserves base properties not present in override', () => {
    const merged = mergeConfig({ a: 1, b: 2 }, { b: 99 });
    expect(merged.a).toBe(1);
    expect(merged.b).toBe(99);
  });

  it('merges nested plain objects recursively', () => {
    const base = { weights: { speculation_language: 0.25, causality_language: 0.3 } };
    const override = { weights: { speculation_language: 0.5 } };
    const merged = mergeConfig(base, override);
    expect(merged.weights.speculation_language).toBe(0.5);
    expect(merged.weights.causality_language).toBe(0.3);
  });

  it('replaces non-customPatterns arrays (allowlist, ignorePatterns)', () => {
    const base = { allowlist: ['probably', 'likely'] };
    const override = { allowlist: ['maybe'] };
    const merged = mergeConfig(base, override);
    expect(merged.allowlist).toEqual(['maybe']);
  });

  it('concatenates customPatterns by default', () => {
    const base = {
      categories: {
        speculation_language: {
          customPatterns: [{ pattern: 'pat1', evidence: 'pat1' }],
        },
      },
    };
    const override = {
      categories: {
        speculation_language: {
          customPatterns: [{ pattern: 'pat2', evidence: 'pat2' }],
        },
      },
    };
    const merged = mergeConfig(base, override);
    expect(merged.categories.speculation_language.customPatterns).toHaveLength(2);
    expect(merged.categories.speculation_language.customPatterns[0].pattern).toBe('pat1');
    expect(merged.categories.speculation_language.customPatterns[1].pattern).toBe('pat2');
  });

  it('replaces customPatterns when replacePatterns: true in override', () => {
    const base = {
      categories: {
        speculation_language: {
          customPatterns: [{ pattern: 'pat1', evidence: 'pat1' }],
        },
      },
    };
    const override = {
      categories: {
        speculation_language: {
          replacePatterns: true,
          customPatterns: [{ pattern: 'pat2', evidence: 'pat2' }],
        },
      },
    };
    const merged = mergeConfig(base, override);
    expect(merged.categories.speculation_language.customPatterns).toHaveLength(1);
    expect(merged.categories.speculation_language.customPatterns[0].pattern).toBe('pat2');
  });

  it('handles override with null override gracefully', () => {
    const base = { severity: 'error' };
    expect(mergeConfig(base, null)).toBe(base);
  });

  it('handles base being null / undefined', () => {
    const override = { severity: 'warning' };
    expect(mergeConfig(null, override)).toBe(override);
  });

  it('does not mutate base or override', () => {
    const base = { allowlist: ['a'] };
    const override = { allowlist: ['b'] };
    mergeConfig(base, override);
    expect(base.allowlist).toEqual(['a']);
    expect(override.allowlist).toEqual(['b']);
  });
});

// =============================================================================
// Schema validation — invalid values fall back to defaults with stderr warning
// =============================================================================
describe('schema validation', () => {
  let tmpDir;
  let originalCwd;
  let stderrOutput;
  let originalStderrWrite;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-val-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    stderrOutput = '';
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg) => {
      stderrOutput += msg;
      return true;
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.stderr.write = originalStderrWrite;
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('invalid severity falls back to "error" with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { severity: 'critical' } }),
    );
    const config = loadConfig();
    expect(config.severity).toBe('error');
    expect(stderrOutput).toContain('severity');
    expect(stderrOutput).toContain('critical');
  });

  it('invalid outputFormat falls back to "text" with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { outputFormat: 'xml' } }),
    );
    const config = loadConfig();
    expect(config.outputFormat).toBe('text');
    expect(stderrOutput).toContain('outputFormat');
  });

  it('invalid maxTriggersPerResponse falls back to 20 with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { maxTriggersPerResponse: -5 } }),
    );
    const config = loadConfig();
    expect(config.maxTriggersPerResponse).toBe(20);
    expect(stderrOutput).toContain('maxTriggersPerResponse');
  });

  it('invalid debug value falls back to false with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { debug: 'yes' } }),
    );
    const config = loadConfig();
    expect(config.debug).toBe(false);
    expect(stderrOutput).toContain('debug');
  });

  it('invalid contextLines falls back to 2 with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { contextLines: -1 } }),
    );
    const config = loadConfig();
    expect(config.contextLines).toBe(2);
    expect(stderrOutput).toContain('contextLines');
  });

  it('valid config values produce no stderr warnings', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          severity: 'warning',
          outputFormat: 'json',
          maxTriggersPerResponse: 10,
          debug: true,
          contextLines: 4,
        },
      }),
    );
    loadConfig();
    expect(stderrOutput).toBe('');
  });
});

// =============================================================================
// loadConfig — threshold loading
// =============================================================================
describe('loadConfig thresholds', () => {
  let tmpDir;
  let originalCwd;
  let savedEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-thresh-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    savedEnv = process.env.HALLUCINATION_DETECTOR_CONFIG;
    delete process.env.HALLUCINATION_DETECTOR_CONFIG;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (savedEnv !== undefined) process.env.HALLUCINATION_DETECTOR_CONFIG = savedEnv;
    else delete process.env.HALLUCINATION_DETECTOR_CONFIG;
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_THRESHOLDS when no rc file exists', () => {
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('loads a valid threshold pair from rc file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.2, hallucinated: 0.7 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds.uncertain).toBe(0.2);
    expect(config.thresholds.hallucinated).toBe(0.7);
  });

  it('falls back to DEFAULT_THRESHOLDS when uncertain > hallucinated (inverted)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.8, hallucinated: 0.4 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when uncertain is out of range', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: -0.1, hallucinated: 0.6 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when hallucinated is out of range', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.3, hallucinated: 1.5 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('thresholds are preserved in frozen config', () => {
    const config = loadConfig({ _homeDir: tmpDir });
    expect(Object.isFrozen(config.thresholds)).toBe(true);
  });

  it('falls back to DEFAULT_THRESHOLDS when threshold values are non-numeric strings', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: "low", hallucinated: "high" } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when uncertain is NaN', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: NaN, hallucinated: 0.6 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when hallucinated is Infinity', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.3, hallucinated: Infinity } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when only the uncertain key is provided', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.2 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('accepts thresholds when uncertain === hallucinated', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.5, hallucinated: 0.5 } };',
    );
    const config = loadConfig({ _homeDir: tmpDir });
    expect(config.thresholds.uncertain).toBe(0.5);
    expect(config.thresholds.hallucinated).toBe(0.5);
  });
});

// =============================================================================
// Cascading priority — higher source overrides lower source
// =============================================================================
describe('loadConfig cascading priority', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-prio-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('.hallucination-detectorrc.cjs overrides project.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { severity: 'warning' } }),
    );
    const cwdRcPath = path.join(tmpDir, '.hallucination-detectorrc.cjs');
    fs.writeFileSync(cwdRcPath, 'module.exports = { severity: "info" };');
    const config = loadConfig();
    expect(config.severity).toBe('info');
  });

  it('pyproject.toml overrides home dir rc', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `hd-home2-${Date.now()}-`));
    try {
      fs.writeFileSync(
        path.join(tmpHome, '.hallucination-detectorrc.cjs'),
        'module.exports = { severity: "error" };',
      );
      fs.writeFileSync(
        path.join(tmpDir, 'pyproject.toml'),
        '[tool.hallucination-detector]\nseverity = "warning"\n',
      );
      const config = loadConfig({ _homeDir: tmpHome });
      expect(config.severity).toBe('warning');
    } finally {
      fs.rmSync(tmpHome, { recursive: true });
    }
  });
});

// =============================================================================
// New DEFAULT_CONFIG fields — warnOnly, ignoreCategories, blockSubagents, blockUserSessions
// =============================================================================
describe('DEFAULT_CONFIG new session-gating fields', () => {
  it('has warnOnly: false', () => {
    expect(DEFAULT_CONFIG.warnOnly).toBe(false);
  });

  it('has ignoreCategories: []', () => {
    expect(Array.isArray(DEFAULT_CONFIG.ignoreCategories)).toBe(true);
    expect(DEFAULT_CONFIG.ignoreCategories).toHaveLength(0);
  });

  it('has blockSubagents: false', () => {
    expect(DEFAULT_CONFIG.blockSubagents).toBe(false);
  });

  it('has blockUserSessions: true', () => {
    expect(DEFAULT_CONFIG.blockUserSessions).toBe(true);
  });
});

// =============================================================================
// getProjectConfigPath
// =============================================================================
describe('getProjectConfigPath', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.CLAUDE_PROJECT_DIR;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = savedEnv;
    }
  });

  it('returns null when CLAUDE_PROJECT_DIR is unset', () => {
    delete process.env.CLAUDE_PROJECT_DIR;
    expect(getProjectConfigPath()).toBeNull();
  });

  it('returns null when CLAUDE_PROJECT_DIR is empty string', () => {
    process.env.CLAUDE_PROJECT_DIR = '';
    expect(getProjectConfigPath()).toBeNull();
  });

  it('returns path joined with .hd/config.json when CLAUDE_PROJECT_DIR is set', () => {
    process.env.CLAUDE_PROJECT_DIR = '/some/project';
    const result = getProjectConfigPath();
    expect(result).toBe(path.join('/some/project', '.hd', 'config.json'));
  });
});

// =============================================================================
// loadConfig — project-level cascade ($CLAUDE_PROJECT_DIR/.hd/config.json)
// =============================================================================
describe('loadConfig project-level cascade', () => {
  let tmpDir;
  let tmpProject;
  let originalCwd;
  let savedProjectDir;
  let savedEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-proj-test-${Date.now()}-`));
    tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), `hd-projdir-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    savedEnv = process.env.HALLUCINATION_DETECTOR_CONFIG;
    delete process.env.HALLUCINATION_DETECTOR_CONFIG;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(tmpProject, { recursive: true });
    if (savedProjectDir === undefined) {
      delete process.env.CLAUDE_PROJECT_DIR;
    } else {
      process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
    }
    if (savedEnv === undefined) {
      delete process.env.HALLUCINATION_DETECTOR_CONFIG;
    } else {
      process.env.HALLUCINATION_DETECTOR_CONFIG = savedEnv;
    }
  });

  it('loads config from $CLAUDE_PROJECT_DIR/.hd/config.json', () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    const hdDir = path.join(tmpProject, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ debug: true }));
    const config = loadConfig();
    expect(config.debug).toBe(true);
  });

  it('project config overrides global ~/.hd/config.json', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `hd-home3-${Date.now()}-`));
    try {
      // Global sets severity=warning; project sets severity=info
      const globalHdDir = path.join(tmpHome, '.hd');
      fs.mkdirSync(globalHdDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalHdDir, 'config.json'),
        JSON.stringify({ severity: 'warning' }),
      );

      process.env.CLAUDE_PROJECT_DIR = tmpProject;
      const hdDir = path.join(tmpProject, '.hd');
      fs.mkdirSync(hdDir, { recursive: true });
      fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ severity: 'info' }));

      const config = loadConfig({ _homeDir: tmpHome });
      expect(config.severity).toBe('info');
    } finally {
      fs.rmSync(tmpHome, { recursive: true });
    }
  });

  it('HALLUCINATION_DETECTOR_CONFIG env var overrides project config', () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    const hdDir = path.join(tmpProject, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ severity: 'info' }));

    const envCfgPath = path.join(tmpDir, 'override.json');
    fs.writeFileSync(envCfgPath, JSON.stringify({ severity: 'warning' }));
    process.env.HALLUCINATION_DETECTOR_CONFIG = envCfgPath;

    const config = loadConfig();
    expect(config.severity).toBe('warning');
  });

  it('gracefully handles missing $CLAUDE_PROJECT_DIR/.hd/config.json', () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    // No .hd/config.json written — should fall back to defaults silently
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });

  it('gracefully handles invalid JSON in project config', () => {
    process.env.CLAUDE_PROJECT_DIR = tmpProject;
    const hdDir = path.join(tmpProject, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), '{ invalid json ]]]');
    const config = loadConfig();
    expect(config.debug).toBe(false);
  });

  it('project config arrays replace (not append) corresponding global arrays', () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `hd-home4-${Date.now()}-`));
    try {
      const globalHdDir = path.join(tmpHome, '.hd');
      fs.mkdirSync(globalHdDir, { recursive: true });
      fs.writeFileSync(
        path.join(globalHdDir, 'config.json'),
        JSON.stringify({ allowlist: ['probably', 'likely'] }),
      );

      process.env.CLAUDE_PROJECT_DIR = tmpProject;
      const hdDir = path.join(tmpProject, '.hd');
      fs.mkdirSync(hdDir, { recursive: true });
      fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ allowlist: ['maybe'] }));

      const config = loadConfig({ _homeDir: tmpHome });
      // Arrays replace — project value wins entirely, global value discarded
      expect(config.allowlist).toEqual(['maybe']);
    } finally {
      fs.rmSync(tmpHome, { recursive: true });
    }
  });
});

// =============================================================================
// loadConfig — global ~/.hd/config.json source
// =============================================================================
describe('loadConfig from global ~/.hd/config.json', () => {
  let tmpDir;
  let tmpHome;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-ghd-test-${Date.now()}-`));
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), `hd-ghddir-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
    fs.rmSync(tmpHome, { recursive: true });
  });

  it('reads ~/.hd/config.json via _homeDir option', () => {
    const hdDir = path.join(tmpHome, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ debug: true }));
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.debug).toBe(true);
  });

  it('project.json overrides ~/.hd/config.json', () => {
    const hdDir = path.join(tmpHome, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), JSON.stringify({ severity: 'warning' }));
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { severity: 'info' } }),
    );
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.severity).toBe('info');
  });

  it('gracefully handles invalid JSON in ~/.hd/config.json', () => {
    const hdDir = path.join(tmpHome, '.hd');
    fs.mkdirSync(hdDir, { recursive: true });
    fs.writeFileSync(path.join(hdDir, 'config.json'), '{ not valid ]');
    const config = loadConfig({ _homeDir: tmpHome });
    expect(config.debug).toBe(false);
  });
});

// =============================================================================
// schema validation — new fields
// =============================================================================
describe('schema validation for new session-gating fields', () => {
  let tmpDir;
  let originalCwd;
  let stderrOutput;
  let originalStderrWrite;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-newval-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    stderrOutput = '';
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (msg) => {
      stderrOutput += msg;
      return true;
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.stderr.write = originalStderrWrite;
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('invalid warnOnly falls back to false with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { warnOnly: 'yes' } }),
    );
    const config = loadConfig();
    expect(config.warnOnly).toBe(false);
    expect(stderrOutput).toContain('warnOnly');
  });

  it('invalid blockSubagents falls back to false with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { blockSubagents: 1 } }),
    );
    const config = loadConfig();
    expect(config.blockSubagents).toBe(false);
    expect(stderrOutput).toContain('blockSubagents');
  });

  it('invalid blockUserSessions falls back to true with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { blockUserSessions: 'no' } }),
    );
    const config = loadConfig();
    expect(config.blockUserSessions).toBe(true);
    expect(stderrOutput).toContain('blockUserSessions');
  });

  it('invalid ignoreCategories (non-array) falls back to [] with a stderr warning', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { ignoreCategories: 'speculation_language' } }),
    );
    const config = loadConfig();
    expect(config.ignoreCategories).toEqual([]);
    expect(stderrOutput).toContain('ignoreCategories');
  });

  it('valid array ignoreCategories is accepted without warnings', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          ignoreCategories: ['speculation_language', 'causality_language'],
        },
      }),
    );
    const config = loadConfig();
    expect(config.ignoreCategories).toEqual(['speculation_language', 'causality_language']);
    expect(stderrOutput).toBe('');
  });
});

// =============================================================================
// per-category thresholds
// =============================================================================
describe('per-category thresholds', () => {
  // --- DEFAULT_CONFIG.categories ---
  it('DEFAULT_CONFIG.categories is an empty object', () => {
    expect(DEFAULT_CONFIG.categories).toEqual({});
  });

  // --- isValidCategoryThreshold ---
  describe('isValidCategoryThreshold', () => {
    it('returns true for a valid { uncertain: 0.3, hallucinated: 0.6 } pair', () => {
      expect(isValidCategoryThreshold({ uncertain: 0.3, hallucinated: 0.6 })).toBe(true);
    });

    it('returns false when uncertain > hallucinated (inverted pair)', () => {
      expect(isValidCategoryThreshold({ uncertain: 0.7, hallucinated: 0.3 })).toBe(false);
    });

    it('returns false when uncertain is out of range (> 1)', () => {
      expect(isValidCategoryThreshold({ uncertain: 1.5, hallucinated: 0.6 })).toBe(false);
    });

    it('returns false when hallucinated field is missing', () => {
      expect(isValidCategoryThreshold({ uncertain: 0.3 })).toBe(false);
    });

    it('returns false when uncertain is a non-numeric string', () => {
      expect(isValidCategoryThreshold({ uncertain: 'bad', hallucinated: 0.6 })).toBe(false);
    });

    it('returns false for null input', () => {
      expect(isValidCategoryThreshold(null)).toBe(false);
    });

    it('returns false for undefined input', () => {
      expect(isValidCategoryThreshold(undefined)).toBe(false);
    });

    it('returns true when uncertain === hallucinated (boundary)', () => {
      expect(isValidCategoryThreshold({ uncertain: 0.5, hallucinated: 0.5 })).toBe(true);
    });
  });

  // --- validateConfig categories via loadConfig ---
  describe('validateConfig categories via loadConfig', () => {
    let tmpDir;
    let originalCwd;
    let stderrOutput;
    let originalStderrWrite;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-cat-test-${Date.now()}-`));
      originalCwd = process.cwd();
      process.chdir(tmpDir);
      stderrOutput = '';
      originalStderrWrite = process.stderr.write.bind(process.stderr);
      process.stderr.write = (msg) => {
        stderrOutput += msg;
        return true;
      };
    });

    afterEach(() => {
      process.chdir(originalCwd);
      process.stderr.write = originalStderrWrite;
      fs.rmSync(tmpDir, { recursive: true });
    });

    it('valid category threshold entry is preserved in loaded config', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: {
              speculation_language: { uncertain: 0.5, hallucinated: 0.8 },
            },
          },
        }),
      );
      const config = loadConfig();
      expect(config.categories.speculation_language.uncertain).toBe(0.5);
      expect(config.categories.speculation_language.hallucinated).toBe(0.8);
      expect(stderrOutput).toBe('');
    });

    it('invalid threshold pair has threshold fields deleted but entry is otherwise preserved', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: {
              speculation_language: { uncertain: 'bad', hallucinated: 0.6, enabled: true },
            },
          },
        }),
      );
      const config = loadConfig();
      // Entry itself must be preserved
      expect(config.categories).toHaveProperty('speculation_language');
      expect(config.categories.speculation_language.enabled).toBe(true);
      // Threshold fields must be deleted
      expect(config.categories.speculation_language).not.toHaveProperty('uncertain');
      expect(config.categories.speculation_language).not.toHaveProperty('hallucinated');
      // Warning emitted referencing the category name
      expect(stderrOutput).toContain('speculation_language');
    });

    it('unknown category name entry is preserved with a warning (not stripped)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: {
              future_category: { uncertain: 0.4, hallucinated: 0.7 },
            },
          },
        }),
      );
      const config = loadConfig();
      // Entry is preserved despite being an unknown category name
      expect(config.categories).toHaveProperty('future_category');
      expect(config.categories.future_category.uncertain).toBe(0.4);
      expect(config.categories.future_category.hallucinated).toBe(0.7);
      // Warning emitted for the unknown name
      expect(stderrOutput).toContain('future_category');
    });

    it('categories: null causes field to fall back to default empty object with warning', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: null,
          },
        }),
      );
      const config = loadConfig();
      expect(config.categories).toEqual({});
      expect(stderrOutput).toContain('categories');
    });

    it('mixed valid and unknown entries are all preserved (unknown only warned)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: {
              speculation_language: { uncertain: 0.4, hallucinated: 0.7 },
              my_custom_category: { uncertain: 0.2, hallucinated: 0.5 },
            },
          },
        }),
      );
      const config = loadConfig();
      expect(config.categories.speculation_language.uncertain).toBe(0.4);
      expect(config.categories.my_custom_category.uncertain).toBe(0.2);
      // Warning for the unknown name only
      expect(stderrOutput).toContain('my_custom_category');
      expect(stderrOutput).not.toContain('speculation_language');
    });

    it('mutating a frozen per-category threshold throws TypeError', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'project.json'),
        JSON.stringify({
          'hallucination-detector': {
            categories: {
              speculation_language: { uncertain: 0.5, hallucinated: 0.8 },
            },
          },
        }),
      );
      const config = loadConfig();
      expect(() => {
        config.categories.speculation_language.uncertain = 999;
      }).toThrow(TypeError);
    });
  });

  // --- mergeConfig per-category threshold merging ---
  describe('mergeConfig per-category threshold merging', () => {
    it('project-level threshold overrides global-level threshold for the same category', () => {
      const base = {
        categories: {
          speculation_language: { uncertain: 0.3, hallucinated: 0.6 },
        },
      };
      const override = {
        categories: {
          speculation_language: { uncertain: 0.5, hallucinated: 0.8 },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.categories.speculation_language.uncertain).toBe(0.5);
      expect(merged.categories.speculation_language.hallucinated).toBe(0.8);
    });

    it('different category entries at each level are merged into a union', () => {
      const base = {
        categories: {
          speculation_language: { uncertain: 0.3, hallucinated: 0.6 },
        },
      };
      const override = {
        categories: {
          causality_language: { uncertain: 0.4, hallucinated: 0.7 },
        },
      };
      const merged = mergeConfig(base, override);
      expect(merged.categories).toHaveProperty('speculation_language');
      expect(merged.categories).toHaveProperty('causality_language');
      expect(merged.categories.speculation_language.uncertain).toBe(0.3);
      expect(merged.categories.causality_language.uncertain).toBe(0.4);
    });
  });
});

// =============================================================================
// DEFAULT_CONFIDENCE_WEIGHTS
// =============================================================================
describe('DEFAULT_CONFIDENCE_WEIGHTS', () => {
  it('has exactly 4 keys', () => {
    expect(Object.keys(DEFAULT_CONFIDENCE_WEIGHTS).length).toBe(4);
  });

  it('has patternStrength: 0.4', () => {
    expect(DEFAULT_CONFIDENCE_WEIGHTS.patternStrength).toBe(0.4);
  });

  it('has evidenceProximity: 0.25', () => {
    expect(DEFAULT_CONFIDENCE_WEIGHTS.evidenceProximity).toBe(0.25);
  });

  it('has categoryStacking: 0.2', () => {
    expect(DEFAULT_CONFIDENCE_WEIGHTS.categoryStacking).toBe(0.2);
  });

  it('has contextDensity: 0.15', () => {
    expect(DEFAULT_CONFIDENCE_WEIGHTS.contextDensity).toBe(0.15);
  });

  it('values sum to 1.0', () => {
    const sum = Object.values(DEFAULT_CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });
});

// =============================================================================
// DEFAULT_CONFIG — confidence scoring fields
// =============================================================================
describe('DEFAULT_CONFIG confidence scoring fields', () => {
  it('has confidenceWeights equal to DEFAULT_CONFIDENCE_WEIGHTS', () => {
    expect(DEFAULT_CONFIG.confidenceWeights).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
  });

  it('has reportingThreshold: 50', () => {
    expect(DEFAULT_CONFIG.reportingThreshold).toBe(50);
  });
});

// =============================================================================
// validateConfig — reportingThreshold
// =============================================================================
describe('validateConfig reportingThreshold', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-rt-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('accepts reportingThreshold: 0', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: 0 } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(0);
  });

  it('accepts reportingThreshold: 50', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: 50 } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });

  it('accepts reportingThreshold: 100', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: 100 } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(100);
  });

  it('rejects reportingThreshold: -5 and falls back to 50', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: -5 } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });

  it('rejects reportingThreshold: 101 and falls back to 50', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: 101 } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });

  it('rejects reportingThreshold: "high" and falls back to 50', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { reportingThreshold: 'high' } }),
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });

  it('rejects reportingThreshold: Infinity and falls back to 50', () => {
    // JSON cannot encode Infinity — use rc file for this case
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { reportingThreshold: Infinity };',
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });

  it('rejects reportingThreshold: NaN and falls back to 50', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { reportingThreshold: NaN };',
    );
    const config = loadConfig();
    expect(config.reportingThreshold).toBe(50);
  });
});

// =============================================================================
// validateConfig — confidenceWeights
// =============================================================================
describe('validateConfig confidenceWeights', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-cw-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('accepts a valid confidenceWeights object', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          confidenceWeights: {
            patternStrength: 0.5,
            evidenceProximity: 0.2,
            categoryStacking: 0.2,
            contextDensity: 0.1,
          },
        },
      }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights.patternStrength).toBe(0.5);
    expect(config.confidenceWeights.evidenceProximity).toBe(0.2);
    expect(config.confidenceWeights.categoryStacking).toBe(0.2);
    expect(config.confidenceWeights.contextDensity).toBe(0.1);
  });

  it('rejects non-object confidenceWeights and falls back to defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { confidenceWeights: 'strong' } }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
  });

  it('rejects array confidenceWeights and falls back to defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({ 'hallucination-detector': { confidenceWeights: [0.4, 0.25, 0.2, 0.15] } }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights).toEqual(DEFAULT_CONFIDENCE_WEIGHTS);
  });

  it('rejects individual key outside [0,1] and falls back that key to default', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          confidenceWeights: { patternStrength: 1.5 },
        },
      }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights.patternStrength).toBe(
      DEFAULT_CONFIDENCE_WEIGHTS.patternStrength,
    );
  });

  it('rejects negative key value and falls back that key to default', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          confidenceWeights: { evidenceProximity: -0.1 },
        },
      }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights.evidenceProximity).toBe(
      DEFAULT_CONFIDENCE_WEIGHTS.evidenceProximity,
    );
  });

  it('preserves unknown keys in confidenceWeights', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { confidenceWeights: { patternStrength: 0.3, futureKey: 0.5 } };',
    );
    const config = loadConfig();
    expect(config.confidenceWeights.patternStrength).toBe(0.3);
    expect(config.confidenceWeights.futureKey).toBe(0.5);
  });

  it('partial override fills missing keys from defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'project.json'),
      JSON.stringify({
        'hallucination-detector': {
          confidenceWeights: { patternStrength: 0.6 },
        },
      }),
    );
    const config = loadConfig();
    expect(config.confidenceWeights.patternStrength).toBe(0.6);
    expect(config.confidenceWeights.evidenceProximity).toBe(
      DEFAULT_CONFIDENCE_WEIGHTS.evidenceProximity,
    );
    expect(config.confidenceWeights.categoryStacking).toBe(
      DEFAULT_CONFIDENCE_WEIGHTS.categoryStacking,
    );
    expect(config.confidenceWeights.contextDensity).toBe(DEFAULT_CONFIDENCE_WEIGHTS.contextDensity);
  });
});

// =============================================================================
// loadConfig — confidenceWeights merge behaviour
// =============================================================================
describe('loadConfig confidenceWeights merge', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-cwm-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns all 4 default keys when no user config provided', () => {
    const config = loadConfig();
    expect(Object.keys(config.confidenceWeights).length).toBeGreaterThanOrEqual(4);
    expect(config.confidenceWeights).toMatchObject(DEFAULT_CONFIDENCE_WEIGHTS);
  });

  it('confidenceWeights is frozen', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config.confidenceWeights)).toBe(true);
  });
});
