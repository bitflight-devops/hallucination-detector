#!/usr/bin/env node
/**
 * Stop hook: audit the last assistant message for misinformation patterns.
 *
 * Goal: reduce "speculation as diagnosis" and invented causality/facts.
 *
 * Mechanism:
 * - Parse Stop hook input (stdin JSON).
 * - Read `transcript_path` (JSONL).
 * - Extract last main-chain assistant message text.
 * - If flagged, emit JSON: { "decision": "block", "reason": "..." } (exit 0).
 *
 * Notes:
 * - Uses a small per-session counter in OS tempdir to avoid infinite loops.
 * - Does not attempt to infer truth; it enforces language discipline and evidence signaling.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Telemetry: node:sqlite is experimental (Node 22.5+). Wrap in try/catch so the
// hook continues normally on any Node version that does not support it.
let DatabaseSync = null;
let telemetryAvailable = false;
try {
  ({ DatabaseSync } = require('node:sqlite'));
  telemetryAvailable = true;
} catch {
  // node:sqlite unavailable — telemetry disabled, hook continues normally
}

const { loadConfig, loadWeights, DEFAULT_WEIGHTS } = require('./hallucination-config.cjs');
const {
  validateClaimStructure,
  CLAIM_LABEL_ALTERNATION,
} = require('./hallucination-claim-structure.cjs');

// =============================================================================
// Telemetry
// =============================================================================

const TELEMETRY_DB_PATH = path.join(os.homedir(), '.hd', 'telemetry', 'hallucination-detector.db');
const SHADOW_LOG_PATH = path.join(os.homedir(), '.hd', 'telemetry', 'shadow-log.jsonl');

const PRICING = {
  'claude-opus-4-6': { output: 75 / 1e6, cache_read: 1.5 / 1e6 },
  'claude-sonnet-4-6': { output: 15 / 1e6, cache_read: 0.3 / 1e6 },
  'claude-haiku-4-5-20251001': { output: 4 / 1e6, cache_read: 0.08 / 1e6 },
};
// Default to sonnet pricing when model is unknown or not in PRICING map.
const DEFAULT_PRICING = PRICING['claude-sonnet-4-6'];

/** Module-level DB connection — opened once, reused across writeTelemetry calls. */
let _telemetryDb = null;

/**
 * Open (or return the cached) telemetry DB connection.
 * Returns null on any failure so callers can detect unavailability.
 *
 * @returns {object|null}
 */
function getTelemetryDb() {
  if (_telemetryDb) return _telemetryDb;
  try {
    fs.mkdirSync(path.dirname(TELEMETRY_DB_PATH), { recursive: true });
    const db = new DatabaseSync(TELEMETRY_DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS hook_events (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        ts                 INTEGER NOT NULL,
        session_id         TEXT    NOT NULL,
        project_dir        TEXT,
        model              TEXT,
        event_type         TEXT    NOT NULL,
        categories         TEXT,
        evidence           TEXT,
        error_codes        TEXT,
        output_tokens      INTEGER,
        cache_read_tokens  INTEGER,
        estimated_cost_usd REAL,
        response_snippet   TEXT,
        retry_count        INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ts         ON hook_events(ts);
      CREATE INDEX IF NOT EXISTS idx_session_id ON hook_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_event_type ON hook_events(event_type);
    `);
    // Migrate existing databases that predate these columns.
    // SQLite does not support ADD COLUMN IF NOT EXISTS — use try/catch per column.
    try {
      db.exec('ALTER TABLE hook_events ADD COLUMN stop_hook_active INTEGER');
    } catch {
      /* column already exists */
    }
    try {
      db.exec('ALTER TABLE hook_events ADD COLUMN permission_mode TEXT');
    } catch {
      /* column already exists */
    }
    try {
      db.exec('ALTER TABLE hook_events ADD COLUMN hook_event_name TEXT');
    } catch {
      /* column already exists */
    }
    _telemetryDb = db;
    return db;
  } catch {
    return null;
  }
}

/**
 * Write a single telemetry event record. Silent on any failure.
 *
 * @param {object} event
 * @param {string}   event.event_type
 * @param {string}   event.session_id
 * @param {string}   [event.project_dir]
 * @param {string}   [event.model]
 * @param {string[]} [event.categories]
 * @param {string[]} [event.evidence]
 * @param {string[]} [event.error_codes]
 * @param {number}   [event.output_tokens]
 * @param {number}   [event.cache_read_tokens]
 * @param {string}   [event.response_snippet]
 * @param {number}   [event.retry_count]
 * @param {number}   [event.stop_hook_active] - 1 if stop_hook_active was true, 0 otherwise
 * @param {string}   [event.permission_mode]
 * @param {string}   [event.hook_event_name]
 */
function writeTelemetry(event) {
  if (!telemetryAvailable) return;
  try {
    const db = getTelemetryDb();
    if (!db) return;

    const model = event.model || 'unknown';
    const pricing = PRICING[model] || DEFAULT_PRICING;
    const outputTokens = event.output_tokens || 0;
    const cacheReadTokens = event.cache_read_tokens || 0;
    const estimatedCost = outputTokens * pricing.output + cacheReadTokens * pricing.cache_read;

    const stmt = db.prepare(`
      INSERT INTO hook_events (
        ts, session_id, project_dir, model, event_type,
        categories, evidence, error_codes,
        output_tokens, cache_read_tokens, estimated_cost_usd,
        response_snippet, retry_count,
        stop_hook_active, permission_mode, hook_event_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      Date.now(),
      event.session_id || '',
      event.project_dir || null,
      model,
      event.event_type,
      event.categories ? JSON.stringify(event.categories) : null,
      event.evidence ? JSON.stringify(event.evidence) : null,
      event.error_codes ? JSON.stringify(event.error_codes) : null,
      outputTokens || null,
      cacheReadTokens || null,
      estimatedCost > 0 ? estimatedCost : null,
      event.response_snippet || null,
      event.retry_count ?? null,
      event.stop_hook_active ?? null,
      event.permission_mode || null,
      event.hook_event_name || null,
    );
  } catch {
    // intentionally silent — telemetry failure must not affect hook behavior
  }
}

/**
 * Append a single shadow-mode event to the shadow log JSONL file.
 * Used when dryRun: true — records would-block decisions without actually blocking.
 * Silent on any failure (same pattern as writeTelemetry).
 *
 * @param {object} event
 * @param {string}   event.sessionId
 * @param {string}   [event.model]
 * @param {string[]} [event.categories]
 * @param {string}   [event.evidence]
 * @param {string}   [event.responseSnippet]
 */
function writeShadowLog(event) {
  try {
    const dir = path.dirname(SHADOW_LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      ts: Date.now(),
      session_id: event.sessionId || '',
      model: event.model || 'unknown',
      categories: Array.isArray(event.categories) ? event.categories : [],
      evidence: event.evidence || '',
      response_snippet: event.responseSnippet || '',
      dry_run: true,
    };
    fs.appendFileSync(SHADOW_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // intentionally silent — shadow log failure must not affect hook behavior
  }
}

/**
 * Extract model name and token usage from the last assistant entry in transcript entries.
 * Scans the last 20 entries (from the end) for an assistant record with a model field.
 *
 * @param {object[]} entries - Parsed JSONL entries
 * @returns {{ model: string, output_tokens: number, cache_read_tokens: number }}
 */
function getLastAssistantMeta(entries) {
  const result = { model: 'unknown', output_tokens: 0, cache_read_tokens: 0 };
  const slice = entries.slice(-20);
  for (let i = slice.length - 1; i >= 0; i--) {
    const entry = slice[i];
    if (!entry || entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg) continue;
    if (typeof msg.model === 'string' && msg.model) result.model = msg.model;
    if (msg.usage) {
      result.output_tokens = msg.usage.output_tokens || 0;
      result.cache_read_tokens = msg.usage.cache_read_input_tokens || 0;
    }
    break;
  }
  return result;
}

function readStdinJson() {
  try {
    const stdin = fs.readFileSync(0, 'utf-8');
    return JSON.parse(stdin);
  } catch {
    return {};
  }
}

function safeReadFileText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// Compaction directive patterns. When the first human-role message in the transcript
// matches any of these, the session is a compact agent session and must be exempted
// from all trigger detection. Compact agents summarize prior conversation content —
// they cannot rephrase words like "may", "because", "since" that appear in the
// conversation they are summarizing.
const COMPACT_DIRECTIVE_PATTERNS = [
  // Explicit compaction instruction tags
  /<compaction_instructions>/i,
  /\bcompaction\b/i,
  // Task-based phrasing
  /your task is to create a\b.{0,80}\bsummar/i,
  // Context window summary requests
  /\bcontext window\b.{0,80}\bsummar/i,
  // Direct summarization imperatives
  /\bsummariz[e]?\s+(?:the\s+)?conversation\b/i,
  /\bsummariz[e]?\s+this\s+conversation\b/i,
  // Condense phrasing
  /\bcondense\b.{0,80}\bconversation\b/i,
];

/**
 * Return true when the transcript at `transcriptPath` belongs to a compact agent
 * session — detected by finding the first human-role JSONL record whose text
 * matches one of COMPACT_DIRECTIVE_PATTERNS.
 *
 * Reads only the first 5 JSONL lines for performance.
 *
 * @param {string} transcriptPath
 * @returns {boolean}
 */
function isCompactAgentSession(transcriptPath) {
  if (!transcriptPath) return false;
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf-8');
  } catch {
    return false;
  }
  const lines = raw.split('\n');
  let checked = 0;
  for (const line of lines) {
    if (checked >= 5) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    checked++;
    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    // Match human/user role entries only
    const role = record.role ?? record.type;
    if (role !== 'user' && role !== 'human') continue;
    const text = extractTextFromMessageContent(record.content ?? record.message?.content ?? '');
    if (COMPACT_DIRECTIVE_PATTERNS.some((re) => re.test(text))) return true;
  }
  return false;
}

function parseJsonl(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // ignore non-JSON lines
    }
  }
  return entries;
}

function isMainChainEntry(entry) {
  return entry && typeof entry === 'object' && !entry.isSidechain && !entry.isMeta && entry.type;
}

function extractTextFromMessageContent(content) {
  // Claude transcripts commonly store content as an array of blocks.
  // We only extract human-readable text; we ignore tool_use blocks.
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_use') continue;

    // Common block shapes:
    // - { type: "text", text: "..." }
    // - { type: "output_text", text: "..." } (future-proof)
    // - { ... , content: "..." }
    if (typeof block.text === 'string' && block.text.trim()) {
      parts.push(block.text);
      continue;
    }
    if (typeof block.content === 'string' && block.content.trim()) {
      parts.push(block.content);
    }
  }
  return parts.join('\n').trim();
}

function getLastAssistantText(transcriptEntries) {
  // Find last main-chain assistant entry with message content.
  for (let i = transcriptEntries.length - 1; i >= 0; i--) {
    const entry = transcriptEntries[i];
    if (!isMainChainEntry(entry)) continue;

    const type = entry.type;
    const message = entry.message;
    if (type !== 'assistant' || !message) continue;

    const content = message.content;
    const text = extractTextFromMessageContent(content);
    if (text) return text;
  }
  return '';
}

function normalizeForScan(text) {
  return text.replace(/\r\n/g, '\n');
}

function stripLowSignalRegions(text) {
  // Avoid false positives from quoted user text or code samples.
  // We only enforce these language rules on the assistant's narrative assertions.
  let out = text;

  // Remove fenced code blocks.
  out = out.replace(/```[\s\S]*?```/g, '');

  // Remove inline code spans.
  out = out.replace(/`[^`\n]*`/g, '');

  // Remove blockquote lines (often used for quoting user text or external sources).
  out = out
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');

  return out;
}

// Change 1: Evidence marker helper — suppresses causality flags when nearby text
// already contains observable evidence (code, quoted text, error codes, file refs).
// Note: EVIDENCE_MARKERS are tested against the stripped haystack, so the backtick
// inline-code marker would be dead (stripped text has no backticks). Instead we
// pass the original (pre-strip) text as `rawText` and check it separately.
const EVIDENCE_MARKERS = [
  /["'][^"']{3,}["']/, // quoted text
  /\b(?:error|exit)\s*(?:code)?\s*\d+/i, // error codes
  /\b[A-Z]\d{3,4}\b/, // linter codes E501, W291
  /\b(?:returned|reported|showed|output|printed|logged|threw|raised|exited|failed)\b/i,
  /\b(?:stdout|stderr|traceback|exception|stack\s*trace)\b/i,
  /[\w/]+\.\w{1,6}:\d+/, // file:line references
];

const BACKTICK_RE = /`[^`\n]+`/; // inline code — tested against raw (pre-strip) text

// Evaluative design tell phrases — exact multi-word phrases only; near-zero false-positive risk.
// The `g` flag is required so the for...of loop in findTriggerMatches() can iterate all occurrences.
const EVALUATIVE_DESIGN_TELLS =
  /\b(?:the\s+cleanest\s+fix|the\s+simplest\s+fix|cleanest\s+solution|simplest\s+solution|cleanest\s+approach|simplest\s+approach|the\s+obvious\s+fix|the\s+obvious\s+solution)\b/gi;
// Module-scope global variant for matchAll() — avoids per-call RegExp recompilation and
// eliminates the lastIndex drift trap that a shared `g`-flagged regex carries across calls.
const EVALUATIVE_DESIGN_TELLS_GLOBAL = new RegExp(EVALUATIVE_DESIGN_TELLS.source, 'gi');

/**
 * Determine whether evidence-like tokens or inline code appear near a given index in the text.
 *
 * Checks a window centered at `idx` (default ±150 characters) in `text` for any regexes from
 * `EVIDENCE_MARKERS`. If `rawText` is provided, also checks the same window in `rawText` for
 * inline code backticks using `BACKTICK_RE`.
 *
 * @param {string} text - The normalized/stripped text to scan for evidence markers.
 * @param {number} idx - Character index around which to search.
 * @param {string} [rawText] - Optional original unstripped text used to detect inline code.
 * @param {number} [windowSize=150] - Number of characters to include on each side of `idx`.
 * @returns {boolean} `true` if any evidence marker or inline code is found within the window, `false` otherwise.
 */
function hasEvidenceNearby(text, idx, rawText, windowSize = 150) {
  const start = Math.max(0, idx - windowSize);
  const end = Math.min(text.length, idx + windowSize);
  const window = text.slice(start, end);
  if (EVIDENCE_MARKERS.some((re) => re.test(window))) return true;
  // Backtick evidence is checked against the original unstripped text around the same position.
  if (rawText) {
    const rawStart = Math.max(0, idx - windowSize);
    const rawEnd = Math.min(rawText.length, idx + windowSize);
    const rawWindow = rawText.slice(rawStart, rawEnd);
    if (BACKTICK_RE.test(rawWindow)) return true;
  }
  return false;
}

function isIndexWithinQuestion(text, idx) {
  // Heuristic: treat the containing "sentence" as a question if it includes a '?'
  // between the nearest prior sentence boundary and the next sentence boundary.
  const startBoundary = Math.max(
    text.lastIndexOf('\n', idx),
    text.lastIndexOf('.', idx),
    text.lastIndexOf('!', idx),
    text.lastIndexOf('?', idx),
  );
  const start = startBoundary === -1 ? 0 : startBoundary + 1;

  const nextNewline = text.indexOf('\n', idx);
  const nextDot = text.indexOf('.', idx);
  const nextBang = text.indexOf('!', idx);
  const nextQ = text.indexOf('?', idx);

  const candidates = [nextNewline, nextDot, nextBang, nextQ].filter((n) => n !== -1);
  const end = candidates.length ? Math.min(...candidates) + 1 : text.length;

  const segment = text.slice(start, end);
  return segment.includes('?');
}

/**
 * Extract the sentence containing the character at `index` from `text`.
 * Sentence boundaries: '.', '!', '?', '\n\n', or start/end of string.
 * A '.' followed immediately by a word character is treated as an intra-token
 * dot (file extension, decimal, URL segment) and is NOT a sentence boundary.
 * Returns the sentence as a string.
 */
function getSentenceContaining(text, index) {
  // Find start: walk back to previous sentence-ending punctuation or start.
  // Skip dots that are immediately followed by a word character (intra-token dots).
  let start = index;
  while (start > 0) {
    const prev = text[start - 1];
    if (!/[.!?\n]/.test(prev)) {
      start--;
      continue;
    }
    // It is a punctuation char — check if it's an intra-token dot.
    if (prev === '.' && start < text.length && /\w/.test(text[start])) {
      // Dot followed by word char: part of a file extension or similar — keep walking.
      start--;
      continue;
    }
    break;
  }

  // Find end: walk forward to next sentence-ending punctuation or end.
  // Skip dots immediately followed by a word character (intra-token dots).
  let end = index;
  while (end < text.length) {
    if (text[end] === '\n' && text[end + 1] === '\n') break;
    if (/[!?]/.test(text[end])) break;
    if (text[end] === '.') {
      // Dot followed by word char: intra-token, skip.
      if (end + 1 < text.length && /\w/.test(text[end + 1])) {
        end++;
        continue;
      }
      break;
    }
    end++;
  }
  return text.slice(start, end + 1).trim();
}

// File-extension pattern for hasSentenceCodeReference — compiled once at module scope.
const SENTENCE_FILE_EXT_RE = /\b[\w./-]+\.(cjs|mjs|js|ts|py|json|yaml|yml|md|sh|rb|go|rs)\b/;
// Function-call pattern (word followed by open paren).
const SENTENCE_FUNC_CALL_RE = /\b\w+\s*\(/;
// Line-number reference: "line 17" or ":42" style.
const SENTENCE_LINE_NUM_RE = /\bline\s+\d+\b|:\d+\b/i;

/**
 * Returns true if the sentence containing `index` in `text` contains any
 * code reference signal: file path, function call, line number, or backtick.
 */
function hasSentenceCodeReference(text, index) {
  const sentence = getSentenceContaining(text, index);
  return (
    SENTENCE_FILE_EXT_RE.test(sentence) ||
    SENTENCE_FUNC_CALL_RE.test(sentence) ||
    SENTENCE_LINE_NUM_RE.test(sentence) ||
    sentence.includes('`')
  );
}

// Change 4: isQualityScore — distinguishes genuine quality ratings from ratios/counts.
function isQualityScore(text, matchStr, matchIndex) {
  const [numStr] = matchStr.split('/');
  const numerator = parseFloat(numStr);

  // 10/10 identity ratio = count, not score
  if (numerator === 10) return false;

  // Decimal numerator = strong quality signal
  if (numStr.includes('.')) return true;

  // Followed by a count noun = ratio not score
  const after = text.slice(matchIndex + matchStr.length, matchIndex + matchStr.length + 35);
  if (
    /^\s+(?:requirements?|items?|tests?|files?|checks?|tasks?|steps?|issues?|points?|modules?|cases?|features?|commits?|lines?|rules?)\b/i.test(
      after,
    )
  )
    return false;

  return true;
}

// Module-level list-item pattern used by hasEnumerationNearby.
// Global flag required for String.prototype.match to return all matches.
const LIST_ITEM_RE = /^\s*(?:\d+[.)]\s|\*\s|-\s)/gm;

// Uncertainty markers — phrases that signal the assistant is explicitly disclosing
// what it does NOT know. When a speculation phrase appears near these markers,
// the speculation serves a disclosure function, not a speculative-assertion function.
const UNCERTAINTY_MARKERS = [
  /\bi\s+don'?t\s+know\b/i,
  /\bi\s+haven'?t\s+(?:verified|confirmed|checked|tested|validated)\b/i,
  /\bunclear\s+(?:whether|if|what|why|how)\b/i,
  /\bunknown\s+(?:whether|if|what|why|how|at\s+this\s+time)\b/i,
  /\bnot\s+sure\s+(?:if|whether|what|why|how|about)\b/i,
  /\bhaven'?t\s+confirmed\b/i,
  /\bcannot\s+(?:confirm|verify|determine)\b/i,
  /\bcan'?t\s+(?:confirm|verify|determine)\b/i,
  /\bnot\s+(?:yet\s+)?(?:confirmed|verified|determined|established)\b/i,
  /\bremains\s+(?:unclear|unknown|unverified|unconfirmed)\b/i,
  /\bno\s+evidence\s+(?:that|of|for)\b/i,
  /\bunable\s+to\s+(?:confirm|verify|determine)\b/i,
  /\bopen\s+question\b/i,
  /\bneed(?:s)?\s+to\s+(?:verify|confirm|check|investigate|determine)\b/i,
  /\bi\s+have\s+not\s+(?:verified|confirmed|checked|tested)\b/i,
];

// Change 5: hasEnumerationNearby — suppresses structural completeness flags when
// the preceding context contains a numbered/bulleted list (2+ items).
function hasEnumerationNearby(text, idx) {
  const start = Math.max(0, idx - 200);
  const preceding = text.slice(start, idx);
  const allMatches = preceding.match(LIST_ITEM_RE);
  return allMatches !== null && allMatches.length >= 2;
}

/**
 * Returns true when a speculation phrase appears within an explicit uncertainty
 * enumeration — the assistant is disclosing unknowns, not making speculative assertions.
 *
 * Uses a window-based approach (200 chars preceding, 80 following) with a
 * paragraph-break guard to prevent cross-paragraph leakage.
 *
 * @param {string} text - The haystack text.
 * @param {number} idx - Character index of the speculation phrase.
 * @param {number} [precedingWindow=200] - Chars to look back.
 * @param {number} [followingWindow=80] - Chars to look ahead.
 * @returns {boolean}
 */
function isWithinUncertaintyEnumeration(text, idx, precedingWindow = 200, followingWindow = 80) {
  const start = Math.max(0, idx - precedingWindow);
  const end = Math.min(text.length, idx + followingWindow);
  const window = text.slice(start, end);
  const idxInWindow = idx - start;

  for (const re of UNCERTAINTY_MARKERS) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const match of window.matchAll(globalRe)) {
      const markerPos = match.index;
      const segStart = Math.min(markerPos, idxInWindow);
      const segEnd = Math.max(markerPos + match[0].length, idxInWindow);
      const between = window.slice(segStart, segEnd);
      if (/\n\n/.test(between)) continue;
      return true;
    }
  }
  return false;
}

// Common words that start with "un" but are NOT negations — they would be
// misclassified by the /^un\w+(?:ed|d)$/ prefix check in isNegatedParticiple.
const NON_NEGATION_UN_WORDS = new Set([
  'understood',
  'united',
  'undertook',
  'underpinned',
  'underscored',
  'underlined',
  'undermined',
  'undergirded',
  'unveiled',
  'unwound',
  'uploaded',
  'updated',
  'uprooted',
  'upended',
]);

/**
 * Returns true when a "fully/completely + participle" match is a negation/disclaimer.
 * E.g., "completely unverified" disclaims completeness; "fully resolved" claims it.
 *
 * @param {string} matchedText - The regex match (e.g., "completely unverified").
 * @param {string} fullText - The full haystack text.
 * @param {number} matchIndex - The character index of the match in fullText.
 * @returns {boolean}
 */
function isNegatedParticiple(matchedText, fullText, matchIndex) {
  const words = matchedText.trim().split(/\s+/);
  const participle = words[words.length - 1].toLowerCase();

  // Exception: common "un-" words that are not negations
  if (NON_NEGATION_UN_WORDS.has(participle)) {
    return false;
  }

  // Safe prefixes where removal reliably indicates negation
  if (/^(?:un|non|dis)\w+(?:ed|d)$/i.test(participle)) {
    return true;
  }

  // Explicit negation preceding the adverb: "not fully verified", "never fully tested"
  const precedingWindow = fullText.slice(Math.max(0, matchIndex - 15), matchIndex).toLowerCase();
  if (/\b(?:not|never|no)\s*$/.test(precedingWindow)) {
    return true;
  }

  return false;
}

/**
 * Detects linguistic signals that suggest uncertainty, causal claims, uncited quantification, completeness assertions, or evaluative-design statements in the provided text.
 *
 * @param {string} text - The text to scan for trigger patterns (typically an assistant message).
 * @param {object} [config={}] - Optional config object (from loadConfig()).  Honoured fields:
 *   - `config.categories.<name>.enabled` — skip the entire category when `false`.
 *   - `config.categories.<name>.customPatterns` — `{ pattern, evidence }[]` added to (or replacing) built-ins.
 *   - `config.categories.<name>.replacePatterns` — when `true`, customPatterns replaces built-ins.
 *   - `config.allowlist` — array of strings/RegExps; any match whose evidence satisfies an entry is dropped.
 *   - `config.maxTriggersPerResponse` — upper bound on the number of returned matches.
 * @returns {Array<{kind: string, evidence: string}>} An array of match objects where `kind` is one of: `speculation_language`, `causality_language`, `pseudo_quantification`, `completeness_claim`, or `evaluative_design_claim`, and `evidence` is the matched snippet from the text.
 */
function findTriggerMatches(text, config = {}) {
  const rawMatches = [];
  const rawText = normalizeForScan(text);
  const haystack = stripLowSignalRegions(rawText);
  const lower = haystack.toLowerCase();

  const cats = config.categories && typeof config.categories === 'object' ? config.categories : {};

  /** Returns true when `catName` is enabled (default: true). */
  function isCategoryEnabled(catName) {
    const cat = cats[catName];
    return !cat || cat.enabled !== false;
  }

  /** Returns true when built-in patterns should run for `catName`. */
  function useBuiltIn(catName) {
    const cat = cats[catName];
    return !cat || !cat.replacePatterns;
  }

  /**
   * Run custom `{ pattern, evidence }` patterns for a category and push matches.
   * `pattern` may be:
   *   - A real RegExp object (from a `.cjs` config loaded via `require()`).
   *   - A `/regex/flags`-style string (from JSON/TOML sources).
   *   - A plain string (matched case-insensitively).
   */
  function runCustomPatterns(catName) {
    const cat = cats[catName];
    if (!cat || !Array.isArray(cat.customPatterns)) return;
    for (const item of cat.customPatterns) {
      if (!item || !item.pattern) continue;
      const { pattern, evidence } = item;
      let found = false;
      if (pattern instanceof RegExp) {
        // Real RegExp from a .cjs config — test directly against the haystack.
        found = pattern.test(haystack);
      } else if (typeof pattern === 'string' && pattern.startsWith('/')) {
        // "/pattern/flags" string from JSON or TOML sources.
        const lastSlash = pattern.lastIndexOf('/');
        if (lastSlash > 0) {
          try {
            const re = new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1) || 'i');
            found = re.test(haystack);
          } catch {
            // invalid regex — skip
          }
        }
      } else if (typeof pattern === 'string') {
        found = lower.includes(pattern.toLowerCase());
      }
      if (found) {
        rawMatches.push({
          kind: catName,
          evidence: typeof evidence === 'string' ? evidence : String(pattern),
        });
      }
    }
  }

  // Convenience alias used throughout the existing detection blocks.
  const matches = rawMatches;

  // 1) Assumption/speculation language (explicitly discouraged by repo policy)
  if (isCategoryEnabled('speculation_language')) {
    if (useBuiltIn('speculation_language')) {
      // Change 3: 'should be' removed from speculationPhrases; handled via regex below.
      const speculationPhrases = [
        'i think',
        'i believe',
        'probably',
        'likely',
        'it seems',
        'seems like',
        'i assume',
        'assume',
        'maybe',
        'might be',
        'could be',
        'presumably',
        'may',
      ];
      // Pronouns that precede "may" in permissive/instructional usage ("you may use").
      const PERMISSIVE_MAY_PRONOUNS = new Set([
        'you',
        'one',
        'anyone',
        'users',
        'they',
        'we',
        'caller',
        'clients',
        'consumers',
      ]);
      // Documentation context keywords: when any appear within ±200 chars, "may" is
      // describing an allowable state, not asserting epistemic uncertainty.
      const MAY_DOC_CONTEXT_RE =
        /\b(?:parameter|option|argument|field|value|config|setting|property|attribute|variable)\b/i;
      // Existential/container "may": describes possible presence of data, not a claim.
      const MAY_EXISTENTIAL_RE = /\bmay\s+(?:contain|include|be\s+present|exist|appear)\b/i;
      // Non-epistemic passive constructions: allowable states, not speculation.
      const MAY_PASSIVE_ALLOWABLE_RE =
        /\bmay\s+be\s+(?:modified|omitted|skipped|empty|null|undefined|absent|overridden|ignored)\b/i;

      // Suppression phrases for "assume": first-person + will/let operating assumption.
      const ASSUME_OPERATING_RE =
        /\b(?:i\s+will\s+assume|i'll\s+assume|let'?s\s+assume|let\s+me\s+assume|i'?m\s+going\s+to\s+assume)\b/i;
      // Conditional framing: "assuming X, then" / "assuming X—" / "assuming X the"
      const ASSUME_CONDITIONAL_RE = /\bassuming\s+\S.{0,60}(?:,\s*then\b|—|\s+the\b|\s+this\b)/i;
      // Clarifying assumption: "assume you want" / "assume the default" / "assume standard"
      const ASSUME_CLARIFYING_RE =
        /\bassume\s+(?:you\s+want|the\s+default|standard|conventional)\b/i;

      for (const phrase of speculationPhrases) {
        let searchFrom = 0;
        while (true) {
          const idx = lower.indexOf(phrase, searchFrom);
          if (idx === -1) break;
          searchFrom = idx + phrase.length;

          // Questions like "Should I do that now?" are desirable—don't flag.
          if (isIndexWithinQuestion(haystack, idx)) continue;
          // Use-mention distinction: suppress when the phrase is directly wrapped in
          // matching quote characters (e.g. "assume" or 'probably') — the word is
          // being named/discussed, not used speculatively.
          if (idx > 0) {
            const quoteChar = lower[idx - 1];
            if (
              (quoteChar === '"' || quoteChar === "'") &&
              lower[idx + phrase.length] === quoteChar
            )
              continue;
          }

          if (phrase === 'may') {
            // Suppress permissive "may" when preceded by a permission-granting pronoun.
            const before = lower.slice(0, idx).trimEnd();
            const lastWord = before.slice(before.lastIndexOf(' ') + 1);
            if (PERMISSIVE_MAY_PRONOUNS.has(lastWord)) continue;

            // Suppress when "may" is in a documentation context (±200 chars contains
            // parameter/option/argument/field/value/config/setting/property/attribute/variable).
            const docWindow = haystack.slice(
              Math.max(0, idx - 200),
              Math.min(haystack.length, idx + 200),
            );
            if (MAY_DOC_CONTEXT_RE.test(docWindow)) continue;

            // Suppress existential/container "may": "may contain", "may include", etc.
            const mayExistWindow = haystack.slice(idx, Math.min(haystack.length, idx + 60));
            if (MAY_EXISTENTIAL_RE.test(mayExistWindow)) continue;

            // Suppress non-epistemic passive allowable-state "may": "may be modified", etc.
            if (MAY_PASSIVE_ALLOWABLE_RE.test(mayExistWindow)) continue;
          }

          if (phrase === 'assume' || phrase === 'i assume') {
            // Suppress operating-assumption framing ("I will assume", "let's assume", etc.)
            const assumeWindow = haystack.slice(
              Math.max(0, idx - 30),
              Math.min(haystack.length, idx + 60),
            );
            if (ASSUME_OPERATING_RE.test(assumeWindow)) continue;
            // Suppress conditional framing ("assuming X, then" / "assuming X—")
            if (ASSUME_CONDITIONAL_RE.test(assumeWindow)) continue;
            // Suppress clarifying assumption ("assume you want", "assume the default")
            if (ASSUME_CLARIFYING_RE.test(assumeWindow)) continue;
          }

          // Suppress when the phrase appears within an explicit uncertainty enumeration —
          // the assistant is transparently disclosing what it does not know.
          if (isWithinUncertaintyEnumeration(haystack, idx)) continue;
          matches.push({ kind: 'speculation_language', evidence: phrase });
          break; // one flag per phrase kind is sufficient
        }
      }

      // Change 3: Three-way classification for 'should be'.
      if (lower.includes('should be') || lower.includes('should')) {
        // Allow: prescriptive (followed by a value/identifier/type literal, or a bare
        // word identifier — handles the case where inline code was stripped by
        // stripLowSignalRegions before the pattern runs)
        const PRESCRIPTIVE_SHOULD =
          /\bshould\s+be\s+(?:`[^`]+`|["'][^"']+["']|\d[\d.]*\b|(?:true|false|null|undefined|none|int|str|float|string|boolean|void)\b|(?:a|an|the)\s+\w[\w-]*|[\w][\w-]{1,})/i;
        // Allow: hypothesis framing
        const HYPOTHESIS_SHOULD =
          /\b(?:H[0₀aA1₁]|hypothesis|null hypothesis|prediction)\b[^.]*\bshould\b/i;
        // Allow: instructional ("you should set/use/configure")
        const INSTRUCTIONAL_SHOULD =
          /\byou\s+should\s+(?:set|configure|change|update|use|add|remove|ensure|verify|check)\b/i;
        // Flag: epistemic ("it/this/that should be working/fixed/done")
        // 'that' is split out: as a relative pronoun it follows a noun antecedent ("changes that
        // should be reflected"), producing false positives. Only treat 'that should be' as epistemic
        // when 'that' is sentence-initial (demonstrative pronoun: "That should be resolved.").
        const EPISTEMIC_SUBJECT_SHOULD = /\b(?:it|this|everything|things?)\s+should\s+be\b/i;
        const EPISTEMIC_THAT_SENTENCE_START = /(?:^|[.!?;]\s+)that\s+should\s+be\b/i;

        // Epistemic check runs first — it is the most specific/dangerous signal.
        if (
          EPISTEMIC_SUBJECT_SHOULD.test(haystack) ||
          EPISTEMIC_THAT_SENTENCE_START.test(haystack)
        ) {
          matches.push({ kind: 'speculation_language', evidence: 'should be (epistemic)' });
        } else if (HYPOTHESIS_SHOULD.test(haystack)) {
          // suppressed — hypothesis framing
        } else if (INSTRUCTIONAL_SHOULD.test(haystack)) {
          // suppressed — instructional usage
        } else if (PRESCRIPTIVE_SHOULD.test(haystack)) {
          // suppressed — prescriptive usage (value/identifier/type follows, or code was stripped)
        } else if (lower.includes('should be')) {
          // Fallback: apply question check on first occurrence
          const idx = lower.indexOf('should be');
          if (!isIndexWithinQuestion(haystack, idx)) {
            matches.push({ kind: 'speculation_language', evidence: 'should be' });
          }
        }
      }
    }
    runCustomPatterns('speculation_language');
  }

  // 2) Hard causality claims (heuristic trigger): require evidence wording when asserting causality.
  // Change 2 & 6: Expanded phrase list + evidence suppression.
  if (isCategoryEnabled('causality_language')) {
    if (useBuiltIn('causality_language')) {
      // Temporal 'since' exclusion (Change 6) — extended with "since then/that" and
      // "since we/you/I + past-tense" patterns.
      const TEMPORAL_SINCE =
        /\bsince\s+(?:last\s+)?(?:yesterday|today|then|\d{4}|\d{1,2}[/-]\d{1,2}|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|the\s+(?:beginning|start|end)|version\s+\d)/i;
      // "since then" / "since that change/commit/update"
      const TEMPORAL_SINCE_THEN = /\bsince\s+then\b/i;
      const TEMPORAL_SINCE_THAT = /\bsince\s+that\b/i;
      // "since we changed", "since I updated", "since you added" — prior action reference
      const TEMPORAL_SINCE_PRIOR_ACTION = /\bsince\s+(?:we|you|i)\s+[a-z]+ed\b/i;

      // Hedged-because pattern (Change 2)
      const HEDGED_BECAUSE =
        /\b(?:probably|likely|possibly|perhaps|maybe|might\s+be|could\s+be)\s+because\b/i;
      // "because" followed within 50 chars by a file path pattern — grounded citation
      const BECAUSE_FILE_PATH_RE = /because.{0,50}(?:\/[\w./~-]+|\.\/|~\/|`[^`]+`)/i;
      // "because of the" + artifact noun — referencing an existing artifact, not guessing
      const BECAUSE_ARTIFACT_RE =
        /\bbecause\s+of\s+the\s+(?:output|error|config|file|log|result|test|report)\b/i;
      // Self-description: "I stopped/exited/skipped/failed because" — describing own action
      const BECAUSE_SELF_DESCRIPTION_RE =
        /\bi\s+(?:stopped|exited|skipped|failed|aborted|returned|quit|halted)\s+because\b/i;

      const causalityPhrases = [
        'caused by',
        'due to',
        'because',
        'as a result',
        'therefore',
        'this means',
        // Change 6 additions
        'consequently',
        'as a consequence',
        'hence',
        'thus',
        'it follows that',
        'this suggests that',
        'this indicates that',
        'this implies that',
        'which is why',
        'which means',
        'which explains',
        'the root cause',
        'stems from',
        'results from',
        'resulted in',
        'led to',
        'attributable to',
        'given that',
        'since',
      ];

      for (const phrase of causalityPhrases) {
        // Scan all occurrences of the phrase, not just the first
        let searchFrom = 0;
        while (true) {
          const idx = lower.indexOf(phrase, searchFrom);
          if (idx === -1) break;
          searchFrom = idx + phrase.length;

          if (isIndexWithinQuestion(haystack, idx)) continue;

          // Temporal exclusion for 'since'
          if (phrase === 'since') {
            const nearby = haystack.slice(
              Math.max(0, idx - 50),
              Math.min(haystack.length, idx + 100),
            );
            if (TEMPORAL_SINCE.test(nearby)) continue;
            if (TEMPORAL_SINCE_THEN.test(nearby)) continue;
            if (TEMPORAL_SINCE_THAT.test(nearby)) continue;
            if (TEMPORAL_SINCE_PRIOR_ACTION.test(nearby)) continue;
          }

          if (phrase === 'because') {
            // Hedged because: always flag regardless of evidence
            if (HEDGED_BECAUSE.test(haystack)) {
              matches.push({ kind: 'causality_language', evidence: 'because (hedged)' });
              break; // one flag per hedged-because pattern is sufficient
            }
            // "because of the <artifact>" — citing an existing artifact, not guessing
            if (
              BECAUSE_ARTIFACT_RE.test(
                haystack.slice(Math.max(0, idx - 5), Math.min(haystack.length, idx + 80)),
              )
            )
              continue;
            // Self-description ("I stopped because") — not a causal claim about the world
            if (
              BECAUSE_SELF_DESCRIPTION_RE.test(
                haystack.slice(Math.max(0, idx - 60), Math.min(haystack.length, idx + 20)),
              )
            )
              continue;
            // "because" followed by a file path within 50 chars — grounded citation
            if (
              BECAUSE_FILE_PATH_RE.test(
                haystack.slice(Math.max(0, idx - 5), Math.min(haystack.length, idx + 60)),
              )
            )
              continue;
            // Evidence nearby suppresses plain 'because' (expanded window: 300 chars)
            if (hasEvidenceNearby(haystack, idx, rawText, 300)) continue;
            // Sentence-scoped code reference suppression: file path, function call,
            // line number, or backtick in the same sentence — grounded citation.
            if (hasSentenceCodeReference(rawText, idx)) continue;
            matches.push({ kind: 'causality_language', evidence: phrase });
            continue;
          }

          // All other causality phrases: suppress when evidence is nearby
          if (hasEvidenceNearby(haystack, idx, rawText)) continue;
          // Sentence-scoped code reference suppression for non-because phrases.
          if (hasSentenceCodeReference(rawText, idx)) continue;
          matches.push({ kind: 'causality_language', evidence: phrase });
          break; // one flag per phrase kind is sufficient for non-because phrases
        }
      }

      // Change 7: Implicit, nominalized, and passive causality patterns.
      const IMPLICIT_CAUSALITY = [
        /\.\s+This\s+(?:made|caused|meant|led\s+to|resulted\s+in|explains?\s+why|is\s+(?:why|because))\b/i,
        /\.\s+That(?:'s|\s+is)\s+(?:why|because|the\s+reason)\b/i,
      ];
      const NOMINALIZED_CAUSALITY = [
        /\bthe\s+(?:likely|probable|possible|main|primary|underlying)\s+(?:cause|reason|explanation)\b/i,
        /\bthe\s+(?:cause|reason|explanation|root\s+cause)\s+(?:of|for|behind)\s+(?:this|that|the)\b/i,
      ];
      const PASSIVE_CAUSALITY = [
        /\bwas\s+(?:caused|triggered|produced)\s+by\b/i,
        /\bresulted\s+(?:from|in)\b/i,
        /\bcan\s+be\s+traced\s+(?:back\s+)?to\b/i,
      ];

      for (const re of [...IMPLICIT_CAUSALITY, ...NOMINALIZED_CAUSALITY, ...PASSIVE_CAUSALITY]) {
        const m = haystack.match(re);
        if (!m) continue;
        if (isIndexWithinQuestion(haystack, m.index)) continue;
        if (hasEvidenceNearby(haystack, m.index, rawText)) continue;
        // Sentence-scoped code reference suppression for regex-matched causality patterns.
        if (hasSentenceCodeReference(rawText, m.index)) continue;
        matches.push({ kind: 'causality_language', evidence: m[0].trim() });
      }
    }
    runCustomPatterns('causality_language');
  }

  // 3) Fake rigor / uncited quantification
  // Change 4: isQualityScore replaces the raw N/10 regex.
  if (isCategoryEnabled('pseudo_quantification')) {
    if (useBuiltIn('pseudo_quantification')) {
      const nOverTenRe = /\b(\d+(?:\.\d+)?)\s*\/\s*10\b/i;
      const m10 = haystack.match(nOverTenRe);
      if (m10 && isQualityScore(haystack, m10[0], m10.index)) {
        matches.push({ kind: 'pseudo_quantification', evidence: m10[0] });
      }

      const percentRe = /\b\d{1,3}(?:\.\d+)?\s*%\b/i;
      const mp = haystack.match(percentRe);
      if (mp) {
        matches.push({ kind: 'pseudo_quantification', evidence: mp[0] });
      }
    }
    runCustomPatterns('pseudo_quantification');
  }

  // 4) Over-claiming completeness (must be backed by explicit actions/observations)
  // Change 5: Expanded phrase list + structural regex patterns.
  if (isCategoryEnabled('completeness_claim')) {
    if (useBuiltIn('completeness_claim')) {
      const completenessPhrases = [
        // Original phrases
        'all files checked',
        'comprehensive analysis',
        'everything is fixed',
        'fully resolved',
        'complete solution',
        // Expanded phrases
        'all issues resolved',
        'all issues fixed',
        'all tests pass',
        'all tests passing',
        'no issues found',
        'no errors found',
        'no remaining issues',
        'no remaining errors',
        'task is complete',
        'task is done',
        'fully implemented',
        'fully complete',
        'fully functional',
        'completely resolved',
        'completely fixed',
        'completely done',
        'all done',
        'all complete',
        'all fixed',
        'all resolved',
        'entirely resolved',
        'entirely fixed',
        'nothing else to fix',
        'nothing else to do',
        'everything works',
        'everything is working',
      ];

      for (const phrase of completenessPhrases) {
        const idx = lower.indexOf(phrase);
        if (idx !== -1) {
          matches.push({ kind: 'completeness_claim', evidence: phrase });
        }
      }

      // Structural completeness regex patterns (Change 5)
      const completenessRegexes = [
        /\ball\s+\w+\s+have\s+been\s+(?:fixed|resolved|updated|added|removed|checked|verified|addressed|handled|processed|completed)\b/i,
        /\bno\s+remaining\s+\w+\b/i,
        /\b(?:fully|completely)\s+\w+(?:ed|d)\b/i,
        /\beverything\s+(?:is|has\s+been)\s+\w+\b/i,
        /\ball\s+(?:of\s+)?(?:the\s+)?\w+\s+(?:are|is)\s+now\s+\w+\b/i,
      ];

      for (const re of completenessRegexes) {
        const m = haystack.match(re);
        if (!m) continue;
        if (isIndexWithinQuestion(haystack, m.index)) continue;
        // Suppress when inside an enumeration list (Change 5)
        if (hasEnumerationNearby(haystack, m.index)) continue;
        // Suppress negated participles after fully/completely (disclaimers, not overclaims)
        if (/^(?:fully|completely)\s/i.test(m[0]) && isNegatedParticiple(m[0], haystack, m.index))
          continue;
        matches.push({ kind: 'completeness_claim', evidence: m[0].trim() });
      }
    }
    runCustomPatterns('completeness_claim');
  }

  // 5) Evaluative design claims — exact tell phrases only; no broad terms.
  // These phrases assert a conclusion ("cleanest", "simplest", "obvious") on a
  // proposed change without evidence. The regex canary fires on exact multi-word
  // phrases with near-zero false-positive risk.
  if (isCategoryEnabled('evaluative_design_claim')) {
    if (useBuiltIn('evaluative_design_claim')) {
      // Reset lastIndex before matchAll() — module-scope `g`-flagged regexes retain state.
      EVALUATIVE_DESIGN_TELLS_GLOBAL.lastIndex = 0;
      for (const edcMatch of haystack.matchAll(EVALUATIVE_DESIGN_TELLS_GLOBAL)) {
        if (isIndexWithinQuestion(haystack, edcMatch.index)) continue;
        matches.push({ kind: 'evaluative_design_claim', evidence: edcMatch[0].trim() });
      }
    }
    runCustomPatterns('evaluative_design_claim');
  }

  // Apply allowlist filter and maxTriggersPerResponse limit.
  const allowlist = Array.isArray(config.allowlist) ? config.allowlist : [];
  const maxTriggers =
    Number.isFinite(config.maxTriggersPerResponse) && config.maxTriggersPerResponse >= 0
      ? config.maxTriggersPerResponse
      : 20;

  const result = [];
  for (const m of rawMatches) {
    if (result.length >= maxTriggers) break;
    const blocked = allowlist.some((item) => {
      if (item instanceof RegExp) return item.test(m.evidence);
      return typeof item === 'string' && m.evidence.includes(item);
    });
    if (!blocked) result.push(m);
  }
  return result;
}

// =============================================================================
// Sentence-level granularity and weighted multi-signal scoring
// =============================================================================

/**
 * Split text into individual sentences on sentence-ending punctuation.
 * Handles `.`, `!`, and `?` followed by whitespace.
 * Edge cases (abbreviations, ellipses) may produce imperfect boundaries.
 */
function splitIntoSentences(text) {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

// DEFAULT_WEIGHTS imported from ./hallucination-config.cjs

/**
 * Compute binary detection flags for a sentence across all configured categories.
 *
 * Each category present in the analysis configuration is assigned 1 if any trigger
 * for that category is detected in the sentence, otherwise 0.
 *
 * @param {string} sentence - The sentence text to analyze.
 * @returns {Object<string, number>} An object mapping category names to `0` or `1`, where `1` indicates the category was triggered in the sentence.
 */
function scoreSentence(sentence) {
  const matches = findTriggerMatches(sentence);
  const scores = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
  for (const match of matches) {
    if (Object.hasOwn(scores, match.kind)) {
      scores[match.kind] = 1;
    }
  }
  return scores;
}

/**
 * Aggregate per-category scores into a single weighted score.
 * Normalizes by the sum of provided weights so custom weight sets
 * that don't sum to 1 still produce values in [0, 1].
 */
function aggregateWeightedScore(scores, weights) {
  const w =
    weights && typeof weights === 'object' && !Array.isArray(weights) ? weights : DEFAULT_WEIGHTS;
  let total = 0;
  let weightSum = 0;
  // Only consider known detection categories; skip non-finite or negative weights.
  for (const category of Object.keys(DEFAULT_WEIGHTS)) {
    const rawWeight = w[category];
    if (!Number.isFinite(rawWeight) || rawWeight < 0) continue;
    const categoryScore =
      typeof scores[category] === 'number' && Number.isFinite(scores[category])
        ? Math.max(0, Math.min(1, scores[category]))
        : 0;
    total += rawWeight * categoryScore;
    weightSum += rawWeight;
  }
  if (weightSum === 0) return 0;
  // Round to 10 decimal places to avoid floating-point boundary artifacts
  const raw = total / weightSum;
  return Math.round(raw * 1e10) / 1e10;
}

/**
 * Map an aggregate score to a three-tier label.
 *   GROUNDED     : score < 0.30
 *   UNCERTAIN    : 0.30 <= score <= 0.60
 *   HALLUCINATED : score > 0.60
 */
function getLabelForScore(score) {
  if (score < 0.3) return 'GROUNDED';
  if (score <= 0.6) return 'UNCERTAIN';
  return 'HALLUCINATED';
}

// loadWeights and loadConfig imported from ./hallucination-config.cjs

/**
 * Score every sentence in a block of text.
 * Returns an array of per-sentence result objects:
 *   { sentence, index, total, scores, aggregateScore, label }
 *
 * @param {string} text     - Input text to analyze.
 * @param {object} [weights] - Optional weight overrides (defaults to DEFAULT_WEIGHTS).
 */
function scoreText(text, weights) {
  const sentences = splitIntoSentences(text);
  const total = sentences.length;
  return sentences.map((sentence, index) => {
    const scores = scoreSentence(sentence);
    const aggregateScore = aggregateWeightedScore(scores, weights);
    const label = getLabelForScore(aggregateScore);
    return { sentence, index, total, scores, aggregateScore, label };
  });
}

/**
 * Compute a short hash of text for deduplication without storing full content.
 *
 * @param {string} text
 * @returns {string} First 16 hex chars of SHA-256.
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Append a single introspection log entry to the JSONL log file.
 * Fails silently — introspection logging must never crash the hook.
 *
 * @param {string} logPath  - Absolute path to the JSONL log file.
 * @param {object} entry    - Log entry object.
 * @returns {void}
 */
function appendIntrospectionLog(logPath, entry) {
  try {
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch {
    // intentionally silent — logging failure must not affect hook behavior
  }
}

function loadLoopState(sessionId) {
  const statePath = path.join(
    os.tmpdir(),
    `claude-hallucination-audit-${sessionId || 'unknown'}.json`,
  );
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && data) return { statePath, data };
  } catch {
    // ignore
  }
  return { statePath, data: { blocks: 0 } };
}

function saveLoopState(statePath, data) {
  try {
    fs.writeFileSync(statePath, JSON.stringify(data), 'utf-8');
  } catch {
    // ignore
  }
}

/**
 * Write a value as a single-line JSON string followed by a newline to stdout.
 * @param {*} obj - The value to serialize with JSON.stringify and emit to process.stdout.
 */
function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/**
 * Strip labeled claim lines (lines containing [LABEL][cN]) from text before
 * running trigger scans. This prevents labeled/typed claims from double-firing
 * the existing speculation and causality detectors.
 *
 * @param {string} text
 * @returns {string}
 */
// Built from CLAIM_LABEL_ALTERNATION so adding a new label requires one edit.
const LABELED_CLAIM_LINE_RE = new RegExp(
  `^\\s*-?\\s*(?:\\[(?:${CLAIM_LABEL_ALTERNATION})\\])+\\[c\\d+\\].*`,
);
const METADATA_LINE_RE = /^\s+(?:Evidence|Basis|Missing|Contradicted by):\s*/i;

function stripLabeledClaimLines(text) {
  return text
    .split('\n')
    .filter((line) => !LABELED_CLAIM_LINE_RE.test(line) && !METADATA_LINE_RE.test(line))
    .join('\n');
}

const STRUCTURED_BLOCK_FORMAT = `
ANSWER
- Direct response to the task.

VERIFIED
- [VERIFIED][c1] <atomic grounded claim>
  Evidence: <file path, line, log, test, doc, tool output, or user-provided fact>

INFERRED
- [INFERRED][c2] <atomic working theory>
  Basis: <why this is inferred>

UNKNOWN
- [UNKNOWN][c3] <atomic unresolved point>
  Missing: <what evidence is absent>

SPECULATION
- [SPECULATION][c4] <atomic low-evidence possibility>
  Basis: <why it is being considered>

CORRELATED
- [CORRELATED][c5] <atomic association only>
  Evidence: <co-occurrence or observed linkage>

CAUSAL
- [CAUSAL][c6] <atomic causal claim>
  Evidence: <experiment, mechanism, controlled comparison, or authoritative source>

REJECTED
- [REJECTED][c7] <atomic prior claim now contradicted>
  Contradicted by: <evidence>

NEXT VERIFICATION
- <smallest check to upgrade INFERRED, SPECULATION, or CORRELATED>

MEMORY WRITE
- Allowed: <claim IDs from VERIFIED and CAUSAL only>
- Blocked: <all other claim IDs>`;

const BLOCK_HEADER = 'Hallucination-detector STOP HOOK blocked this response.';

/**
 * Apply the loop guard and emit a block decision if the limit has not been reached.
 * Always calls process.exit(0).
 *
 * The allow-through fires unconditionally once the session block count reaches the
 * limit — it does NOT require stopHookActive to be true. stopHookActive being false
 * on the first call of a new turn was the previous bug: the counter accumulated across
 * turns but the guard was unreachable on first-call-of-turn, producing up to 14 blocks
 * against the documented limit of 2.
 *
 * @param {string} sessionId
 * @param {string} reason
 * @param {number} [maxBlocks] - Maximum number of blocks before allowing through. Defaults to 2.
 */
/**
 * @param {string} sessionId
 * @param {string} reason
 * @param {number} [maxBlocks]
 * @param {object} [telemetryCtx] - Optional telemetry context passed to writeTelemetry.
 * @param {string} [telemetryCtx.event_type] - 'block' or 'structural_block'
 */
function blockAndExit(sessionId, reason, maxBlocks, telemetryCtx) {
  const { statePath, data } = loadLoopState(sessionId);
  const currentBlocks = Number(data.blocks || 0);
  const limit = typeof maxBlocks === 'number' && maxBlocks >= 0 ? maxBlocks : 2;
  if (currentBlocks >= limit) {
    // Already hit the limit in a prior call — allow through unconditionally.
    if (telemetryCtx) {
      writeTelemetry({ ...telemetryCtx, event_type: 'fail_open', retry_count: currentBlocks });
    }
    process.exit(0);
  }
  saveLoopState(statePath, { blocks: currentBlocks + 1 });
  if (telemetryCtx) {
    writeTelemetry({ ...telemetryCtx, retry_count: currentBlocks });
  }
  emitJson({ decision: 'block', reason });
  process.exit(0);
}

/**
 * Build a block reason for a structured response with validation errors.
 *
 * @param {Array<{code: string, claimId?: string, label?: string, message: string}>} errors
 * @returns {string}
 */
function buildStructuralBlockReason(errors) {
  const errorLines = errors
    .slice(0, 10)
    .map((e) => {
      const prefix = e.claimId
        ? `[${e.code}] ${e.claimId}${e.label ? ` [${e.label}]` : ''}`
        : `[${e.code}]`;
      return `- ${prefix}: ${e.message}`;
    })
    .join('\n');

  return [
    BLOCK_HEADER,
    '',
    'Structured claim validation failed:',
    errorLines || '- (no error details available)',
    '',
    'Rewrite using the required structured format:',
    STRUCTURED_BLOCK_FORMAT,
  ].join('\n');
}

/**
 * Constructs a human-readable block reason from detected trigger matches.
 *
 * @param {Array<{kind: string, evidence: string}>} matches - Array of match objects; each must have a `kind` label and an `evidence` snippet used in the reason.
 * @returns {string} A formatted block reason string suitable for the STOP hook output.
 */
function buildBlockReason(matches) {
  const uniqueKinds = [...new Set(matches.map((m) => m.kind))];
  const evidenceSnippets = matches
    .slice(0, 6)
    .map((m) => `- ${m.kind}: \`${m.evidence.replace(/\s+/g, ' ').trim().replace(/`/g, "'")}\``)
    .join('\n');
  return [
    BLOCK_HEADER,
    '',
    'Detected trigger language in your last assistant message:',
    evidenceSnippets || '- (no snippets available)',
    '',
    'Rewrite the response to follow these rules:',
    '- Only state actions you actually took and what you actually observed.',
    '- If information is missing, say "I don\'t know yet" / "I don\'t have that information" / "I can check using my tools".',
    '- Do not assert causality unless you explicitly cite the observed evidence that supports it.',
    '- Remove speculative hedging (e.g., `probably`, `likely`, `seems`). Replace with verification steps or uncertainty statements.',
    '- If you need to reference or discuss a flagged phrase in your rewrite, wrap it in backticks (e.g., `probably`, `because`) so the hook does not re-trigger on the explanation.',
    '- If an evaluative label (`cleanest`, `simplest`, `obvious`) appears on a proposed change: state what the changed component protects when functioning correctly before proposing to change it.',
    '',
    `Kinds flagged: ${uniqueKinds.join(', ')}`,
  ].join('\n');
}

/**
 * Build a combined block reason when both structural validation errors and
 * trigger phrase matches are present. Emits both sections under one BLOCK_HEADER
 * so the assistant can fix everything in a single rewrite.
 *
 * @param {Array<{code: string, claimId?: string, label?: string, message: string}>} errors
 * @param {Array<{kind: string, evidence: string}>} matches
 * @returns {string}
 */
function buildCombinedBlockReason(errors, matches) {
  const errorLines = errors
    .slice(0, 5)
    .map((e) => {
      const prefix = e.claimId
        ? `[${e.code}] ${e.claimId}${e.label ? ` [${e.label}]` : ''}`
        : `[${e.code}]`;
      return `- ${prefix}: ${e.message}`;
    })
    .join('\n');

  const matchLines = matches
    .slice(0, 4)
    .map((m) => `- ${m.kind}: \`${m.evidence.replace(/\s+/g, ' ').trim().replace(/`/g, "'")}\``)
    .join('\n');

  return [
    BLOCK_HEADER,
    '',
    'Structural claim validation issues:',
    errorLines || '- (no error details available)',
    '',
    'Trigger language issues:',
    matchLines || '- (no snippets available)',
    '',
    'Fix ALL of the above in your rewrite.',
    '',
    'Rewrite using the required structured format:',
    STRUCTURED_BLOCK_FORMAT,
  ].join('\n');
}

/**
 * Run the STOP hook: read stdin JSON, analyze the last main-chain assistant message for hallucination signals, and either emit a block decision or exit without blocking.
 *
 * When a transcript path is present, the function extracts the last assistant message, applies configured pattern detection and scoring, and:
 * - In introspection mode, logs analysis details to a configured or temporary JSONL file and always exits without emitting a block decision.
 * - When matches are absent, resets per-session block state and exits without blocking.
 * - When matches are present, updates per-session loop state and, unless session loop limits permit continuing, emits a single JSON line to stdout of the form { decision: "block", reason: "<human-readable reason>" } and then exits.
 *
 * Side effects: reads stdin and files, may write per-session state and introspection logs, writes a single JSON line to stdout when blocking, and terminates the process.
 */
function main() {
  const input = readStdinJson();
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || '';
  const projectDir = input.cwd || null;
  const stopHookActive = input.stop_hook_active === true;
  const permissionMode = input.permission_mode || 'default';
  const hookEventName = input.hook_event_name || 'Stop';

  // Defensive guard: only handle known stop-hook events.
  if (hookEventName !== 'Stop' && hookEventName !== 'SubagentStop') {
    process.exit(0);
  }

  // Compact agent exemption: sessions whose first human message is a compaction
  // directive are exempted from all detection. Compact agents summarize prior
  // conversation content verbatim — they cannot avoid flagged phrases that
  // appear in the conversation being summarized.
  if (transcriptPath && isCompactAgentSession(transcriptPath)) {
    writeTelemetry({
      event_type: 'compact_exempt',
      session_id: sessionId,
      project_dir: projectDir,
    });
    process.exit(0);
  }

  // Prefer last_assistant_message from stdin: Claude Code provides the current
  // turn's text directly, avoiding the race condition where the transcript is
  // not yet flushed when the Stop hook fires.
  const lastAssistantMessageFromStdin =
    typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()
      ? input.last_assistant_message
      : null;

  let entries = [];
  if (!lastAssistantMessageFromStdin) {
    // Transcript is only needed when stdin does not supply the message directly.
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      process.exit(0);
    }

    const transcriptText = safeReadFileText(transcriptPath);
    if (!transcriptText.trim()) {
      process.exit(0);
    }

    entries = parseJsonl(transcriptText);

    // Guard against the race condition where the Stop hook fires before the
    // current turn's assistant message has been flushed to the JSONL transcript.
    // In that case the transcript ends with a user (or system/progress) entry and
    // the last assistant entry belongs to a previous turn.  Scanning it would
    // produce a false positive block.  Skip scanning when the last main-chain
    // non-meta entry is not an assistant message.
    const lastMainEntry = entries.findLast(isMainChainEntry);
    if (lastMainEntry && lastMainEntry.type !== 'assistant') {
      process.exit(0);
    }
  }

  const lastAssistantText = lastAssistantMessageFromStdin ?? getLastAssistantText(entries);
  if (!lastAssistantText) {
    process.exit(0);
  }

  // Extract model/token metadata for telemetry. When entries were not parsed
  // (stdin supplied the text directly), entries is empty and getLastAssistantMeta
  // returns defaults — that is acceptable.
  const assistantMeta = getLastAssistantMeta(entries);

  const config = loadConfig();
  const maxBlocks = config.maxBlocksPerSession ?? 2;

  // Template validation: check for observation template blocks before structural
  // validation. Runs only when the session has not yet exceeded the block limit —
  // once fail-open fires, we skip all validation to avoid infinite loops.
  const templateResult = validateTemplateBlocks(lastAssistantText);

  // hasValidTemplate is declared for Phase 3c (ungrounded_behavioral_assertion suppression).
  // Currently not acted upon — trigger scan runs regardless of template presence.
  const hasValidTemplate = templateResult.hasTemplate === true && templateResult.valid === true;
  void hasValidTemplate; // Phase 3c will use this

  const { data: loopStateData } = loadLoopState(sessionId);
  const currentBlockCount = Number(loopStateData.blocks || 0);
  if (currentBlockCount < maxBlocks && templateResult.hasTemplate && !templateResult.valid) {
    const fieldList = templateResult.errors
      .map((e) => `${e.template}: missing required field '${e.missingField}'`)
      .join('; ');
    const reason = `OBSERVATION TEMPLATE: Required fields missing — ${fieldList}. Fill in all fields or remove the template header.`;
    writeTelemetry({
      session_id: sessionId,
      project_dir: projectDir,
      model: assistantMeta.model,
      event_type: 'block',
      categories: ['template_validation_error'],
      response_snippet: lastAssistantText.slice(0, 300),
      stop_hook_active: stopHookActive ? 1 : 0,
      permission_mode: permissionMode,
      hook_event_name: hookEventName,
    });
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
    process.exit(0);
  }

  // Two-layer combined detection: collect structural errors and trigger matches
  // in a single pass before deciding whether to block. This prevents the
  // consecutive-block UX problem where the assistant fixes structural errors,
  // resubmits, and gets blocked again by trigger phrases that were present
  // but never reported in the first block.
  const structureResult = validateClaimStructure(lastAssistantText);

  let structuralErrors = [];
  let triggerMatches = [];

  if (structureResult.structured) {
    if (!structureResult.valid) {
      // Structural errors present — also run trigger detection on the raw text
      // (labels are invalid, so don't strip them — the whole response is suspect).
      structuralErrors = structureResult.errors;
      triggerMatches = findTriggerMatches(lastAssistantText, config);
    } else {
      // Structured + valid: run trigger audit on text with labeled claim lines
      // stripped so acknowledged typed claims don't re-fire speculation/causality detectors.
      const strippedText = stripLabeledClaimLines(lastAssistantText);
      triggerMatches = findTriggerMatches(strippedText, config);
    }
  } else {
    // Unstructured response: run trigger audit on full text.
    triggerMatches = findTriggerMatches(lastAssistantText, config);
  }

  // Base telemetry context shared across all exit paths below.
  const telemetryBase = {
    session_id: sessionId,
    project_dir: projectDir,
    model: assistantMeta.model,
    output_tokens: assistantMeta.output_tokens,
    cache_read_tokens: assistantMeta.cache_read_tokens,
    response_snippet: lastAssistantText.slice(0, 300),
    categories:
      triggerMatches.length > 0
        ? [...new Set(triggerMatches.map((m) => m.kind))]
        : structuralErrors.length > 0
          ? ['structural']
          : [],
    evidence: triggerMatches.map((m) => m.evidence),
    error_codes: structuralErrors.map((e) => e.code),
    stop_hook_active: stopHookActive ? 1 : 0,
    permission_mode: permissionMode,
    hook_event_name: hookEventName,
  };

  if (config.introspect) {
    // Introspection mode: log everything, never block.
    const { statePath, data } = loadLoopState(sessionId);
    const blocks = Number(data.blocks || 0);
    const hasIssues = structuralErrors.length > 0 || triggerMatches.length > 0;
    const nextBlocks = hasIssues ? blocks + 1 : 0;
    saveLoopState(statePath, { blocks: nextBlocks });

    const logPath =
      config.introspectOutputPath ||
      path.join(os.tmpdir(), 'hallucination-detector-introspect.jsonl');

    const wouldBlock = hasIssues && nextBlocks <= maxBlocks;
    const sentenceScores = scoreText(lastAssistantText, config.weights);

    const categoryCounts = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
    for (const m of triggerMatches) {
      if (Object.hasOwn(categoryCounts, m.kind)) {
        categoryCounts[m.kind] += 1;
      }
    }

    appendIntrospectionLog(logPath, {
      timestamp: new Date().toISOString(),
      sessionId,
      wouldBlock,
      structuralErrorCount: structuralErrors.length,
      matchCount: triggerMatches.length,
      matches: triggerMatches.map((m) => ({ kind: m.kind, evidence: m.evidence })),
      sentenceScores,
      textLength: lastAssistantText.length,
      textHash: hashText(lastAssistantText),
      categories: categoryCounts,
    });

    process.exit(0);
  }

  // Decide block reason based on what was found.
  if (structuralErrors.length === 0 && triggerMatches.length === 0) {
    const { statePath } = loadLoopState(sessionId);
    saveLoopState(statePath, { blocks: 0 });
    writeTelemetry({ ...telemetryBase, event_type: 'allow', retry_count: 0 });
    process.exit(0);
  }

  // Shadow mode: log would-block decisions without actually blocking.
  if (config.dryRun) {
    writeShadowLog({
      sessionId,
      model: assistantMeta.model,
      categories: telemetryBase.categories,
      evidence: telemetryBase.evidence.join(', '),
      responseSnippet: lastAssistantText.slice(0, 300),
    });
    process.exit(0);
  }

  if (structuralErrors.length > 0 && triggerMatches.length > 0) {
    blockAndExit(sessionId, buildCombinedBlockReason(structuralErrors, triggerMatches), maxBlocks, {
      ...telemetryBase,
      event_type: 'structural_block',
    });
  }

  if (structuralErrors.length > 0) {
    blockAndExit(sessionId, buildStructuralBlockReason(structuralErrors), maxBlocks, {
      ...telemetryBase,
      event_type: 'structural_block',
    });
  }

  // Trigger matches only.
  blockAndExit(sessionId, buildBlockReason(triggerMatches), maxBlocks, {
    ...telemetryBase,
    event_type: 'block',
  });
}

// =============================================================================
// Observation template validation
// =============================================================================

/**
 * Required fields for each observation template type.
 * Values are the field label strings (without the trailing colon).
 */
const TEMPLATE_REQUIRED_FIELDS = {
  'TOOL RUN': ['Command', 'Observed', 'Scope', 'Does not cover'],
  'AGENT REPORT': ['Reported', 'Independently verified'],
  COMMITTED: ['Changes', 'Validation'],
};

/**
 * Detect observation template headers in raw response text and validate that
 * all required fields are present with non-empty, non-placeholder values.
 *
 * Operates on raw (non-stripped) text so that templates in prose are found.
 * Templates inside fenced code blocks are intentionally still detected — when
 * a response contains a template header followed by the required fields, it
 * signals an observation claim regardless of surrounding markdown.
 *
 * @param {string} text - Raw assistant response text.
 * @returns {{ hasTemplate: false } |
 *           { hasTemplate: true, valid: true } |
 *           { hasTemplate: true, valid: false, errors: Array<{ template: string, missingField: string }> }}
 */
function validateTemplateBlocks(text) {
  const PLACEHOLDER_RE = /^\s*\[.*\]\s*$/; // value is only a [...] placeholder

  /**
   * Extract the block of text starting at `headerLine` up to the next blank
   * line or end of text.
   *
   * @param {string[]} lines - All lines of `text`.
   * @param {number} headerIdx - Index of the header line.
   * @returns {string[]} Lines from (and including) the header line to the end of the block.
   */
  function extractBlock(lines, headerIdx) {
    const block = [lines[headerIdx]];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') break;
      block.push(lines[i]);
    }
    return block;
  }

  /**
   * Check whether a required field is satisfied within the block.
   * A field is satisfied when a line starts with `<fieldLabel>:` and the
   * value after the colon is non-empty and not a placeholder.
   *
   * @param {string[]} blockLines
   * @param {string} fieldLabel
   * @returns {boolean}
   */
  function fieldPresent(blockLines, fieldLabel) {
    const prefix = `${fieldLabel}:`;
    for (const line of blockLines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(prefix)) {
        const value = trimmed.slice(prefix.length);
        if (!value.trim() || PLACEHOLDER_RE.test(value)) return false;
        return true;
      }
    }
    return false;
  }

  const lines = text.split('\n');
  const errors = [];
  let hasTemplate = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Detect which template header this line matches (if any).
    let templateName = null;
    if (trimmed === 'TOOL RUN') {
      templateName = 'TOOL RUN';
    } else if (/^AGENT REPORT/.test(trimmed)) {
      templateName = 'AGENT REPORT';
    } else if (/^COMMITTED\s+\S/.test(trimmed) || trimmed === 'COMMITTED') {
      templateName = 'COMMITTED';
    }

    if (!templateName) continue;

    hasTemplate = true;
    const requiredFields = TEMPLATE_REQUIRED_FIELDS[templateName];
    const block = extractBlock(lines, i);

    for (const field of requiredFields) {
      if (!fieldPresent(block, field)) {
        errors.push({ template: templateName, missingField: field });
      }
    }
  }

  if (!hasTemplate) return { hasTemplate: false };
  if (errors.length === 0) return { hasTemplate: true, valid: true };
  return { hasTemplate: true, valid: false, errors };
}

// Export internals for testing; run main() only when executed directly.
if (require.main === module) {
  main();
}

module.exports = {
  findTriggerMatches,
  buildBlockReason,
  normalizeForScan,
  stripLowSignalRegions,
  extractTextFromMessageContent,
  getLastAssistantText,
  isMainChainEntry,
  hasEvidenceNearby,
  isIndexWithinQuestion,
  getSentenceContaining,
  hasSentenceCodeReference,
  isQualityScore,
  hasEnumerationNearby,
  isNegatedParticiple,
  parseJsonl,
  splitIntoSentences,
  scoreSentence,
  aggregateWeightedScore,
  getLabelForScore,
  // Re-exported from hallucination-config.cjs for backward compatibility
  loadWeights,
  loadConfig,
  scoreText,
  DEFAULT_WEIGHTS,
  // New introspection exports
  appendIntrospectionLog,
  hashText,
  // Structure-aware detection exports
  buildStructuralBlockReason,
  buildCombinedBlockReason,
  stripLabeledClaimLines,
  // Uncertainty enumeration suppression
  isWithinUncertaintyEnumeration,
  // Compact agent exemption
  isCompactAgentSession,
  // Telemetry
  writeTelemetry,
  getLastAssistantMeta,
  TELEMETRY_DB_PATH,
  // Shadow mode
  writeShadowLog,
  SHADOW_LOG_PATH,
  // Observation template validation
  validateTemplateBlocks,
};
