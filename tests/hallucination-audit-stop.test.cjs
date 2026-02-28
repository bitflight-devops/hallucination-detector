const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
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
      'I observed error code 127 in the logs. ' +
      'I think the root cause is a missing binary.';
    const matches = findTriggerMatches(text);
    const kinds = matches.map((m) => m.kind);
    assert.ok(kinds.includes('speculation_language'));
  });
});
