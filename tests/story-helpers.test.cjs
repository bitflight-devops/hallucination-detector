'use strict';

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
    expect(OWNER).toBe('bitflight-devops');
  });

  it('exports REPO constant', () => {
    expect(REPO).toBe('hallucination-detector');
  });

  it('exports ROLE_MAP with all issue types', () => {
    expect(typeof ROLE_MAP).toBe('object');
    expect(ROLE_MAP).toHaveProperty('Feature');
    expect(ROLE_MAP).toHaveProperty('Bug');
    expect(ROLE_MAP).toHaveProperty('Refactor');
    expect(ROLE_MAP).toHaveProperty('Docs');
    expect(ROLE_MAP).toHaveProperty('Chore');
  });

  it('exports BENEFIT_MAP with all issue types', () => {
    expect(typeof BENEFIT_MAP).toBe('object');
    expect(BENEFIT_MAP).toHaveProperty('Feature');
    expect(BENEFIT_MAP).toHaveProperty('Bug');
    expect(BENEFIT_MAP).toHaveProperty('Refactor');
    expect(BENEFIT_MAP).toHaveProperty('Docs');
    expect(BENEFIT_MAP).toHaveProperty('Chore');
  });
});

// =============================================================================
// normalizeTitle
// =============================================================================
describe('normalizeTitle', () => {
  it('removes feat: prefix', () => {
    const result = normalizeTitle('feat: add new detection pattern');
    expect(result).toBe('add new detection pattern');
  });

  it('removes fix: prefix', () => {
    const result = normalizeTitle('fix: repair broken hook');
    expect(result).toBe('repair broken hook');
  });

  it('removes chore: prefix', () => {
    const result = normalizeTitle('chore: update dependencies');
    expect(result).toBe('update dependencies');
  });

  it('removes docs: prefix', () => {
    const result = normalizeTitle('docs: update README');
    expect(result).toBe('update readme');
  });

  it('removes refactor: prefix', () => {
    const result = normalizeTitle('refactor: simplify parsing logic');
    expect(result).toBe('simplify parsing logic');
  });

  it('removes P0: prefix', () => {
    const result = normalizeTitle('P0: critical bug fix');
    expect(result).toBe('critical bug fix');
  });

  it('removes P1: prefix', () => {
    const result = normalizeTitle('P1: important feature');
    expect(result).toBe('important feature');
  });

  it('removes P2: prefix', () => {
    const result = normalizeTitle('P2: nice to have');
    expect(result).toBe('nice to have');
  });

  it('removes both conventional commit and priority prefixes', () => {
    const result = normalizeTitle('feat: P0: critical new feature');
    expect(result).toBe('critical new feature');
  });

  it('is case-insensitive for conventional commit prefixes', () => {
    const result = normalizeTitle('FEAT: Add Feature');
    expect(result).toBe('add feature');
  });

  it('is case-insensitive for priority prefixes', () => {
    const result = normalizeTitle('p0: Fix Bug');
    expect(result).toBe('fix bug');
  });

  it('lowercases the result', () => {
    const result = normalizeTitle('Add New Feature');
    expect(result).toBe('add new feature');
  });

  it('trims trailing whitespace but not before prefix matching', () => {
    // Leading whitespace prevents prefix match due to ^ anchor in regex
    const result = normalizeTitle('  feat: add feature  ');
    expect(result).toBe('feat: add feature');
  });

  it('trims whitespace when no prefix present', () => {
    const result = normalizeTitle('  add feature  ');
    expect(result).toBe('add feature');
  });

  it('handles empty string', () => {
    const result = normalizeTitle('');
    expect(result).toBe('');
  });

  it('handles title with no prefix', () => {
    const result = normalizeTitle('Simple Title');
    expect(result).toBe('simple title');
  });

  it('handles title with only prefix', () => {
    const result = normalizeTitle('feat:');
    expect(result).toBe('');
  });

  it('removes prefix with multiple spaces', () => {
    const result = normalizeTitle('feat:    add feature');
    expect(result).toBe('add feature');
  });

  it('handles multiple colons in title', () => {
    const result = normalizeTitle('feat: add feature: implementation');
    expect(result).toBe('add feature: implementation');
  });

  it('handles Unicode characters', () => {
    const result = normalizeTitle('feat: add 🚀 feature');
    expect(result).toBe('add 🚀 feature');
  });

  it('preserves internal priority mentions', () => {
    const result = normalizeTitle('feat: P0 items need attention');
    expect(result).toBe('p0 items need attention');
  });

  it('handles priority prefix without colon in middle of text', () => {
    const result = normalizeTitle('P0: Fix P1 and P2 issues');
    expect(result).toBe('fix p1 and p2 issues');
  });
});
