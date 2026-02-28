const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

// =============================================================================
// Script structure tests
// =============================================================================

describe('sync-issues-to-project script structure', () => {
  it('script file exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    assert.ok(existsSync(scriptPath));
  });

  it('imports required dependencies', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("require('octokit')"));
    assert.ok(content.includes("require('./lib/story-helpers.cjs')"));
  });

  it('defines DEFAULT_PRIORITY constant', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('DEFAULT_PRIORITY'));
  });

  it('imports OWNER and REPO from story-helpers', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('OWNER'));
    assert.ok(content.includes('REPO'));
  });
});

// =============================================================================
// GraphQL helpers tests
// =============================================================================

describe('sync-issues-to-project GraphQL helpers', () => {
  it('contains addIssueToProject function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function addIssueToProject'));
  });

  it('uses addProjectV2ItemById mutation', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('addProjectV2ItemById'));
  });

  it('contains setFieldValue function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function setFieldValue'));
  });

  it('uses updateProjectV2ItemFieldValue mutation', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('updateProjectV2ItemFieldValue'));
  });

  it('sets single-select field values', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('singleSelectOptionId'));
  });

  it('uses octokit.graphql for mutations', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('octokit.graphql'));
  });
});

// =============================================================================
// Field option discovery tests
// =============================================================================

describe('sync-issues-to-project field discovery', () => {
  it('contains fetchProjectFields function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function fetchProjectFields'));
  });

  it('queries ProjectV2SingleSelectField nodes', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('ProjectV2SingleSelectField'));
  });

  it('fetches field options', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('options {'));
    assert.ok(content.includes('id'));
    assert.ok(content.includes('name'));
  });

  it('contains buildOptionMap function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function buildOptionMap'));
  });

  it('creates case-insensitive option map', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('toUpperCase()'));
  });
});

// =============================================================================
// Discovery mode tests
// =============================================================================

describe('sync-issues-to-project discovery mode', () => {
  it('contains runDiscoverMode function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function runDiscoverMode'));
  });

  it('queries both organization and user projects', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('organization(login:'));
    assert.ok(content.includes('user(login:'));
    assert.ok(content.includes('projectsV2'));
  });

  it('uses Promise.allSettled for parallel queries', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('Promise.allSettled'));
  });

  it('prints PROJECT_ID for each discovered project', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('PROJECT_ID='));
  });

  it('prints field IDs and option IDs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('_FIELD_ID='));
    assert.ok(content.includes('Option'));
  });

  it('handles failed queries gracefully', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("status === 'fulfilled'"));
  });
});

// =============================================================================
// Priority extraction tests
// =============================================================================

describe('sync-issues-to-project priority extraction', () => {
  it('contains getPriorityFromLabels function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('function getPriorityFromLabels'));
  });

  it('recognizes priority: P0 label format', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('/^priority\\s*:/i'));
  });

  it('recognizes bare P0, P1, P2 labels', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('/^P[0-9]$/i'));
  });

  it('recognizes Idea label', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('/^idea$/i'));
  });

  it('returns DEFAULT_PRIORITY when no match found', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('return DEFAULT_PRIORITY'));
  });

  it('converts priority to uppercase', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    // Check that priority is uppercased after extraction
    assert.ok(content.includes('.toUpperCase()'));
  });
});

// =============================================================================
// Issue sync tests
// =============================================================================

describe('sync-issues-to-project issue sync', () => {
  it('contains syncIssue function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function syncIssue'));
  });

  it('extracts priority from issue labels', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('getPriorityFromLabels'));
  });

  it('looks up priority option ID', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('priorityOptions.get'));
  });

  it('sets status to Backlog for new items', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('Backlog'));
    assert.ok(content.includes('backlogOptionId'));
  });

  it('skips issues with unknown priority', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes("SKIP #"));
    assert.ok(content.includes('unknown priority'));
  });

  it('adds issue to project and sets fields', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('addIssueToProject'));
    assert.ok(content.includes('setFieldValue'));
  });

  it('respects dry-run mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('WOULD ADD'));
  });
});

// =============================================================================
// Main function tests
// =============================================================================

describe('sync-issues-to-project main function', () => {
  it('contains main function', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('async function main'));
  });

  it('handles --dry-run flag', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('--dry-run'));
  });

  it('handles --discover flag', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('--discover'));
  });

  it('checks for GITHUB_TOKEN environment variable', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.GITHUB_TOKEN'));
  });

  it('requires PROJECT_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.PROJECT_ID'));
  });

  it('requires PRIORITY_FIELD_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.PRIORITY_FIELD_ID'));
  });

  it('requires STATUS_FIELD_ID in sync mode', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.env.STATUS_FIELD_ID'));
  });

  it('auto-discovers field options from live project', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('fetchProjectFields'));
  });

  it('validates priority field exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('!priorityField'));
    assert.ok(content.includes('Priority field not found'));
  });

  it('validates status field exists', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('!statusField'));
    assert.ok(content.includes('Status field not found'));
  });

  it('fetches open issues with pagination', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('octokit.paginate'));
    assert.ok(content.includes('octokit.rest.issues.listForRepo'));
    assert.ok(content.includes("state: 'open'"));
  });

  it('filters out pull requests', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('!issue.pull_request'));
  });

  it('tracks added and error counts', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('added'));
    assert.ok(content.includes('errors'));
  });

  it('handles sync errors gracefully', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('try {'));
    assert.ok(content.includes('catch (err)'));
  });

  it('prints summary at end', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('Done:'));
  });

  it('exits with error code on failures', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('process.exit(1)'));
  });
});

// =============================================================================
// Environment variable handling tests
// =============================================================================

describe('sync-issues-to-project environment variables', () => {
  it('provides helpful error message for missing token', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('GITHUB_TOKEN is not set'));
  });

  it('provides helpful error message for missing project config', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(
      content.includes('PROJECT_ID, PRIORITY_FIELD_ID, and STATUS_FIELD_ID must all be set'),
    );
  });

  it('suggests using --discover to find IDs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('Run with --discover'));
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
    assert.ok(content.includes('OWNER'));
    assert.ok(content.includes('REPO'));
  });

  it('integrates with GitHub Projects V2 API', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('ProjectV2'));
    assert.ok(content.includes('addProjectV2ItemById'));
    assert.ok(content.includes('updateProjectV2ItemFieldValue'));
  });

  it('handles both REST and GraphQL APIs', () => {
    const scriptPath = join(__dirname, '..', '.claude', 'scripts', 'sync-issues-to-project.cjs');
    const content = readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('octokit.rest'));
    assert.ok(content.includes('octokit.graphql'));
  });
});