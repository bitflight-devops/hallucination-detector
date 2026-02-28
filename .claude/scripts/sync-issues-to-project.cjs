#!/usr/bin/env node
'use strict';

/**
 * Sync all open GitHub issues to a Projects V2 board and set Priority + Status fields.
 *
 * Uses octokit (full SDK) for REST calls and octokit.graphql() for Projects V2 GraphQL mutations.
 *
 * Usage:
 *   node .claude/scripts/sync-issues-to-project.cjs --dry-run
 *   node .claude/scripts/sync-issues-to-project.cjs --discover
 *   node .claude/scripts/sync-issues-to-project.cjs
 *
 * Required env vars (for sync):
 *   GITHUB_TOKEN      — GitHub personal access token with repo + project scopes
 *   PROJECT_ID        — Projects V2 node ID (PVT_...)
 *   PRIORITY_FIELD_ID — Single-select field node ID for Priority (PVTSSF_...)
 *   STATUS_FIELD_ID   — Single-select field node ID for Status (PVTSSF_...)
 */

const { Octokit } = require('octokit');
const { OWNER, REPO } = require('./lib/story-helpers.cjs');

// Default priority when no matching label is found
const DEFAULT_PRIORITY = 'P2';

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

/**
 * Add an issue to a Projects V2 board.
 *
 * @param {import('octokit').Octokit} octokit - Octokit REST/GraphQL client.
 * @param {string} projectId - Projects V2 node ID.
 * @param {string} issueNodeId - Issue GraphQL node ID to add to the project.
 * @returns {string|null} The created project item ID, or `null` if the item could not be created.
 */
async function addIssueToProject(octokit, projectId, issueNodeId) {
  const result = await octokit.graphql(
    `
    mutation AddItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item {
          id
        }
      }
    }
  `,
    { projectId, contentId: issueNodeId },
  );

  return result?.addProjectV2ItemById?.item?.id ?? null;
}

/**
 * Set the value of a single-select field on a Projects V2 item.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {string} projectId - Projects V2 node ID.
 * @param {string} itemId - Project item node ID.
 * @param {string} fieldId - Field node ID corresponding to a single-select field.
 * @param {string} optionId - Single-select option node ID to assign.
 */
async function setFieldValue(octokit, projectId, itemId, fieldId, optionId) {
  await octokit.graphql(
    `
    mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,
    { projectId, itemId, fieldId, optionId },
  );
}

// ---------------------------------------------------------------------------
// Field option discovery
// ---------------------------------------------------------------------------

/**
 * @typedef {{ id: string, name: string }} FieldOption
 * @typedef {{ id: string, name: string, options: FieldOption[] }} ProjectField
 */

/**
 * Retrieve single-select fields (including their options) from a Projects V2 board.
 * @param {import('octokit').Octokit} octokit - Octokit REST/GraphQL client (used for GraphQL queries).
 * @param {string} projectId - The Projects V2 node ID.
 * @returns {Promise<ProjectField[]>} An array of single-select project fields; each item includes `id`, `name`, and `options`. Returns an empty array if no matching fields are found.
 */
async function fetchProjectFields(octokit, projectId) {
  const result = await octokit.graphql(
    `
    query ProjectFields($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `,
    { projectId },
  );

  const nodes = result?.node?.fields?.nodes ?? [];
  // Filter to only single-select fields (which have an options array)
  return nodes.filter((n) => n?.options);
}

/**
 * Create a lookup map from option name to option ID that supports case-insensitive and exact-name lookup.
 *
 * Adds two entries per option: the original option name and an uppercased version of the name, both mapping to the option's node ID.
 *
 * @param {FieldOption[]} options - Array of field option objects with `name` and `id` properties.
 * @returns {Map<string, string>} Map where keys are option names (original and uppercased) and values are option IDs.
 */
function buildOptionMap(options) {
  const map = new Map();
  for (const opt of options) {
    map.set(opt.name.toUpperCase(), opt.id);
    map.set(opt.name, opt.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Discovery mode
// ---------------------------------------------------------------------------

/**
 * Query Projects V2 under both the org and the repo owner (user), then print
 * project IDs, field IDs, and option IDs to stdout.
 *
 * @param {import('octokit').Octokit} octokit
 * @returns {Promise<void>}
 */
async function runDiscoverMode(octokit) {
  console.log(`Discovering Projects V2 for ${OWNER}/${REPO}...\n`);

  // Query org projects and user projects in parallel
  const [orgResult, userResult] = await Promise.allSettled([
    octokit.graphql(
      `
      query OrgProjects($login: String!) {
        organization(login: $login) {
          projectsV2(first: 20) {
            nodes {
              id
              title
              number
            }
          }
        }
      }
    `,
      { login: OWNER },
    ),
    octokit.graphql(
      `
      query UserProjects($login: String!) {
        user(login: $login) {
          projectsV2(first: 20) {
            nodes {
              id
              title
              number
            }
          }
        }
      }
    `,
      { login: OWNER },
    ),
  ]);

  /** @type {Array<{id: string, title: string, number: number, source: string}>} */
  const projects = [];

  if (orgResult.status === 'fulfilled') {
    const nodes = orgResult.value?.organization?.projectsV2?.nodes ?? [];
    for (const p of nodes) {
      if (p) projects.push({ ...p, source: 'org' });
    }
  } else {
    console.log(`  [org query failed: ${orgResult.reason?.message}]`);
  }

  if (userResult.status === 'fulfilled') {
    const nodes = userResult.value?.user?.projectsV2?.nodes ?? [];
    for (const p of nodes) {
      if (p) projects.push({ ...p, source: 'user' });
    }
  } else {
    console.log(`  [user query failed: ${userResult.reason?.message}]`);
  }

  if (projects.length === 0) {
    console.log('No Projects V2 found.');
    return;
  }

  console.log(`Found ${projects.length} project(s):\n`);

  for (const project of projects) {
    console.log(`Project: ${project.title} (#${project.number}) [${project.source}]`);
    console.log(`  PROJECT_ID=${project.id}`);

    let fields;
    try {
      fields = await fetchProjectFields(octokit, project.id);
    } catch (err) {
      console.log(`  [failed to fetch fields: ${err.message}]`);
      console.log('');
      continue;
    }

    if (fields.length === 0) {
      console.log('  (no single-select fields found)');
    }

    for (const field of fields) {
      const envKey = field.name.toUpperCase().replace(/\s+/g, '_');
      console.log(`  Field: ${field.name}`);
      console.log(`    ${envKey}_FIELD_ID=${field.id}`);
      for (const opt of field.options) {
        console.log(`    Option "${opt.name}": ${opt.id}`);
      }
    }

    console.log('');
  }
}

// ---------------------------------------------------------------------------
// Priority extraction
// ---------------------------------------------------------------------------

/**
 * Determine the issue's priority from its labels.
 *
 * Recognizes labels in the forms "priority: P0" (or "priority:P0"), bare priorities like "P0"/"P1"/"P2",
 * and "Idea". If no matching label is found, returns DEFAULT_PRIORITY.
 *
 * @param {Array<{name: string}>} labels - Array of label objects (each with a `name` property).
 * @returns {string} Priority string such as "P0", "P1", "P2", or "Idea"; defaults to DEFAULT_PRIORITY when none matched.
 */
function getPriorityFromLabels(labels) {
  for (const label of labels) {
    const name = label.name;

    // Format: "priority: P0" or "priority:P0"
    if (/^priority\s*:/i.test(name)) {
      const part = name.split(':')[1]?.trim() ?? '';
      if (part) {
        return part.toUpperCase();
      }
    }

    // Format: bare "P0", "P1", "P2", "Idea"
    if (/^P[0-9]$/i.test(name)) {
      return name.toUpperCase();
    }

    if (/^idea$/i.test(name)) {
      return 'Idea';
    }
  }

  return DEFAULT_PRIORITY;
}

// ---------------------------------------------------------------------------
// Sync a single issue
// ---------------------------------------------------------------------------

/**
 * Add an issue to the Projects V2 board and set its Priority and Status fields.
 *
 * Determines the issue's priority from its labels, resolves matching single-select option IDs,
 * adds the issue to the project, and sets the Priority and Status (Backlog) field values.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit REST/GraphQL client.
 * @param {object} opts
 * @param {string} opts.projectId - Projects V2 node ID.
 * @param {string} opts.priorityFieldId - Node ID of the Priority single-select field.
 * @param {string} opts.statusFieldId - Node ID of the Status single-select field.
 * @param {Map<string, string>} opts.priorityOptions - Map from priority name (case-insensitive) to option node ID.
 * @param {Map<string, string>} opts.statusOptions - Map from status name (case-insensitive) to option node ID.
 * @param {{ number: number, title: string, node_id: string, labels: Array<{name: string}> }} opts.issue - Issue object; labels are inspected to derive priority.
 * @param {boolean} opts.dryRun - If true, log intended actions without making API changes.
 * @returns {Promise<boolean>} `true` if the issue was added (or would be added in dry-run), `false` on skip or error.
 */
async function syncIssue(octokit, opts) {
  const {
    projectId,
    priorityFieldId,
    statusFieldId,
    priorityOptions,
    statusOptions,
    issue,
    dryRun,
  } = opts;

  const priority = getPriorityFromLabels(issue.labels);
  const priorityOptionId =
    priorityOptions.get(priority) ?? priorityOptions.get(priority.toUpperCase());

  if (!priorityOptionId) {
    console.log(`  SKIP #${issue.number}: unknown priority '${priority}' (no matching option)`);
    return false;
  }

  const backlogOptionId = statusOptions.get('Backlog') ?? statusOptions.get('BACKLOG');
  if (!backlogOptionId) {
    console.log(`  SKIP #${issue.number}: 'Backlog' status option not found in project`);
    return false;
  }

  if (dryRun) {
    console.log(`  WOULD ADD #${issue.number}: ${issue.title} (Priority: ${priority})`);
    return true;
  }

  const itemId = await addIssueToProject(octokit, projectId, issue.node_id);
  if (!itemId) {
    console.log(`  ERROR #${issue.number}: failed to add to project`);
    return false;
  }

  await setFieldValue(octokit, projectId, itemId, priorityFieldId, priorityOptionId);
  await setFieldValue(octokit, projectId, itemId, statusFieldId, backlogOptionId);

  console.log(`  ADDED #${issue.number}: ${issue.title} (Priority: ${priority})`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Syncs open repository issues to a Projects V2 board, setting Priority and Status fields.
 *
 * Supports two modes controlled by command-line flags:
 * - --discover: prints Projects V2 project IDs and field/option IDs for the repo owner and exits.
 * - default (or with --dry-run): adds open issues to the configured project and sets priority/status;
 *   use --dry-run to simulate actions without making changes.
 *
 * Reads GITHUB_TOKEN from the environment and exits with an error if missing. In sync mode the
 * environment variables PROJECT_ID, PRIORITY_FIELD_ID, and STATUS_FIELD_ID must be set; the script
 * fetches live single-select field options from the project, maps label-derived priorities to
 * option IDs, and applies the Priority and Status (Backlog) fields to each added issue. Logs a
 * summary of added items and any errors, and exits the process on fatal configuration errors.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const discover = args.includes('--discover');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('ERROR: GITHUB_TOKEN is not set');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  if (discover) {
    await runDiscoverMode(octokit);
    return;
  }

  // Sync mode — require project and field IDs
  const projectId = process.env.PROJECT_ID;
  const priorityFieldId = process.env.PRIORITY_FIELD_ID;
  const statusFieldId = process.env.STATUS_FIELD_ID;

  if (!projectId || !priorityFieldId || !statusFieldId) {
    console.error(
      'ERROR: PROJECT_ID, PRIORITY_FIELD_ID, and STATUS_FIELD_ID must all be set.\n' +
        'Run with --discover to print available project and field IDs.',
    );
    process.exit(1);
  }

  // Auto-discover field options from the live project board
  console.log(`Fetching field options from project ${projectId}...`);
  const fields = await fetchProjectFields(octokit, projectId);

  const priorityField = fields.find(
    (f) => f.id === priorityFieldId || f.name.toUpperCase() === 'PRIORITY',
  );
  const statusField = fields.find(
    (f) => f.id === statusFieldId || f.name.toUpperCase() === 'STATUS',
  );

  if (!priorityField) {
    console.error(
      `ERROR: Priority field not found in project (PRIORITY_FIELD_ID=${priorityFieldId})`,
    );
    process.exit(1);
  }

  if (!statusField) {
    console.error(`ERROR: Status field not found in project (STATUS_FIELD_ID=${statusFieldId})`);
    process.exit(1);
  }

  const priorityOptions = buildOptionMap(priorityField.options);
  const statusOptions = buildOptionMap(statusField.options);

  console.log(`Priority options: ${priorityField.options.map((o) => o.name).join(', ')}`);
  console.log(`Status options: ${statusField.options.map((o) => o.name).join(', ')}`);

  // Fetch all open issues (paginated, excludes PRs)
  const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    state: 'open',
    per_page: 100,
  });

  const openIssues = allIssues.filter((issue) => !issue.pull_request);
  console.log(`\nFound ${openIssues.length} open issue(s) in ${OWNER}/${REPO}`);

  if (dryRun) {
    console.log('(dry-run mode — no changes will be made)\n');
  }

  let added = 0;
  let errors = 0;

  for (const issue of openIssues) {
    try {
      const ok = await syncIssue(octokit, {
        projectId,
        priorityFieldId,
        statusFieldId,
        priorityOptions,
        statusOptions,
        issue,
        dryRun,
      });
      if (ok) {
        added += 1;
      } else {
        errors += 1;
      }
    } catch (err) {
      console.log(`  ERROR #${issue.number}: ${err.message}`);
      errors += 1;
    }
  }

  console.log(`\nDone: ${added} added, ${errors} errors`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
