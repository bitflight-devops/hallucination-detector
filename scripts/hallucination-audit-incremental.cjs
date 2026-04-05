#!/usr/bin/env node
/**
 * PostToolUse hook: incremental audit accumulator.
 *
 * Runs after each tool use and accumulates block statistics from new session
 * JSONL files into a persistent SQLite database at:
 *   ~/.hd/telemetry/hallucination-detector.db
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
 * Zero runtime dependencies — Node.js built-ins only (node:sqlite requires Node >= 22.5.0).
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// =============================================================================
// Constants
// =============================================================================

const DB_PATH = path.join(os.homedir(), '.hd', 'telemetry', 'hallucination-detector.db');

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
// Database helpers
// =============================================================================

/**
 * Opens a DatabaseSync at an explicit path. Creates the directory if absent.
 * Creates the runs and block_categories tables if they do not exist.
 * Sets WAL journal mode for concurrent writer safety.
 *
 * Used directly by tests (avoids mocking the module-level DB_PATH constant).
 *
 * @param {string} dbPath - Absolute path to the SQLite database file.
 * @returns {import('node:sqlite').DatabaseSync|null} Open database instance, or null on error.
 */
function _openDbAt(dbPath) {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      new_blocks INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS block_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    )`);
    return db;
  } catch {
    return null;
  }
}

/**
 * Opens the production database at DB_PATH.
 *
 * @returns {import('node:sqlite').DatabaseSync|null} Open database instance, or null on error.
 */
function openDb() {
  return _openDbAt(DB_PATH);
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
// Main
// =============================================================================

/**
 * PostToolUse hook entry point.
 * Reads stdin (ignored — PostToolUse input not needed for audit accumulation),
 * discovers new session files, extracts block events, and persists the run to SQLite.
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

  let db = null;
  try {
    db = openDb();
  } catch {
    // silent — db failure must not affect session
  }

  // Derive last_run from the max ts in the runs table.
  let lastRun = 0;
  if (db) {
    try {
      const row = db.prepare('SELECT COALESCE(MAX(ts), 0) AS last_run FROM runs').get();
      lastRun = row?.last_run ?? 0;
    } catch {
      // silent
    }
  }

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

  if (db) {
    try {
      db.exec('BEGIN');
      const insertRun = db.prepare(
        'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
      );
      insertRun.run(Date.now(), newFiles.length, totalNewBlocks, durationMs);
      const runId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

      // Aggregate categories by count before inserting.
      const catCounts = {};
      for (const cat of allCategories) {
        catCounts[cat] = (catCounts[cat] || 0) + 1;
      }
      const insertCat = db.prepare(
        'INSERT INTO block_categories (run_id, category, count) VALUES (?, ?, ?)',
      );
      for (const [cat, count] of Object.entries(catCounts)) {
        insertCat.run(runId, cat, count);
      }
      db.exec('COMMIT');
    } catch {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
    } finally {
      try {
        db.close();
      } catch {
        // ignore close failure
      }
    }
  }

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
  DB_PATH,
  openDb,
  _openDbAt,
  MAX_FILE_SIZE_BYTES,
  MAX_BLOCKS_PER_FILE,
};
