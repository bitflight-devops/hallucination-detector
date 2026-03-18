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
  DEFAULT_THRESHOLDS,
  stripLabeledClaimLines,
  buildStructuralBlockReason,
  buildCombinedBlockReason,
  isNegatedParticiple,
  isWithinUncertaintyEnumeration,
  stemWord,
  extractSignificantTerms,
  stripNegationMarkers,
  detectInternalContradictions,
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

  // Negated participle suppression
  it('does not flag "completely unverified" (un- prefix)', () => {
    const matches = findTriggerMatches('The data is completely unverified.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "fully untested" (un- prefix)', () => {
    const matches = findTriggerMatches('This code path is fully untested.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "completely unresolved" (un- prefix)', () => {
    const matches = findTriggerMatches('The issue remains completely unresolved.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "fully unconfirmed" (un- prefix)', () => {
    const matches = findTriggerMatches('The report is fully unconfirmed.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "completely disconnected" (dis- prefix)', () => {
    const matches = findTriggerMatches('These modules are completely disconnected.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "not fully verified" (explicit negation precedes)', () => {
    const matches = findTriggerMatches('This has not fully verified the fix.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('does not flag "never fully tested" (explicit negation precedes)', () => {
    const matches = findTriggerMatches('This path was never fully tested.');
    expect(matches.filter((m) => m.kind === 'completeness_claim')).toHaveLength(0);
  });

  it('still flags "fully resolved" (affirmative overclaim)', () => {
    const matches = findTriggerMatches('The bug is fully resolved.');
    expect(matches.filter((m) => m.kind === 'completeness_claim').length).toBeGreaterThan(0);
  });

  it('still flags "completely fixed" (affirmative overclaim)', () => {
    const matches = findTriggerMatches('The issue is completely fixed.');
    expect(matches.filter((m) => m.kind === 'completeness_claim').length).toBeGreaterThan(0);
  });

  it('still flags "fully implemented" (affirmative overclaim)', () => {
    const matches = findTriggerMatches('The feature is fully implemented.');
    expect(matches.filter((m) => m.kind === 'completeness_claim').length).toBeGreaterThan(0);
  });

  it('still flags "completely done" (affirmative overclaim)', () => {
    const matches = findTriggerMatches('The task is completely done.');
    expect(matches.filter((m) => m.kind === 'completeness_claim').length).toBeGreaterThan(0);
  });

  it('still flags "fully understood" — NON_NEGATION_UN_WORDS must not suppress completeness_claim', () => {
    const matches = findTriggerMatches('The problem is fully understood.');
    expect(matches.filter((m) => m.kind === 'completeness_claim').length).toBeGreaterThan(0);
  });
});

// =============================================================================
// isNegatedParticiple unit tests
// =============================================================================
describe('isNegatedParticiple', () => {
  it('returns true for un- prefixed participle', () => {
    expect(isNegatedParticiple('fully unverified', 'The data is fully unverified.', 11)).toBe(true);
  });

  it('returns true for dis- prefixed participle', () => {
    expect(
      isNegatedParticiple('completely disconnected', 'They are completely disconnected.', 9),
    ).toBe(true);
  });

  it('returns true for non- prefixed participle', () => {
    expect(isNegatedParticiple('fully noncomplied', 'It is fully noncomplied.', 6)).toBe(true);
  });

  it('returns false for affirmative participle "resolved"', () => {
    expect(isNegatedParticiple('fully resolved', 'The bug is fully resolved.', 11)).toBe(false);
  });

  it('returns false for affirmative participle "implemented"', () => {
    expect(isNegatedParticiple('fully implemented', 'The feature is fully implemented.', 15)).toBe(
      false,
    );
  });

  it('returns true when preceded by "not"', () => {
    const text = 'This has not fully verified the fix.';
    const idx = text.indexOf('fully');
    expect(isNegatedParticiple('fully verified', text, idx)).toBe(true);
  });

  it('returns true when preceded by "never"', () => {
    const text = 'This path was never fully tested.';
    const idx = text.indexOf('fully');
    expect(isNegatedParticiple('fully tested', text, idx)).toBe(true);
  });

  it('returns false for "understood" (NON_NEGATION_UN_WORDS exception)', () => {
    expect(isNegatedParticiple('fully understood', 'The problem is fully understood.', 15)).toBe(
      false,
    );
  });

  it('returns false for "united" (NON_NEGATION_UN_WORDS exception)', () => {
    expect(isNegatedParticiple('completely united', 'The team is completely united.', 12)).toBe(
      false,
    );
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
    // speculation weight = 0.25, weightSum = 1.65 (internal_contradiction: 0.35 added)
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
    // Only speculation fires: 0.25 / 1.65 ≈ 0.15152 (weightSum = 1.65 with internal_contradiction: 0.35)
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
    // causality_language weight = 0.30, weightSum = 1.65 → score = 0.30/1.65 ≈ 0.182 → GROUNDED
    const results = scoreText('The test breaks because the config is missing.');
    const causalResult = results.find((r) => r.scores.causality_language === 1);
    expect(causalResult).toBeTruthy();
    expect(causalResult.label).toBe('GROUNDED');
  });

  it('highly flagged sentence gets UNCERTAIN or HALLUCINATED label', () => {
    // speculation (0.25) + causality (0.30) + completeness (0.20) = 0.75 / 1.65 ≈ 0.455 → UNCERTAIN
    const results = scoreText('I think everything is fixed because of the change.');
    const flagged = results.find((r) => r.aggregateScore > 0.3);
    expect(flagged).toBeTruthy();
    expect(['UNCERTAIN', 'HALLUCINATED']).toContain(flagged.label);
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
  it('contains all six detection categories including evaluative_design_claim and internal_contradiction', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('internal_contradiction');
    expect(DEFAULT_WEIGHTS).not.toHaveProperty('fabricated_source');
    expect(Object.keys(DEFAULT_WEIGHTS).length).toBe(6);
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

// =============================================================================
// Direct-wrap suppression
// Trigger words wrapped in matching quote pairs immediately adjacent on both
// sides are being discussed as objects (use-mention distinction) and must not
// fire speculation_language.
// =============================================================================
describe('direct-wrap suppression', () => {
  it('does not flag "assume" wrapped in double quotes', () => {
    // "assume" is being named/discussed, not used speculatively.
    const matches = findTriggerMatches('He said "assume" and left.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag "assume" wrapped in single quotes', () => {
    const matches = findTriggerMatches("He said 'assume' and left.");
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag "i think" wrapped in double quotes', () => {
    // Use-mention: the phrase is being discussed, not uttered.
    const matches = findTriggerMatches('The word "i think" is speculative.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('does not flag "probably" wrapped in double quotes', () => {
    const matches = findTriggerMatches('He said "probably" and left.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBe(0);
  });

  it('still flags bare "assume" without wrapping quotes (confirms suppression is wrap-specific)', () => {
    // No wrapping — bare usage must still fire.
    const matches = findTriggerMatches('Use assume in a sentence.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Stale message re-scan — full transcript replay
//
// Verbatim JSONL fixture taken from real session transcript:
//   /home/ubuntulinuxqa2/.claude/projects/
//   -home-ubuntulinuxqa2-repos-hallucination-detector/
//   8427ae52-369a-420b-bf83-434a42ea03ab.jsonl
//
// The fixture includes all entries up to and including the block event
// (transcript lines 129–142).  The sequence is:
//
//   line 129: assistant — passes the hook (no trigger language)
//   line 134: user    — "Can you allow any kind of wrap? like [{'\"` "
//   line 135: assistant — contains "I think this is correct" in double quotes
//             (use-mention); hook PASSED on this turn
//   line 136: progress (hook_progress Stop)
//   line 137: system  (stop_hook_summary, preventedContinuation: false)
//   line 138: file-history-snapshot
//   line 139: user    — "If the keyword is quoted like "assume"..."
//   line 140: assistant — CLEAN message, no "i think" anywhere
//   line 141: progress (hook_progress Stop)
//   line 142: user (isMeta:true) — block feedback: speculation_language "i think"
//
// Bug: the hook fired on line 140's stop event but flagged "i think" from
// line 135 — the PREVIOUS turn's assistant message.
//
// This test MUST FAIL under the current code.  The hook currently blocks even
// though the last assistant message (line 140) contains no trigger phrases.
// =============================================================================
describe('stale message re-scan — full transcript replay', () => {
  // ---------------------------------------------------------------------------
  // Verbatim JSONL lines 129–139 from the real transcript.
  // Line 140 is intentionally OMITTED — it simulates the race condition where
  // the hook reads the transcript file before the current assistant response
  // has been flushed.  The hook therefore sees line 135 as the last assistant
  // entry and incorrectly flags "i think" from a previous turn.
  // ---------------------------------------------------------------------------
  const VERBATIM_JSONL_LINES = [
    // line 129 — assistant (passes hook)
    '{"parentUuid":"ee3cf531-7d37-4e16-8e40-e7f51288a876","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","message":{"model":"claude-opus-4-6","id":"msg_013YZ68naDuds27CD9ZGNVDE","type":"message","role":"assistant","content":[{"type":"text","text":"The evidence is clear. Looking at the report:\\n\\n**The hook worked correctly every time.** The early messages (#3, #4, #5) had many bare occurrences of the word in double quotes (`\\"assume\\"`) rather than backticks. The hook strips backtick-wrapped content but not double-quoted content.\\n\\nMessage #9 (line 91-92) also had bare occurrences in double quotes.\\n\\nMessage #14 (line 139) had a bare occurrence in the prose phrase \\"So backticked `assume` should have been stripped.\\"\\n\\n**What the transcript shows**: I was using double quotes to mention the word instead of backticks. The hook only strips backtick-wrapped inline code, not double-quoted strings. Every block was legitimate — bare instances were present each time.\\n\\nNo bug in the hook."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":453,"cache_read_input_tokens":82371,"output_tokens":186,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":453,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CYwZUU7RHFoZn2ppDGGRK","type":"assistant","uuid":"0313de26-acea-43d7-9b18-b0648b6c3194","timestamp":"2026-03-11T15:52:12.033Z"}',
    // line 130 — progress (hook_progress Stop for line 129's turn)
    '{"parentUuid":"0313de26-acea-43d7-9b18-b0648b6c3194","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"progress","data":{"type":"hook_progress","hookEvent":"Stop","hookName":"Stop","command":"node \\"${CLAUDE_PLUGIN_ROOT}/scripts/hallucination-audit-stop.js\\""},"parentToolUseID":"29c9db77-46b0-4b38-99b6-2a0a44c5c828","toolUseID":"29c9db77-46b0-4b38-99b6-2a0a44c5c828","timestamp":"2026-03-11T15:52:12.061Z","uuid":"5b9f5bae-cb28-4567-99d4-29a0804d078e"}',
    // line 131 — system (stop_hook_summary)
    '{"parentUuid":"5b9f5bae-cb28-4567-99d4-29a0804d078e","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"system","subtype":"stop_hook_summary","hookCount":1,"hookInfos":[{"command":"node \\"${CLAUDE_PLUGIN_ROOT}/scripts/hallucination-audit-stop.js\\"","durationMs":24}],"hookErrors":[],"preventedContinuation":false,"stopReason":"","hasOutput":false,"level":"suggestion","timestamp":"2026-03-11T15:52:12.087Z","uuid":"2afae7bf-7be5-468b-b6ac-423d89c6bece","toolUseID":"29c9db77-46b0-4b38-99b6-2a0a44c5c828"}',
    // line 132 — system (turn_duration)
    '{"parentUuid":"2afae7bf-7be5-468b-b6ac-423d89c6bece","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"system","subtype":"turn_duration","durationMs":126344,"timestamp":"2026-03-11T15:52:12.087Z","uuid":"a9bf85a4-739f-44d7-aefd-9c8fda322b8a","isMeta":false}',
    // line 133 — file-history-snapshot
    '{"type":"file-history-snapshot","messageId":"dfda07cb-182d-4774-8266-36c8d6808575","snapshot":{"messageId":"dfda07cb-182d-4774-8266-36c8d6808575","trackedFileBackups":{},"timestamp":"2026-03-11T16:14:50.463Z"},"isSnapshotUpdate":false}',
    // line 134 — user: "Can you allow any kind of wrap?"
    '{"parentUuid":"a9bf85a4-739f-44d7-aefd-9c8fda322b8a","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"user","message":{"role":"user","content":"Can you allow any kind of wrap? like [{\'\\"\\u0060"},"uuid":"dfda07cb-182d-4774-8266-36c8d6808575","timestamp":"2026-03-11T16:14:50.462Z","permissionMode":"bypassPermissions"}',
    // line 135 — assistant: contains "I think this is correct" in double quotes
    '{"parentUuid":"dfda07cb-182d-4774-8266-36c8d6808575","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","message":{"model":"claude-opus-4-6","id":"msg_01Xew6rboSyUeJ4Qngp5v6GB","type":"message","role":"assistant","content":[{"type":"text","text":"That\'s a design decision worth considering, but there\'s a trade-off:\\n\\n- Double quotes are used in normal prose all the time (\\"the user said X\\")\\n- Single quotes same\\n- Square brackets have meaning in the claim structure (`[VERIFIED]`, `[c1]`)\\n- Backticks are the only delimiter that unambiguously signals \\"I\'m mentioning this as a code/meta reference, not using it\\"\\n\\nExpanding the stripping to `\\"assume\\"` would also strip any double-quoted text from scanning — which could let speculation slip through inside quotation marks (\\"I think this is correct\\" would become invisible to the hook).\\n\\nThe current design is correct: backticks = meta-discussion, everything else = prose that gets scanned. The fix is for me to consistently use backticks when discussing trigger words, which the hook\'s block message already instructs.\\n\\nDo you still want to change it, or keep the current behavior?"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":3,"cache_creation_input_tokens":896,"cache_read_input_tokens":82371,"output_tokens":209,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":896},"inference_geo":"","iterations":[],"speed":"standard"}},"requestId":"req_011CYwbCvYShRm9atyNpoLQs","type":"assistant","uuid":"4f70102b-0c44-4053-b389-b003af16b2f8","timestamp":"2026-03-11T16:14:58.577Z"}',
    // line 136 — progress (hook_progress Stop for line 135's turn)
    '{"parentUuid":"4f70102b-0c44-4053-b389-b003af16b2f8","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"progress","data":{"type":"hook_progress","hookEvent":"Stop","hookName":"Stop","command":"node \\"${CLAUDE_PLUGIN_ROOT}/scripts/hallucination-audit-stop.js\\""},"parentToolUseID":"f35519b4-72f4-4bf0-b49b-588a58bc159f","toolUseID":"f35519b4-72f4-4bf0-b49b-588a58bc159f","timestamp":"2026-03-11T16:14:58.625Z","uuid":"adc04cc3-39ea-4126-be71-552778c2b76b"}',
    // line 137 — system (stop_hook_summary, preventedContinuation: false — hook passed line 135)
    '{"parentUuid":"adc04cc3-39ea-4126-be71-552778c2b76b","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"system","subtype":"stop_hook_summary","hookCount":1,"hookInfos":[{"command":"node \\"${CLAUDE_PLUGIN_ROOT}/scripts/hallucination-audit-stop.js\\"","durationMs":128}],"hookErrors":[],"preventedContinuation":false,"stopReason":"","hasOutput":false,"level":"suggestion","timestamp":"2026-03-11T16:14:58.755Z","uuid":"e31bd9fe-b3fe-41ba-a044-488518efee23","toolUseID":"f35519b4-72f4-4bf0-b49b-588a58bc159f"}',
    // line 138 — file-history-snapshot
    '{"type":"file-history-snapshot","messageId":"4d6c3aa1-3fc5-4fed-8714-14d233ead16d","snapshot":{"messageId":"4d6c3aa1-3fc5-4fed-8714-14d233ead16d","trackedFileBackups":{},"timestamp":"2026-03-11T16:16:30.411Z"},"isSnapshotUpdate":false}',
    // line 139 — user: "If the keyword is quoted like..."
    '{"parentUuid":"e31bd9fe-b3fe-41ba-a044-488518efee23","isSidechain":false,"userType":"external","cwd":"/home/ubuntulinuxqa2/repos/hallucination-detector","sessionId":"8427ae52-369a-420b-bf83-434a42ea03ab","version":"2.1.72","gitBranch":"main","slug":"quiet-prancing-wozniak","type":"user","message":{"role":"user","content":"If the keyword is quoted like \\"assume\\" then its being addressed as an object. as would \\"likely\\" and \\"probably\\" be. I am not asking for you to ignore quoted content i am asking for you to skip keywords if they have direct wraps on them."},"uuid":"4d6c3aa1-3fc5-4fed-8714-14d233ead16d","timestamp":"2026-03-11T16:16:30.411Z","permissionMode":"bypassPermissions"}',
  ];
  // Line 140 (the CLEAN assistant response with no trigger phrases) is absent
  // from the fixture above.  It would appear here if the hook read the file
  // after the current turn's assistant message was flushed.

  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(
      os.tmpdir(),
      `hd-full-replay-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
    );
    fs.writeFileSync(tmpFile, VERBATIM_JSONL_LINES.join('\n') + '\n', 'utf-8');
  });

  afterEach(() => {
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
    tmpFile = undefined;
  });

  it('sanity: last assistant entry in fixture (line 135) contains "i think"', () => {
    // With line 140 absent, line 135 is the last assistant entry.
    // Confirm it is the stale trigger source.
    const entries = parseJsonl(VERBATIM_JSONL_LINES.join('\n') + '\n');
    const lastText = getLastAssistantText(entries);
    expect(lastText.toLowerCase()).toContain('i think');
  });

  it('end-to-end: hook does NOT block when invoked before current assistant message is in the transcript', () => {
    // This test MUST FAIL under the current code.
    //
    // The fixture contains only lines 129–139.  Line 140 (the clean assistant
    // response to "If the keyword is quoted like...") is not yet in the file —
    // this simulates the race condition where Claude Code invokes the Stop hook
    // before flushing the current assistant message to the JSONL transcript.
    //
    // The hook reads the file, finds line 135 as the last assistant entry, and
    // incorrectly blocks for speculation_language: "i think".
    //
    // Correct behavior: the hook must NOT block.  When the transcript ends with
    // a user message (line 139) and no subsequent assistant message, the hook
    // has no current-turn assistant output to scan and must allow the stop.
    const { stdout } = runHook({
      session_id: '8427ae52-369a-420b-bf83-434a42ea03ab',
      transcript_path: tmpFile,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    // Empty stdout = hook allowed Claude to stop (no block).
    // This assertion FAILS under the current code.
    expect(stdout.trim()).toBe('');
  });
});

describe('last_assistant_message stdin field', () => {
  let transcriptPath;

  afterEach(() => {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    transcriptPath = undefined;
  });

  it('uses last_assistant_message over stale transcript — does not block clean message', () => {
    // Transcript has a stale assistant message with speculation language.
    // Stdin provides a clean last_assistant_message with no trigger phrases.
    // Hook should scan the clean stdin field and NOT block.
    transcriptPath = makeTempTranscript('I think this is correct');
    const { stdout } = runHook({
      session_id: `test-lam-clean-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
      last_assistant_message: 'The fix has been applied successfully.',
    });
    expect(stdout.trim()).toBe('');
  });

  it('uses last_assistant_message over stale transcript — blocks trigger phrase in stdin field', () => {
    // Transcript has a clean assistant message with no trigger phrases.
    // Stdin provides a last_assistant_message containing a trigger phrase.
    // Hook should scan the stdin field and BLOCK.
    transcriptPath = makeTempTranscript('The fix has been applied successfully.');
    const { stdout } = runHook({
      session_id: `test-lam-trigger-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
      last_assistant_message: 'I think this will work correctly.',
    });
    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.decision).toBe('block');
  });
});

describe('isWithinUncertaintyEnumeration — unit tests', () => {
  it('returns true when "I don\'t know" precedes within window', () => {
    const text = "I don't know if the agent list is cached, could be something else entirely";
    const idx = text.indexOf('could be');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(true);
  });

  it('returns true when "cannot confirm" precedes within window', () => {
    const text = 'I cannot confirm the exact version, could be 3.x or 4.x';
    const idx = text.indexOf('could be');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(true);
  });

  it('returns false when no uncertainty marker is present', () => {
    const text = 'This is probably a race condition.';
    const idx = text.indexOf('probably');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(false);
  });

  it('returns false when marker is separated by a paragraph break (\\n\\n)', () => {
    const text = "I don't know the full history.\n\nThis is probably a race condition.";
    const idx = text.indexOf('probably');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(false);
  });

  it('returns false when marker is beyond the 200-char preceding window', () => {
    const farMarker = `I don't know. ${'x'.repeat(210)}`;
    const text = `${farMarker} probably a race condition.`;
    const idx = text.indexOf('probably');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(false);
  });

  it('returns true when marker follows the phrase within the 80-char following window', () => {
    const text = "It could be a caching issue, I don't know for certain";
    const idx = text.indexOf('could be');
    expect(isWithinUncertaintyEnumeration(text, idx)).toBe(true);
  });
});

describe('speculation_language — uncertainty enumeration suppression', () => {
  it('does not flag "could be" when preceded by "I don\'t know"', () => {
    const matches = findTriggerMatches(
      "I don't know if the agent list is cached, could be something else entirely",
    );
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('does not flag "maybe" when preceded by "not sure"', () => {
    const matches = findTriggerMatches(
      "I'm not sure about the root cause, maybe the config is stale",
    );
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('does not flag "might be" when preceded by "unclear whether"', () => {
    const matches = findTriggerMatches(
      "It's unclear whether the timeout applies here, might be a different setting",
    );
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('does not flag "probably" when preceded by "I haven\'t verified"', () => {
    const matches = findTriggerMatches(
      "I haven't verified this yet, but it's probably in the auth module",
    );
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('does not flag "could be" when preceded by "cannot confirm"', () => {
    const matches = findTriggerMatches('I cannot confirm the exact version, could be 3.x or 4.x');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('does not flag "could be" when trailing marker "I don\'t know for certain" follows', () => {
    const matches = findTriggerMatches("It could be a caching issue, I don't know for certain");
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches).toHaveLength(0);
  });

  it('still flags bare "probably" with no uncertainty marker', () => {
    const matches = findTriggerMatches('This is probably a race condition.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBeGreaterThan(0);
  });

  it('still flags "could be" when no uncertainty marker is present', () => {
    const matches = findTriggerMatches('The fix works. This could be improved further.');
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBeGreaterThan(0);
  });

  it('still flags "probably" when marker is separated by a paragraph break', () => {
    const matches = findTriggerMatches(
      "I don't know the full history.\n\nThis is probably a race condition.",
    );
    const specMatches = matches.filter((m) => m.kind === 'speculation_language');
    expect(specMatches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// DEFAULT_THRESHOLDS
// =============================================================================
describe('DEFAULT_THRESHOLDS', () => {
  it('is exported from hallucination-audit-stop.cjs', () => {
    expect(typeof DEFAULT_THRESHOLDS).toBe('object');
  });

  it('has uncertain: 0.3', () => {
    expect(DEFAULT_THRESHOLDS.uncertain).toBe(0.3);
  });

  it('has hallucinated: 0.6', () => {
    expect(DEFAULT_THRESHOLDS.hallucinated).toBe(0.6);
  });
});

// =============================================================================
// buildCombinedBlockReason
// =============================================================================
describe('buildCombinedBlockReason', () => {
  it('includes BLOCK_HEADER once', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('Hallucination-detector STOP HOOK blocked this response.');
    // BLOCK_HEADER must appear exactly once
    const occurrences =
      reason.split('Hallucination-detector STOP HOOK blocked this response.').length - 1;
    expect(occurrences).toBe(1);
  });

  it('includes structural section header', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'causality_language', evidence: 'because' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('Structural claim validation issues:');
  });

  it('includes trigger section header', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'causality_language', evidence: 'because' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('Trigger language issues:');
  });

  it('formats structural error with claimId and label', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('[missing_evidence] c1 [VERIFIED]: VERIFIED claims require Evidence:');
  });

  it('formats trigger match with kind and evidence in backticks', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('- speculation_language: `probably`');
  });

  it('includes "Fix ALL of the above" instruction', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'causality_language', evidence: 'because' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('Fix ALL of the above in your rewrite.');
  });

  it('includes structured block format template (ANSWER and MEMORY WRITE)', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildCombinedBlockReason(errors, matches);
    expect(reason).toContain('ANSWER');
    expect(reason).toContain('MEMORY WRITE');
  });

  it('slices to max 5 structural errors', () => {
    const errors = Array.from({ length: 8 }, (_, i) => ({
      code: 'missing_evidence',
      claimId: `c${i + 1}`,
      label: 'VERIFIED',
      message: `Missing evidence (${i + 1})`,
    }));
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildCombinedBlockReason(errors, matches);
    const errorLineCount = reason
      .split('\n')
      .filter((l) => l.startsWith('- [missing_evidence]')).length;
    expect(errorLineCount).toBe(5);
  });

  it('slices to max 4 trigger matches', () => {
    const matches = [
      { kind: 'speculation_language', evidence: 'probably' },
      { kind: 'causality_language', evidence: 'because' },
      { kind: 'completeness_claim', evidence: 'fully resolved' },
      { kind: 'evaluative_design_claim', evidence: 'the cleanest fix' },
      { kind: 'pseudo_quantification', evidence: '8/10' },
    ];
    const errors = [
      { code: 'missing_evidence', claimId: 'c1', label: 'VERIFIED', message: 'Missing evidence' },
    ];
    const reason = buildCombinedBlockReason(errors, matches);
    // Count lines that start with "- <kind>:" pattern (trigger match lines)
    const matchLineCount = reason.split('\n').filter((l) => /^- \w+: `/.test(l)).length;
    expect(matchLineCount).toBe(4);
  });

  it('does not re-trigger findTriggerMatches (self-trigger guard)', () => {
    const errors = [
      {
        code: 'missing_evidence',
        claimId: 'c1',
        label: 'VERIFIED',
        message: 'VERIFIED claims require Evidence:',
      },
    ];
    const matches = [
      { kind: 'speculation_language', evidence: 'probably' },
      { kind: 'causality_language', evidence: 'because' },
    ];
    const reason = buildCombinedBlockReason(errors, matches);
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });
});

// =============================================================================
// getLabelForScore — custom thresholds
// =============================================================================
describe('getLabelForScore with custom thresholds', () => {
  it('uses provided thresholds instead of defaults', () => {
    const t = { uncertain: 0.1, hallucinated: 0.5 };
    expect(getLabelForScore(0.05, t)).toBe('GROUNDED');
    expect(getLabelForScore(0.1, t)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.5, t)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.51, t)).toBe('HALLUCINATED');
  });

  it('falls back to DEFAULT_THRESHOLDS when no thresholds provided', () => {
    expect(getLabelForScore(0.29)).toBe('GROUNDED');
    expect(getLabelForScore(0.3)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.6)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.61)).toBe('HALLUCINATED');
  });

  it('uses thresholds where uncertain equals hallucinated (edge: both 0.5)', () => {
    const t = { uncertain: 0.5, hallucinated: 0.5 };
    expect(getLabelForScore(0.49, t)).toBe('GROUNDED');
    expect(getLabelForScore(0.5, t)).toBe('UNCERTAIN');
    expect(getLabelForScore(0.51, t)).toBe('HALLUCINATED');
  });
});

// =============================================================================
// scoreText — custom thresholds
// =============================================================================
describe('scoreText with custom thresholds', () => {
  it('applies custom thresholds to label computation', () => {
    // With very tight thresholds (uncertain: 0.01), any non-zero score → UNCERTAIN or HALLUCINATED.
    const t = { uncertain: 0.01, hallucinated: 0.99 };
    const results = scoreText('I think this is correct.', DEFAULT_WEIGHTS, t);
    const specResult = results.find((r) => r.scores.speculation_language === 1);
    expect(specResult).toBeTruthy();
    // score > 0.01 → UNCERTAIN (not GROUNDED)
    expect(specResult.label).not.toBe('GROUNDED');
  });

  it('uses DEFAULT_THRESHOLDS when no thresholds argument passed', () => {
    const results = scoreText('I read the file and saw no errors.');
    expect(results[0].label).toBe('GROUNDED');
  });
});

// =============================================================================
// scoreText — config propagation to findTriggerMatches
// =============================================================================
describe('scoreText config propagation', () => {
  it('honors disabled category — speculation_language disabled produces score 0', () => {
    const sentence = 'I think this is correct.';
    const config = { categories: { speculation_language: { enabled: false } } };

    const withConfig = scoreText(sentence, DEFAULT_WEIGHTS, undefined, config);
    expect(withConfig[0].scores.speculation_language).toBe(0);

    const withoutConfig = scoreText(sentence, DEFAULT_WEIGHTS, undefined);
    expect(withoutConfig[0].scores.speculation_language).toBe(1);
  });

  it('honors disabled category — completeness_claim disabled produces score 0', () => {
    const sentence = 'Everything is fully resolved.';
    const config = { categories: { completeness_claim: { enabled: false } } };

    const withConfig = scoreText(sentence, DEFAULT_WEIGHTS, undefined, config);
    expect(withConfig[0].scores.completeness_claim).toBe(0);

    const withoutConfig = scoreText(sentence, DEFAULT_WEIGHTS, undefined);
    expect(withoutConfig[0].scores.completeness_claim).toBe(1);
  });

  it('config does not affect unrelated categories', () => {
    const sentence = 'I think this is correct.';
    const config = { categories: { completeness_claim: { enabled: false } } };

    const results = scoreText(sentence, DEFAULT_WEIGHTS, undefined, config);
    // speculation_language is NOT disabled — should still fire
    expect(results[0].scores.speculation_language).toBe(1);
    // completeness_claim is disabled — should be 0
    expect(results[0].scores.completeness_claim).toBe(0);
  });
});

// =============================================================================
// buildBlockReason — sentence-level analysis section
// =============================================================================
describe('buildBlockReason sentence-level analysis', () => {
  it('appends sentence-level section when flagged sentences are present', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const sentenceScores = [
      {
        sentence: 'This is probably wrong.',
        index: 0,
        total: 2,
        aggregateScore: 0.35,
        label: 'UNCERTAIN',
      },
      {
        sentence: 'The fix was applied.',
        index: 1,
        total: 2,
        aggregateScore: 0,
        label: 'GROUNDED',
      },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    expect(reason).toContain('Sentence-level analysis:');
    expect(reason).toContain('sentence 1 of 2 [UNCERTAIN]');
  });

  it('does not append sentence-level section when all sentences are GROUNDED', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const sentenceScores = [
      { sentence: 'The file was read.', index: 0, total: 1, aggregateScore: 0, label: 'GROUNDED' },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    expect(reason).not.toContain('Sentence-level analysis:');
  });

  it('includes HALLUCINATED sentences in the section', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const sentenceScores = [
      {
        sentence: 'I think everything is fixed because of the reason.',
        index: 0,
        total: 1,
        aggregateScore: 0.8,
        label: 'HALLUCINATED',
      },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    expect(reason).toContain('[HALLUCINATED]');
  });

  it('truncates long snippets at 60 characters with ellipsis', () => {
    const longSentence = 'A'.repeat(80);
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const sentenceScores = [
      { sentence: longSentence, index: 0, total: 1, aggregateScore: 0.5, label: 'UNCERTAIN' },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    expect(reason).toContain('...');
    // The snippet inside backticks should be 60 chars + '...' = 63 chars
    const line = reason.split('\n').find((l) => l.includes('[UNCERTAIN]'));
    expect(line).toBeDefined();
    const backtickContent = line.match(/`([^`]+)`/)?.[1];
    expect(backtickContent).toBeDefined();
    expect(backtickContent.endsWith('...')).toBe(true);
    expect(backtickContent.length).toBe(63); // 60 + '...'
  });

  it('wraps snippet in backticks (self-trigger safety)', () => {
    const matches = [{ kind: 'causality_language', evidence: 'because' }];
    const sentenceScores = [
      {
        sentence: 'The test fails because the mock is wrong.',
        index: 0,
        total: 1,
        aggregateScore: 0.5,
        label: 'UNCERTAIN',
      },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    // Snippet must be wrapped in backticks so inline-code stripping removes it
    const sentenceLine = reason.split('\n').find((l) => l.includes('[UNCERTAIN]'));
    expect(sentenceLine).toBeDefined();
    expect(sentenceLine).toMatch(/`[^`]+`/);
  });

  it('omits sentence-level section when no sentenceScores argument passed', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const reason = buildBlockReason(matches);
    expect(reason).not.toContain('Sentence-level analysis:');
  });

  it('replaces backticks in snippet with single quotes to prevent broken inline-code wrapping', () => {
    const matches = [{ kind: 'speculation_language', evidence: 'probably' }];
    const sentenceScores = [
      {
        sentence: 'Run `npm test` to verify.',
        index: 0,
        total: 1,
        aggregateScore: 0.4,
        label: 'UNCERTAIN',
      },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    const sentenceLine = reason.split('\n').find((l) => l.includes('[UNCERTAIN]'));
    expect(sentenceLine).toBeDefined();
    // The outer backtick wrapping must be intact: exactly one pair of backticks
    const backtickContent = sentenceLine.match(/`([^`]+)`/)?.[1];
    expect(backtickContent).toBeDefined();
    // Inner backticks from the sentence must be replaced with single quotes
    expect(backtickContent).not.toContain('`');
    expect(backtickContent).toContain("'npm test'");
  });

  it('sentence-level section does not re-trigger findTriggerMatches', () => {
    const matches = [{ kind: 'causality_language', evidence: 'because' }];
    const sentenceScores = [
      {
        sentence: 'Because the config is wrong.',
        index: 0,
        total: 1,
        aggregateScore: 0.5,
        label: 'UNCERTAIN',
      },
    ];
    const reason = buildBlockReason(matches, sentenceScores);
    // The backtick-wrapped snippet must not cause the reason to self-trigger
    const secondPassMatches = findTriggerMatches(reason);
    expect(secondPassMatches.length).toBe(0);
  });
});

// =============================================================================
// Combined validation — both structural errors and trigger matches in one pass
// =============================================================================
describe('combined validation (structural + trigger in one block)', () => {
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

  it('reports both structural errors and trigger phrases in a single block', () => {
    const assistantText = [
      'ANSWER',
      '- This is probably the correct approach.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists at scripts/foo.cjs',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-combined-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim().length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('Structural claim validation issues:');
    expect(parsed.reason).toContain('Trigger language issues:');
  });

  it('combined block reason does not re-trigger findTriggerMatches', () => {
    const assistantText = [
      'ANSWER',
      '- This is probably the correct approach.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists at scripts/foo.cjs',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-combined-selfguard-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    const parsed = JSON.parse(stdout.trim());
    const secondPassMatches = findTriggerMatches(parsed.reason);
    expect(secondPassMatches.length).toBe(0);
  });
});

// =============================================================================
// stemWord
// =============================================================================
describe('stemWord', () => {
  it('strips -ing suffix', () => {
    expect(stemWord('walking')).toBe('walk');
  });

  it('collapses doubled consonant after -ing strip (running → run)', () => {
    expect(stemWord('running')).toBe('run');
  });

  it('collapses doubled consonant after -ing strip (stopping → stop)', () => {
    expect(stemWord('stopping')).toBe('stop');
  });

  it('strips -ed suffix', () => {
    expect(stemWord('walked')).toBe('walk');
  });

  it('strips -s suffix', () => {
    expect(stemWord('tests')).toBe('test');
  });

  it('strips -tion suffix', () => {
    // 'assertion' (9 chars) → 'assert' ... wait: a-s-s-e-r-t-i-o-n
    // slice(0,-4) of 'assertion' = 'asser' (5 chars)
    // Use 'decoration': d-e-c-o-r-a-t-i-o-n (10 chars) → 'decora' — also suffix chain
    // Use 'narration': n-a-r-r-a-t-i-o-n (9 chars, > 6) → 'narra' (5 chars)
    // Verify actual stemWord output matches: stemWord strips -tion leaving root chars
    const result = stemWord('narration');
    // narration length 9, ends with 'tion' at positions 5-8, slice(0,-4) = 'narra'
    expect(result).toBe('narra');
  });

  it('returns short words unchanged', () => {
    expect(stemWord('it')).toBe('it');
    expect(stemWord('no')).toBe('no');
  });

  it('strips -er suffix', () => {
    expect(stemWord('faster')).toBe('fast');
  });

  it('strips -ly suffix', () => {
    expect(stemWord('quickly')).toBe('quick');
  });

  it('preserves legitimate double-s in base form (kissing → kiss)', () => {
    expect(stemWord('kissing')).toBe('kiss');
  });

  it('preserves legitimate double-l in base form (filling → fill)', () => {
    expect(stemWord('filling')).toBe('fill');
  });

  it('preserves legitimate double-f in base form (bluffing → bluff)', () => {
    expect(stemWord('bluffing')).toBe('bluff');
  });

  it('preserves legitimate double-z in base form (buzzing → buzz)', () => {
    expect(stemWord('buzzing')).toBe('buzz');
  });
});

// =============================================================================
// maxBlocksPerSession wired from config
// =============================================================================
describe('maxBlocksPerSession from config', () => {
  let transcriptPath;
  let stateFilePath;
  let tmpDir;
  let originalCwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-maxblocks-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    if (stateFilePath && fs.existsSync(stateFilePath)) {
      fs.unlinkSync(stateFilePath);
    }
    fs.rmSync(tmpDir, { recursive: true });
    transcriptPath = undefined;
    stateFilePath = undefined;
  });

  it('allows through after maxBlocksPerSession=1 when stop_hook_active is true', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { maxBlocksPerSession: 1 };',
    );

    const sessionId = `test-maxblocks-1-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 1 }), 'utf-8');

    transcriptPath = makeTempTranscript('I think this is correct.');
    const { stdout } = runHook({
      session_id: sessionId,
      transcript_path: transcriptPath,
      stop_hook_active: true,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim()).toBe('');
  });

  it('still blocks when blocks count has not exceeded maxBlocksPerSession=1', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { maxBlocksPerSession: 1 };',
    );

    const sessionId = `test-maxblocks-1-under-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 0 }), 'utf-8');

    transcriptPath = makeTempTranscript('I think this is correct.');
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

  it('allows through after maxBlocksPerSession=5 at block count 5 with stop_hook_active', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      'module.exports = { maxBlocksPerSession: 5 };',
    );

    const sessionId = `test-maxblocks-5-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 5 }), 'utf-8');

    transcriptPath = makeTempTranscript('I think this is correct.');
    const { stdout } = runHook({
      session_id: sessionId,
      transcript_path: transcriptPath,
      stop_hook_active: true,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim()).toBe('');
  });

  it('defaults to maxBlocksPerSession=2 when config has no maxBlocksPerSession', () => {
    const sessionId = `test-maxblocks-default-${Date.now()}`;
    stateFilePath = path.join(os.tmpdir(), `claude-hallucination-audit-${sessionId}.json`);
    fs.writeFileSync(stateFilePath, JSON.stringify({ blocks: 2 }), 'utf-8');

    transcriptPath = makeTempTranscript('I think this is correct.');
    const { stdout } = runHook({
      session_id: sessionId,
      transcript_path: transcriptPath,
      stop_hook_active: true,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim()).toBe('');
  });
});

// =============================================================================
// extractSignificantTerms
// =============================================================================
describe('extractSignificantTerms', () => {
  it('lowercases and splits on non-alpha characters', () => {
    const terms = extractSignificantTerms('The file is valid.');
    expect(terms).not.toContain('The');
    expect(terms).not.toContain('the');
  });

  it('filters stop words', () => {
    const terms = extractSignificantTerms('This is not a valid configuration.');
    expect(terms).not.toContain('this');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('not');
    expect(terms).not.toContain('a');
  });

  it('filters words shorter than 3 characters', () => {
    const terms = extractSignificantTerms('Do it now.');
    expect(terms).not.toContain('do');
  });

  it('applies stemWord to each term', () => {
    const terms = extractSignificantTerms('The tests are passing.');
    // 'tests' → 'test', 'passing' → 'pass'
    expect(terms).toContain('test');
  });

  it('returns empty array for stop-word-only input', () => {
    const terms = extractSignificantTerms('the is and or');
    expect(terms).toEqual([]);
  });
});

// =============================================================================
// Introspection mode with combined validation
// =============================================================================
describe('introspection mode with combined validation', () => {
  let transcriptPath;
  let tmpDir;
  let originalCwd;
  let logPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-introspect-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    logPath = path.join(tmpDir, 'introspect.jsonl');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      fs.unlinkSync(transcriptPath);
    }
    fs.rmSync(tmpDir, { recursive: true });
    transcriptPath = undefined;
  });

  it('does not block in introspection mode even with both structural and trigger errors', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { introspect: true, introspectOutputPath: ${JSON.stringify(logPath)} };`,
    );

    const assistantText = [
      'ANSWER',
      '- This is probably the correct approach.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists at scripts/foo.cjs',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    const { stdout } = runHook({
      session_id: `test-introspect-combined-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    expect(stdout.trim()).toBe('');
  });

  it('writes introspection log entry with structuralErrorCount when structured+invalid', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.hallucination-detectorrc.cjs'),
      `module.exports = { introspect: true, introspectOutputPath: ${JSON.stringify(logPath)} };`,
    );

    const assistantText = [
      'ANSWER',
      '- Task acknowledged.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The file exists.',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');

    transcriptPath = makeTempTranscript(assistantText);
    runHook({
      session_id: `test-introspect-log-${Date.now()}`,
      transcript_path: transcriptPath,
      stop_hook_active: false,
      hook_event_name: 'Stop',
    });

    expect(fs.existsSync(logPath)).toBe(true);
    const logLines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(logLines.length).toBeGreaterThan(0);
    const entry = JSON.parse(logLines[0]);
    expect(entry).toHaveProperty('structuralErrorCount');
    expect(typeof entry.structuralErrorCount).toBe('number');
  });
});

// =============================================================================
// stripNegationMarkers
// =============================================================================
describe('stripNegationMarkers', () => {
  it('removes negation words', () => {
    const result = stripNegationMarkers('The file is not valid.');
    expect(result).not.toContain('not');
    expect(result).toContain('valid');
  });

  it('removes contractions', () => {
    const result = stripNegationMarkers("The test doesn't pass.");
    expect(result).not.toContain("doesn't");
  });

  it('collapses multiple spaces after removal', () => {
    const result = stripNegationMarkers('This is not a valid config.');
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('trims leading and trailing whitespace', () => {
    const result = stripNegationMarkers('not valid');
    expect(result).toBe('valid');
  });
});

// =============================================================================
// detectInternalContradictions
// =============================================================================
describe('detectInternalContradictions', () => {
  it('detects a direct contradiction pair', () => {
    const text = 'The authentication module is secure. The authentication module is not secure.';
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].kind).toBe('internal_contradiction');
  });

  it('returns empty array for single sentence', () => {
    const matches = detectInternalContradictions('The file exists.');
    expect(matches).toEqual([]);
  });

  it('returns empty array when sentences are unrelated', () => {
    const text = 'The file exists. The test is not passing.';
    const matches = detectInternalContradictions(text);
    // "file exists" vs "test not passing" — no significant term overlap
    expect(matches).toEqual([]);
  });

  it('returns empty array when both sentences are affirmative (no negation polarity difference)', () => {
    const text = 'The configuration is valid. The configuration is correct.';
    const matches = detectInternalContradictions(text);
    expect(matches).toEqual([]);
  });

  it('does not fire on questions (stripLowSignalRegions removes nothing, but single-sentence)', () => {
    const matches = detectInternalContradictions('Is the file valid?');
    expect(matches).toEqual([]);
  });

  it('does not fire on text inside code blocks (stripped before sentence split)', () => {
    const text = 'Valid code.\n```\nThe module is valid. The module is not valid.\n```\nEnd.';
    const matches = detectInternalContradictions(text);
    expect(matches).toEqual([]);
  });

  it('collects all contradiction pairs, not just the first', () => {
    const text = [
      'The cache is enabled.',
      'The cache is not enabled.',
      'The index is valid.',
      'The index is not valid.',
    ].join(' ');
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("detects contradiction when negation is expressed via contraction (e.g. doesn't)", () => {
    const text =
      "The system handles errors gracefully. The system doesn't handle errors gracefully.";
    const matches = detectInternalContradictions(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].kind).toBe('internal_contradiction');
  });

  it('requires Jaccard >= 0.4 — low overlap does not trigger', () => {
    // One shared term out of many unique terms → Jaccard < 0.4
    const text =
      'The authentication proxy cache module gateway is valid secure reliable. The proxy is not broken.';
    const matches = detectInternalContradictions(text);
    expect(matches).toHaveLength(0);
  });

  it('requires >= 2 shared terms', () => {
    // Only one shared significant term → should not trigger
    const text = 'The module is valid. The module is not damaged.';
    const matches = detectInternalContradictions(text);
    expect(matches).toHaveLength(0);
  });
});

// =============================================================================
// findTriggerMatches — internal_contradiction integration
// =============================================================================
describe('findTriggerMatches internal_contradiction', () => {
  it('detects internal_contradiction kind for contradictory sentence pairs', () => {
    const text =
      'The authentication module is secure and reliable. The authentication module is not secure and not reliable.';
    const matches = findTriggerMatches(text);
    const contradictionMatches = matches.filter((m) => m.kind === 'internal_contradiction');
    expect(contradictionMatches.length).toBeGreaterThan(0);
  });

  it('does not flag non-contradictory text as internal_contradiction', () => {
    const text = 'The file exists at the expected path. The test passed with no errors.';
    const matches = findTriggerMatches(text);
    const contradictionMatches = matches.filter((m) => m.kind === 'internal_contradiction');
    expect(contradictionMatches).toHaveLength(0);
  });

  it('respects enabled: false for internal_contradiction category', () => {
    const text = 'The authentication module is secure. The authentication module is not secure.';
    const config = { categories: { internal_contradiction: { enabled: false } } };
    const matches = findTriggerMatches(text, config);
    const contradictionMatches = matches.filter((m) => m.kind === 'internal_contradiction');
    expect(contradictionMatches).toHaveLength(0);
  });
});
