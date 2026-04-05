#!/usr/bin/env node
/**
 * PostToolUse hook: incremental audit accumulator.
 *
 * Runs after each tool use and accumulates block statistics from new session
 * JSONL files into a persistent audit state file at:
 *   ~/.hd/telemetry/audit-state.json
 *
 * Performance constraints:
 * - Skips files larger than 5 MB.
 * - Stops scanning a file after 50 block events (runaway session guard).
 * - Total execution target: < 2 seconds for typical sessions.
 *
 * Error handling: all failures are silent. A broken audit hook must never
 * interrupt the user's session.
 *
 * PostToolUse hooks must emit NOTHING to stdout. Any stdout output from a
 * PostToolUse hook can suppress tool output shown to Claude.
 *
 * Zero runtime dependencies — Node.js built-ins only.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// =============================================================================
// Constants
// =============================================================================

const AUDIT_STATE_PATH = path.join(os.homedir(), '.hd', 'telemetry', 'audit-state.json');

/** Maximum file size to scan (5 MB). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/** Maximum block events to extract from a single file (runaway session guard). */
const MAX_BLOCKS_PER_FILE = 50;

/**
 * Text patterns that identify a block event line in a JSONL session file.
 * Matches lines that contain the block header or observation template block text.
 */
const BLOCK_HEADER_PATTERNS = [
  /⚠️\s*Hallucination[\s-]detector/i,
  /Hallucination-detector STOP HOOK blocked/i,
  /OBSERVATION TEMPLATE:/i,
];

/**
 * Regex to extract a category kind from a block reason line.
 * Matches lines like: "- speculation_language: `probably`"
 */
const CATEGORY_EVIDENCE_RE =
  /^\s*-\s*(speculation_language|causality_language|pseudo_quantification|completeness_claim|evaluative_design_claim|structural|template_validation_error)\s*:/;

// =============================================================================
// Default audit state shape
// =============================================================================

/**
 * @returns {object} A fresh default audit state object.
 */
function defaultAuditState() {
  return {
    last_run: 0,
    totals: {
      sessions_scanned: 0,
      blocks_total: 0,
      by_category: {},
      by_session_type: {},
      estimated_cost_usd: 0,
    },
    runs: [],
  };
}

// =============================================================================
// State file I/O
// =============================================================================

/**
 * Load the audit state from disk, or return a fresh default state if the file
 * is absent or unparseable.
 *
 * @returns {object} Audit state object.
 */
function loadAuditState() {
  try {
    if (!fs.existsSync(AUDIT_STATE_PATH)) return defaultAuditState();
    const raw = fs.readFileSync(AUDIT_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultAuditState();
    // Ensure required sub-objects exist for forward compatibility.
    if (!parsed.totals || typeof parsed.totals !== 'object')
      parsed.totals = defaultAuditState().totals;
    if (!Array.isArray(parsed.runs)) parsed.runs = [];
    if (typeof parsed.last_run !== 'number') parsed.last_run = 0;
    return parsed;
  } catch {
    return defaultAuditState();
  }
}

/**
 * Write audit state to disk atomically (write to .tmp, then rename).
 * Silent on failure.
 *
 * @param {object} state - Audit state object to persist.
 */
function saveAuditState(state) {
  try {
    const dir = path.dirname(AUDIT_STATE_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${AUDIT_STATE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, AUDIT_STATE_PATH);
  } catch {
    // intentionally silent — state write failure must not affect hook behavior
  }
}

// =============================================================================
// Session file discovery
// =============================================================================

/**
 * Recursively collect all `.jsonl` files under `dir` whose mtime is strictly
 * greater than `afterMs` and whose size is at most `MAX_FILE_SIZE_BYTES`.
 *
 * @param {string} dir       - Root directory to search.
 * @param {number} afterMs   - Epoch milliseconds threshold (exclusive).
 * @returns {string[]} Absolute paths of matching files.
 */
function findNewSessionFiles(dir, afterMs) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  _walkDir(dir, afterMs, results);
  return results;
}

/**
 * Internal recursive walker used by findNewSessionFiles.
 *
 * @param {string}   dir
 * @param {number}   afterMs
 * @param {string[]} out
 */
function _walkDir(dir, afterMs, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _walkDir(fullPath, afterMs, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > afterMs && stat.size <= MAX_FILE_SIZE_BYTES) {
          out.push(fullPath);
        }
      } catch {
        // stat failed — skip file
      }
    }
  }
}

// =============================================================================
// Block event extraction
// =============================================================================

/**
 * Parse a JSONL session file and extract block events.
 *
 * Scans each line for block header text. When found, attempts to extract the
 * category from subsequent lines. Stops after MAX_BLOCKS_PER_FILE events.
 *
 * @param {string} filePath - Absolute path to a JSONL session file.
 * @returns {{ count: number, categories: string[] }} Block count and category list.
 */
function parseBlockEvents(filePath) {
  const result = { count: 0, categories: [] };
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return result;
  }

  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (result.count >= MAX_BLOCKS_PER_FILE) break;
    const line = lines[i];

    // Check whether this line contains a block signal.
    let isBlockLine = false;
    for (const pattern of BLOCK_HEADER_PATTERNS) {
      if (pattern.test(line)) {
        isBlockLine = true;
        break;
      }
    }
    if (!isBlockLine) continue;

    result.count++;

    // Scan ahead up to 15 lines for category evidence lines.
    const lookAhead = Math.min(i + 15, lines.length);
    for (let j = i + 1; j < lookAhead; j++) {
      const m = CATEGORY_EVIDENCE_RE.exec(lines[j]);
      if (m) {
        result.categories.push(m[1]);
      }
    }
  }

  return result;
}

// =============================================================================
// State update
// =============================================================================

/**
 * Merge a delta (from scanning new files) into the audit state totals.
 * Appends a run record to state.runs.
 *
 * @param {object} state         - Mutable audit state object (modified in place).
 * @param {object} delta
 * @param {number}   delta.filesScanned  - Number of files scanned this run.
 * @param {number}   delta.newBlocks     - Total new block events found.
 * @param {string[]} delta.categories    - Category strings from block events.
 * @param {number}   delta.durationMs    - Wall-clock duration of this run.
 * @returns {object} The mutated state.
 */
function updateAuditState(state, delta) {
  state.totals.sessions_scanned += delta.filesScanned;
  state.totals.blocks_total += delta.newBlocks;

  // Increment per-category counters.
  for (const cat of delta.categories) {
    state.totals.by_category[cat] = (state.totals.by_category[cat] || 0) + 1;
  }

  // Append run record.
  state.runs.push({
    ts: Date.now(),
    files_scanned: delta.filesScanned,
    new_blocks: delta.newBlocks,
    duration_ms: delta.durationMs,
  });

  return state;
}

// =============================================================================
// Main
// =============================================================================

/**
 * PostToolUse hook entry point.
 * Reads stdin (ignored — PostToolUse input not needed for audit accumulation),
 * discovers new session files, extracts block events, and updates the state file.
 * Always exits 0. Never writes to stdout.
 */
function main() {
  const startMs = Date.now();

  // Consume stdin to avoid broken-pipe signals. The payload is not needed.
  try {
    fs.readFileSync(0, 'utf-8');
  } catch {
    // stdin unavailable — continue
  }

  const state = loadAuditState();
  const lastRun = state.last_run || 0;

  // Search for new session JSONL files in ~/.claude/projects/
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  const newFiles = findNewSessionFiles(claudeProjectsDir, lastRun);

  let totalNewBlocks = 0;
  const allCategories = [];

  for (const filePath of newFiles) {
    const { count, categories } = parseBlockEvents(filePath);
    totalNewBlocks += count;
    for (const cat of categories) {
      allCategories.push(cat);
    }
  }

  const durationMs = Date.now() - startMs;

  // Always update last_run, even when no new files were found.
  state.last_run = Date.now();

  updateAuditState(state, {
    filesScanned: newFiles.length,
    newBlocks: totalNewBlocks,
    categories: allCategories,
    durationMs,
  });

  saveAuditState(state);
  // PostToolUse hooks must not write to stdout.
  process.exit(0);
}

// Export internals for testing; run main() only when executed directly.
if (require.main === module) {
  main();
}

module.exports = {
  findNewSessionFiles,
  parseBlockEvents,
  updateAuditState,
  loadAuditState,
  saveAuditState,
  defaultAuditState,
  AUDIT_STATE_PATH,
  MAX_FILE_SIZE_BYTES,
  MAX_BLOCKS_PER_FILE,
};
