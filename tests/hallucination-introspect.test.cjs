'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { hashText, appendIntrospectionLog } = require('../scripts/hallucination-audit-stop.cjs');
const {
  parseArgs,
  readJsonlFile,
  appendJsonlEntry,
  cmdAnnotate,
  cmdAddNegative,
  cmdSummary,
} = require('../scripts/hallucination-annotate.cjs');

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

function makeTempPath(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}.jsonl`);
}

// =============================================================================
// hashText
// =============================================================================
describe('hashText', () => {
  it('returns a 16-character hex string', () => {
    const result = hashText('hello world');
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 16);
    assert.match(result, /^[0-9a-f]{16}$/);
  });

  it('same input produces same hash (deterministic)', () => {
    const a = hashText('deterministic input');
    const b = hashText('deterministic input');
    assert.equal(a, b);
  });

  it('different inputs produce different hashes', () => {
    const a = hashText('input one');
    const b = hashText('input two');
    assert.notEqual(a, b);
  });

  it('handles empty string', () => {
    const result = hashText('');
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 16);
    assert.match(result, /^[0-9a-f]{16}$/);
  });
});

// =============================================================================
// appendIntrospectionLog
// =============================================================================
describe('appendIntrospectionLog', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('appends a JSON line to a temp file', () => {
    tmpFile = makeTempPath('introspect-append');
    const entry = { timestamp: '2026-01-01T00:00:00.000Z', matchCount: 1 };
    appendIntrospectionLog(tmpFile, entry);

    const raw = fs.readFileSync(tmpFile, 'utf-8');
    assert.ok(raw.trim().length > 0);
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.matchCount, 1);
  });

  it('appends multiple entries as separate lines', () => {
    tmpFile = makeTempPath('introspect-multi');
    appendIntrospectionLog(tmpFile, { seq: 1 });
    appendIntrospectionLog(tmpFile, { seq: 2 });
    appendIntrospectionLog(tmpFile, { seq: 3 });

    const raw = fs.readFileSync(tmpFile, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).seq, 1);
    assert.equal(JSON.parse(lines[1]).seq, 2);
    assert.equal(JSON.parse(lines[2]).seq, 3);
  });

  it('silently ignores write failures for invalid paths', () => {
    const invalidPath = '/dev/null/no-such-dir/file.jsonl';
    // Must not throw.
    assert.doesNotThrow(() => {
      appendIntrospectionLog(invalidPath, { test: true });
    });
  });

  it('each line is valid JSON', () => {
    tmpFile = makeTempPath('introspect-json');
    appendIntrospectionLog(tmpFile, { kind: 'speculation_language', evidence: 'probably' });
    appendIntrospectionLog(tmpFile, { kind: 'causality_language', evidence: 'because' });

    const raw = fs.readFileSync(tmpFile, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `Line is not valid JSON: ${line}`);
    }
  });
});

// =============================================================================
// parseArgs
// =============================================================================
describe('parseArgs', () => {
  it('parses positional arguments', () => {
    const result = parseArgs(['file.jsonl', 'second']);
    assert.deepEqual(result._positional, ['file.jsonl', 'second']);
  });

  it('parses --flag value pairs', () => {
    const result = parseArgs(['--line', '3', '--label', 'fp']);
    assert.equal(result.line, '3');
    assert.equal(result.label, 'fp');
  });

  it('parses boolean flags (--flag without value)', () => {
    const result = parseArgs(['--summary']);
    assert.equal(result.summary, true);
  });

  it('handles mixed positional and flag arguments', () => {
    const result = parseArgs(['log.jsonl', '--line', '1', '--label', 'tp', '--summary']);
    assert.deepEqual(result._positional, ['log.jsonl']);
    assert.equal(result.line, '1');
    assert.equal(result.label, 'tp');
    assert.equal(result.summary, true);
  });

  it('handles empty argv', () => {
    const result = parseArgs([]);
    assert.deepEqual(result._positional, []);
    assert.equal(Object.keys(result).length, 1); // only _positional
  });

  it('treats a flag followed by another flag as boolean', () => {
    const result = parseArgs(['--add-negative', '--text', 'hello']);
    assert.equal(result['add-negative'], true);
    assert.equal(result.text, 'hello');
  });
});

// =============================================================================
// readJsonlFile
// =============================================================================
describe('readJsonlFile', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('reads and parses a JSONL file', () => {
    tmpFile = makeTempPath('rjf-reads');
    fs.writeFileSync(tmpFile, '{"a":1}\n{"b":2}\n', 'utf-8');
    const entries = readJsonlFile(tmpFile);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], { a: 1 });
    assert.deepEqual(entries[1], { b: 2 });
  });

  it('returns empty array for non-existent file', () => {
    const nonExistent = path.join(os.tmpdir(), `hd-no-such-${crypto.randomUUID()}.jsonl`);
    const entries = readJsonlFile(nonExistent);
    assert.deepEqual(entries, []);
  });

  it('skips malformed lines', () => {
    tmpFile = makeTempPath('rjf-malformed');
    fs.writeFileSync(tmpFile, '{"ok":1}\nnot json here\n{"also":"ok"}\n', 'utf-8');
    const entries = readJsonlFile(tmpFile);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ok, 1);
    assert.equal(entries[1].also, 'ok');
  });

  it('handles empty file', () => {
    tmpFile = makeTempPath('rjf-empty');
    fs.writeFileSync(tmpFile, '', 'utf-8');
    const entries = readJsonlFile(tmpFile);
    assert.deepEqual(entries, []);
  });
});

// =============================================================================
// appendJsonlEntry
// =============================================================================
describe('appendJsonlEntry', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('appends a JSON line to a file', () => {
    tmpFile = makeTempPath('ajle-append');
    appendJsonlEntry(tmpFile, { x: 42 });
    const raw = fs.readFileSync(tmpFile, 'utf-8');
    const parsed = JSON.parse(raw.trim());
    assert.equal(parsed.x, 42);
  });

  it('creates the file if it does not exist', () => {
    tmpFile = makeTempPath('ajle-create');
    assert.ok(!fs.existsSync(tmpFile));
    appendJsonlEntry(tmpFile, { created: true });
    assert.ok(fs.existsSync(tmpFile));
    const entries = readJsonlFile(tmpFile);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].created, true);
  });
});

// =============================================================================
// cmdSummary
// =============================================================================
describe('cmdSummary', () => {
  let tmpFile;

  before(() => {
    tmpFile = makeTempPath('summary-test');
    // Write 3 detection entries and 2 annotation entries.
    const detections = [
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        wouldBlock: true,
        matchCount: 2,
        textHash: 'aabbccdd11223344',
        categories: {
          speculation_language: 1,
          causality_language: 1,
          pseudo_quantification: 0,
          completeness_claim: 0,
          fabricated_source: 0,
          evaluative_design_claim: 0,
        },
      },
      {
        timestamp: '2026-01-01T01:00:00.000Z',
        wouldBlock: false,
        matchCount: 0,
        textHash: 'deadbeef00000000',
        categories: {
          speculation_language: 0,
          causality_language: 0,
          pseudo_quantification: 0,
          completeness_claim: 0,
          fabricated_source: 0,
          evaluative_design_claim: 0,
        },
      },
      {
        timestamp: '2026-01-01T02:00:00.000Z',
        wouldBlock: true,
        matchCount: 1,
        textHash: '1234567890abcdef',
        categories: {
          speculation_language: 0,
          causality_language: 0,
          pseudo_quantification: 1,
          completeness_claim: 0,
          fabricated_source: 0,
          evaluative_design_claim: 0,
        },
      },
    ];
    const annotations = [
      {
        type: 'annotation',
        timestamp: '2026-01-01T03:00:00.000Z',
        targetLine: 1,
        targetHash: 'aabbccdd11223344',
        label: 'fp',
        category: 'speculation_language',
        note: null,
      },
      {
        type: 'annotation',
        timestamp: '2026-01-01T04:00:00.000Z',
        targetLine: 3,
        targetHash: '1234567890abcdef',
        label: 'tp',
        category: 'pseudo_quantification',
        note: 'confirmed',
      },
    ];

    for (const entry of [...detections, ...annotations]) {
      fs.appendFileSync(tmpFile, `${JSON.stringify(entry)}\n`, 'utf-8');
    }
  });

  after(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  });

  it('summary output contains correct detection entry count', () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdSummary(tmpFile);
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = chunks.join('');
    assert.ok(output.includes('Total detection entries : 3'), `Output was:\n${output}`);
  });

  it('summary output contains correct would-block count', () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdSummary(tmpFile);
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = chunks.join('');
    assert.ok(output.includes('Would-block events      : 2'), `Output was:\n${output}`);
  });

  it('summary output contains correct annotation count', () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdSummary(tmpFile);
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = chunks.join('');
    assert.ok(output.includes('Total annotations       : 2'), `Output was:\n${output}`);
  });

  it('summary output contains correct total match signals', () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdSummary(tmpFile);
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = chunks.join('');
    // 2 + 0 + 1 = 3
    assert.ok(output.includes('Total match signals     : 3'), `Output was:\n${output}`);
  });

  it('summary output contains annotation label counts', () => {
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdSummary(tmpFile);
    } finally {
      process.stdout.write = originalWrite;
    }
    const output = chunks.join('');
    // 1 fp, 1 tp, 0 fn, 0 tn
    assert.ok(output.includes('fp (false positive) : 1'), `Output was:\n${output}`);
    assert.ok(output.includes('tp (true positive)  : 1'), `Output was:\n${output}`);
    assert.ok(output.includes('fn (false negative) : 0'), `Output was:\n${output}`);
  });
});

// =============================================================================
// cmdAnnotate
// =============================================================================
describe('cmdAnnotate', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = makeTempPath('annotate-test');
  });

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('appends an annotation entry to the log file', () => {
    // Write one detection entry to the log first.
    const detection = {
      timestamp: '2026-01-01T00:00:00.000Z',
      wouldBlock: true,
      matchCount: 1,
      textHash: 'abcd1234abcd1234',
      categories: {
        speculation_language: 1,
        causality_language: 0,
        pseudo_quantification: 0,
        completeness_claim: 0,
        fabricated_source: 0,
        evaluative_design_claim: 0,
      },
    };
    appendJsonlEntry(tmpFile, detection);

    // Capture stdout so cmdAnnotate's success message does not appear in test output.
    const chunks = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
      chunks.push(String(chunk));
      return true;
    };
    try {
      cmdAnnotate(tmpFile, {
        line: '1',
        label: 'fp',
        category: 'speculation_language',
        note: 'test note',
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const entries = readJsonlFile(tmpFile);
    // Original detection + appended annotation = 2 entries.
    assert.equal(entries.length, 2);
    const annotation = entries[1];
    assert.equal(annotation.type, 'annotation');
    assert.equal(annotation.label, 'fp');
    assert.equal(annotation.targetLine, 1);
    assert.equal(annotation.category, 'speculation_language');
    assert.equal(annotation.note, 'test note');
    assert.equal(annotation.targetHash, 'abcd1234abcd1234');
  });

  it('annotation entry has a timestamp', () => {
    const detection = {
      timestamp: '2026-01-01T00:00:00.000Z',
      wouldBlock: false,
      matchCount: 0,
      textHash: '0011223344556677',
      categories: {
        speculation_language: 0,
        causality_language: 0,
        pseudo_quantification: 0,
        completeness_claim: 0,
        fabricated_source: 0,
        evaluative_design_claim: 0,
      },
    };
    appendJsonlEntry(tmpFile, detection);

    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      cmdAnnotate(tmpFile, { line: '1', label: 'tn' });
    } finally {
      process.stdout.write = originalWrite;
    }

    const entries = readJsonlFile(tmpFile);
    const annotation = entries[1];
    assert.ok(typeof annotation.timestamp === 'string');
    assert.ok(annotation.timestamp.length > 0);
  });
});

// =============================================================================
// cmdAddNegative
// =============================================================================
describe('cmdAddNegative', () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = makeTempPath('addneg-test');
  });

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('appends a missed_detection entry to the log file', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      cmdAddNegative(tmpFile, {
        text: 'This is clearly speculative phrasing.',
        category: 'speculation_language',
        note: 'should have been flagged',
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const entries = readJsonlFile(tmpFile);
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.type, 'missed_detection');
    assert.equal(entry.text, 'This is clearly speculative phrasing.');
    assert.equal(entry.expectedCategory, 'speculation_language');
    assert.equal(entry.note, 'should have been flagged');
  });

  it('entry has a timestamp', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      cmdAddNegative(tmpFile, { text: 'some missed text', category: 'causality_language' });
    } finally {
      process.stdout.write = originalWrite;
    }

    const entries = readJsonlFile(tmpFile);
    const entry = entries[0];
    assert.ok(typeof entry.timestamp === 'string');
    assert.ok(entry.timestamp.length > 0);
  });

  it('note defaults to null when not provided', () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      cmdAddNegative(tmpFile, { text: 'missed phrase', category: 'completeness_claim' });
    } finally {
      process.stdout.write = originalWrite;
    }

    const entries = readJsonlFile(tmpFile);
    assert.equal(entries[0].note, null);
  });

  it('creates the log file if it does not exist', () => {
    assert.ok(!fs.existsSync(tmpFile));
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      cmdAddNegative(tmpFile, { text: 'example text', category: 'pseudo_quantification' });
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.ok(fs.existsSync(tmpFile));
  });
});
