'use strict';

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
    expect(existsSync(scriptPath)).toBe(true);
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

    expect(content).toContain("require('node:fs')");
    expect(content).toContain("require('node:path')");
    expect(content).toContain("require('octokit')");
    expect(content).toContain("require('gray-matter')");
    expect(content).toContain("require('yaml')");
    expect(content).toContain("require('./lib/story-helpers.cjs')");
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

    expect(content).toContain('REPO_ROOT');
    expect(content).toContain('REGISTER_PATH');
    expect(content).toContain('BACKLOG_DIR');
    expect(content).toContain('FIELD_MAP');
    expect(content).toContain('MULTILINE_FIELDS');
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

    expect(content).toContain("'**Source**:'");
    expect(content).toContain("'**Added**:'");
    expect(content).toContain("'**Priority**:'");
    expect(content).toContain("'**Description**:'");
    expect(content).toContain("'**Research first**:'");
    expect(content).toContain("'**Suggested location**:'");
    expect(content).toContain("'**Files**:'");
    expect(content).toContain("'**Issue**:'");
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

    expect(content).toContain('MULTILINE_FIELDS');
    expect(content).toContain("'**Description**:'");
    expect(content).toContain("'**Files**:'");
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

    expect(content).toContain('SEPARATOR_LINE_RE');
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

    expect(content).toContain('function detectPriority');
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

    expect(content).toContain("'## P0'");
    expect(content).toContain("'## P1'");
    expect(content).toContain("'## P2'");
    expect(content).toContain("'## Ideas'");
    expect(content).toContain("'## Completed'");
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

    expect(content).toContain('function matchFieldPrefix');
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

    expect(content).toContain('function isBoldKeyLine');
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

    expect(content).toContain('function collectMultilineValue');
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

    expect(content).toContain('function extractFields');
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

    expect(content).toContain('function parseRegister');
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

    expect(content).toContain('issue_number');
    expect(content).toContain('/#(\\d+)/');
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

    expect(content).toContain('full_body');
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

    expect(content).toContain('function fuzzyMatch');
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

    expect(content).toContain('function matchItemsToIssues');
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

    expect(content).toContain('normalizeTitle');
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

    expect(content).toContain('issueMap.get');
    expect(content).toContain('fuzzyMatch');
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

    expect(content).toContain('function findPerItemFile');
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
    expect(content).toContain('p1Prefix');
    expect(content).toContain('.slice(0, 30)');
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
    expect(content).toContain('slugPrefix');
    expect(content).toContain('.slice(0, 20)');
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

    expect(content).toContain('function readGroomedContent');
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

    expect(content).toContain('## Groomed');
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

    expect(content).toContain('function extractAdditionalContent');
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

    expect(content).toContain('coveredPrefixes');
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

    expect(content).toContain('function buildStoryBody');
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

    expect(content).toContain('## Story');
    expect(content).toContain('As a **');
    expect(content).toContain('I want to **');
    expect(content).toContain('so that **');
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

    expect(content).toContain('## Description');
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

    expect(content).toContain('## Details');
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

    expect(content).toContain('## Files');
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

    expect(content).toContain('## Suggested Location');
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

    expect(content).toContain('## Context');
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

    expect(content).toContain('## Plan');
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

    expect(content).toContain('groomedContent');
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

    expect(content).toContain('ROLE_MAP');
    expect(content).toContain('BENEFIT_MAP');
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

    expect(content).toContain('function updatePerItemFile');
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

    expect(content).toContain('matter(');
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

    expect(content).toContain('yaml.stringify');
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

    expect(content).toContain('newDesc.length <= oldDesc.length');
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

    expect(content).toContain("'Not specified'");
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

    expect(content).toContain('async function main');
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

    expect(content).toContain('--dry-run');
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

    expect(content).toContain('existsSync(REGISTER_PATH)');
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

    expect(content).toContain('process.env.GITHUB_TOKEN');
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

    expect(content).toContain("priority !== 'Completed'");
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

    expect(content).toContain('octokit.paginate');
    expect(content).toContain("state: 'open'");
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

    expect(content).toContain('totalFilesUpdated');
    expect(content).toContain('totalIssuesUpdated');
    expect(content).toContain('totalNoIssue');
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

    expect(content).toContain('process.exit(1)');
  });
});
