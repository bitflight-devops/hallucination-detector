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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

function isSidechainEntry(entry) {
  return Boolean(entry?.isSidechain);
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
    if (!entry || typeof entry !== 'object') continue;
    if (isSidechainEntry(entry)) continue;

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

// Change 5: hasEnumerationNearby — suppresses structural completeness flags when
// the preceding context contains a numbered/bulleted list (2+ items).
function hasEnumerationNearby(text, idx) {
  const start = Math.max(0, idx - 200);
  const preceding = text.slice(start, idx);
  const listItemRe = /^\s*(?:\d+[.)]\s|\*\s|-\s)/m;
  const globalListItemRe = /^\s*(?:\d+[.)]\s|\*\s|-\s)/gm;
  if (!listItemRe.test(preceding)) return false;
  const allMatches = preceding.match(globalListItemRe);
  return allMatches !== null && allMatches.length >= 2;
}

function findTriggerMatches(text) {
  const matches = [];
  const rawText = normalizeForScan(text);
  const haystack = stripLowSignalRegions(rawText);
  const lower = haystack.toLowerCase();

  // 1) Assumption/speculation language (explicitly discouraged by repo policy)
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
  ];
  for (const phrase of speculationPhrases) {
    const idx = lower.indexOf(phrase);
    if (idx !== -1) {
      // Questions like "Should I do that now?" are desirable—don't flag.
      if (isIndexWithinQuestion(haystack, idx)) continue;
      matches.push({ kind: 'speculation_language', evidence: phrase });
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
    const EPISTEMIC_SUBJECT_SHOULD = /\b(?:it|this|that|everything|things?)\s+should\s+be\b/i;

    // Epistemic check runs first — it is the most specific/dangerous signal.
    if (EPISTEMIC_SUBJECT_SHOULD.test(haystack)) {
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

  // 2) Hard causality claims (heuristic trigger): require evidence wording when asserting causality.
  // Change 2 & 6: Expanded phrase list + evidence suppression.

  // Temporal 'since' exclusion (Change 6)
  const TEMPORAL_SINCE =
    /\bsince\s+(?:last\s+)?(?:yesterday|today|then|\d{4}|\d{1,2}[/-]\d{1,2}|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago|the\s+(?:beginning|start|end)|version\s+\d)/i;

  // Hedged-because pattern (Change 2)
  const HEDGED_BECAUSE =
    /\b(?:probably|likely|possibly|perhaps|maybe|might\s+be|could\s+be)\s+because\b/i;

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
        const nearby = haystack.slice(Math.max(0, idx - 50), Math.min(haystack.length, idx + 100));
        if (TEMPORAL_SINCE.test(nearby)) continue;
      }

      if (phrase === 'because') {
        // Hedged because: always flag regardless of evidence
        if (HEDGED_BECAUSE.test(haystack)) {
          matches.push({ kind: 'causality_language', evidence: 'because (hedged)' });
          break; // one flag per hedged-because pattern is sufficient
        }
        // Evidence nearby suppresses plain 'because'
        if (hasEvidenceNearby(haystack, idx, rawText)) continue;
        matches.push({ kind: 'causality_language', evidence: phrase });
        continue;
      }

      // All other causality phrases: suppress when evidence is nearby
      if (hasEvidenceNearby(haystack, idx, rawText)) continue;
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
    matches.push({ kind: 'causality_language', evidence: m[0].trim() });
  }

  // 3) Fake rigor / uncited quantification
  // Change 4: isQualityScore replaces the raw N/10 regex.
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

  // 4) Over-claiming completeness (must be backed by explicit actions/observations)
  // Change 5: Expanded phrase list + structural regex patterns.
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
    'nothing left to do',
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
    matches.push({ kind: 'completeness_claim', evidence: m[0].trim() });
  }

  return matches;
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

/**
 * Default weights for each detection category.
 * Must sum to 1.0 for aggregate scores to be in [0, 1].
 */
const DEFAULT_WEIGHTS = {
  speculation_language: 0.25,
  causality_language: 0.3,
  pseudo_quantification: 0.15,
  completeness_claim: 0.2,
  fabricated_source: 0.1,
};

/**
 * Score a single sentence across all detection categories.
 * Returns binary scores (0 or 1) per category.
 */
function scoreSentence(sentence) {
  const matches = findTriggerMatches(sentence);
  const scores = {
    speculation_language: 0,
    causality_language: 0,
    pseudo_quantification: 0,
    completeness_claim: 0,
    fabricated_source: 0,
  };
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
  const w = weights || DEFAULT_WEIGHTS;
  let total = 0;
  let weightSum = 0;
  for (const [category, weight] of Object.entries(w)) {
    total += weight * (scores[category] || 0);
    weightSum += weight;
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

/**
 * Load weights from an optional `.hallucination-detectorrc.cjs` config file
 * in the current working directory. Unknown keys are merged on top of the
 * defaults; missing keys fall back to defaults.
 */
function loadWeights() {
  const rcPath = path.join(process.cwd(), '.hallucination-detectorrc.cjs');
  try {
    if (fs.existsSync(rcPath)) {
      // eslint-disable-next-line import/no-dynamic-require
      const rc = require(rcPath);
      if (rc?.weights && typeof rc.weights === 'object') {
        return { ...DEFAULT_WEIGHTS, ...rc.weights };
      }
    }
  } catch {
    // ignore errors loading config
  }
  return DEFAULT_WEIGHTS;
}

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

function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function main() {
  const input = readStdinJson();
  const transcriptPath = input.transcript_path || '';
  const sessionId = input.session_id || '';
  const stopHookActive = Boolean(input.stop_hook_active);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
  }

  const transcriptText = safeReadFileText(transcriptPath);
  if (!transcriptText.trim()) {
    process.exit(0);
  }

  const entries = parseJsonl(transcriptText);
  const lastAssistantText = getLastAssistantText(entries);
  if (!lastAssistantText) {
    process.exit(0);
  }

  const matches = findTriggerMatches(lastAssistantText);
  if (matches.length === 0) {
    const { statePath } = loadLoopState(sessionId);
    saveLoopState(statePath, { blocks: 0 });
    process.exit(0);
  }

  const { statePath, data } = loadLoopState(sessionId);
  const blocks = Number(data.blocks || 0);
  const nextBlocks = blocks + 1;

  // Avoid infinite loops: after 2 blocks in the same session, allow stop.
  if (nextBlocks > 2 && stopHookActive) {
    saveLoopState(statePath, { blocks: nextBlocks });
    process.exit(0);
  }

  saveLoopState(statePath, { blocks: nextBlocks });

  const uniqueKinds = [...new Set(matches.map((m) => m.kind))];
  const evidenceSnippets = matches
    .slice(0, 6)
    .map((m) => `- ${m.kind}: "${m.evidence}"`)
    .join('\n');

  const reason = [
    'Hallucination-detector STOP HOOK blocked this response.',
    '',
    'Detected trigger language in your last assistant message:',
    evidenceSnippets || '- (no snippets available)',
    '',
    'Rewrite the response to follow these rules:',
    '- Only state actions you actually took and what you actually observed.',
    '- If information is missing, say "I don\'t know yet" / "I don\'t have that information" / "I can check using my tools".',
    '- Do not assert causality unless you explicitly cite the observed evidence that supports it.',
    '- Remove speculative hedging (e.g., "probably", "likely", "seems"). Replace with verification steps or uncertainty statements.',
    '- If you need to reference or discuss a flagged phrase in your rewrite, wrap it in backticks (e.g., `probably`, `because`) so the hook does not re-trigger on the explanation.',
    '',
    `Kinds flagged: ${uniqueKinds.join(', ')}`,
  ].join('\n');

  emitJson({ decision: 'block', reason });
  process.exit(0);
}

// Export internals for testing; run main() only when executed directly.
if (require.main === module) {
  main();
}

module.exports = {
  findTriggerMatches,
  normalizeForScan,
  stripLowSignalRegions,
  extractTextFromMessageContent,
  getLastAssistantText,
  hasEvidenceNearby,
  isIndexWithinQuestion,
  isQualityScore,
  hasEnumerationNearby,
  parseJsonl,
  splitIntoSentences,
  scoreSentence,
  aggregateWeightedScore,
  getLabelForScore,
  loadWeights,
  scoreText,
  DEFAULT_WEIGHTS,
};
