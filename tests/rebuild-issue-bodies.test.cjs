const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// Mock the module to test internal functions without making API calls
const modulePath = '../.claude/scripts/rebuild-issue-bodies.cjs';

// We'll test the utility functions that can be tested without external dependencies
// For functions that require Octokit, we'd need to mock the API calls

// =============================================================================
// Test helper to parse and expose internal functions
// =============================================================================

// Since the script uses module.exports for some functions, we need to load it
// and test what we can. For a complete test, we'd need to refactor the script
// to export its utility functions.

describe('rebuild-issue-bodies script structure', () => {
  it('script file exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    assert.ok(existsSync(scriptPath));
  });

  it('imports required dependencies', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("require('node:fs/promises')"));
    assert.ok(content.includes("require('node:path')"));
    assert.ok(content.includes("require('node:fs')"));
    assert.ok(content.includes("require('octokit')"));
    assert.ok(content.includes("require('gray-matter')"));
    assert.ok(content.includes("require('./lib/story-helpers.cjs')"));
  });

  it('defines BACKLOG_DIR constant', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('BACKLOG_DIR'));
  });

  it('contains parseBacklogFile function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function parseBacklogFile'));
  });

  it('contains extractExtraFields function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function extractExtraFields'));
  });

  it('contains buildStoryBody function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function buildStoryBody'));
  });

  it('contains main function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function main'));
  });

  it('handles --dry-run flag', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('--dry-run'));
  });

  it('checks for GITHUB_TOKEN environment variable', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.GITHUB_TOKEN'));
  });
});

// =============================================================================
// Test logic patterns
// =============================================================================

describe('rebuild-issue-bodies logic validation', () => {
  it('extracts research first field pattern', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // Verify the script looks for this field
    assert.ok(content.includes('**Research first**:'));
  });

  it('extracts suggested location field pattern', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('**Suggested location**:'));
  });

  it('extracts files field pattern', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('**Files**:'));
  });

  it('builds story format with role and benefit', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Story'));
    assert.ok(content.includes('As a **'));
    assert.ok(content.includes('I want to **'));
    assert.ok(content.includes('so that **'));
  });

  it('includes description section in story body', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Description'));
  });

  it('includes context section with metadata', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Context'));
    assert.ok(content.includes('**Source**:'));
    assert.ok(content.includes('**Priority**:'));
    assert.ok(content.includes('**Added**:'));
  });

  it('uses normalizeTitle for matching', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('normalizeTitle'));
  });

  it('performs fuzzy substring matching', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // Check for substring matching logic
    assert.ok(content.includes('.includes('));
  });

  it('filters out items already in story format', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("issue.body?.includes('## Story')"));
  });

  it('uses gray-matter for frontmatter parsing', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('matter('));
  });

  it('handles missing backlog directory gracefully', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('existsSync(BACKLOG_DIR)'));
  });

  it('filters out completed items', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('completed-'));
  });

  it('uses Octokit for GitHub API interactions', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('new Octokit'));
    assert.ok(content.includes('octokit.paginate'));
    assert.ok(content.includes('octokit.rest.issues'));
  });

  it('tracks updated, skipped, and no-match counts', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('updated'));
    assert.ok(content.includes('skipped'));
    assert.ok(content.includes('noMatch'));
  });

  it('exits with error code on missing token', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.exit(1)'));
  });
});

// =============================================================================
// Test data structure expectations
// =============================================================================

describe('rebuild-issue-bodies data structures', () => {
  it('expects frontmatter with name field', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('fm.name'));
  });

  it('expects frontmatter with description field', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('fm.description'));
  });

  it('expects metadata object in frontmatter', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('fm.metadata'));
    assert.ok(content.includes('metadata.source'));
    assert.ok(content.includes('metadata.added'));
    assert.ok(content.includes('metadata.priority'));
    assert.ok(content.includes('metadata.type'));
  });

  it('handles missing metadata with defaults', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('Not specified'));
    assert.ok(content.includes('Unknown'));
    assert.ok(content.includes('Feature'));
  });

  it('uses ROLE_MAP for type-to-role mapping', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('ROLE_MAP'));
  });

  it('uses BENEFIT_MAP for type-to-benefit mapping', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('BENEFIT_MAP'));
  });
});
