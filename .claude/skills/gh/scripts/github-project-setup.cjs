#!/usr/bin/env node
'use strict';

/**
 * GitHub project management automation — labels, milestones, and issues.
 *
 * Usage:
 *   node .claude/skills/gh/scripts/github-project-setup.cjs labels [--force]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs milestone list
 *   node .claude/skills/gh/scripts/github-project-setup.cjs milestone create --title "..." [--due YYYY-MM-DD] [--description "..."]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number N [--dry-run]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs milestone close --number N [--dry-run]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs issue list [--priority p1] [--state open]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs issue create --title "..." [--body "..."] [--priority-label "..."] [--type-label "..."] [--milestone N]
 *   node .claude/skills/gh/scripts/github-project-setup.cjs setup
 *
 * Required env vars:
 *   GITHUB_TOKEN — GitHub personal access token with repo scope
 */

const { createGitHubClient, OWNER, REPO } = require('../../../scripts/lib/github-client.cjs');

// ---------------------------------------------------------------------------
// CLI argument helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

/**
 * Return true if a boolean flag is present in the argument list.
 *
 * @param {string} name - Flag name including leading dashes (e.g. '--force').
 * @returns {boolean}
 */
function getFlag(name) {
  return args.includes(name);
}

/**
 * Return the value of a named option from the argument list, or null if absent.
 *
 * @param {string} name - Option name including leading dashes (e.g. '--title').
 * @returns {string|null}
 */
function getOption(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

// ---------------------------------------------------------------------------
// Label taxonomy
// ---------------------------------------------------------------------------

/** @typedef {{ name: string, color: string, description: string }} LabelDef */

/** @type {LabelDef[]} */
const LABELS = [
  // Priority
  { name: 'priority:p0', color: 'D73A4A', description: 'Critical — blocks work or production' },
  { name: 'priority:p1', color: 'E99695', description: 'High — should be done next' },
  { name: 'priority:p2', color: 'F9D0C4', description: 'Medium — do when P0/P1 are clear' },
  { name: 'priority:idea', color: 'BFD4F2', description: 'Unscoped — future consideration' },
  // Type
  { name: 'type:feature', color: '0E8A16', description: 'New capability' },
  { name: 'type:bug', color: 'B60205', description: 'Something is broken' },
  {
    name: 'type:refactor',
    color: '5319E7',
    description: 'Internal improvement, no behavior change',
  },
  { name: 'type:docs', color: '0075CA', description: 'Documentation only' },
  { name: 'type:chore', color: 'EDEDED', description: 'Maintenance, tooling, CI' },
  // Status
  { name: 'status:in-progress', color: '1D76DB', description: 'Actively being worked on' },
  { name: 'status:done', color: '0E8A16', description: 'Work complete, milestone closing' },
  { name: 'status:blocked', color: 'B60205', description: 'Waiting on external dependency' },
  { name: 'status:needs-grooming', color: 'FEF2C0', description: 'Captured but not yet groomed' },
  {
    name: 'status:needs-review',
    color: 'D876E3',
    description: 'Implementation done, needs review',
  },
];

// ---------------------------------------------------------------------------
// Labels command
// ---------------------------------------------------------------------------

/**
 * Create or update the standard label taxonomy on the repository.
 *
 * Fetches existing labels, then for each defined label:
 * - If the label does not exist, creates it.
 * - If the label exists and --force is set, updates it.
 * - If the label exists and --force is not set, skips it.
 *
 * Prints a summary line followed by per-label detail lines.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {boolean} force - When true, update existing labels to match the defined taxonomy.
 * @returns {Promise<void>}
 */
async function runLabels(octokit, force) {
  const existing = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
    owner: OWNER,
    repo: REPO,
    per_page: 100,
  });

  /** @type {Map<string, { id: number, color: string, description: string }>} */
  const existingMap = new Map(
    existing.map((l) => [
      l.name.toLowerCase(),
      { id: l.id, color: l.color, description: l.description ?? '' },
    ]),
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  /** @type {Array<{ status: string, name: string, note?: string }>} */
  const lines = [];

  for (const label of LABELS) {
    const key = label.name.toLowerCase();
    const existing_ = existingMap.get(key);

    if (!existing_) {
      await octokit.rest.issues.createLabel({
        owner: OWNER,
        repo: REPO,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      created += 1;
      lines.push({ status: 'created', name: label.name });
    } else if (force) {
      await octokit.rest.issues.updateLabel({
        owner: OWNER,
        repo: REPO,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      updated += 1;
      lines.push({ status: 'updated', name: label.name });
    } else {
      skipped += 1;
      lines.push({ status: 'exists', name: label.name, note: '--force to update' });
    }
  }

  console.log(`Labels: ${created} created, ${updated} updated, ${skipped} skipped`);
  for (const line of lines) {
    const note = line.note ? `  (${line.note})` : '';
    console.log(`  ${line.status.padEnd(8)} ${line.name}${note}`);
  }
}

// ---------------------------------------------------------------------------
// Milestone commands
// ---------------------------------------------------------------------------

/**
 * Print all milestones (open and closed) to stdout.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @returns {Promise<void>}
 */
async function runMilestoneList(octokit) {
  const milestones = await octokit.paginate(octokit.rest.issues.listMilestones, {
    owner: OWNER,
    repo: REPO,
    state: 'all',
    per_page: 100,
  });

  if (milestones.length === 0) {
    console.log('No milestones found.');
    return;
  }

  console.log(`Milestones (${milestones.length}):`);
  for (const m of milestones) {
    const due = m.due_on ? ` due ${m.due_on.slice(0, 10)}` : '';
    const open = m.open_issues;
    const closed = m.closed_issues;
    console.log(`  #${m.number} [${m.state}]${due}  ${open} open / ${closed} closed — ${m.title}`);
  }
}

/**
 * Create a new milestone.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {string} title - Milestone title (required).
 * @param {string|null} due - ISO date string YYYY-MM-DD, or null.
 * @param {string|null} description - Milestone description, or null.
 * @returns {Promise<void>}
 */
async function runMilestoneCreate(octokit, title, due, description) {
  /** @type {Record<string, string>} */
  const params = { owner: OWNER, repo: REPO, title };
  if (due) {
    params.due_on = `${due}T00:00:00Z`;
  }
  if (description) {
    params.description = description;
  }

  const { data: milestone } = await octokit.rest.issues.createMilestone(params);
  console.log(`Created milestone #${milestone.number}: ${milestone.title}`);
  if (milestone.due_on) {
    console.log(`  Due: ${milestone.due_on.slice(0, 10)}`);
  }
}

/**
 * Transition open issues in a milestone from status:needs-grooming to status:in-progress.
 *
 * Removes the 'status:needs-grooming' label and adds 'status:in-progress' to each
 * open issue in the milestone that carries the grooming label. Issues without the
 * grooming label are skipped.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {number} milestoneNumber - Milestone number.
 * @param {boolean} dryRun - When true, log intended actions without making changes.
 * @returns {Promise<void>}
 */
async function runMilestoneStart(octokit, milestoneNumber, dryRun) {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    milestone: milestoneNumber,
    state: 'open',
    per_page: 100,
  });

  const targets = issues.filter(
    (i) => !i.pull_request && i.labels.some((l) => l.name === 'status:needs-grooming'),
  );

  if (dryRun) {
    console.log(
      `(dry-run) Milestone #${milestoneNumber} start — ${targets.length} issue(s) would transition`,
    );
  } else {
    console.log(`Milestone #${milestoneNumber} start — transitioning ${targets.length} issue(s)`);
  }

  for (const issue of targets) {
    const currentLabels = issue.labels
      .map((l) => l.name)
      .filter((n) => n !== 'status:needs-grooming');
    const newLabels = [...currentLabels, 'status:in-progress'];

    if (dryRun) {
      console.log(`  WOULD UPDATE #${issue.number}: ${issue.title}`);
    } else {
      await octokit.rest.issues.setLabels({
        owner: OWNER,
        repo: REPO,
        issue_number: issue.number,
        labels: newLabels,
      });
      console.log(`  UPDATED #${issue.number}: ${issue.title}`);
    }
  }
}

/**
 * Transition open issues in a milestone to status:done, then close the milestone.
 *
 * For each open issue in the milestone: removes 'status:in-progress' and
 * 'status:needs-grooming', then adds 'status:done'. After all issues are updated,
 * closes the milestone itself.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {number} milestoneNumber - Milestone number.
 * @param {boolean} dryRun - When true, log intended actions without making changes.
 * @returns {Promise<void>}
 */
async function runMilestoneClose(octokit, milestoneNumber, dryRun) {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    milestone: milestoneNumber,
    state: 'open',
    per_page: 100,
  });

  const openIssues = issues.filter((i) => !i.pull_request);

  if (dryRun) {
    console.log(
      `(dry-run) Milestone #${milestoneNumber} close — ${openIssues.length} issue(s) would transition`,
    );
  } else {
    console.log(
      `Milestone #${milestoneNumber} close — transitioning ${openIssues.length} issue(s)`,
    );
  }

  const REMOVE = new Set(['status:in-progress', 'status:needs-grooming']);

  for (const issue of openIssues) {
    const currentLabels = issue.labels.map((l) => l.name).filter((n) => !REMOVE.has(n));
    const newLabels = [...currentLabels, 'status:done'];

    if (dryRun) {
      console.log(`  WOULD UPDATE #${issue.number}: ${issue.title}`);
    } else {
      await octokit.rest.issues.setLabels({
        owner: OWNER,
        repo: REPO,
        issue_number: issue.number,
        labels: newLabels,
      });
      console.log(`  UPDATED #${issue.number}: ${issue.title}`);
    }
  }

  if (dryRun) {
    console.log(`  WOULD CLOSE milestone #${milestoneNumber}`);
  } else {
    await octokit.rest.issues.updateMilestone({
      owner: OWNER,
      repo: REPO,
      milestone_number: milestoneNumber,
      state: 'closed',
    });
    console.log(`  CLOSED milestone #${milestoneNumber}`);
  }
}

// ---------------------------------------------------------------------------
// Issue commands
// ---------------------------------------------------------------------------

/**
 * List issues with optional label and state filtering.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {string|null} priority - Priority label value (e.g. 'p1'), or null for no filter.
 * @param {string} state - Issue state: 'open', 'closed', or 'all'. Defaults to 'open'.
 * @returns {Promise<void>}
 */
async function runIssueList(octokit, priority, state) {
  /** @type {Record<string, string | number>} */
  const params = {
    owner: OWNER,
    repo: REPO,
    state: state ?? 'open',
    per_page: 100,
  };

  if (priority) {
    params.labels = `priority:${priority}`;
  }

  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, params);
  const filtered = issues.filter((i) => !i.pull_request);

  if (filtered.length === 0) {
    console.log('No issues found.');
    return;
  }

  console.log(`Issues (${filtered.length}):`);
  for (const issue of filtered) {
    const labelNames = issue.labels.map((l) => l.name).join(', ');
    const milestone = issue.milestone ? ` [M#${issue.milestone.number}]` : '';
    console.log(`  #${issue.number}${milestone} ${issue.title}`);
    if (labelNames) {
      console.log(`    labels: ${labelNames}`);
    }
  }
}

/**
 * Create a new issue with optional labels and milestone assignment.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @param {string} title - Issue title (required).
 * @param {string|null} body - Issue body text, or null.
 * @param {string|null} priorityLabel - Full priority label name (e.g. 'priority:p1'), or null.
 * @param {string|null} typeLabel - Full type label name (e.g. 'type:feature'), or null.
 * @param {number|null} milestone - Milestone number, or null.
 * @returns {Promise<void>}
 */
async function runIssueCreate(octokit, title, body, priorityLabel, typeLabel, milestone) {
  /** @type {string[]} */
  const labels = [];
  if (priorityLabel) labels.push(priorityLabel);
  if (typeLabel) labels.push(typeLabel);

  /** @type {Record<string, unknown>} */
  const params = { owner: OWNER, repo: REPO, title };
  if (body) params.body = body;
  if (labels.length > 0) params.labels = labels;
  if (milestone != null) params.milestone = milestone;

  const { data: issue } = await octokit.rest.issues.create(params);
  console.log(`Created issue #${issue.number}: ${issue.title}`);
  console.log(`  URL: ${issue.html_url}`);
  if (labels.length > 0) {
    console.log(`  Labels: ${labels.join(', ')}`);
  }
  if (milestone != null) {
    console.log(`  Milestone: #${milestone}`);
  }
}

// ---------------------------------------------------------------------------
// Setup command
// ---------------------------------------------------------------------------

/**
 * Run initial repository setup: create labels, then print next-steps instructions.
 *
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client.
 * @returns {Promise<void>}
 */
async function runSetup(octokit) {
  console.log(`Setting up ${OWNER}/${REPO}...\n`);

  console.log('Step 1: Creating labels');
  await runLabels(octokit, false);

  console.log('\nSetup complete. Next steps:');
  console.log('  1. Create milestones:');
  console.log(
    '       node github-project-setup.cjs milestone create --title "v1.0" --due 2026-04-01',
  );
  console.log('  2. Start a milestone sprint (transitions needs-grooming → in-progress):');
  console.log('       node github-project-setup.cjs milestone start --number 1');
  console.log('  3. Close a milestone sprint (transitions in-progress → done, closes milestone):');
  console.log('       node github-project-setup.cjs milestone close --number 1');
  console.log('  4. Create issues with labels:');
  console.log(
    '       node github-project-setup.cjs issue create --title "My feature" --priority-label priority:p1 --type-label type:feature',
  );
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Print usage information to stderr and exit with code 1.
 *
 * @param {string} [message] - Optional error message to print before usage.
 */
function usage(message) {
  if (message) {
    console.error(`ERROR: ${message}\n`);
  }
  console.error('Usage:');
  console.error('  github-project-setup.cjs labels [--force]');
  console.error('  github-project-setup.cjs milestone list');
  console.error(
    '  github-project-setup.cjs milestone create --title "..." [--due YYYY-MM-DD] [--description "..."]',
  );
  console.error('  github-project-setup.cjs milestone start --number N [--dry-run]');
  console.error('  github-project-setup.cjs milestone close --number N [--dry-run]');
  console.error('  github-project-setup.cjs issue list [--priority p1] [--state open|closed|all]');
  console.error(
    '  github-project-setup.cjs issue create --title "..." [--body "..."] [--priority-label "..."] [--type-label "..."] [--milestone N]',
  );
  console.error('  github-project-setup.cjs setup');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Entry point. Parses CLI arguments, authenticates with GitHub, and dispatches
 * to the appropriate command handler.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const octokit = createGitHubClient();

  if (command === 'labels') {
    const force = getFlag('--force');
    await runLabels(octokit, force);
    return;
  }

  if (command === 'milestone') {
    if (subcommand === 'list') {
      await runMilestoneList(octokit);
      return;
    }

    if (subcommand === 'create') {
      const title = getOption('--title');
      if (!title) {
        usage('milestone create requires --title');
      }
      const due = getOption('--due');
      const description = getOption('--description');
      await runMilestoneCreate(octokit, title, due, description);
      return;
    }

    if (subcommand === 'start') {
      const numberStr = getOption('--number');
      if (!numberStr) {
        usage('milestone start requires --number');
      }
      const milestoneNumber = Number.parseInt(numberStr, 10);
      if (Number.isNaN(milestoneNumber)) {
        usage(`--number must be an integer, got: ${numberStr}`);
      }
      const dryRun = getFlag('--dry-run');
      await runMilestoneStart(octokit, milestoneNumber, dryRun);
      return;
    }

    if (subcommand === 'close') {
      const numberStr = getOption('--number');
      if (!numberStr) {
        usage('milestone close requires --number');
      }
      const milestoneNumber = Number.parseInt(numberStr, 10);
      if (Number.isNaN(milestoneNumber)) {
        usage(`--number must be an integer, got: ${numberStr}`);
      }
      const dryRun = getFlag('--dry-run');
      await runMilestoneClose(octokit, milestoneNumber, dryRun);
      return;
    }

    usage(`unknown milestone subcommand: ${subcommand}`);
  }

  if (command === 'issue') {
    if (subcommand === 'list') {
      const priority = getOption('--priority');
      const state = getOption('--state') ?? 'open';
      await runIssueList(octokit, priority, state);
      return;
    }

    if (subcommand === 'create') {
      const title = getOption('--title');
      if (!title) {
        usage('issue create requires --title');
      }
      const body = getOption('--body');
      const priorityLabel = getOption('--priority-label');
      const typeLabel = getOption('--type-label');
      const milestoneStr = getOption('--milestone');
      const milestone = milestoneStr != null ? Number.parseInt(milestoneStr, 10) : null;
      if (milestoneStr != null && Number.isNaN(milestone)) {
        usage(`--milestone must be an integer, got: ${milestoneStr}`);
      }
      await runIssueCreate(octokit, title, body, priorityLabel, typeLabel, milestone);
      return;
    }

    usage(`unknown issue subcommand: ${subcommand}`);
  }

  if (command === 'setup') {
    await runSetup(octokit);
    return;
  }

  usage(command ? `unknown command: ${command}` : 'a command is required');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
