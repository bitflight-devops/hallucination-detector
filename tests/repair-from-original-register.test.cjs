const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// =============================================================================
// Script structure tests
// =============================================================================

describe('repair-from-original-register script structure', () => {
  it('script file exists', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    assert.ok(existsSync(scriptPath));
  });

  it('imports required dependencies', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("require('node:fs')"));
    assert.ok(content.includes("require('node:path')"));
    assert.ok(content.includes("require('octokit')"));
    assert.ok(content.includes("require('gray-matter')"));
    assert.ok(content.includes("require('yaml')"));
    assert.ok(content.includes("require('./lib/story-helpers.cjs')"));
  });

  it('defines required constants', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('REPO_ROOT'));
    assert.ok(content.includes('REGISTER_PATH'));
    assert.ok(content.includes('BACKLOG_DIR'));
    assert.ok(content.includes('FIELD_MAP'));
    assert.ok(content.includes('MULTILINE_FIELDS'));
  });
});

// =============================================================================
// Field mapping tests
// =============================================================================

describe('repair-from-original-register field mapping', () => {
  it('defines FIELD_MAP for bold-key fields', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("'**Source**:'"));
    assert.ok(content.includes("'**Added**:'"));
    assert.ok(content.includes("'**Priority**:'"));
    assert.ok(content.includes("'**Description**:'"));
    assert.ok(content.includes("'**Research first**:'"));
    assert.ok(content.includes("'**Suggested location**:'"));
    assert.ok(content.includes("'**Files**:'"));
    assert.ok(content.includes("'**Issue**:'"));
  });

  it('defines MULTILINE_FIELDS for multi-line content', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('MULTILINE_FIELDS'));
    assert.ok(content.includes("'**Description**:'"));
    assert.ok(content.includes("'**Files**:'"));
  });

  it('uses regex pattern for separator lines', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('SEPARATOR_LINE_RE'));
  });
});

// =============================================================================
// Parsing function tests
// =============================================================================

describe('repair-from-original-register parsing functions', () => {
  it('contains detectPriority function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function detectPriority'));
  });

  it('detects P0, P1, P2, Ideas, and Completed sections', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("'## P0'"));
    assert.ok(content.includes("'## P1'"));
    assert.ok(content.includes("'## P2'"));
    assert.ok(content.includes("'## Ideas'"));
    assert.ok(content.includes("'## Completed'"));
  });

  it('contains matchFieldPrefix function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function matchFieldPrefix'));
  });

  it('contains isBoldKeyLine function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function isBoldKeyLine'));
  });

  it('contains collectMultilineValue function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function collectMultilineValue'));
  });

  it('contains extractFields function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function extractFields'));
  });

  it('contains parseRegister function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function parseRegister'));
  });

  it('extracts issue number from Issue field', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('issue_number'));
    assert.ok(content.includes('/#(\\d+)/'));
  });

  it('stores full_body for each item', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('full_body'));
  });
});

// =============================================================================
// Title matching tests
// =============================================================================

describe('repair-from-original-register title matching', () => {
  it('contains fuzzyMatch function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function fuzzyMatch'));
  });

  it('contains matchItemsToIssues function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function matchItemsToIssues'));
  });

  it('uses normalizeTitle for matching', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('normalizeTitle'));
  });

  it('performs exact match first, then fuzzy match', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('issueMap.get'));
    assert.ok(content.includes('fuzzyMatch'));
  });
});

// =============================================================================
// Per-item file handling tests
// =============================================================================

describe('repair-from-original-register per-item file handling', () => {
  it('contains findPerItemFile function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function findPerItemFile'));
  });

  it('searches with priority prefix pattern first', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    // Pattern: {priority}-{slug[:30]}*.md
    assert.ok(content.includes('p1Prefix'));
    assert.ok(content.includes('.slice(0, 30)'));
  });

  it('fallback searches with slug pattern', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    // Pattern: *{slug[:20]}*.md
    assert.ok(content.includes('slugPrefix'));
    assert.ok(content.includes('.slice(0, 20)'));
  });

  it('contains readGroomedContent function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function readGroomedContent'));
  });

  it('extracts groomed section from ## Groomed heading', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Groomed'));
  });

  it('contains extractAdditionalContent function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function extractAdditionalContent'));
  });

  it('filters out covered fields from additional content', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('coveredPrefixes'));
  });
});

// =============================================================================
// Story body builder tests
// =============================================================================

describe('repair-from-original-register story body builder', () => {
  it('contains buildStoryBody function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function buildStoryBody'));
  });

  it('includes Story section with role-goal-benefit format', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Story'));
    assert.ok(content.includes('As a **'));
    assert.ok(content.includes('I want to **'));
    assert.ok(content.includes('so that **'));
  });

  it('includes Description section', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Description'));
  });

  it('includes Details section for additional content', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Details'));
  });

  it('includes Files section when present', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Files'));
  });

  it('includes Suggested Location section when present', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Suggested Location'));
  });

  it('includes Context section with metadata', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Context'));
  });

  it('includes Plan section when present', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('## Plan'));
  });

  it('appends groomed content when provided', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('groomedContent'));
  });

  it('uses ROLE_MAP and BENEFIT_MAP', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('ROLE_MAP'));
    assert.ok(content.includes('BENEFIT_MAP'));
  });
});

// =============================================================================
// File update tests
// =============================================================================

describe('repair-from-original-register file update', () => {
  it('contains updatePerItemFile function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function updatePerItemFile'));
  });

  it('uses gray-matter to read frontmatter', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('matter('));
  });

  it('uses yaml to write frontmatter', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('yaml.stringify'));
  });

  it('only updates when new description is longer', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('newDesc.length <= oldDesc.length'));
  });

  it('updates source metadata when previously unspecified', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("'Not specified'"));
  });
});

// =============================================================================
// Main function tests
// =============================================================================

describe('repair-from-original-register main function', () => {
  it('contains main function', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function main'));
  });

  it('handles --dry-run flag', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('--dry-run'));
  });

  it('checks for register file existence', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('existsSync(REGISTER_PATH)'));
  });

  it('checks for GITHUB_TOKEN environment variable', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.GITHUB_TOKEN'));
  });

  it('filters out completed items', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("priority !== 'Completed'"));
  });

  it('fetches open issues from GitHub', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('octokit.paginate'));
    assert.ok(content.includes("state: 'open'"));
  });

  it('tracks files updated, issues updated, and no-match counts', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('totalFilesUpdated'));
    assert.ok(content.includes('totalIssuesUpdated'));
    assert.ok(content.includes('totalNoIssue'));
  });

  it('exits with error code on failures', () => {
    const scriptPath = join(
      __dirname,
      '..',
      '.claude',
      'scripts',
      'repair-from-original-register.cjs',
    );
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.exit(1)'));
  });
});