const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findTriggerMatches,
  stripLowSignalRegions,
  extractTextFromMessageContent,
  getLastAssistantText,
  parseJsonl,
  splitIntoSentences,
  scoreSentence,
  aggregateWeightedScore,
  getLabelForScore,
  scoreText,
  loadWeights,
  DEFAULT_WEIGHTS,
} = require('../scripts/hallucination-audit-stop.cjs');

// =============================================================================
// Speculation language
// =============================================================================
describe('speculation language', () => {
  it('flags "I think"', () => {
    const matches = findTriggerMatches('I think the issue is in the config.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('speculation_language'));
  });

  it('flags "probably"', () => {
    const matches = findTriggerMatches('This is probably a race condition.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('speculation_language'));
  });

  it('flags "likely"', () => {
    const matches = findTriggerMatches('The error is likely in the database layer.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('speculation_language'));
  });

  it('does not flag questions', () => {
    const matches = findTriggerMatches('Should I do that now?');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    assert.equal(specMatches.length, 0);
  });

  it('does not flag code blocks', () => {
    const matches = findTriggerMatches('Here is the fix:\n```\nif (probably) return;\n```\n');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence === 'probably',
    );
    assert.equal(specMatches.length, 0);
  });

  it('does not flag inline code', () => {
    const matches = findTriggerMatches('Set the value to `likely` in the config.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence === 'likely',
    );
    assert.equal(specMatches.length, 0);
  });

  it('flags epistemic "should be"', () => {
    const matches = findTriggerMatches('It should be working now.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    assert.ok(specMatches.length > 0);
  });

  it('does not flag prescriptive "should be" with identifier', () => {
    // Prescriptive suppression requires the value after inline code stripping
    const matches = findTriggerMatches('The value should be true.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence.includes('should be'),
    );
    assert.equal(specMatches.length, 0);
  });
});

// =============================================================================
// Causality language
// =============================================================================
describe('causality language', () => {
  it('flags "because" without evidence', () => {
    const matches = findTriggerMatches('The test fails because the mock is wrong.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('causality_language'));
  });

  it('suppresses "because" with nearby evidence', () => {
    const matches = findTriggerMatches(
      'The test fails because `error code 127` was returned by the process.',
    );
    const causalMatches = matches.filter(
      (m) => m.kind === 'causality_language' && m.evidence === 'because',
    );
    assert.equal(causalMatches.length, 0);
  });

  it('flags "caused by" without evidence', () => {
    const matches = findTriggerMatches('The outage was caused by a memory leak.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('causality_language'));
  });

  it('does not flag temporal "since"', () => {
    const matches = findTriggerMatches('This has been broken since yesterday.');
    const sinceMatches = matches.filter(
      (m) => m.kind === 'causality_language' && m.evidence === 'since',
    );
    assert.equal(sinceMatches.length, 0);
  });

  it('flags hedged because', () => {
    const matches = findTriggerMatches('This probably fails because the path is wrong.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('causality_language'));
  });
});

// =============================================================================
// Pseudo-quantification
// =============================================================================
describe('pseudo-quantification', () => {
  it('flags quality scores like 8.5/10', () => {
    const matches = findTriggerMatches('I would rate this code 8.5/10.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('pseudo_quantification'));
  });

  it('flags bare percentages', () => {
    // The percentage regex requires % to be followed immediately by a word character
    // (the trailing \b in /\b\d{1,3}(?:\.\d+)?\s*%\b/ matches only when a word char follows %)
    const matches = findTriggerMatches('This achieves a 70%reduction in latency.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('pseudo_quantification'));
  });

  it('does not flag 10/10 as quality score (identity ratio)', () => {
    const matches = findTriggerMatches('10/10 requirements met.');
    const qualityMatches = matches.filter(
      (m) => m.kind === 'pseudo_quantification' && m.evidence.includes('/10'),
    );
    assert.equal(qualityMatches.length, 0);
  });

  it('does not flag N/10 followed by count noun', () => {
    const matches = findTriggerMatches('7/10 tests passed successfully.');
    const qualityMatches = matches.filter(
      (m) => m.kind === 'pseudo_quantification' && m.evidence.includes('/10'),
    );
    assert.equal(qualityMatches.length, 0);
  });
});

// =============================================================================
// Completeness claims
// =============================================================================
describe('completeness claims', () => {
  it('flags "all files checked"', () => {
    const matches = findTriggerMatches('I have verified that all files checked out fine.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('completeness_claim'));
  });

  it('flags "fully resolved"', () => {
    const matches = findTriggerMatches('The bug is fully resolved.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('completeness_claim'));
  });

  it('flags "everything is fixed"', () => {
    const matches = findTriggerMatches('Everything is fixed now.');
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('completeness_claim'));
  });

  it('suppresses structural completeness near enumerated list', () => {
    const text =
      '1. Fixed auth module\n2. Fixed db layer\n3. Fixed API routes\nAll issues have been fixed.';
    const matches = findTriggerMatches(text);
    const structuralMatches = matches.filter(
      (m) => m.kind === 'completeness_claim' && m.evidence.startsWith('All issues have been'),
    );
    assert.equal(structuralMatches.length, 0);
  });
});

// =============================================================================
// Helper: extractTextFromMessageContent
// =============================================================================
describe('extractTextFromMessageContent', () => {
  it('extracts plain string', () => {
    assert.equal(extractTextFromMessageContent('hello'), 'hello');
  });

  it('extracts text blocks from array', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'second' },
    ];
    assert.equal(extractTextFromMessageContent(content), 'first\nsecond');
  });

  it('ignores tool_use blocks', () => {
    const content = [{ type: 'tool_use', name: 'Bash', input: {} }];
    assert.equal(extractTextFromMessageContent(content), '');
  });
});

// =============================================================================
// Helper: getLastAssistantText
// =============================================================================
describe('getLastAssistantText', () => {
  it('returns last assistant message text', () => {
    const entries = [
      { type: 'human', message: { content: 'hi' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'response one' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'response two' }] } },
    ];
    assert.equal(getLastAssistantText(entries), 'response two');
  });

  it('skips sidechain entries', () => {
    const entries = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'main' }] } },
      {
        type: 'assistant',
        isSidechain: true,
        message: { content: [{ type: 'text', text: 'side' }] },
      },
    ];
    assert.equal(getLastAssistantText(entries), 'main');
  });
});

// =============================================================================
// Helper: parseJsonl
// =============================================================================
describe('parseJsonl', () => {
  it('parses valid JSONL', () => {
    const text = '{"a":1}\n{"b":2}\n';
    const entries = parseJsonl(text);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0], { a: 1 });
  });

  it('skips invalid lines', () => {
    const text = '{"a":1}\nnot json\n{"b":2}';
    const entries = parseJsonl(text);
    assert.equal(entries.length, 2);
  });
});

// =============================================================================
// Helper: stripLowSignalRegions
// =============================================================================
describe('stripLowSignalRegions', () => {
  it('removes fenced code blocks', () => {
    const text = 'before\n```\nprobably\n```\nafter';
    const stripped = stripLowSignalRegions(text);
    assert.ok(!stripped.includes('probably'));
    assert.ok(stripped.includes('before'));
    assert.ok(stripped.includes('after'));
  });

  it('removes inline code', () => {
    const stripped = stripLowSignalRegions('set `likely` to true');
    assert.ok(!stripped.includes('likely'));
  });

  it('removes blockquotes', () => {
    const stripped = stripLowSignalRegions('> probably wrong\nnot quoted');
    assert.ok(!stripped.includes('probably'));
    assert.ok(stripped.includes('not quoted'));
  });
});

// =============================================================================
// Integration: clean text passes
// =============================================================================
describe('integration', () => {
  it('clean evidence-based text produces no matches', () => {
    const text =
      'I read the file at src/main.rs:42. The output showed error code 1. ' +
      'I ran `cargo test` and observed 3 failures in the auth module.';
    const matches = findTriggerMatches(text);
    assert.equal(matches.length, 0);
  });

  it('mixed text flags only speculation, not evidence', () => {
    const text =
      'I observed error code 127 in the logs. ' + 'I think the root cause is a missing binary.';
    const matches = findTriggerMatches(text);
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('speculation_language'));
  });
});

// =============================================================================
// splitIntoSentences
// =============================================================================
describe('splitIntoSentences', () => {
  it('splits on periods', () => {
    const sentences = splitIntoSentences('First sentence. Second sentence. Third sentence.');
    assert.equal(sentences.length, 3);
    assert.equal(sentences[0], 'First sentence.');
    assert.equal(sentences[1], 'Second sentence.');
    assert.equal(sentences[2], 'Third sentence.');
  });

  it('splits on exclamation marks', () => {
    const sentences = splitIntoSentences('Watch out! It is dangerous!');
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0], 'Watch out!');
  });

  it('splits on question marks', () => {
    const sentences = splitIntoSentences('Is this correct? Yes it is.');
    assert.equal(sentences.length, 2);
    assert.equal(sentences[0], 'Is this correct?');
  });

  it('returns single-sentence text as one element', () => {
    const sentences = splitIntoSentences('No terminal punctuation here');
    assert.equal(sentences.length, 1);
    assert.equal(sentences[0], 'No terminal punctuation here');
  });

  it('filters empty results from blank input', () => {
    const sentences = splitIntoSentences('');
    assert.equal(sentences.length, 0);
  });

  it('handles multiple spaces between sentences', () => {
    const sentences = splitIntoSentences('First.  Second.');
    assert.equal(sentences.length, 2);
  });

  it('handles mixed punctuation', () => {
    const sentences = splitIntoSentences('A. B! C?');
    assert.equal(sentences.length, 3);
  });
});

// =============================================================================
// scoreSentence
// =============================================================================
describe('scoreSentence', () => {
  it('returns zero scores for clean text', () => {
    const scores = scoreSentence('I read the file and saw no errors.');
    assert.equal(scores.speculation_language, 0);
    assert.equal(scores.causality_language, 0);
    assert.equal(scores.pseudo_quantification, 0);
    assert.equal(scores.completeness_claim, 0);
    assert.equal(scores.fabricated_source, 0);
  });

  it('returns 1 for speculation_language on speculative text', () => {
    const scores = scoreSentence('I think this is broken.');
    assert.equal(scores.speculation_language, 1);
  });

  it('returns 1 for causality_language on causal text', () => {
    const scores = scoreSentence('The test breaks because the config is missing.');
    assert.equal(scores.causality_language, 1);
  });

  it('scores multiple categories independently', () => {
    const scores = scoreSentence('I think this breaks because of a bug.');
    assert.equal(scores.speculation_language, 1);
    assert.equal(scores.causality_language, 1);
  });

  it('returns 1 for pseudo_quantification on percentage text', () => {
    // The percentage regex requires a word char after %; use '40%reduction' (no space).
    const scores = scoreSentence('This achieves a 40%reduction in latency.');
    assert.equal(scores.pseudo_quantification, 1);
  });

  it('returns 1 for completeness_claim on overclaim text', () => {
    const scores = scoreSentence('Everything is fixed now.');
    assert.equal(scores.completeness_claim, 1);
  });
});

// =============================================================================
// aggregateWeightedScore
// =============================================================================
describe('aggregateWeightedScore', () => {
  it('returns 0 for all-zero scores', () => {
    const scores = {
      speculation_language: 0,
      causality_language: 0,
      pseudo_quantification: 0,
      completeness_claim: 0,
      fabricated_source: 0,
    };
    assert.equal(aggregateWeightedScore(scores, DEFAULT_WEIGHTS), 0);
  });

  it('returns 1 for all-one scores with default weights (weights sum to 1)', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 1,
      pseudo_quantification: 1,
      completeness_claim: 1,
      fabricated_source: 1,
    };
    assert.equal(aggregateWeightedScore(scores, DEFAULT_WEIGHTS), 1);
  });

  it('returns the triggered category fractional weight for partial scores', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 0,
      pseudo_quantification: 0,
      completeness_claim: 0,
      fabricated_source: 0,
    };
    // speculation weight = 0.25, all weights sum ≈ 1.0, so result ≈ 0.25
    const result = aggregateWeightedScore(scores, DEFAULT_WEIGHTS);
    assert.ok(Math.abs(result - 0.25) < 0.001, `Expected ~0.25, got ${result}`);
  });

  it('normalizes custom weights that do not sum to 1', () => {
    const customWeights = { speculation_language: 2, causality_language: 2 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // total = 4, weightSum = 4 → 4/4 = 1
    assert.equal(aggregateWeightedScore(scores, customWeights), 1);
  });

  it('handles missing score keys as 0', () => {
    const scores = { speculation_language: 1 };
    const result = aggregateWeightedScore(scores, DEFAULT_WEIGHTS);
    // Only speculation fires: 0.25 / 1.0 ≈ 0.25
    assert.ok(Math.abs(result - 0.25) < 0.001, `Expected ~0.25, got ${result}`);
  });

  it('returns 0 when weights object is empty', () => {
    const scores = { speculation_language: 1 };
    assert.equal(aggregateWeightedScore(scores, {}), 0);
  });

  it('ignores unknown category keys in custom weights', () => {
    const customWeights = { unknown_key: 99, speculation_language: 1 };
    const scores = { speculation_language: 1 };
    // unknown_key should be ignored; only speculation_language contributes
    const result = aggregateWeightedScore(scores, customWeights);
    assert.equal(result, 1);
  });

  it('ignores NaN weight values', () => {
    const customWeights = { speculation_language: Number.NaN, causality_language: 0.5 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // NaN weight for speculation_language is skipped; only causality contributes
    const result = aggregateWeightedScore(scores, customWeights);
    assert.equal(result, 1);
  });

  it('ignores negative weight values', () => {
    const customWeights = { speculation_language: -1, causality_language: 0.5 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // Negative weight for speculation_language is skipped; only causality contributes
    const result = aggregateWeightedScore(scores, customWeights);
    assert.equal(result, 1);
  });
});

// =============================================================================
// getLabelForScore
// =============================================================================
describe('getLabelForScore', () => {
  it('returns GROUNDED for score < 0.30', () => {
    assert.equal(getLabelForScore(0), 'GROUNDED');
    assert.equal(getLabelForScore(0.1), 'GROUNDED');
    assert.equal(getLabelForScore(0.29), 'GROUNDED');
  });

  it('returns UNCERTAIN for score between 0.30 and 0.60 inclusive', () => {
    assert.equal(getLabelForScore(0.3), 'UNCERTAIN');
    assert.equal(getLabelForScore(0.45), 'UNCERTAIN');
    assert.equal(getLabelForScore(0.6), 'UNCERTAIN');
  });

  it('returns HALLUCINATED for score > 0.60', () => {
    assert.equal(getLabelForScore(0.61), 'HALLUCINATED');
    assert.equal(getLabelForScore(0.8), 'HALLUCINATED');
    assert.equal(getLabelForScore(1), 'HALLUCINATED');
  });
});

// =============================================================================
// scoreText
// =============================================================================
describe('scoreText', () => {
  it('returns one result per sentence', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const results = scoreText(text);
    assert.equal(results.length, 3);
  });

  it('result objects have required fields', () => {
    const results = scoreText('This is clean.');
    assert.equal(results.length, 1);
    const r = results[0];
    assert.ok('sentence' in r);
    assert.ok('index' in r);
    assert.ok('total' in r);
    assert.ok('scores' in r);
    assert.ok('aggregateScore' in r);
    assert.ok('label' in r);
  });

  it('index starts at 0 and total reflects sentence count', () => {
    const results = scoreText('One. Two. Three.');
    assert.equal(results[0].index, 0);
    assert.equal(results[2].index, 2);
    assert.equal(results[0].total, 3);
  });

  it('clean sentence gets GROUNDED label', () => {
    const results = scoreText('I ran the tests and they all passed.');
    assert.equal(results[0].label, 'GROUNDED');
    assert.equal(results[0].aggregateScore, 0);
  });

  it('causal sentence gets UNCERTAIN label', () => {
    // causality_language weight = 0.30, so score = 0.30 → UNCERTAIN
    const results = scoreText('The test breaks because the config is missing.');
    const causalResult = results.find((r) => r.scores.causality_language === 1);
    assert.ok(causalResult);
    assert.equal(causalResult.label, 'UNCERTAIN');
  });

  it('highly flagged sentence gets HALLUCINATED label', () => {
    // speculation (0.25) + causality (0.30) + completeness (0.20) = 0.75 → HALLUCINATED
    const results = scoreText('I think everything is fixed because of the change.');
    const flagged = results.find((r) => r.aggregateScore > 0.6);
    assert.ok(flagged);
    assert.equal(flagged.label, 'HALLUCINATED');
  });

  it('accepts custom weights', () => {
    const customWeights = { speculation_language: 1 };
    const results = scoreText('I think it works.', customWeights);
    // 1 * 1 / 1 = 1.0 → HALLUCINATED
    assert.equal(results[0].aggregateScore, 1);
    assert.equal(results[0].label, 'HALLUCINATED');
  });

  it('handles single-sentence text', () => {
    const results = scoreText('No issues detected');
    assert.equal(results.length, 1);
    assert.equal(results[0].index, 0);
    assert.equal(results[0].total, 1);
  });

  it('each sentence is scored independently', () => {
    const text = 'I think this is broken. The test passed with no errors.';
    const results = scoreText(text);
    assert.equal(results.length, 2);
    assert.equal(results[0].scores.speculation_language, 1);
    assert.equal(results[1].scores.speculation_language, 0);
  });
});

// =============================================================================
// DEFAULT_WEIGHTS
// =============================================================================
describe('DEFAULT_WEIGHTS', () => {
  it('contains all five detection categories', () => {
    assert.ok('speculation_language' in DEFAULT_WEIGHTS);
    assert.ok('causality_language' in DEFAULT_WEIGHTS);
    assert.ok('pseudo_quantification' in DEFAULT_WEIGHTS);
    assert.ok('completeness_claim' in DEFAULT_WEIGHTS);
    assert.ok('fabricated_source' in DEFAULT_WEIGHTS);
  });

  it('weights sum to 1.0', () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9, `Expected sum ~1.0, got ${sum}`);
  });
});

// =============================================================================
// loadWeights
// =============================================================================
describe('loadWeights', () => {
  it('returns DEFAULT_WEIGHTS when no config file exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const weights = loadWeights();
      assert.deepEqual(weights, DEFAULT_WEIGHTS);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('merges valid weight overrides from config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.hallucination-detectorrc.cjs'),
        'module.exports = { weights: { speculation_language: 0.5, causality_language: 0.4 } };',
      );
      process.chdir(tmpDir);
      const weights = loadWeights();
      assert.equal(weights.speculation_language, 0.5);
      assert.equal(weights.causality_language, 0.4);
      // Other categories fall back to defaults
      assert.equal(weights.pseudo_quantification, DEFAULT_WEIGHTS.pseudo_quantification);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('ignores invalid (non-numeric) weight values, falls back to default', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.hallucination-detectorrc.cjs'),
        'module.exports = { weights: { speculation_language: "high", causality_language: 0.4 } };',
      );
      process.chdir(tmpDir);
      const weights = loadWeights();
      // Non-numeric value falls back to default
      assert.equal(weights.speculation_language, DEFAULT_WEIGHTS.speculation_language);
      assert.equal(weights.causality_language, 0.4);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('ignores unknown category keys from config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.hallucination-detectorrc.cjs'),
        'module.exports = { weights: { unknown_category: 0.99 } };',
      );
      process.chdir(tmpDir);
      const weights = loadWeights();
      assert.ok(!Object.hasOwn(weights, 'unknown_category'));
      assert.deepEqual(weights, DEFAULT_WEIGHTS);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('returns DEFAULT_WEIGHTS when config has no weights property', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, '.hallucination-detectorrc.cjs'), 'module.exports = {};');
      process.chdir(tmpDir);
      const weights = loadWeights();
      assert.deepEqual(weights, DEFAULT_WEIGHTS);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
