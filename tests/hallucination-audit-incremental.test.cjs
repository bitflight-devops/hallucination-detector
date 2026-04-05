'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  findNewSessionFiles,
  parseBlockEvents,
  _openDbAt,
  MAX_FILE_SIZE_BYTES,
} = require('../scripts/hallucination-audit-incremental.cjs');

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a temp directory for the test, returning its path.
 * The caller is responsible for cleanup via rmSync({ recursive: true }).
 */
function makeTempDir() {
  const dir = path.join(
    os.tmpdir(),
    `hd-inc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a JSONL session file containing the given lines, and return the file path.
 */
function writeTempJsonl(dir, name, lines) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
  return filePath;
}

/**
 * Build raw file lines that simulate a block event in a session JSONL file.
 *
 * The incremental scanner operates on raw file lines:
 * - It matches BLOCK_HEADER_PATTERNS against each raw line string.
 * - It then scans ahead on subsequent raw lines for CATEGORY_EVIDENCE_RE.
 *
 * Returns an array of raw line strings:
 * - Line 0: JSON line whose raw text contains the block header.
 * - Lines 1+: Plain-text lines with category evidence (matched by CATEGORY_EVIDENCE_RE).
 *   Plain-text lines that fail JSON.parse are silently skipped by the scanner's
 *   block-counting logic but ARE checked for category evidence in the lookahead.
 */
function blockLines(categories) {
  // Line 0: JSON entry whose raw string contains the block header.
  const headerLine = JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: '⚠️ Hallucination detector blocked this response.' }],
    },
  });
  // Lines 1+: Plain-text category evidence lines matching CATEGORY_EVIDENCE_RE.
  // Pattern: /^\s*-\s*(speculation_language|...)\s*:/
  const evidenceLines = categories.map((c) => `- ${c}: \`evidence\``);
  return [headerLine, ...evidenceLines];
}

// =============================================================================
// findNewSessionFiles
// =============================================================================
describe('findNewSessionFiles', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('returns files modified after a given timestamp', () => {
    tmpDir = makeTempDir();
    const beforeTs = Date.now() - 5000; // 5 seconds ago threshold

    // Write a file — its mtime will be "now", which is after beforeTs
    writeTempJsonl(tmpDir, 'session-a.jsonl', ['{"type":"assistant"}']);

    const found = findNewSessionFiles(tmpDir, beforeTs);
    const names = found.map((f) => path.basename(f));
    expect(names).toContain('session-a.jsonl');
  });

  it('does not return files modified before the threshold', () => {
    tmpDir = makeTempDir();

    // Write a file first
    writeTempJsonl(tmpDir, 'old-session.jsonl', ['{"type":"assistant"}']);

    // Use a future threshold — all existing files are "before" it
    const futureTs = Date.now() + 60 * 1000;

    const found = findNewSessionFiles(tmpDir, futureTs);
    expect(found.length).toBe(0);
  });

  it('skips files larger than 5 MB', () => {
    tmpDir = makeTempDir();
    const beforeTs = Date.now() - 5000;

    const bigFile = path.join(tmpDir, 'big-session.jsonl');
    // Write a file larger than MAX_FILE_SIZE_BYTES
    const bigContent = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 'x');
    fs.writeFileSync(bigFile, bigContent);

    const found = findNewSessionFiles(tmpDir, beforeTs);
    const names = found.map((f) => path.basename(f));
    expect(names).not.toContain('big-session.jsonl');
  });

  it('returns empty array when directory does not exist', () => {
    const nonExistent = path.join(os.tmpdir(), `hd-inc-noexist-${Date.now()}`);
    const found = findNewSessionFiles(nonExistent, 0);
    expect(found).toEqual([]);
  });

  it('recursively finds files in subdirectories', () => {
    tmpDir = makeTempDir();
    const beforeTs = Date.now() - 5000;

    const subDir = path.join(tmpDir, 'project-abc', 'sessions');
    fs.mkdirSync(subDir, { recursive: true });
    writeTempJsonl(subDir, 'nested.jsonl', ['{"type":"assistant"}']);

    const found = findNewSessionFiles(tmpDir, beforeTs);
    const names = found.map((f) => path.basename(f));
    expect(names).toContain('nested.jsonl');
  });
});

// =============================================================================
// parseBlockEvents
// =============================================================================
describe('parseBlockEvents', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('returns zero count for a file with no block events', () => {
    tmpDir = makeTempDir();
    const filePath = writeTempJsonl(tmpDir, 'clean.jsonl', [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'All good.' }] },
      }),
    ]);

    const { count, categories } = parseBlockEvents(filePath);
    expect(count).toBe(0);
    expect(categories).toEqual([]);
  });

  it('correctly counts block events from lines containing the block header', () => {
    tmpDir = makeTempDir();
    const filePath = writeTempJsonl(tmpDir, 'blocked.jsonl', [
      ...blockLines(['speculation_language']),
      ...blockLines(['causality_language']),
    ]);

    const { count } = parseBlockEvents(filePath);
    expect(count).toBe(2);
  });

  it('extracts category from block header lines', () => {
    tmpDir = makeTempDir();
    const filePath = writeTempJsonl(tmpDir, 'with-cats.jsonl', [
      ...blockLines(['speculation_language', 'causality_language']),
    ]);

    const { categories } = parseBlockEvents(filePath);
    // At least one category should be extracted
    expect(categories.length).toBeGreaterThan(0);
    // The extracted values must be valid category names
    const validCats = new Set([
      'speculation_language',
      'causality_language',
      'pseudo_quantification',
      'completeness_claim',
      'evaluative_design_claim',
      'structural',
      'template_validation_error',
    ]);
    for (const cat of categories) {
      expect(validCats.has(cat)).toBe(true);
    }
  });

  it('returns zero count for a non-existent file', () => {
    const { count, categories } = parseBlockEvents('/tmp/hd-inc-no-such-file-xyz.jsonl');
    expect(count).toBe(0);
    expect(categories).toEqual([]);
  });
});

// =============================================================================
// openDb / _openDbAt
// =============================================================================
describe('openDb / _openDbAt', () => {
  let tmpDir;
  let tmpDbPath;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `hd-sqlite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the directory and returns a DatabaseSync instance', () => {
    const db = _openDbAt(tmpDbPath);
    expect(db).not.toBeNull();
    expect(fs.existsSync(tmpDbPath)).toBe(true);
    db.close();
  });

  it('creates runs table', () => {
    const db = _openDbAt(tmpDbPath);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runs'")
      .get();
    expect(row?.name).toBe('runs');
    db.close();
  });

  it('creates block_categories table', () => {
    const db = _openDbAt(tmpDbPath);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='block_categories'")
      .get();
    expect(row?.name).toBe('block_categories');
    db.close();
  });

  it('sets WAL journal mode', () => {
    const db = _openDbAt(tmpDbPath);
    const row = db.prepare('PRAGMA journal_mode').get();
    expect(row?.journal_mode).toBe('wal');
    db.close();
  });

  it('returns null for an invalid path', () => {
    // Pass a path inside a file (not a directory) to force an error
    const filePath = path.join(os.tmpdir(), `hd-not-a-dir-${Date.now()}`);
    fs.writeFileSync(filePath, 'x');
    const db = _openDbAt(path.join(filePath, 'sub', 'test.db'));
    expect(db).toBeNull();
    fs.rmSync(filePath);
  });
});

// =============================================================================
// last_run derived from MAX(ts)
// =============================================================================
describe('last_run derived from MAX(ts)', () => {
  let tmpDir;
  let tmpDbPath;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `hd-sqlite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when runs table is empty', () => {
    const db = _openDbAt(tmpDbPath);
    const row = db.prepare('SELECT COALESCE(MAX(ts), 0) AS last_run FROM runs').get();
    expect(row.last_run).toBe(0);
    db.close();
  });

  it('returns the max ts after inserts', () => {
    const db = _openDbAt(tmpDbPath);
    db.prepare(
      'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
    ).run(1000, 1, 0, 10);
    db.prepare(
      'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
    ).run(5000, 2, 3, 20);
    const row = db.prepare('SELECT COALESCE(MAX(ts), 0) AS last_run FROM runs').get();
    expect(row.last_run).toBe(5000);
    db.close();
  });
});

// =============================================================================
// runs and block_categories inserts
// =============================================================================
describe('runs and block_categories inserts', () => {
  let tmpDir;
  let tmpDbPath;

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `hd-sqlite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts a run row with correct fields', () => {
    const db = _openDbAt(tmpDbPath);
    const ts = Date.now();
    db.prepare(
      'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
    ).run(ts, 3, 5, 42);
    const row = db.prepare('SELECT * FROM runs').get();
    expect(row.ts).toBe(ts);
    expect(row.files_scanned).toBe(3);
    expect(row.new_blocks).toBe(5);
    expect(row.duration_ms).toBe(42);
    db.close();
  });

  it('inserts block_category rows linked to run_id', () => {
    const db = _openDbAt(tmpDbPath);
    db.prepare(
      'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
    ).run(Date.now(), 1, 2, 10);
    const runId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare('INSERT INTO block_categories (run_id, category, count) VALUES (?, ?, ?)').run(
      runId,
      'speculation_language',
      2,
    );
    db.prepare('INSERT INTO block_categories (run_id, category, count) VALUES (?, ?, ?)').run(
      runId,
      'causality_language',
      1,
    );
    const cats = db.prepare('SELECT * FROM block_categories ORDER BY category').all();
    expect(cats.length).toBe(2);
    expect(cats[0].category).toBe('causality_language');
    expect(cats[0].run_id).toBe(runId);
    expect(cats[1].category).toBe('speculation_language');
    expect(cats[1].count).toBe(2);
    db.close();
  });
});

// =============================================================================
// Full integration (SQLite)
// =============================================================================
describe('full integration (SQLite)', () => {
  let tmpSessionDir;
  let tmpDbDir;
  let tmpDbPath;

  beforeEach(() => {
    tmpSessionDir = path.join(
      os.tmpdir(),
      `hd-int-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.mkdirSync(tmpSessionDir, { recursive: true });
    tmpDbDir = path.join(
      os.tmpdir(),
      `hd-int-db-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tmpDbPath = path.join(tmpDbDir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(tmpSessionDir, { recursive: true, force: true });
    fs.rmSync(tmpDbDir, { recursive: true, force: true });
  });

  it('empty db → 2 block events in JSONL → runs.new_blocks = 2', () => {
    const beforeTs = Date.now() - 5000;

    // Write a session file with 2 block events
    const headerLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: '⚠️ Hallucination detector blocked this response.' }],
      },
    });
    const sessionLines = [
      headerLine,
      '- speculation_language: `evidence`',
      headerLine,
      '- causality_language: `evidence`',
    ];
    const sessionFile = path.join(tmpSessionDir, 'session.jsonl');
    fs.writeFileSync(sessionFile, `${sessionLines.join('\n')}\n`, 'utf-8');

    // Verify file discovery works
    const newFiles = findNewSessionFiles(tmpSessionDir, beforeTs);
    expect(newFiles).toContain(sessionFile);

    // Open DB and confirm it starts empty
    const db = _openDbAt(tmpDbPath);
    expect(db).not.toBeNull();

    const lastRunRow = db.prepare('SELECT COALESCE(MAX(ts), 0) AS last_run FROM runs').get();
    expect(lastRunRow.last_run).toBe(0);

    // Parse block events
    let totalBlocks = 0;
    const allCats = [];
    for (const f of newFiles) {
      const { count, categories } = parseBlockEvents(f);
      totalBlocks += count;
      for (const c of categories) allCats.push(c);
    }
    expect(totalBlocks).toBe(2);

    // Aggregate and insert
    const catCounts = {};
    for (const cat of allCats) {
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    db.exec('BEGIN');
    db.prepare(
      'INSERT INTO runs (ts, files_scanned, new_blocks, duration_ms) VALUES (?, ?, ?, ?)',
    ).run(Date.now(), newFiles.length, totalBlocks, 10);
    const runId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    const insertCat = db.prepare(
      'INSERT INTO block_categories (run_id, category, count) VALUES (?, ?, ?)',
    );
    for (const [cat, cnt] of Object.entries(catCounts)) {
      insertCat.run(runId, cat, cnt);
    }
    db.exec('COMMIT');

    // Verify persisted state
    const runRow = db.prepare('SELECT * FROM runs').get();
    expect(runRow.new_blocks).toBe(2);
    expect(runRow.files_scanned).toBe(1);

    const catRows = db.prepare('SELECT * FROM block_categories ORDER BY category').all();
    expect(catRows.length).toBe(2);

    db.close();
  });
});
