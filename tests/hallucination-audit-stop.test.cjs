'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findTriggerMatches,
  buildBlockReason,
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
  stripLabeledClaimLines,
  buildStructuralBlockReason,
  detectInternalContradictions,
  extractSignificantTerms,
  stripNegationMarkers,
  stemWord,
} = require('../scripts/hallucination-audit-stop.cjs');

const SCRIPT_PATH = path.resolve(__dirname, '../scripts/hallucination-audit-stop.cjs');

/**
 * Run the stop-hook script as a child process with the given stdin JSON payload.
 * Returns { stdout, stderr, status }.
 */
function runHook(stdinPayload) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf-8',
    timeout: 10000,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

/**
 * Build a temporary transcript file whose last assistant message is the given text.
 * Returns the file path. Caller is responsible for cleanup.
 */
function makeTempTranscript(assistantText) {
  const tmpFile = path.join(
    os.tmpdir(),
    `hd-main-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  const entry = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: assistantText }] },
  });
  fs.writeFileSync(tmpFile, `${entry}\n`, 'utf-8');
  return tmpFile;
}

// =============================================================================
// Speculation language
// =============================================================================
describe('speculation language', () => {
  it('flags "I think"', () => {
    const matches = findTriggerMatches('I think the issue is in the config.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('speculation_language');
  });

  it('flags "probably"', () => {
    const matches = findTriggerMatches('This is probably a race condition.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('speculation_language');
  });

  it('flags "likely"', () => {
    const matches = findTriggerMatches('The error is likely in the database layer.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('speculation_language');
  });

  it('does not flag questions', () => {
    const matches = findTriggerMatches('Should I do that now?');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag code blocks', () => {
    const matches = findTriggerMatches('Here is the fix:\n```\nif (probably) return;\n```\n');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence === 'probably',
    );
    expect(specMatches.length).toBe(0);
  });

  it('does not flag inline code', () => {
    const matches = findTriggerMatches('Set the value to `likely` in the config.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence === 'likely',
    );
    expect(specMatches.length).toBe(0);
  });

  it('flags epistemic "should be"', () => {
    const matches = findTriggerMatches('It should be working now.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBeGreaterThan(0);
  });

  it('does not flag prescriptive "should be" with identifier', () => {
    // Prescriptive suppression requires the value after inline code stripping
    const matches = findTriggerMatches('The value should be true.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence.includes('should be'),
    );
    expect(specMatches.length).toBe(0);
  });

  it('does not flag hypothesis "should be" framing', () => {
    const matches = findTriggerMatches('H0 should be rejected based on the data.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag instructional "should be"', () => {
    const matches = findTriggerMatches('You should configure the timeout value.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('flags bare "should be" fallback trigger', () => {
    // "The answer should be." — no following identifier, no epistemic subject, no hypothesis
    // framing — exercises the bare fallback branch (lines 278-283 in source)
    const matches = findTriggerMatches('The answer should be.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence === 'should be',
    );
    expect(specMatches.length).toBeGreaterThan(0);
  });

  it('does not flag relative-clause "that should be" as epistemic (false positive regression)', () => {
    // "that" here is a relative pronoun introducing a subordinate clause, not an epistemic subject.
    // Previously EPISTEMIC_SUBJECT_SHOULD fired on e.g. "changes that should be reflected in the docs".
    const falsePositiveCases = [
      'The changes that should be reflected in the documentation.',
      'Files that should be committed.',
      'The behavior that should be documented.',
      'This file requires changes that should be reflected in the documentation.',
    ];
    for (const text of falsePositiveCases) {
      const matches = findTriggerMatches(text);
      const epistemicMatches = matches.filter(
        (m) => m.kind === 'speculation_language' && m.evidence === 'should be (epistemic)',
      );
      expect(epistemicMatches, `false positive on: ${text}`).toHaveLength(0);
    }
  });

  it('still flags sentence-initial demonstrative "that should be" as epistemic', () => {
    // "That should be resolved." — 'that' is a demonstrative pronoun (sentence subject), not relative.
    const genuineCases = [
      'That should be fixed already.',
      'I fixed the bug. That should be resolved now.',
    ];
    for (const text of genuineCases) {
      const matches = findTriggerMatches(text);
      const epistemicMatches = matches.filter(
        (m) => m.kind === 'speculation_language' && m.evidence === 'should be (epistemic)',
      );
      expect(epistemicMatches, `missed genuine epistemic: ${text}`).toHaveLength(1);
    }
  });

  it('flags "may" in speculative context', () => {
    const matches = findTriggerMatches('This may cause an issue.');
    const specMatches = matches.filter(
      (m) => m.kind === 'speculation_language' && m.evidence.includes('may'),
    );
    expect(specMatches.length).toBeGreaterThan(0);
  });

  it('flags "may not" in speculative context', () => {
    const matches = findTriggerMatches('This may not work correctly.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('speculation_language');
  });

  it('does not flag permissive/instructional "may"', () => {
    // "You may use this feature" — permissive grant, not speculation
    const matches = findTriggerMatches('You may use this feature.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag "May" in a question (already suppressed by isIndexWithinQuestion)', () => {
    const matches = findTriggerMatches('May I ask a question?');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });
});

// =============================================================================
// Causality language
// =============================================================================
describe('causality language', () => {
  it('flags "because" without evidence', () => {
    const matches = findTriggerMatches('The test fails because the mock is wrong.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('causality_language');
  });

  it('suppresses "because" with nearby evidence', () => {
    const matches = findTriggerMatches(
      'The test fails because `error code 127` was returned by the process.',
    );
    const causalMatches = matches.filter(
      (m) => m.kind === 'causality_language' && m.evidence === 'because',
    );
    expect(causalMatches.length).toBe(0);
  });

  it('flags "caused by" without evidence', () => {
    const matches = findTriggerMatches('The outage was caused by a memory leak.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('causality_language');
  });

  it('does not flag temporal "since"', () => {
    const matches = findTriggerMatches('This has been broken since yesterday.');
    const sinceMatches = matches.filter(
      (m) => m.kind === 'causality_language' && m.evidence === 'since',
    );
    expect(sinceMatches.length).toBe(0);
  });

  it('flags hedged because', () => {
    const matches = findTriggerMatches('This probably fails because the path is wrong.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('causality_language');
  });

  it('flags hedged-because with evidence "because (hedged)"', () => {
    const matches = findTriggerMatches('It failed probably because of the timeout.');
    const hedgedMatches = matches.filter(
      (m) => m.kind === 'causality_language' && m.evidence === 'because (hedged)',
    );
    expect(hedgedMatches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Pseudo-quantification
// =============================================================================
describe('pseudo-quantification', () => {
  it('flags quality scores like 8.5/10', () => {
    const matches = findTriggerMatches('I would rate this code 8.5/10.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('pseudo_quantification');
  });

  it('flags bare percentages', () => {
    // The percentage regex requires % to be followed immediately by a word character
    // (the trailing \b in /\b\d{1,3}(?:\.\d+)?\s*%\b/ matches only when a word char follows %)
    const matches = findTriggerMatches('This achieves a 70%reduction in latency.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('pseudo_quantification');
  });

  it('does not flag 10/10 as quality score (identity ratio)', () => {
    const matches = findTriggerMatches('10/10 requirements met.');
    const qualityMatches = matches.filter(
      (m) => m.kind === 'pseudo_quantification' && m.evidence.includes('/10'),
    );
    expect(qualityMatches.length).toBe(0);
  });

  it('does not flag N/10 followed by count noun', () => {
    const matches = findTriggerMatches('7/10 tests passed successfully.');
    const qualityMatches = matches.filter(
      (m) => m.kind === 'pseudo_quantification' && m.evidence.includes('/10'),
    );
    expect(qualityMatches.length).toBe(0);
  });

  it('flags decimal numerator quality score like 7.5/10', () => {
    const matches = findTriggerMatches('The quality score is 7.5/10.');
    const qualityMatches = matches.filter((m) => m.kind === 'pseudo_quantification');
    expect(qualityMatches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Completeness claims
// =============================================================================
describe('completeness claims', () => {
  it('flags "all files checked"', () => {
    const matches = findTriggerMatches('I have verified that all files checked out fine.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('completeness_claim');
  });

  it('flags "fully resolved"', () => {
    const matches = findTriggerMatches('The bug is fully resolved.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('completeness_claim');
  });

  it('flags "everything is fixed"', () => {
    const matches = findTriggerMatches('Everything is fixed now.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('completeness_claim');
  });

  it('does not flag "nothing left to do" as completeness_claim', () => {
    const matches = findTriggerMatches('The working tree is clean — nothing left to do here.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).not.toContain('completeness_claim');
  });

  it('suppresses structural completeness near enumerated list', () => {
    const text =
      '1. Fixed auth module\n2. Fixed db layer\n3. Fixed API routes\nAll issues have been fixed.';
    const matches = findTriggerMatches(text);
    const structuralMatches = matches.filter(
      (m) => m.kind === 'completeness_claim' && m.evidence.startsWith('All issues have been'),
    );
    expect(structuralMatches.length).toBe(0);
  });
});

// =============================================================================
// Helper: extractTextFromMessageContent
// =============================================================================
describe('extractTextFromMessageContent', () => {
  it('extracts plain string', () => {
    expect(extractTextFromMessageContent('hello')).toBe('hello');
  });

  it('extracts text blocks from array', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'second' },
    ];
    expect(extractTextFromMessageContent(content)).toBe('first\nsecond');
  });

  it('ignores tool_use blocks', () => {
    const content = [{ type: 'tool_use', name: 'Bash', input: {} }];
    expect(extractTextFromMessageContent(content)).toBe('');
  });

  it('extracts .content string field from blocks', () => {
    const content = [{ type: 'result', content: 'some text' }];
    expect(extractTextFromMessageContent(content)).toBe('some text');
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
    expect(getLastAssistantText(entries)).toBe('response two');
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
    expect(getLastAssistantText(entries)).toBe('main');
  });

  it('returns empty string when no assistant entries exist', () => {
    const entries = [{ type: 'user', message: { content: 'hi' } }];
    expect(getLastAssistantText(entries)).toBe('');
  });
});

// =============================================================================
// Helper: parseJsonl
// =============================================================================
describe('parseJsonl', () => {
  it('parses valid JSONL', () => {
    const text = '{"a":1}\n{"b":2}\n';
    const entries = parseJsonl(text);
    expect(entries.length).toBe(2);
    expect(entries[0]).toEqual({ a: 1 });
  });

  it('skips invalid lines', () => {
    const text = '{"a":1}\nnot json\n{"b":2}';
    const entries = parseJsonl(text);
    expect(entries.length).toBe(2);
  });
});

// =============================================================================
// Helper: stripLowSignalRegions
// =============================================================================
describe('stripLowSignalRegions', () => {
  it('removes fenced code blocks', () => {
    const text = 'before\n```\nprobably\n```\nafter';
    const stripped = stripLowSignalRegions(text);
    expect(stripped).not.toContain('probably');
    expect(stripped).toContain('before');
    expect(stripped).toContain('after');
  });

  it('removes inline code', () => {
    const stripped = stripLowSignalRegions('set `likely` to true');
    expect(stripped).not.toContain('likely');
  });

  it('removes blockquotes', () => {
    const stripped = stripLowSignalRegions('> probably wrong\nnot quoted');
    expect(stripped).not.toContain('probably');
    expect(stripped).toContain('not quoted');
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
    expect(matches.length).toBe(0);
  });

  it('mixed text flags only speculation, not evidence', () => {
    const text =
      'I observed error code 127 in the logs. ' + 'I think the root cause is a missing binary.';
    const matches = findTriggerMatches(text);
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('speculation_language');
  });
});

// =============================================================================
// splitIntoSentences
// =============================================================================
describe('splitIntoSentences', () => {
  it('splits on periods', () => {
    const sentences = splitIntoSentences('First sentence. Second sentence. Third sentence.');
    expect(sentences.length).toBe(3);
    expect(sentences[0]).toBe('First sentence.');
    expect(sentences[1]).toBe('Second sentence.');
    expect(sentences[2]).toBe('Third sentence.');
  });

  it('splits on exclamation marks', () => {
    const sentences = splitIntoSentences('Watch out! It is dangerous!');
    expect(sentences.length).toBe(2);
    expect(sentences[0]).toBe('Watch out!');
  });

  it('splits on question marks', () => {
    const sentences = splitIntoSentences('Is this correct? Yes it is.');
    expect(sentences.length).toBe(2);
    expect(sentences[0]).toBe('Is this correct?');
  });

  it('returns single-sentence text as one element', () => {
    const sentences = splitIntoSentences('No terminal punctuation here');
    expect(sentences.length).toBe(1);
    expect(sentences[0]).toBe('No terminal punctuation here');
  });

  it('filters empty results from blank input', () => {
    const sentences = splitIntoSentences('');
    expect(sentences.length).toBe(0);
  });

  it('handles multiple spaces between sentences', () => {
    const sentences = splitIntoSentences('First.  Second.');
    expect(sentences.length).toBe(2);
  });

  it('handles mixed punctuation', () => {
    const sentences = splitIntoSentences('A. B! C?');
    expect(sentences.length).toBe(3);
  });
});

// =============================================================================
// scoreSentence
// =============================================================================
describe('scoreSentence', () => {
  it('returns zero scores for clean text', () => {
    const scores = scoreSentence('I read the file and saw no errors.');
    expect(scores.speculation_language).toBe(0);
    expect(scores.causality_language).toBe(0);
    expect(scores.pseudo_quantification).toBe(0);
    expect(scores.completeness_claim).toBe(0);
    expect(scores.evaluative_design_claim).toBe(0);
  });

  it('returns 1 for speculation_language on speculative text', () => {
    const scores = scoreSentence('I think this is broken.');
    expect(scores.speculation_language).toBe(1);
  });

  it('returns 1 for causality_language on causal text', () => {
    const scores = scoreSentence('The test breaks because the config is missing.');
    expect(scores.causality_language).toBe(1);
  });

  it('scores multiple categories independently', () => {
    const scores = scoreSentence('I think this breaks because of a bug.');
    expect(scores.speculation_language).toBe(1);
    expect(scores.causality_language).toBe(1);
  });

  it('returns 1 for pseudo_quantification on percentage text', () => {
    // The percentage regex requires a word char after %; use '40%reduction' (no space).
    const scores = scoreSentence('This achieves a 40%reduction in latency.');
    expect(scores.pseudo_quantification).toBe(1);
  });

  it('returns 1 for completeness_claim on overclaim text', () => {
    const scores = scoreSentence('Everything is fixed now.');
    expect(scores.completeness_claim).toBe(1);
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
    };
    expect(aggregateWeightedScore(scores, DEFAULT_WEIGHTS)).toBe(0);
  });

  it('returns 1 for all-one scores with default weights (normalization preserves ceiling)', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 1,
      pseudo_quantification: 1,
      completeness_claim: 1,
      evaluative_design_claim: 1,
      internal_contradiction: 1,
    };
    expect(aggregateWeightedScore(scores, DEFAULT_WEIGHTS)).toBe(1);
  });

  it('returns the triggered category fractional weight for partial scores', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 0,
      pseudo_quantification: 0,
      completeness_claim: 0,
      evaluative_design_claim: 0,
      internal_contradiction: 0,
    };
    // speculation weight = 0.25, weightSum = 1.65 (0.25+0.3+0.15+0.2+0.4+0.35)
    // result = 0.25 / 1.65 ≈ 0.15152
    const result = aggregateWeightedScore(scores, DEFAULT_WEIGHTS);
    const expected = 0.25 / 1.65;
    expect(Math.abs(result - expected)).toBeLessThan(0.001);
  });

  it('normalizes custom weights that do not sum to 1', () => {
    const customWeights = { speculation_language: 2, causality_language: 2 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // total = 4, weightSum = 4 → 4/4 = 1
    expect(aggregateWeightedScore(scores, customWeights)).toBe(1);
  });

  it('handles missing score keys as 0', () => {
    const scores = { speculation_language: 1 };
    const result = aggregateWeightedScore(scores, DEFAULT_WEIGHTS);
    // Only speculation fires: 0.25 / 1.65 ≈ 0.15152 (weightSum = 1.65)
    const expected = 0.25 / 1.65;
    expect(Math.abs(result - expected)).toBeLessThan(0.001);
  });

  it('returns 0 when weights object is empty', () => {
    const scores = { speculation_language: 1 };
    expect(aggregateWeightedScore(scores, {})).toBe(0);
  });

  it('ignores unknown category keys in custom weights', () => {
    const customWeights = { unknown_key: 99, speculation_language: 1 };
    const scores = { speculation_language: 1 };
    // unknown_key should be ignored; only speculation_language contributes
    const result = aggregateWeightedScore(scores, customWeights);
    expect(result).toBe(1);
  });

  it('ignores NaN weight values', () => {
    const customWeights = { speculation_language: Number.NaN, causality_language: 0.5 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // NaN weight for speculation_language is skipped; only causality contributes
    const result = aggregateWeightedScore(scores, customWeights);
    expect(result).toBe(1);
  });

  it('ignores negative weight values', () => {
    const customWeights = { speculation_language: -1, causality_language: 0.5 };
    const scores = { speculation_language: 1, causality_language: 1 };
    // Negative weight for speculation_language is skipped; only causality contributes
    const result = aggregateWeightedScore(scores, customWeights);
    expect(result).toBe(1);
  });
});

// =============================================================================
// getLabelForScore
// =============================================================================
describe('getLabelForScore', () => {
  it('returns GROUNDED for score < 0.30', () => {
    expect(getLabelForScore(0)).toBe('GROUNDED');
    expect(getLabelForScore(0.1)).toBe('GROUNDED');
    expect(getLabelForScore(0.29)).toBe('GROUNDED');
  });

  it('returns UNCERTAIN for score between 0.30 and 0.60 inclusive', () => {
    expect(getLabelForScore(0.3)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.45)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.6)).toBe('UNCERTAIN');
  });

  it('returns HALLUCINATED for score > 0.60', () => {
    expect(getLabelForScore(0.61)).toBe('HALLUCINATED');
    expect(getLabelForScore(0.8)).toBe('HALLUCINATED');
    expect(getLabelForScore(1)).toBe('HALLUCINATED');
  });
});

// =============================================================================
// scoreText
// =============================================================================
describe('scoreText', () => {
  it('returns one result per sentence', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const results = scoreText(text);
    expect(results.length).toBe(3);
  });

  it('result objects have required fields', () => {
    const results = scoreText('This is clean.');
    expect(results.length).toBe(1);
    const r = results[0];
    expect(r).toHaveProperty('sentence');
    expect(r).toHaveProperty('index');
    expect(r).toHaveProperty('total');
    expect(r).toHaveProperty('scores');
    expect(r).toHaveProperty('aggregateScore');
    expect(r).toHaveProperty('label');
  });

  it('index starts at 0 and total reflects sentence count', () => {
    const results = scoreText('One. Two. Three.');
    expect(results[0].index).toBe(0);
    expect(results[2].index).toBe(2);
    expect(results[0].total).toBe(3);
  });

  it('clean sentence gets GROUNDED label', () => {
    const results = scoreText('I ran the tests and they all passed.');
    expect(results[0].label).toBe('GROUNDED');
    expect(results[0].aggregateScore).toBe(0);
  });

  it('causal sentence gets GROUNDED label', () => {
    // causality_language weight = 0.30, weightSum = 1.4 → score = 0.30/1.4 ≈ 0.214 → GROUNDED
    const results = scoreText('The test breaks because the config is missing.');
    const causalResult = results.find((r) => r.scores.causality_language === 1);
    expect(causalResult).toBeTruthy();
    expect(causalResult.label).toBe('GROUNDED');
  });

  it('highly flagged sentence gets UNCERTAIN label', () => {
    // speculation (0.25) + causality (0.30) + completeness (0.20) = 0.75 / 1.4 ≈ 0.536 → UNCERTAIN
    const results = scoreText('I think everything is fixed because of the change.');
    const flagged = results.find((r) => r.aggregateScore > 0.3);
    expect(flagged).toBeTruthy();
    expect(flagged.label).toBe('UNCERTAIN');
  });

  it('accepts custom weights', () => {
    const customWeights = { speculation_language: 1 };
    const results = scoreText('I think it works.', customWeights);
    // 1 * 1 / 1 = 1.0 → HALLUCINATED
    expect(results[0].aggregateScore).toBe(1);
    expect(results[0].label).toBe('HALLUCINATED');
  });

  it('handles single-sentence text', () => {
    const results = scoreText('No issues detected');
    expect(results.length).toBe(1);
    expect(results[0].index).toBe(0);
    expect(results[0].total).toBe(1);
  });

  it('each sentence is scored independently', () => {
    const text = 'I think this is broken. The test passed with no errors.';
    const results = scoreText(text);
    expect(results.length).toBe(2);
    expect(results[0].scores.speculation_language).toBe(1);
    expect(results[1].scores.speculation_language).toBe(0);
  });
});

// =============================================================================
// Evaluative design claims
// =============================================================================
describe('evaluative_design_claim', () => {
  it('flags "The cleanest fix is to remove the delegation constraint"', () => {
    const matches = findTriggerMatches('The cleanest fix is to remove the delegation constraint.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('evaluative_design_claim');
  });

  it('flags "The simplest solution is to bypass the python-cli-architect agent"', () => {
    const matches = findTriggerMatches(
      'The simplest solution is to bypass the python-cli-architect agent.',
    );
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('evaluative_design_claim');
  });

  it('flags all known tell phrases', () => {
    const tells = [
      'the cleanest fix',
      'the simplest fix',
      'cleanest solution',
      'simplest solution',
      'cleanest approach',
      'simplest approach',
      'the obvious fix',
      'the obvious solution',
    ];
    for (const phrase of tells) {
      const matches = findTriggerMatches(`We should use ${phrase} here.`);
      const kinds = matches.map((m) => m.kind);
      expect(
        kinds.includes('evaluative_design_claim'),
        `Expected evaluative_design_claim for phrase: "${phrase}"`,
      ).toBe(true);
    }
  });

  it('does not flag "This code is clean and well-structured" (no exact tell phrase)', () => {
    const matches = findTriggerMatches('This code is clean and well-structured.');
    const edcMatches = matches.filter((m) => m.kind === 'evaluative_design_claim');
    expect(edcMatches.length).toBe(0);
  });

  it('does not flag bare "simple" or "clean" without the tell phrase', () => {
    const matches = findTriggerMatches('A simple approach would be to refactor the module.');
    const edcMatches = matches.filter((m) => m.kind === 'evaluative_design_claim');
    expect(edcMatches.length).toBe(0);
  });

  it(
    'DOES match "The cleanest fix requires understanding what the constraint protects"' +
      " — regex is a tell, semantic gate is the prompt hook's job",
    () => {
      // The regex fires on the exact tell phrase regardless of surrounding context.
      // Whether design intent was stated is evaluated by the UserPromptSubmit prompt hook,
      // not by the regex canary. This false-positive at the regex level is acceptable.
      const matches = findTriggerMatches(
        'The cleanest fix requires understanding what the constraint protects.',
      );
      const kinds = matches.map((m) => m.kind);
      expect(kinds).toContain('evaluative_design_claim');
    },
  );

  it('is case-insensitive', () => {
    const matches = findTriggerMatches('THE CLEANEST FIX is to delete this file.');
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('evaluative_design_claim');
  });

  it('does not fire on tell phrases inside code blocks', () => {
    const text = '```\n// the cleanest fix\nreturn null;\n```\nThis is the solution.';
    const matches = findTriggerMatches(text);
    const edcMatches = matches.filter((m) => m.kind === 'evaluative_design_claim');
    expect(edcMatches.length).toBe(0);
  });

  it('detects multiple evaluative_design_claim occurrences in one text', () => {
    const matches = findTriggerMatches('The cleanest fix is X. The simplest approach is Y.');
    const edcMatches = matches.filter((m) => m.kind === 'evaluative_design_claim');
    expect(edcMatches.length).toBe(2);
  });

  it('suppresses evaluative_design_claim inside a question', () => {
    const matches = findTriggerMatches('Is the simplest fix really appropriate?');
    const edcMatches = matches.filter((m) => m.kind === 'evaluative_design_claim');
    expect(edcMatches.length).toBe(0);
  });
});

// =============================================================================
// Internal contradiction detection (negation polarity heuristics)
// =============================================================================
describe('internal_contradiction', () => {
  // --- stemWord ---
  it('stemWord: removes -ing suffix for words > 6 chars', () => {
    // "passing" = "pass" + "ing" → "pass" (no doubled consonant added)
    expect(stemWord('passing')).toBe('pass');
    expect(stemWord('failing')).toBe('fail');
    // "running" = "run" + "n" + "ing" → strip -ing gives "runn" (doubled n retained by heuristic)
    expect(stemWord('running')).toBe('runn');
  });

  it('stemWord: removes -es suffix for words > 5 chars', () => {
    expect(stemWord('passes')).toBe('pass');
    expect(stemWord('classes')).toBe('class');
  });

  it('stemWord: removes -ed suffix for words > 5 chars', () => {
    expect(stemWord('failed')).toBe('fail');
    expect(stemWord('passed')).toBe('pass');
  });

  it('stemWord: removes -s suffix for words > 4 chars', () => {
    expect(stemWord('works')).toBe('work');
    expect(stemWord('tests')).toBe('test');
  });

  it('stemWord: does not over-strip short words', () => {
    expect(stemWord('run')).toBe('run');
    expect(stemWord('bug')).toBe('bug');
    expect(stemWord('fix')).toBe('fix');
  });

  // --- extractSignificantTerms ---
  it('extractSignificantTerms: filters stop words and applies stemming', () => {
    const terms = extractSignificantTerms('The tests are passing correctly');
    expect(terms).toContain('test');
    expect(terms).toContain('pass');
    // 'correctly' is not stripped by the suffix rules (no -ing/-es/-ed/-s match),
    // so it remains as-is in the term list
    expect(terms).toContain('correctly');
    // stop words removed
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('are');
  });

  it('extractSignificantTerms: filters words shorter than 3 characters', () => {
    const terms = extractSignificantTerms('It is OK to run');
    // 'it', 'is', 'ok' (2 chars) filtered; 'run' kept
    expect(terms).toContain('run');
    expect(terms).not.toContain('ok');
  });

  // --- stripNegationMarkers ---
  it('stripNegationMarkers: removes "not"', () => {
    expect(stripNegationMarkers('The test does not pass')).toBe('The test does pass');
  });

  it('stripNegationMarkers: removes contractions like "doesn\'t"', () => {
    expect(stripNegationMarkers("The server doesn't run")).toBe('The server run');
  });

  it('stripNegationMarkers: removes "never"', () => {
    expect(stripNegationMarkers('The hook never fires')).toBe('The hook fires');
  });

  it('stripNegationMarkers: removes "cannot"', () => {
    expect(stripNegationMarkers('The user cannot proceed')).toBe('The user proceed');
  });

  // --- detectInternalContradictions ---
  it('flags a direct negation contradiction: "X works" vs "X does not work"', () => {
    const text = 'The feature works correctly. The feature does not work correctly.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].kind).toBe('internal_contradiction');
  });

  it('flags: "The server is running" vs "The server is not running"', () => {
    const text = 'The server is running smoothly. The server is not running at all.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].kind).toBe('internal_contradiction');
  });

  it('flags via findTriggerMatches: contradiction fires internal_contradiction kind', () => {
    const text = 'The test passes. The test does not pass.';
    const matches = findTriggerMatches(text);
    const kinds = matches.map((m) => m.kind);
    expect(kinds).toContain('internal_contradiction');
  });

  it('does not flag a single sentence (no pair to compare)', () => {
    const text = 'The feature works correctly.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag when only negated sentences exist (no affirmative partner)', () => {
    const text = "The feature doesn't work. The build doesn't pass. The server isn't running.";
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag when only affirmative sentences exist (no negation)', () => {
    const text = 'The feature works. The build passes. The server runs fine.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag unrelated negation (low Jaccard similarity after stripping)', () => {
    // The negated sentence is about authentication; the affirmative is about a different topic.
    const text =
      'The server responds correctly with the expected payload. The build system does not require authentication.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag question sentences', () => {
    // "Does the server run?" ends with '?' and is excluded from comparison.
    const text = 'Does the server run? The server does not run right now.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag very short sentences (< 12 chars)', () => {
    const text = 'OK. Not OK.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('does not flag text inside code blocks (stripped before comparison)', () => {
    const text = [
      '```',
      'function works() { return true; }',
      'function doesNotWork() { return false; }',
      '```',
      'The implementation is complete.',
    ].join('\n');
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBe(0);
  });

  it('evidence field contains shared terms', () => {
    const text =
      'The authentication module works as expected. The authentication module does not work as expected.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThan(0);
    // evidence should list stemmed shared terms (e.g. "authentication", "module", "work")
    const evidence = matches[0].evidence;
    expect(typeof evidence).toBe('string');
    expect(evidence.length).toBeGreaterThan(0);
    // at least one of the expected stemmed shared terms should appear in evidence
    const hasExpectedTerm =
      evidence.includes('authentication') ||
      evidence.includes('module') ||
      evidence.includes('work');
    expect(hasExpectedTerm).toBe(true);
  });
});

// =============================================================================
// Self-trigger loop regression: block reason must not re-trigger findTriggerMatches
// =============================================================================
describe('block reason self-trigger regression', () => {
  // Uses the real production buildBlockReason (imported above) — not a copy.
  // If the evidence is embedded verbatim (unprotected), findTriggerMatches()
  // would fire on the reason string itself when Claude Code writes it back into
  // the transcript as an assistant message — creating an infinite block loop.

  it('block reason for "since" match does not re-trigger findTriggerMatches', () => {
    // This is the exact scenario from the since-bug: a response containing "since"
    // causes a block. The reason string embeds the evidence. On next invocation
    // the hook reads the reason as the last assistant text and must not re-block.
    const originalMatches = findTriggerMatches('This fails since the config is missing.');
    expect(originalMatches.some((m) => m.evidence === 'since')).toBe(true);

    const reason = buildBlockReason(originalMatches);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });

  it('block reason for "because" match does not re-trigger findTriggerMatches', () => {
    const originalMatches = findTriggerMatches('The test fails because the mock is wrong.');
    expect(originalMatches.some((m) => m.evidence === 'because')).toBe(true);

    const reason = buildBlockReason(originalMatches);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });

  it('block reason for "probably" match does not re-trigger findTriggerMatches', () => {
    const originalMatches = findTriggerMatches('This is probably a race condition.');
    expect(originalMatches.some((m) => m.evidence === 'probably')).toBe(true);

    const reason = buildBlockReason(originalMatches);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });

  it('block reason for "I think" match does not re-trigger findTriggerMatches', () => {
    const originalMatches = findTriggerMatches('I think the issue is in the config.');
    expect(originalMatches.some((m) => m.evidence === 'i think')).toBe(true);

    const reason = buildBlockReason(originalMatches);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });

  it('block reason for all causality phrases does not re-trigger findTriggerMatches', () => {
    // Exhaustive check: every causality phrase that can appear as evidence
    const causalityPhrases = [
      'caused by',
      'due to',
      'because',
      'as a result',
      'therefore',
      'this means',
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
      const syntheticMatch = [{ kind: 'causality_language', evidence: phrase }];
      const reason = buildBlockReason(syntheticMatch);
      const secondPassMatches = findTriggerMatches(reason);
      expect(secondPassMatches.length).toBe(0);
    }
  });

  it('block reason for all speculation phrases does not re-trigger findTriggerMatches', () => {
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
      'should be',
      'should be (epistemic)',
    ];

    for (const phrase of speculationPhrases) {
      const syntheticMatch = [{ kind: 'speculation_language', evidence: phrase }];
      const reason = buildBlockReason(syntheticMatch);
      const secondPassMatches = findTriggerMatches(reason);
      expect(secondPassMatches.length).toBe(0);
    }
  });

  it('normalizes embedded newlines in evidence to single spaces', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'the\ncleanest\nfix', offset: 0 }];
    const reason = buildBlockReason(matches);
    // The evidence line is the second line of the "Detected trigger language" section.
    // Extract just that line to confirm newlines were collapsed before wrapping in backticks.
    const evidenceLine = reason.split('\n').find((l) => l.startsWith('- speculation_language:'));
    expect(evidenceLine).toBeDefined();
    expect(evidenceLine).toContain('`the cleanest fix`');
    expect(evidenceLine).not.toContain('\n');
  });

  it('escapes embedded backticks in evidence to prevent breaking inline code span', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'the `cleanest` fix', offset: 0 }];
    const reason = buildBlockReason(matches);
    // Extract just the evidence line — the static instruction text must not interfere.
    const evidenceLine = reason.split('\n').find((l) => l.startsWith('- speculation_language:'));
    expect(evidenceLine).toBeDefined();
    // Backticks replaced with single quotes so the span is a single inline-code token.
    expect(evidenceLine).toContain("`the 'cleanest' fix`");
    // The evidence span must open and close exactly once: one ` at start, one ` at end.
    const span = evidenceLine.replace(/^- speculation_language: /, '');
    expect(span.startsWith('`')).toBe(true);
    expect(span.endsWith('`')).toBe(true);
    expect(span.slice(1, -1)).not.toContain('`');
  });

  it('full reason string with one match per category does not re-trigger findTriggerMatches', () => {
    // Self-maintaining canary: if anyone adds a bare trigger word to the static
    // instruction text or changes the evidence snippet format so it is no longer
    // wrapped in backticks, findTriggerMatches() will fire on the reason string
    // and this test will catch it before the infinite-block loop can occur.
    const onePerCategory = [
      { kind: 'speculation_language', evidence: 'probably' },
      { kind: 'causality_language', evidence: 'because' },
      { kind: 'pseudo_quantification', evidence: '7/10' },
      { kind: 'completeness_claim', evidence: 'fully resolved' },
      { kind: 'evaluative_design_claim', evidence: 'the cleanest fix' },
    ];
    const reason = buildBlockReason(onePerCategory);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });
});

// =============================================================================
// DEFAULT_WEIGHTS
// =============================================================================
describe('DEFAULT_WEIGHTS', () => {
  it('contains all detection categories including evaluative_design_claim and internal_contradiction', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('internal_contradiction');
    expect(DEFAULT_WEIGHTS).not.toHaveProperty('fabricated_source');
  });

  it('evaluative_design_claim weight is 0.4', () => {
    expect(DEFAULT_WEIGHTS.evaluative_design_claim).toBe(0.4);
  });

  it('internal_contradiction weight is 0.35', () => {
    expect(DEFAULT_WEIGHTS.internal_contradiction).toBe(0.35);
  });
});

// =============================================================================
// loadWeights
// =============================================================================
describe('loadWeights', () => {
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns DEFAULT_WEIGHTS when no config file exists', () => {
    const weights = loadWeights();
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('merges valid weight overrides from config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { weights: { speculation_language: 0.5, causality_language: 0.4 } };',
    );
    const weights = loadWeights();
    expect(weights.speculation_language).toBe(0.5);
    expect(weights.causality_language).toBe(0.4);
    // Other categories fall back to defaults
    expect(weights.pseudo_quantification).toBe(DEFAULT_WEIGHTS.pseudo_quantification);
  });

  it('ignores invalid (non-numeric) weight values, falls back to default', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { weights: { speculation_language: "high", causality_language: 0.4 } };',
    );
    const weights = loadWeights();
    // Non-numeric value falls back to default
    expect(weights.speculation_language).toBe(DEFAULT_WEIGHTS.speculation_language);
    expect(weights.causality_language).toBe(0.4);
  });

  it('ignores unknown category keys from config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { weights: { unknown_category: 0.99 } };',
    );
    const weights = loadWeights();
    expect(Object.hasOwn(weights, 'unknown_category')).toBe(false);
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('returns DEFAULT_WEIGHTS when config has no weights property', () => {
    fs.writeFileSync(path.join(tmpDir, '.hallucination-detectorrc.cjs'), 'module.exports = {};');
    const weights = loadWeights();
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });
});

// =============================================================================
// stripLabeledClaimLines
// =============================================================================
describe('stripLabeledClaimLines', () => {
  it('strips [VERIFIED][cN] claim lines', () => {
    const input =
      'Some intro text.\n- [VERIFIED][c1] The file exists.\n  Evidence: Read tool output\nMore text.';
    const result = stripLabeledClaimLines(input);
    expect(result).not.toContain('[VERIFIED][c1]');
    expect(result).toContain('Some intro text.');
    expect(result).toContain('More text.');
  });

  it('strips [INFERRED][cN] claim lines', () => {
    const input =
      '- [INFERRED][c2] The bug is in the parser.\n  Basis: Error message points to parse step';
    const result = stripLabeledClaimLines(input);
    expect(result).not.toContain('[INFERRED][c2]');
    expect(result).not.toContain('Basis:');
  });

  it('strips [UNKNOWN][cN] claim lines and Missing: metadata', () => {
    const input = '- [UNKNOWN][c3] Whether it is configurable.\n  Missing: No config key found';
    const result = stripLabeledClaimLines(input);
    expect(result).not.toContain('[UNKNOWN][c3]');
    expect(result).not.toContain('Missing:');
  });

  it('strips [SPECULATION][cN] and [CORRELATED][cN] and [CAUSAL][cN] and [REJECTED][cN]', () => {
    const labels = ['SPECULATION', 'CORRELATED', 'CAUSAL', 'REJECTED'];
    for (const label of labels) {
      const input = `- [${label}][c1] Some claim.\n  Evidence: some evidence`;
      const result = stripLabeledClaimLines(input);
      expect(result).not.toContain(`[${label}][c1]`);
    }
  });

  it('strips Evidence:, Basis:, Missing:, and Contradicted by: metadata lines', () => {
    const input = [
      '- [VERIFIED][c1] Claim text.',
      '  Evidence: file path at line 10',
      '- [INFERRED][c2] Inferred claim.',
      '  Basis: reasoning here',
      '- [UNKNOWN][c3] Unknown point.',
      '  Missing: no doc found',
      '- [REJECTED][c4] Rejected claim.',
      '  Contradicted by: test output',
    ].join('\n');
    const result = stripLabeledClaimLines(input);
    expect(result).not.toContain('Evidence:');
    expect(result).not.toContain('Basis:');
    expect(result).not.toContain('Missing:');
    expect(result).not.toContain('Contradicted by:');
  });

  it('preserves non-claim lines', () => {
    const input =
      'ANSWER\n- Direct answer here.\n\nVERIFIED\n- [VERIFIED][c1] Claim.\n  Evidence: tool output\n\nNEXT VERIFICATION\n- Run the tests.';
    const result = stripLabeledClaimLines(input);
    expect(result).toContain('ANSWER');
    expect(result).toContain('Direct answer here.');
    expect(result).toContain('NEXT VERIFICATION');
    expect(result).toContain('Run the tests.');
  });

  it('does not strip lines that merely mention a label word without the bracket pattern', () => {
    const input = 'This is VERIFIED by observation.\nThe INFERRED result is correct.';
    const result = stripLabeledClaimLines(input);
    expect(result).toContain('This is VERIFIED by observation.');
    expect(result).toContain('The INFERRED result is correct.');
  });
});

// =============================================================================
// buildStructuralBlockReason
// =============================================================================
describe('buildStructuralBlockReason', () => {
  it('includes block header in output', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain('Hallucination-detector STOP HOOK blocked this response.');
  });

  it('formats error with claimId and label', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain('[missing_evidence] c1 [VERIFIED]: VERIFIED claims require Evidence:');
  });

  it('formats error without claimId', () => {
    const errors = [
      {
        code: 'missing_memory_write_section',
        message: 'Structured response has labeled claims but no MEMORY WRITE section',
      },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain(
      '[missing_memory_write_section]: Structured response has labeled claims but no MEMORY WRITE section',
    );
  });

  it('formats error with claimId but no label', () => {
    const errors = [
      { code: 'duplicate_claim_id', claimId: 'c1', message: 'Duplicate claim ID c1' },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain('[duplicate_claim_id] c1: Duplicate claim ID c1');
  });

  it('includes "Structured claim validation failed:" header', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain('Structured claim validation failed:');
  });

  it('includes the structured block format hint (ANSWER section)', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const reason = buildStructuralBlockReason(errors);
    expect(reason).toContain('ANSWER');
    expect(reason).toContain('MEMORY WRITE');
  });

  it('slices to max 10 errors when given more than 10', () => {
    const errors = Array.from({ length: 15 }, (_, i) => ({
      code: 'missing_evidence',
      claimId: `c${i + 1}`,
      label: 'VERIFIED',
      message: `VERIFIED claims require Evidence: (${i + 1})`,
    }));
    const reason = buildStructuralBlockReason(errors);
    // slice(0,10) means exactly 10 "- [missing_evidence]" lines appear
    const errorLineCount = reason
      .split('\n')
      .filter((l) => l.startsWith('- [missing_evidence]')).length;
    expect(errorLineCount).toBe(10);
  });

  it('uses fallback message when errors array is empty', () => {
    const reason = buildStructuralBlockReason([]);
    expect(reason).toContain('(no error details available)');
  });
});

// =============================================================================
// main() — structured + invalid path
// =============================================================================
describe('main() structured + invalid', () => {
  let transcriptPath;

  afterEach(() => {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    transcriptPath = undefined;
  });

  it('blocks when structured response has missing Evidence: on VERIFIED claim', () => {
    // [VERIFIED][c1] without an Evidence: line is structurally invalid.
    // No MEMORY WRITE section either → triggers missing_memory_write_section error too.
    const assistantText = [
      'ANSWER',
      '- The file exists.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists at scripts/foo.cjs',
      '',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-invalid-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('Structured claim validation failed');
  });

  it('block reason for invalid structure does not contain unprotected trigger phrases', () => {
    const assistantText = [
      'ANSWER',
      '- Direct response.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] Some claim.',
      '',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-invalid-reason-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    const parsed = JSON.parse(stdout.trim());
    // The block reason itself must not re-trigger the detector (self-trigger guard)
    const secondPassMatches = findTriggerMatches(parsed.reason);
    expect(secondPassMatches.length).toBe(0);
  });
});

// =============================================================================
// main() — structured + valid path
// =============================================================================
describe('main() structured + valid', () => {
  let transcriptPath;

  afterEach(() => {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    transcriptPath = undefined;
  });

  it('passes through (no block) when structured response is fully valid and clean', () => {
    // Minimal valid structured response: one VERIFIED claim with Evidence,
    // MEMORY WRITE section listing it in Allowed.
    const assistantText = [
      'ANSWER',
      '- The file exists at the expected path.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists at scripts/hallucination-audit-stop.cjs',
      '  Evidence: Tool: Confirmed via Read tool output',
      '',
      'NEXT VERIFICATION',
      '- Run pnpm test to confirm no regressions.',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-valid-clean-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    // No block decision emitted — stdout should be empty
    expect(stdout.trim()).toBe('');
  });

  it('blocks when structured + valid response has speculation in the ANSWER section (non-claim text)', () => {
    // The claim lines will be stripped before trigger scan, but "probably" in
    // the ANSWER section survives stripping and fires speculation_language.
    const assistantText = [
      'ANSWER',
      '- This is probably the correct approach.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The test passed.',
      '  Evidence: Command: pnpm test output shows 0 failures',
      '',
      'NEXT VERIFICATION',
      '- No further checks needed.',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-valid-spec-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('speculation_language');
  });
});

// =============================================================================
// main() — loop guard (blockAndExit stop_hook_active path)
// =============================================================================
describe('main() loop guard', () => {
  let transcriptPath;
  let stateFilePath;

  afterEach(() => {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    if (stateFilePath && fs.existsSync(stateFilePath)) {
      fs.unlinkSync(stateFilePath);
    }
    transcriptPath = undefined;
    stateFilePath = undefined;
  });

  it('allows through (no block emitted) when nextBlocks > 2 and stop_hook_active is true', () => {
    // Seed the loop state file with blocks: 2. The next call will compute
    // nextBlocks = 3, which satisfies nextBlocks > 2 && stopHookActive → exit(0) without block.
    const sessionId = `test-loop-guard-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 2 }), 'utf-8');

    // Use a message that would normally trigger speculation_language.
    const assistantText = 'I think this is probably correct.';
    transcriptPath = makeTempTranscript(assistantText);

    const { stdout } = runHook({
      session_id: sessionId,
      transcript_path: transcriptPath,
      stop_hook_active: true,
      hook_event_name: 'Stop',
    });

    // Loop guard triggered: no block decision emitted.
    expect(stdout.trim()).toBe('');
  });

  it('still blocks when nextBlocks <= 2 even with stop_hook_active true', () => {
    // Seed blocks: 0 — nextBlocks will be 1, which does NOT satisfy the > 2 guard.
    const sessionId = `test-loop-no-guard-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 0 }), 'utf-8');

    const assistantText = 'I think this is probably correct.';
    transcriptPath = makeTempTranscript(assistantText);

    const { stdout } = runHook({
      session_id: sessionId,
      transcript_path: transcriptPath,
      stop_hook_active: true,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.decision).toBe('block');
  });
});
