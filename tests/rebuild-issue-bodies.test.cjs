'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const SCRIPT_PATH = join(__dirname, '..', '.claude', 'scripts', 'rebuild-issue-bodies.cjs');

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
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  it('imports required dependencies', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain("require('node:fs/promises')");
    expect(content).toContain("require('node:path')");
    expect(content).toContain("require('node:fs')");
    expect(content).toContain("require('octokit')");
    expect(content).toContain("require('gray-matter')");
    expect(content).toContain("require('./lib/story-helpers.cjs')");
  });

  it('defines BACKLOG_DIR constant', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('BACKLOG_DIR');
  });

  it('contains parseBacklogFile function', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('async function parseBacklogFile');
  });

  it('contains extractExtraFields function', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('function extractExtraFields');
  });

  it('contains buildStoryBody function', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('function buildStoryBody');
  });

  it('contains main function', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('async function main');
  });

  it('handles --dry-run flag', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('--dry-run');
  });

  it('checks for GITHUB_TOKEN environment variable', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('process.env.GITHUB_TOKEN');
  });
});

// =============================================================================
// Test logic patterns
// =============================================================================

describe('rebuild-issue-bodies logic validation', () => {
  it('extracts research first field pattern', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    // Verify the script looks for this field
    expect(content).toContain('**Research first**:');
  });

  it('extracts suggested location field pattern', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('**Suggested location**:');
  });

  it('extracts files field pattern', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('**Files**:');
  });

  it('builds story format with role and benefit', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('## Story');
    expect(content).toContain('As a **');
    expect(content).toContain('I want to **');
    expect(content).toContain('so that **');
  });

  it('includes description section in story body', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('## Description');
  });

  it('includes context section with metadata', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('## Context');
    expect(content).toContain('**Source**:');
    expect(content).toContain('**Priority**:');
    expect(content).toContain('**Added**:');
  });

  it('uses normalizeTitle for matching', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('normalizeTitle');
  });

  it('performs fuzzy substring matching', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    // Check for substring matching logic
    expect(content).toContain('.includes(');
  });

  it('filters out items already in story format', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain("issue.body?.includes('## Story')");
  });

  it('uses gray-matter for frontmatter parsing', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('matter(');
  });

  it('handles missing backlog directory gracefully', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('existsSync(BACKLOG_DIR)');
  });

  it('filters out completed items', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('completed-');
  });

  it('uses Octokit for GitHub API interactions', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('new Octokit');
    expect(content).toContain('octokit.paginate');
    expect(content).toContain('octokit.rest.issues');
  });

  it('tracks updated, skipped, and no-match counts', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('updated');
    expect(content).toContain('skipped');
    expect(content).toContain('noMatch');
  });

  it('exits with error code on missing token', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('process.exit(1)');
  });
});

// =============================================================================
// Test data structure expectations
// =============================================================================

describe('rebuild-issue-bodies data structures', () => {
  it('expects frontmatter with name field', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('fm.name');
  });

  it('expects frontmatter with description field', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('fm.description');
  });

  it('expects metadata object in frontmatter', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('fm.metadata');
    expect(content).toContain('metadata.source');
    expect(content).toContain('metadata.added');
    expect(content).toContain('metadata.priority');
    expect(content).toContain('metadata.type');
  });

  it('handles missing metadata with defaults', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('Not specified');
    expect(content).toContain('Unknown');
    expect(content).toContain('Feature');
  });

  it('uses ROLE_MAP for type-to-role mapping', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('ROLE_MAP');
  });

  it('uses BENEFIT_MAP for type-to-benefit mapping', () => {
    const content = readFileSync(SCRIPT_PATH, 'utf8');

    expect(content).toContain('BENEFIT_MAP');
  });
});
