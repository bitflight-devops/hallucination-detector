'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findNewSessionFiles,
  parseBlockEvents,
  updateAuditState,
  defaultAuditState,
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
// updateAuditState
// =============================================================================
describe('updateAuditState', () => {
  it('increments totals correctly', () => {
    const state = defaultAuditState();
    updateAuditState(state, {
      filesScanned: 3,
      newBlocks: 5,
      categories: ['speculation_language', 'causality_language'],
      durationMs: 42,
    });

    expect(state.totals.sessions_scanned).toBe(3);
    expect(state.totals.blocks_total).toBe(5);
    expect(state.totals.by_category.speculation_language).toBe(1);
    expect(state.totals.by_category.causality_language).toBe(1);
  });

  it('appends to runs array', () => {
    const state = defaultAuditState();
    updateAuditState(state, {
      filesScanned: 1,
      newBlocks: 2,
      categories: [],
      durationMs: 10,
    });

    expect(state.runs.length).toBe(1);
    expect(state.runs[0].files_scanned).toBe(1);
    expect(state.runs[0].new_blocks).toBe(2);
    expect(state.runs[0].duration_ms).toBe(10);
    expect(typeof state.runs[0].ts).toBe('number');
  });

  it('accumulates across multiple calls', () => {
    const state = defaultAuditState();
    updateAuditState(state, {
      filesScanned: 2,
      newBlocks: 3,
      categories: ['speculation_language'],
      durationMs: 20,
    });
    updateAuditState(state, {
      filesScanned: 1,
      newBlocks: 4,
      categories: ['speculation_language', 'causality_language'],
      durationMs: 15,
    });

    expect(state.totals.sessions_scanned).toBe(3);
    expect(state.totals.blocks_total).toBe(7);
    expect(state.totals.by_category.speculation_language).toBe(2);
    expect(state.totals.by_category.causality_language).toBe(1);
    expect(state.runs.length).toBe(2);
  });
});

// =============================================================================
// Full integration: empty state → process JSONL with 2 block events → totals = 2
// =============================================================================
describe('full integration', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('empty state → 2 block events in JSONL → state.totals.blocks_total = 2', () => {
    tmpDir = makeTempDir();
    const beforeTs = Date.now() - 5000;

    // Write a session file with 2 block events
    const sessionFile = writeTempJsonl(tmpDir, 'session-with-blocks.jsonl', [
      ...blockLines(['speculation_language']),
      ...blockLines(['causality_language']),
    ]);

    // Verify file was found
    const newFiles = findNewSessionFiles(tmpDir, beforeTs);
    expect(newFiles).toContain(sessionFile);

    // Parse block events from the file
    const { count, categories } = parseBlockEvents(sessionFile);
    expect(count).toBe(2);

    // Update state
    const state = defaultAuditState();
    const startMs = Date.now();
    updateAuditState(state, {
      filesScanned: newFiles.length,
      newBlocks: count,
      categories,
      durationMs: Date.now() - startMs,
    });

    expect(state.totals.blocks_total).toBe(2);
    expect(state.totals.sessions_scanned).toBe(1);
    expect(state.runs.length).toBe(1);
    expect(state.runs[0].new_blocks).toBe(2);
  });
});
