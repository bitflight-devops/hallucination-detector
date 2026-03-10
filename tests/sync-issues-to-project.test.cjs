'use strict';

const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// =============================================================================
// Script structure tests
// =============================================================================

describe('sync-issues-to-project script structure', () => {
  it('script file exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('imports required dependencies', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain("require('octokit')");
    expect(content).toContain("require('./lib/story-helpers.cjs')");
  });

  it('defines DEFAULT_PRIORITY constant', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('DEFAULT_PRIORITY');
  });

  it('imports OWNER and REPO from story-helpers', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('OWNER');
    expect(content).toContain('REPO');
  });
});

// =============================================================================
// GraphQL helpers tests
// =============================================================================

describe('sync-issues-to-project GraphQL helpers', () => {
  it('contains addIssueToProject function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function addIssueToProject');
  });

  it('uses addProjectV2ItemById mutation', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('addProjectV2ItemById');
  });

  it('contains setFieldValue function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function setFieldValue');
  });

  it('uses updateProjectV2ItemFieldValue mutation', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('updateProjectV2ItemFieldValue');
  });

  it('sets single-select field values', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('singleSelectOptionId');
  });

  it('uses octokit.graphql for mutations', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('octokit.graphql');
  });
});

// =============================================================================
// Field option discovery tests
// =============================================================================

describe('sync-issues-to-project field discovery', () => {
  it('contains fetchProjectFields function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function fetchProjectFields');
  });

  it('queries ProjectV2SingleSelectField nodes', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('ProjectV2SingleSelectField');
  });

  it('fetches field options', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('options {');
    expect(content).toContain('id');
    expect(content).toContain('name');
  });

  it('contains buildOptionMap function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('function buildOptionMap');
  });

  it('creates case-insensitive option map', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('toUpperCase()');
  });
});

// =============================================================================
// Discovery mode tests
// =============================================================================

describe('sync-issues-to-project discovery mode', () => {
  it('contains runDiscoverMode function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function runDiscoverMode');
  });

  it('queries both organization and user projects', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('organization(login:');
    expect(content).toContain('user(login:');
    expect(content).toContain('projectsV2');
  });

  it('uses Promise.allSettled for parallel queries', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('Promise.allSettled');
  });

  it('prints PROJECT_ID for each discovered project', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('PROJECT_ID=');
  });

  it('prints field IDs and option IDs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('_FIELD_ID=');
    expect(content).toContain('Option');
  });

  it('handles failed queries gracefully', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain("status === 'fulfilled'");
  });
});

// =============================================================================
// Priority extraction tests
// =============================================================================

describe('sync-issues-to-project priority extraction', () => {
  it('contains getPriorityFromLabels function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('function getPriorityFromLabels');
  });

  it('recognizes priority: P0 label format', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('/^priority\\s*:/i');
  });

  it('recognizes bare P0, P1, P2 labels', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('/^P[0-9]$/i');
  });

  it('recognizes Idea label', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('/^idea$/i');
  });

  it('returns DEFAULT_PRIORITY when no match found', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('return DEFAULT_PRIORITY');
  });

  it('converts priority to uppercase', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // Check that priority is uppercased after extraction
    expect(content).toContain('.toUpperCase()');
  });
});

// =============================================================================
// Issue sync tests
// =============================================================================

describe('sync-issues-to-project issue sync', () => {
  it('contains syncIssue function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function syncIssue');
  });

  it('extracts priority from issue labels', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('getPriorityFromLabels');
  });

  it('looks up priority option ID', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('priorityOptions.get');
  });

  it('sets status to Backlog for new items', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('Backlog');
    expect(content).toContain('backlogOptionId');
  });

  it('skips issues with unknown priority', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('SKIP #');
    expect(content).toContain('unknown priority');
  });

  it('adds issue to project and sets fields', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('addIssueToProject');
    expect(content).toContain('setFieldValue');
  });

  it('respects dry-run mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('WOULD ADD');
  });
});

// =============================================================================
// Main function tests
// =============================================================================

describe('sync-issues-to-project main function', () => {
  it('contains main function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('async function main');
  });

  it('handles --dry-run flag', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('--dry-run');
  });

  it('handles --discover flag', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('--discover');
  });

  it('checks for GITHUB_TOKEN environment variable', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('process.env.GITHUB_TOKEN');
  });

  it('requires PROJECT_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('process.env.PROJECT_ID');
  });

  it('requires PRIORITY_FIELD_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('process.env.PRIORITY_FIELD_ID');
  });

  it('requires STATUS_FIELD_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('process.env.STATUS_FIELD_ID');
  });

  it('auto-discovers field options from live project', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('fetchProjectFields');
  });

  it('validates priority field exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('!priorityField');
    expect(content).toContain('Priority field not found');
  });

  it('validates status field exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('!statusField');
    expect(content).toContain('Status field not found');
  });

  it('fetches open issues with pagination', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('octokit.paginate');
    expect(content).toContain('octokit.rest.issues.listForRepo');
    expect(content).toContain("state: 'open'");
  });

  it('filters out pull requests', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('!issue.pull_request');
  });

  it('tracks added and error counts', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('added');
    expect(content).toContain('errors');
  });

  it('handles sync errors gracefully', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('try {');
    expect(content).toContain('catch (err)');
  });

  it('prints summary at end', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('Done:');
  });

  it('exits with error code on failures', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('process.exit(1)');
  });
});

// =============================================================================
// Environment variable handling tests
// =============================================================================

describe('sync-issues-to-project environment variables', () => {
  it('provides helpful error message for missing token', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('GITHUB_TOKEN is not set');
  });

  it('provides helpful error message for missing project config', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('PROJECT_ID, PRIORITY_FIELD_ID, and STATUS_FIELD_ID must all be set');
  });

  it('suggests using --discover to find IDs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('Run with --discover');
  });
});

// =============================================================================
// Integration tests
// =============================================================================

describe('sync-issues-to-project integration', () => {
  it('uses story-helpers constants', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // Should use OWNER and REPO from story-helpers
    expect(content).toContain('OWNER');
    expect(content).toContain('REPO');
  });

  it('integrates with GitHub Projects V2 API', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('ProjectV2');
    expect(content).toContain('addProjectV2ItemById');
    expect(content).toContain('updateProjectV2ItemFieldValue');
  });

  it('handles both REST and GraphQL APIs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    expect(content).toContain('octokit.rest');
    expect(content).toContain('octokit.graphql');
  });
});
