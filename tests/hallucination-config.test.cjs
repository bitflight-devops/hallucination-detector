'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  loadWeights,
  mergeConfig,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
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
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('internal_contradiction');
    expect(DEFAULT_WEIGHTS).not.toHaveProperty('fabricated_source');
    expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(6);
  });

  it('values sum to 1.65 (internal_contradiction: 0.35 added to base 1.3)', () => {
    // aggregateWeightedScore normalizes by weightSum, so aggregate scores remain in [0, 1].
    // fabricated_source (0.1) removed — reserved for future implementation (issue #18).
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1.65)).toBeLessThan(1e-9);
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

  it('is exported from hallucination-config.cjs', () => {
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `hd-thresh-test-${Date.now()}-`));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_THRESHOLDS when no rc file exists', () => {
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('loads a valid threshold pair from rc file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.2, hallucinated: 0.7 } };',
    );
    const config = loadConfig();
    expect(config.thresholds.uncertain).toBe(0.2);
    expect(config.thresholds.hallucinated).toBe(0.7);
  });

  it('falls back to DEFAULT_THRESHOLDS when uncertain > hallucinated (inverted)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.8, hallucinated: 0.4 } };',
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when uncertain is out of range', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: -0.1, hallucinated: 0.6 } };',
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('falls back to DEFAULT_THRESHOLDS when hallucinated is out of range', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { thresholds: { uncertain: 0.3, hallucinated: 1.5 } };',
    );
    const config = loadConfig();
    expect(config.thresholds).toEqual(DEFAULT_THRESHOLDS);
  });

  it('thresholds are preserved in frozen config', () => {
    const config = loadConfig();
    expect(Object.isFrozen(config.thresholds)).toBe(true);
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
