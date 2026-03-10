#!/usr/bin/env node
/**
 * Annotation utility for introspection logs.
 *
 * Reads an introspection JSONL log and appends annotation entries.
 * Used to flag false positives, false negatives, and new patterns.
 *
 * Usage:
 *   node scripts/hallucination-annotate.cjs <logfile> --line <N> --label <fp|fn|tp|tn> [--note "..."]
 *   node scripts/hallucination-annotate.cjs <logfile> --add-negative --text "text" --category speculation_language [--note "..."]
 *   node scripts/hallucination-annotate.cjs <logfile> --summary
 */

'use strict';

const fs = require('node:fs');
const { DEFAULT_WEIGHTS } = require('./hallucination-config.cjs');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse process.argv into a simple key-value map.
 * Boolean flags (--flag) map to true.
 * Value flags (--flag value) map to the next token.
 *
 * @param {string[]} argv - Raw argv array (typically process.argv.slice(2))
 * @returns {{ _positional: string[], [key: string]: string | boolean }}
 */
function parseArgs(argv) {
  const result = { _positional: [] };
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        result[key] = next;
        i += 2;
      } else {
        result[key] = true;
        i += 1;
      }
    } else {
      result._positional.push(token);
      i += 1;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

/**
 * Read all lines from a JSONL file. Returns an array of parsed objects.
 * Returns empty array if the file does not exist or cannot be parsed.
 *
 * @param {string} logPath
 * @returns {object[]}
 */
function readJsonlFile(logPath) {
  let raw;
  try {
    raw = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/**
 * Append a single object as a JSON line to a JSONL file.
 *
 * @param {string} logPath
 * @param {object} entry
 * @returns {void}
 */
function appendJsonlEntry(logPath, entry) {
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const VALID_LABELS = new Set(['fp', 'fn', 'tp', 'tn']);

/**
 * Annotate a specific detection line in the log.
 *
 * @param {string} logPath
 * @param {{ line: string, label: string, category?: string, note?: string }} opts
 * @returns {void}
 */
function cmdAnnotate(logPath, opts) {
  const lineNum = parseInt(opts.line, 10);
  if (!Number.isFinite(lineNum) || lineNum < 1) {
    process.stderr.write('Error: --line must be a positive integer (1-indexed).\n');
    process.exit(1);
  }

  if (!VALID_LABELS.has(opts.label)) {
    process.stderr.write(`Error: --label must be one of: fp, fn, tp, tn. Got: ${opts.label}\n`);
    process.exit(1);
  }

  const entries = readJsonlFile(logPath);
  if (entries.length === 0) {
    process.stderr.write(`Error: log file is empty or does not exist: ${logPath}\n`);
    process.exit(1);
  }

  // Find the target entry (1-indexed, detection entries only — not annotation entries).
  const detectionEntries = entries.filter(
    (e) => e.type !== 'annotation' && e.type !== 'missed_detection',
  );
  if (lineNum > detectionEntries.length) {
    process.stderr.write(
      `Error: --line ${lineNum} is out of range. The log has ${detectionEntries.length} detection entries.\n`,
    );
    process.exit(1);
  }

  const target = detectionEntries[lineNum - 1];

  /** @type {object} */
  const annotation = {
    type: 'annotation',
    timestamp: new Date().toISOString(),
    targetLine: lineNum,
    targetHash: target.textHash ?? null,
    label: opts.label,
    category: typeof opts.category === 'string' ? opts.category : null,
    note: typeof opts.note === 'string' ? opts.note : null,
  };

  appendJsonlEntry(logPath, annotation);
  process.stdout.write(
    `Annotation recorded: line ${lineNum}, label=${opts.label}${opts.category ? `, category=${opts.category}` : ''}${opts.note ? `, note="${opts.note}"` : ''}\n`,
  );
}

/**
 * Record a missed detection (text that should have triggered but did not).
 *
 * @param {string} logPath
 * @param {{ text: string, category: string, note?: string }} opts
 * @returns {void}
 */
function cmdAddNegative(logPath, opts) {
  if (typeof opts.text !== 'string' || opts.text.trim() === '') {
    process.stderr.write('Error: --text must be a non-empty string.\n');
    process.exit(1);
  }

  if (typeof opts.category !== 'string' || opts.category.trim() === '') {
    process.stderr.write('Error: --category must be a non-empty string.\n');
    process.exit(1);
  }

  /** @type {object} */
  const entry = {
    type: 'missed_detection',
    timestamp: new Date().toISOString(),
    text: opts.text,
    expectedCategory: opts.category,
    note: typeof opts.note === 'string' ? opts.note : null,
  };

  appendJsonlEntry(logPath, entry);
  process.stdout.write(
    `Missed detection recorded: category=${opts.category}${opts.note ? `, note="${opts.note}"` : ''}\n`,
  );
}

/**
 * Print a summary of detections and annotations from the log.
 *
 * @param {string} logPath
 * @returns {void}
 */
function cmdSummary(logPath) {
  const entries = readJsonlFile(logPath);

  if (entries.length === 0) {
    process.stdout.write(`Log file is empty or does not exist: ${logPath}\n`);
    return;
  }

  const detections = entries.filter(
    (e) => e.type !== 'annotation' && e.type !== 'missed_detection',
  );
  const annotations = entries.filter((e) => e.type === 'annotation');
  const missedDetections = entries.filter((e) => e.type === 'missed_detection');

  // Label counts from annotations
  const labelCounts = { fp: 0, fn: 0, tp: 0, tn: 0 };
  for (const ann of annotations) {
    if (Object.hasOwn(labelCounts, ann.label)) {
      labelCounts[ann.label] += 1;
    }
  }

  // Per-category breakdown from detection entries
  const categoryTotals = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
  let totalWouldBlock = 0;
  let totalMatches = 0;

  for (const det of detections) {
    if (det.wouldBlock) totalWouldBlock += 1;
    totalMatches += det.matchCount ?? 0;
    if (det.categories && typeof det.categories === 'object') {
      for (const cat of Object.keys(categoryTotals)) {
        if (Number.isFinite(det.categories[cat])) {
          categoryTotals[cat] += det.categories[cat];
        }
      }
    }
  }

  const lines = [
    `Introspection log: ${logPath}`,
    '',
    '--- Overview ---',
    `Total detection entries : ${detections.length}`,
    `Would-block events      : ${totalWouldBlock}`,
    `Total match signals     : ${totalMatches}`,
    `Missed detection entries: ${missedDetections.length}`,
    `Total annotations       : ${annotations.length}`,
    '',
    '--- Annotation labels ---',
    `  fp (false positive) : ${labelCounts.fp}`,
    `  fn (false negative) : ${labelCounts.fn}`,
    `  tp (true positive)  : ${labelCounts.tp}`,
    `  tn (true negative)  : ${labelCounts.tn}`,
    '',
    '--- Category match counts (across all detection entries) ---',
  ];

  for (const [cat, count] of Object.entries(categoryTotals)) {
    lines.push(`  ${cat.padEnd(26)}: ${count}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts/hallucination-annotate.cjs <logfile> --line <N> --label <fp|fn|tp|tn> [--category <cat>] [--note "..."]',
      '  node scripts/hallucination-annotate.cjs <logfile> --add-negative --text "text" --category <cat> [--note "..."]',
      '  node scripts/hallucination-annotate.cjs <logfile> --summary',
      '',
      'Labels: fp=false positive, fn=false negative, tp=true positive, tn=true negative',
      '',
      'Categories: speculation_language, causality_language, pseudo_quantification, completeness_claim',
      '',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logPath = args._positional[0];

  if (!logPath) {
    process.stderr.write('Error: <logfile> argument is required.\n\n');
    printUsage();
    process.exit(1);
  }

  if (args.summary) {
    cmdSummary(logPath);
    return;
  }

  if (args['add-negative']) {
    cmdAddNegative(logPath, {
      text: typeof args.text === 'string' ? args.text : '',
      category: typeof args.category === 'string' ? args.category : '',
      note: typeof args.note === 'string' ? args.note : undefined,
    });
    return;
  }

  if (args.line !== undefined || args.label !== undefined) {
    cmdAnnotate(logPath, {
      line: String(args.line ?? ''),
      label: String(args.label ?? ''),
      category: typeof args.category === 'string' ? args.category : undefined,
      note: typeof args.note === 'string' ? args.note : undefined,
    });
    return;
  }

  process.stderr.write(
    'Error: no command specified. Use --line/--label, --add-negative, or --summary.\n\n',
  );
  printUsage();
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  readJsonlFile,
  appendJsonlEntry,
  cmdAnnotate,
  cmdAddNegative,
  cmdSummary,
};
