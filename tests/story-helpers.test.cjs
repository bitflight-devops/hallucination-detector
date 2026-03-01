const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  OWNER,
  REPO,
  ROLE_MAP,
  BENEFIT_MAP,
  normalizeTitle,
} = require('../.claude/scripts/lib/story-helpers.cjs');

// =============================================================================
// Constants
// =============================================================================
describe('constants', () => {
  it('exports OWNER constant', () => {
    assert.equal(OWNER, 'bitflight-devops');
  });

  it('exports REPO constant', () => {
    assert.equal(REPO, 'hallucination-detector');
  });

  it('exports ROLE_MAP with all issue types', () => {
    assert.ok(typeof ROLE_MAP === 'object');
    assert.ok('Feature' in ROLE_MAP);
    assert.ok('Bug' in ROLE_MAP);
    assert.ok('Refactor' in ROLE_MAP);
    assert.ok('Docs' in ROLE_MAP);
    assert.ok('Chore' in ROLE_MAP);
  });

  it('exports BENEFIT_MAP with all issue types', () => {
    assert.ok(typeof BENEFIT_MAP === 'object');
    assert.ok('Feature' in BENEFIT_MAP);
    assert.ok('Bug' in BENEFIT_MAP);
    assert.ok('Refactor' in BENEFIT_MAP);
    assert.ok('Docs' in BENEFIT_MAP);
    assert.ok('Chore' in BENEFIT_MAP);
  });
});

// =============================================================================
// normalizeTitle
// =============================================================================
describe('normalizeTitle', () => {
  it('removes feat: prefix', () => {
    const result = normalizeTitle('feat: add new detection pattern');
    assert.equal(result, 'add new detection pattern');
  });

  it('removes fix: prefix', () => {
    const result = normalizeTitle('fix: repair broken hook');
    assert.equal(result, 'repair broken hook');
  });

  it('removes chore: prefix', () => {
    const result = normalizeTitle('chore: update dependencies');
    assert.equal(result, 'update dependencies');
  });

  it('removes docs: prefix', () => {
    const result = normalizeTitle('docs: update README');
    assert.equal(result, 'update readme');
  });

  it('removes refactor: prefix', () => {
    const result = normalizeTitle('refactor: simplify parsing logic');
    assert.equal(result, 'simplify parsing logic');
  });

  it('removes P0: prefix', () => {
    const result = normalizeTitle('P0: critical bug fix');
    assert.equal(result, 'critical bug fix');
  });

  it('removes P1: prefix', () => {
    const result = normalizeTitle('P1: important feature');
    assert.equal(result, 'important feature');
  });

  it('removes P2: prefix', () => {
    const result = normalizeTitle('P2: nice to have');
    assert.equal(result, 'nice to have');
  });

  it('removes both conventional commit and priority prefixes', () => {
    const result = normalizeTitle('feat: P0: critical new feature');
    assert.equal(result, 'critical new feature');
  });

  it('is case-insensitive for conventional commit prefixes', () => {
    const result = normalizeTitle('FEAT: Add Feature');
    assert.equal(result, 'add feature');
  });

  it('is case-insensitive for priority prefixes', () => {
    const result = normalizeTitle('p0: Fix Bug');
    assert.equal(result, 'fix bug');
  });

  it('lowercases the result', () => {
    const result = normalizeTitle('Add New Feature');
    assert.equal(result, 'add new feature');
  });

  it('trims trailing whitespace but not before prefix matching', () => {
    // Leading whitespace prevents prefix match due to ^ anchor in regex
    const result = normalizeTitle('  feat: add feature  ');
    assert.equal(result, 'feat: add feature');
  });

  it('trims whitespace when no prefix present', () => {
    const result = normalizeTitle('  add feature  ');
    assert.equal(result, 'add feature');
  });

  it('handles empty string', () => {
    const result = normalizeTitle('');
    assert.equal(result, '');
  });

  it('handles title with no prefix', () => {
    const result = normalizeTitle('Simple Title');
    assert.equal(result, 'simple title');
  });

  it('handles title with only prefix', () => {
    const result = normalizeTitle('feat:');
    assert.equal(result, '');
  });

  it('removes prefix with multiple spaces', () => {
    const result = normalizeTitle('feat:    add feature');
    assert.equal(result, 'add feature');
  });

  it('handles multiple colons in title', () => {
    const result = normalizeTitle('feat: add feature: implementation');
    assert.equal(result, 'add feature: implementation');
  });

  it('handles Unicode characters', () => {
    const result = normalizeTitle('feat: add 🚀 feature');
    assert.equal(result, 'add 🚀 feature');
  });

  it('preserves internal priority mentions', () => {
    const result = normalizeTitle('feat: P0 items need attention');
    assert.equal(result, 'p0 items need attention');
  });

  it('handles priority prefix without colon in middle of text', () => {
    const result = normalizeTitle('P0: Fix P1 and P2 issues');
    assert.equal(result, 'fix p1 and p2 issues');
  });
});
