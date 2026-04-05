#!/usr/bin/env node
/**
 * Shared SQLite database helper for the hallucination-detector plugin.
 *
 * Exports a single canonical DB_PATH and factory functions that open (or
 * create) the database with all four telemetry tables. Both the stop hook and
 * the incremental hook require this module so the schema is defined in exactly
 * one place.
 *
 * Zero runtime dependencies — Node.js built-ins only (node:sqlite requires
 * Node >= 22.5.0).
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// =============================================================================
// Constants
// =============================================================================

/** Canonical path to the hallucination-detector telemetry database. */
const DB_PATH = path.join(os.homedir(), '.hd', 'telemetry', 'hallucination-detector.db');

// =============================================================================
// Schema DDL
// =============================================================================

/**
 * Idempotent DDL for all four telemetry tables.
 *
 * - `runs` / `block_categories` — written by the incremental PostToolUse hook.
 * - `stop_hook_log` / `block_matches` — written by the Stop hook.
 *
 * All CREATE statements use IF NOT EXISTS so calling this function on an already-
 * initialised database is safe.
 */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  files_scanned INTEGER NOT NULL DEFAULT 0,
  new_blocks    INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS block_categories (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   INTEGER NOT NULL,
  category TEXT    NOT NULL,
  count    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stop_hook_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id            TEXT    NOT NULL,
  ts                    INTEGER NOT NULL,
  decision              TEXT    NOT NULL,
  is_retry              INTEGER NOT NULL DEFAULT 0,
  is_structured         INTEGER NOT NULL DEFAULT 0,
  response_length_chars INTEGER,
  blocks_so_far         INTEGER,
  prior_block_id        INTEGER,
  response_snippet      TEXT
);

CREATE TABLE IF NOT EXISTS block_matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id      INTEGER NOT NULL,
  category    TEXT    NOT NULL,
  evidence    TEXT,
  was_ignored INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_stop_hook_session ON stop_hook_log(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_prior_block ON stop_hook_log(prior_block_id);
`;

// =============================================================================
// Database helpers
// =============================================================================

/**
 * Opens a DatabaseSync at an explicit path. Creates the parent directory if
 * absent. Creates all four tables if they do not already exist. Sets WAL
 * journal mode for concurrent writer safety.
 *
 * This function is exposed separately from `openDb()` so that tests can pass
 * an in-memory path (`:memory:`) or a temporary file without touching the
 * production DB_PATH.
 *
 * @param {string} dbPath - Absolute path to the SQLite database file, or
 *   `:memory:` for an in-memory database.
 * @returns {import('node:sqlite').DatabaseSync} Open database instance.
 * @throws {Error} Re-throws any error from DatabaseSync construction or DDL
 *   execution so callers can decide whether to swallow it.
 */
function _openDbAt(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec(SCHEMA_DDL);
  return db;
}

/**
 * Opens the production database at `DB_PATH` after ensuring the target
 * directory exists.
 *
 * @returns {import('node:sqlite').DatabaseSync} Open database instance.
 * @throws {Error} Re-throws any construction or DDL errors.
 */
function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  return _openDbAt(DB_PATH);
}

// =============================================================================
// Exports
// =============================================================================

module.exports = { DB_PATH, _openDbAt, openDb };
