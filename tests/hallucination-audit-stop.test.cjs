'use strict';

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
} = require('../scripts/hallucination-audit-stop.cjs');

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
    expect(scores.fabricated_source).toBe(0);
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
      fabricated_source: 0,
    };
    expect(aggregateWeightedScore(scores, DEFAULT_WEIGHTS)).toBe(0);
  });

  it('returns 1 for all-one scores with default weights (normalization preserves ceiling)', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 1,
      pseudo_quantification: 1,
      completeness_claim: 1,
      fabricated_source: 1,
      evaluative_design_claim: 1,
    };
    expect(aggregateWeightedScore(scores, DEFAULT_WEIGHTS)).toBe(1);
  });

  it('returns the triggered category fractional weight for partial scores', () => {
    const scores = {
      speculation_language: 1,
      causality_language: 0,
      pseudo_quantification: 0,
      completeness_claim: 0,
      fabricated_source: 0,
      evaluative_design_claim: 0,
    };
    // speculation weight = 0.25, weightSum = 1.4 (includes evaluative_design_claim: 0.4)
    // result = 0.25 / 1.4 ≈ 0.17857
    const result = aggregateWeightedScore(scores, DEFAULT_WEIGHTS);
    const expected = 0.25 / 1.4;
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
    // Only speculation fires: 0.25 / 1.4 ≈ 0.17857 (weightSum includes evaluative_design_claim: 0.4)
    const expected = 0.25 / 1.4;
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
  it('contains all six detection categories including evaluative_design_claim', () => {
    expect(DEFAULT_WEIGHTS).toHaveProperty('speculation_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('causality_language');
    expect(DEFAULT_WEIGHTS).toHaveProperty('pseudo_quantification');
    expect(DEFAULT_WEIGHTS).toHaveProperty('completeness_claim');
    expect(DEFAULT_WEIGHTS).toHaveProperty('fabricated_source');
    expect(DEFAULT_WEIGHTS).toHaveProperty('evaluative_design_claim');
  });

  it('evaluative_design_claim weight is 0.4', () => {
    expect(DEFAULT_WEIGHTS.evaluative_design_claim).toBe(0.4);
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
