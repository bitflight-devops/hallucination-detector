#!/usr/bin/env node
/**
 * Shared configuration loader for hallucination-detector hooks.
 * Zero dependencies — Node.js built-ins only.
 *
 * Supports cascading configuration from multiple sources (highest priority first):
 *   1. HALLUCINATION_DETECTOR_CONFIG env var → file path to any supported format
 *   2. .hallucination-detectorrc.cjs in process.cwd()
 *   3. project.json → hallucination-detector key
 *   4. pyproject.toml → [tool.hallucination-detector] section
 *   5. ~/.hallucination-detectorrc.cjs (home directory)
 *   6. Built-in defaults
 *
 * Any parse error in a config source is silently ignored (falls back to
 * lower-priority sources or defaults). The returned config object is deeply frozen.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
} = require('./hallucination-config-defaults.cjs');

const { parseToml } = require('./hallucination-config-toml.cjs');

const { mergeConfig, deepFreeze } = require('./hallucination-config-merge.cjs');

const {
  validateConfig,
  isValidThresholds,
  isValidCategoryThreshold,
} = require('./hallucination-config-validate.cjs');

// ============================================================================
// Source loaders
// ============================================================================

/**
 * Load a CJS module at the given path via `require()`.
 * Returns `null` on any error (file not found, syntax error, etc.).
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadCjsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    // eslint-disable-next-line import/no-dynamic-require
    return require(filePath);
  } catch {
    return null;
  }
}

/**
 * Load a JSON file and return its parsed content.
 * Returns `null` on any error.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a TOML file and return its parsed content.
 * Returns `null` on any error.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadTomlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseToml(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Load a config file by inferring format from its extension.
 * Supported extensions: `.cjs`, `.js`, `.json`, `.toml`.
 * Returns `null` for unknown extensions or on any error.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadFileByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.cjs' || ext === '.js') return loadCjsFile(filePath);
  if (ext === '.json') return loadJsonFile(filePath);
  if (ext === '.toml') return loadTomlFile(filePath);
  return null;
}

/**
 * Load the `hallucination-detector` key from a `project.json` file.
 * Returns `null` if the file is absent, unparseable, or lacks the key.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadProjectJsonConfig(filePath) {
  const data = loadJsonFile(filePath);
  if (!data || typeof data !== 'object') return null;
  const val = data['hallucination-detector'];
  return val && typeof val === 'object' && !Array.isArray(val) ? val : null;
}

/**
 * Load the `[tool.hallucination-detector]` section from a `pyproject.toml` file.
 * Returns `null` if the file is absent, unparseable, or the section is missing.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function loadPyprojectConfig(filePath) {
  const data = loadTomlFile(filePath);
  if (!data || typeof data !== 'object') return null;
  const tool = data.tool;
  if (!tool || typeof tool !== 'object') return null;
  const val = tool['hallucination-detector'];
  return val && typeof val === 'object' && !Array.isArray(val) ? val : null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Return the resolved path to the project-level config file, or null when
 * `CLAUDE_PROJECT_DIR` is unset or empty.
 *
 * The project-level config lives at `$CLAUDE_PROJECT_DIR/.hd/config.json` and
 * is the new highest-priority source below the explicit env-var override.
 *
 * Exported for testing.
 *
 * @returns {string|null}
 */
function getProjectConfigPath() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir || typeof projectDir !== 'string' || !projectDir.trim()) return null;
  return path.join(projectDir, '.hd', 'config.json');
}

/**
 * Load and validate the full configuration using a cascading source chain.
 * Returns a deeply-frozen config object.
 *
 * Sources (highest priority first):
 *   1. `HALLUCINATION_DETECTOR_CONFIG` env var → file path
 *   2. `$CLAUDE_PROJECT_DIR/.hd/config.json` (project-level override)
 *   3. `.hallucination-detectorrc.cjs` in `process.cwd()`
 *   4. `project.json` → `hallucination-detector` key
 *   5. `pyproject.toml` → `[tool.hallucination-detector]` section
 *   6. `~/.hd/config.json` (global user config)
 *   7. `~/.hallucination-detectorrc.cjs`
 *   8. Built-in defaults
 *
 * @param {object} [_opts]              - Internal options (used by tests only).
 * @param {string} [_opts._homeDir]     - Override home directory path.
 * @returns {object} Frozen config object.
 */
function loadConfig(_opts) {
  const homeDir = _opts?._homeDir ? _opts._homeDir : os.homedir();
  const cwd = process.cwd();

  // Collect source configs in ascending priority order (lowest → highest).
  // We merge them into the defaults in this order so the last write wins.
  const sources = [];

  // Priority 7: ~/.hallucination-detectorrc.cjs
  const homeRc = loadCjsFile(path.join(homeDir, '.hallucination-detectorrc.cjs'));
  if (homeRc && typeof homeRc === 'object') {
    sources.push(validateConfig({ ...homeRc }, '~/.hallucination-detectorrc.cjs'));
  }

  // Priority 6: ~/.hd/config.json (global user config)
  const globalHdConfig = loadJsonFile(path.join(homeDir, '.hd', 'config.json'));
  if (globalHdConfig && typeof globalHdConfig === 'object') {
    sources.push(validateConfig({ ...globalHdConfig }, '~/.hd/config.json'));
  }

  // Priority 5: pyproject.toml → [tool.hallucination-detector]
  const pyprojectCfg = loadPyprojectConfig(path.join(cwd, 'pyproject.toml'));
  if (pyprojectCfg) {
    sources.push(validateConfig({ ...pyprojectCfg }, 'pyproject.toml'));
  }

  // Priority 4: project.json → hallucination-detector key
  const projectJsonCfg = loadProjectJsonConfig(path.join(cwd, 'project.json'));
  if (projectJsonCfg) {
    sources.push(validateConfig({ ...projectJsonCfg }, 'project.json'));
  }

  // Priority 3: .hallucination-detectorrc.cjs in cwd
  const cwdRc = loadCjsFile(path.join(cwd, '.hallucination-detectorrc.cjs'));
  if (cwdRc && typeof cwdRc === 'object') {
    sources.push(validateConfig({ ...cwdRc }, '.hallucination-detectorrc.cjs'));
  }

  // Priority 2: $CLAUDE_PROJECT_DIR/.hd/config.json (project-level override)
  const projectCfgPath = getProjectConfigPath();
  if (projectCfgPath) {
    const projectCfg = loadJsonFile(projectCfgPath);
    if (projectCfg && typeof projectCfg === 'object') {
      sources.push(validateConfig({ ...projectCfg }, '$CLAUDE_PROJECT_DIR/.hd/config.json'));
    }
  }

  // Priority 1: HALLUCINATION_DETECTOR_CONFIG env var
  const envPath = process.env.HALLUCINATION_DETECTOR_CONFIG;
  if (envPath) {
    const envRc = loadFileByExt(envPath);
    if (envRc && typeof envRc === 'object') {
      sources.push(validateConfig({ ...envRc }, `HALLUCINATION_DETECTOR_CONFIG (${envPath})`));
    }
  }

  // Merge all sources on top of the built-in defaults.
  let config = {
    ...DEFAULT_CONFIG,
    weights: { ...DEFAULT_WEIGHTS },
    thresholds: { ...DEFAULT_THRESHOLDS },
    confidenceWeights: { ...DEFAULT_CONFIDENCE_WEIGHTS },
    categories: {},
    ignorePatterns: [],
    ignoreBlocks: [],
    evidenceMarkers: [],
    allowlist: [],
    responseTemplates: {},
  };

  for (const src of sources) {
    config = mergeConfig(config, src);
  }

  // Validate and normalise the weights field after all merges.
  const weights = { ...DEFAULT_WEIGHTS };
  if (config.weights && typeof config.weights === 'object' && !Array.isArray(config.weights)) {
    for (const category of Object.keys(DEFAULT_WEIGHTS)) {
      const val = config.weights[category];
      if (Number.isFinite(val) && val >= 0) {
        weights[category] = val;
      }
    }
  }
  config.weights = weights;

  // Validate and normalise the thresholds field after all merges.
  config.thresholds = isValidThresholds(config.thresholds)
    ? { uncertain: config.thresholds.uncertain, hallucinated: config.thresholds.hallucinated }
    : { ...DEFAULT_THRESHOLDS };

  // Validate and normalise confidenceWeights after all merges.
  // Preserve all keys from the merged object (unknown keys included), then
  // reset any recognized key that has an out-of-range value back to its default.
  if (
    config.confidenceWeights &&
    typeof config.confidenceWeights === 'object' &&
    !Array.isArray(config.confidenceWeights)
  ) {
    const confidenceWeights = { ...DEFAULT_CONFIDENCE_WEIGHTS, ...config.confidenceWeights };
    for (const key of Object.keys(DEFAULT_CONFIDENCE_WEIGHTS)) {
      const val = confidenceWeights[key];
      if (!Number.isFinite(val) || val < 0 || val > 1) {
        confidenceWeights[key] = DEFAULT_CONFIDENCE_WEIGHTS[key];
      }
    }
    config.confidenceWeights = confidenceWeights;
  } else {
    config.confidenceWeights = { ...DEFAULT_CONFIDENCE_WEIGHTS };
  }

  return deepFreeze(config);
}

/**
 * Load only weights — backward-compatible wrapper around `loadConfig()`.
 *
 * @returns {object} Validated weights map.
 */
function loadWeights() {
  return loadConfig().weights;
}

module.exports = {
  loadConfig,
  loadWeights,
  mergeConfig,
  isValidThresholds,
  isValidCategoryThreshold,
  getProjectConfigPath,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  DEFAULT_CONFIG,
};
