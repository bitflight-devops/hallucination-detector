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
 * Default full configuration object.
 */
const DEFAULT_CONFIG = {
  weights: DEFAULT_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  introspect: false,
  introspectOutputPath: null,
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
};

// ============================================================================
// Minimal TOML parser — handles the subset needed for pyproject.toml sections.
// Supports: simple key-value pairs (string, number, boolean), section headers
// ([section] / [section.sub]), and single-line arrays of strings or inline tables.
// ============================================================================

/**
 * Split `content` on `sep` at depth 0, respecting nested brackets and quoted strings.
 * @param {string} content
 * @param {string} sep - Single separator character.
 * @returns {string[]}
 */
function splitTopLevel(content, sep) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let strChar = '';
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === '\\' && i + 1 < content.length) {
        i++;
        continue;
      }
      if (ch === strChar) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ']' || ch === '}') {
      depth--;
    } else if (ch === sep && depth === 0) {
      parts.push(content.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
}

/**
 * Strip a `#` inline comment from a TOML value string, respecting quoted strings.
 * @param {string} valStr
 * @returns {string}
 */
function stripTomlInlineComment(valStr) {
  let inStr = false;
  let strChar = '';
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr[i];
    if (inStr) {
      if (ch === '\\' && i + 1 < valStr.length) {
        i++;
        continue;
      }
      if (ch === strChar) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
    } else if (ch === '#') {
      return valStr.slice(0, i).trim();
    }
  }
  return valStr.trim();
}

/**
 * Parse a single TOML value string into a JS value.
 * @param {string} valStr
 * @returns {*}
 */
function parseTomlValue(valStr) {
  const s = stripTomlInlineComment(valStr);
  if (!s) return null;
  // Quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"');
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  // Array
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map((item) => parseTomlValue(item));
  }
  // Inline table
  if (s.startsWith('{') && s.endsWith('}')) {
    return parseTomlInlineTable(s.slice(1, -1));
  }
  return s;
}

/**
 * Parse a TOML inline table body (content between `{` and `}`).
 * @param {string} content
 * @returns {object}
 */
function parseTomlInlineTable(content) {
  const table = {};
  if (!content.trim()) return table;
  for (const pair of splitTopLevel(content.trim(), ',')) {
    const p = pair.trim();
    const eqIdx = p.indexOf('=');
    if (eqIdx === -1) continue;
    const k = p.slice(0, eqIdx).trim();
    const v = p.slice(eqIdx + 1).trim();
    if (k) table[k] = parseTomlValue(v);
  }
  return table;
}

/**
 * Parse a TOML source string into a plain JS object.
 * Only handles the subset needed for `[tool.hallucination-detector]` sections.
 *
 * @param {string} source - TOML source text.
 * @returns {object}
 */
function parseToml(source) {
  const result = {};
  let current = result;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // Section header: [key] or [key.subkey]  (not array tables [[...]])
    if (line.startsWith('[') && !line.startsWith('[[')) {
      const end = line.indexOf(']');
      if (end === -1) continue;
      const sectionStr = line.slice(1, end).trim();
      // Split on '.' to get nested path (bare keys may contain hyphens)
      const parts = sectionStr.split('.').map((p) => p.trim());
      current = result;
      for (const part of parts) {
        if (typeof current[part] !== 'object' || current[part] === null) {
          current[part] = {};
        }
        current = current[part];
      }
      continue;
    }

    // Key-value pair
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const valStr = line.slice(eqIdx + 1).trim();
    if (!key) continue;
    current[key] = parseTomlValue(valStr);
  }

  return result;
}

// ============================================================================
// Deep freeze
// ============================================================================

/**
 * Recursively freeze an object and all nested plain objects / arrays.
 * @param {*} obj
 * @returns {*} The frozen value.
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const val of Object.values(obj)) {
    deepFreeze(val);
  }
  return Object.freeze(obj);
}

// ============================================================================
// Schema validation
// ============================================================================

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);
const VALID_OUTPUT_FORMATS = new Set(['text', 'json', 'jsonl']);

/**
 * Validate a raw config object loaded from a source, logging warnings to stderr
 * for invalid field values and deleting them so they fall back to defaults during
 * the merge step.  Mutates the provided object in place.
 *
 * @param {object} obj    - Raw config object to validate.
 * @param {string} source - Human-readable source label used in warning messages.
 * @returns {object} The (mutated) object.
 */
function validateConfig(obj, source) {
  if (!obj || typeof obj !== 'object') return {};
  const src = source || 'unknown source';

  /**
   * Emit a validation warning to stderr.
   * @param {string} field
   * @param {*} val
   * @param {*} def
   */
  function warn(field, val, def) {
    process.stderr.write(
      `[hallucination-detector] Invalid ${field} "${val}" from ${src}; using default ${JSON.stringify(def)}\n`,
    );
  }

  if ('severity' in obj && !VALID_SEVERITIES.has(obj.severity)) {
    warn('severity', obj.severity, 'error');
    delete obj.severity;
  }
  if ('outputFormat' in obj && !VALID_OUTPUT_FORMATS.has(obj.outputFormat)) {
    warn('outputFormat', obj.outputFormat, 'text');
    delete obj.outputFormat;
  }
  if ('maxTriggersPerResponse' in obj) {
    if (!Number.isInteger(obj.maxTriggersPerResponse) || obj.maxTriggersPerResponse < 0) {
      warn('maxTriggersPerResponse', obj.maxTriggersPerResponse, 20);
      delete obj.maxTriggersPerResponse;
    }
  }
  if ('maxBlocksPerSession' in obj && obj.maxBlocksPerSession !== null) {
    if (!Number.isInteger(obj.maxBlocksPerSession) || obj.maxBlocksPerSession < 0) {
      warn('maxBlocksPerSession', obj.maxBlocksPerSession, null);
      delete obj.maxBlocksPerSession;
    }
  }
  if ('debug' in obj && typeof obj.debug !== 'boolean') {
    warn('debug', obj.debug, false);
    delete obj.debug;
  }
  if ('introspect' in obj && typeof obj.introspect !== 'boolean') {
    warn('introspect', obj.introspect, false);
    delete obj.introspect;
  }
  if ('includeContext' in obj && typeof obj.includeContext !== 'boolean') {
    warn('includeContext', obj.includeContext, true);
    delete obj.includeContext;
  }
  if ('contextLines' in obj) {
    if (!Number.isInteger(obj.contextLines) || obj.contextLines < 0) {
      warn('contextLines', obj.contextLines, 2);
      delete obj.contextLines;
    }
  }
  // weights: object with numeric values
  if ('weights' in obj) {
    if (typeof obj.weights !== 'object' || obj.weights === null || Array.isArray(obj.weights)) {
      warn('weights', obj.weights, DEFAULT_WEIGHTS);
      delete obj.weights;
    }
  }
  // thresholds: { uncertain, hallucinated } both numbers in [0,1], uncertain <= hallucinated
  if ('thresholds' in obj) {
    const t = obj.thresholds;
    const valid =
      t !== null &&
      typeof t === 'object' &&
      !Array.isArray(t) &&
      typeof t.uncertain === 'number' &&
      Number.isFinite(t.uncertain) &&
      t.uncertain >= 0 &&
      t.uncertain <= 1 &&
      typeof t.hallucinated === 'number' &&
      Number.isFinite(t.hallucinated) &&
      t.hallucinated >= 0 &&
      t.hallucinated <= 1 &&
      t.uncertain <= t.hallucinated;
    if (!valid) {
      warn('thresholds', JSON.stringify(t), DEFAULT_THRESHOLDS);
      delete obj.thresholds;
    }
  }
  return obj;
}

// ============================================================================
// Deep merge
// ============================================================================

/**
 * Deep-merge two config objects.  Rules:
 * - Plain objects are merged recursively.
 * - `categories.<name>.customPatterns` arrays are concatenated unless the override
 *   has `replacePatterns: true` for that category.
 * - All other arrays are replaced by the override value.
 * - Scalar values are replaced by the override value.
 *
 * Neither argument is mutated; a new object is returned.
 *
 * @param {object} base     - Lower-priority config.
 * @param {object} override - Higher-priority config (wins on conflict).
 * @returns {object} Merged config.
 */
function mergeConfig(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  if (!base || typeof base !== 'object' || Array.isArray(base)) return override;

  const result = { ...base };

  for (const key of Object.keys(override)) {
    const overVal = override[key];
    const baseVal = base[key];

    if (key === 'categories') {
      // Merge categories map, with special customPatterns concatenation logic.
      const baseCats =
        typeof baseVal === 'object' && baseVal !== null && !Array.isArray(baseVal) ? baseVal : {};
      const overCats =
        typeof overVal === 'object' && overVal !== null && !Array.isArray(overVal) ? overVal : {};
      const merged = { ...baseCats };
      for (const catName of Object.keys(overCats)) {
        const baseCat = baseCats[catName] || {};
        const overCat = overCats[catName];
        if (typeof overCat !== 'object' || overCat === null) {
          merged[catName] = overCat;
          continue;
        }
        const mergedCat = { ...baseCat, ...overCat };
        // Concatenate customPatterns unless replacePatterns is true in the override.
        if (
          !overCat.replacePatterns &&
          Array.isArray(baseCat.customPatterns) &&
          Array.isArray(overCat.customPatterns)
        ) {
          mergedCat.customPatterns = [...baseCat.customPatterns, ...overCat.customPatterns];
        }
        merged[catName] = mergedCat;
      }
      result[key] = merged;
    } else if (
      typeof overVal === 'object' &&
      overVal !== null &&
      !Array.isArray(overVal) &&
      typeof baseVal === 'object' &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      // Both are plain objects — recurse.
      result[key] = mergeConfig(baseVal, overVal);
    } else {
      // Scalar, array, or null — override wins.
      result[key] = overVal;
    }
  }

  return result;
}

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
 * Load and validate the full configuration using a cascading source chain.
 * Returns a deeply-frozen config object.
 *
 * Sources (highest priority first):
 *   1. `HALLUCINATION_DETECTOR_CONFIG` env var → file path
 *   2. `.hallucination-detectorrc.cjs` in `process.cwd()`
 *   3. `project.json` → `hallucination-detector` key
 *   4. `pyproject.toml` → `[tool.hallucination-detector]` section
 *   5. `~/.hallucination-detectorrc.cjs`
 *   6. Built-in defaults
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

  // Priority 5: ~/.hallucination-detectorrc.cjs
  const homeRc = loadCjsFile(path.join(homeDir, '.hallucination-detectorrc.cjs'));
  if (homeRc && typeof homeRc === 'object') {
    sources.push(validateConfig({ ...homeRc }, '~/.hallucination-detectorrc.cjs'));
  }

  // Priority 4: pyproject.toml → [tool.hallucination-detector]
  const pyprojectCfg = loadPyprojectConfig(path.join(cwd, 'pyproject.toml'));
  if (pyprojectCfg) {
    sources.push(validateConfig({ ...pyprojectCfg }, 'pyproject.toml'));
  }

  // Priority 3: project.json → hallucination-detector key
  const projectJsonCfg = loadProjectJsonConfig(path.join(cwd, 'project.json'));
  if (projectJsonCfg) {
    sources.push(validateConfig({ ...projectJsonCfg }, 'project.json'));
  }

  // Priority 2: .hallucination-detectorrc.cjs in cwd
  const cwdRc = loadCjsFile(path.join(cwd, '.hallucination-detectorrc.cjs'));
  if (cwdRc && typeof cwdRc === 'object') {
    sources.push(validateConfig({ ...cwdRc }, '.hallucination-detectorrc.cjs'));
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
  const t = config.thresholds;
  const thresholdsValid =
    t !== null &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    typeof t.uncertain === 'number' &&
    Number.isFinite(t.uncertain) &&
    t.uncertain >= 0 &&
    t.uncertain <= 1 &&
    typeof t.hallucinated === 'number' &&
    Number.isFinite(t.hallucinated) &&
    t.hallucinated >= 0 &&
    t.hallucinated <= 1 &&
    t.uncertain <= t.hallucinated;
  config.thresholds = thresholdsValid
    ? { uncertain: t.uncertain, hallucinated: t.hallucinated }
    : { ...DEFAULT_THRESHOLDS };

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
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
  DEFAULT_CONFIG,
};
