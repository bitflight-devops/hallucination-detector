#!/usr/bin/env node
'use strict';

/**
 * General-purpose GitHub API script for ad-hoc operations.
 *
 * Subcommands:
 *   issue list                                          — list open issues
 *   issue create --title "..." [--label "..."] [--body "..."]
 *                                                       — create an issue
 *   issue view <number>                                 — show issue details
 *   issue comment <number> --body "..."                 — add a comment
 *   pr list                                             — list open pull requests
 *   pr create --title "..." --body "..."                — create a pull request
 *   label list                                          — list all labels
 *   label create --name "..." --color "rrggbb" [--description "..."]
 *                                                       — create a label
 *
 * All successful output is written as JSON to stdout.
 * Errors go to stderr with exit code 1.
 *
 * Required env vars:
 *   GITHUB_TOKEN — GitHub personal access token with repo scope
 */

const { createGitHubClient, OWNER, REPO } = require('./lib/github-client.cjs');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

/**
 * Return the value of a named CLI argument, or null if not present.
 * @param {string} name - Argument name including leading dashes, e.g. '--title'
 * @returns {string|null}
 */
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

/**
 * Collect all values for a repeatable argument (e.g. --label can appear multiple times).
 * @param {string} name - Argument name including leading dashes.
 * @returns {string[]}
 */
function getArgAll(name) {
  const values = [];
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === name) {
      values.push(args[i + 1]);
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

/**
 * List open issues (excludes pull requests).
 * @param {import('octokit').Octokit} octokit
 */
async function issueList(octokit) {
  const all = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    state: 'open',
    per_page: 100,
  });

  const issues = all
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      created_at: i.created_at,
      html_url: i.html_url,
    }));

  console.log(JSON.stringify(issues, null, 2));
}

/**
 * Create a new issue.
 * @param {import('octokit').Octokit} octokit
 */
async function issueCreate(octokit) {
  const title = getArg('--title');
  if (!title) {
    console.error('ERROR: --title is required for issue create');
    process.exit(1);
  }

  const body = getArg('--body') ?? undefined;
  const labels = getArgAll('--label');

  const { data } = await octokit.rest.issues.create({
    owner: OWNER,
    repo: REPO,
    title,
    body,
    labels: labels.length > 0 ? labels : undefined,
  });

  console.log(
    JSON.stringify(
      {
        number: data.number,
        title: data.title,
        html_url: data.html_url,
        state: data.state,
      },
      null,
      2,
    ),
  );
}

/**
 * Show details of a single issue.
 * @param {import('octokit').Octokit} octokit
 * @param {string} numberStr - Issue number as a string from argv.
 */
async function issueView(octokit, numberStr) {
  const issueNumber = Number.parseInt(numberStr, 10);
  if (Number.isNaN(issueNumber)) {
    console.error(`ERROR: invalid issue number '${numberStr}'`);
    process.exit(1);
  }

  const { data } = await octokit.rest.issues.get({
    owner: OWNER,
    repo: REPO,
    issue_number: issueNumber,
  });

  console.log(
    JSON.stringify(
      {
        number: data.number,
        title: data.title,
        state: data.state,
        body: data.body,
        labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name)),
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
      },
      null,
      2,
    ),
  );
}

/**
 * Add a comment to an issue.
 * @param {import('octokit').Octokit} octokit
 * @param {string} numberStr - Issue number as a string from argv.
 */
async function issueComment(octokit, numberStr) {
  const issueNumber = Number.parseInt(numberStr, 10);
  if (Number.isNaN(issueNumber)) {
    console.error(`ERROR: invalid issue number '${numberStr}'`);
    process.exit(1);
  }

  const body = getArg('--body');
  if (!body) {
    console.error('ERROR: --body is required for issue comment');
    process.exit(1);
  }

  const { data } = await octokit.rest.issues.createComment({
    owner: OWNER,
    repo: REPO,
    issue_number: issueNumber,
    body,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        html_url: data.html_url,
        created_at: data.created_at,
      },
      null,
      2,
    ),
  );
}

/**
 * List open pull requests.
 * @param {import('octokit').Octokit} octokit
 */
async function prList(octokit) {
  const all = await octokit.paginate(octokit.rest.pulls.list, {
    owner: OWNER,
    repo: REPO,
    state: 'open',
    per_page: 100,
  });

  const prs = all.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    head: p.head.ref,
    base: p.base.ref,
    created_at: p.created_at,
    html_url: p.html_url,
  }));

  console.log(JSON.stringify(prs, null, 2));
}

/**
 * Create a pull request. Delegates arg resolution and branch detection to the
 * same logic used by create-pr.cjs, but inlined here to avoid exec overhead.
 * @param {import('octokit').Octokit} octokit
 */
async function prCreate(octokit) {
  const { execSync } = require('node:child_process');

  const title = getArg('--title');
  if (!title) {
    console.error('ERROR: --title is required for pr create');
    process.exit(1);
  }

  const base = getArg('--base') ?? 'main';
  const body = getArg('--body') ?? '';
  const head = execSync('git branch --show-current', { encoding: 'utf8' }).trim();

  if (!head) {
    console.error('ERROR: could not detect current branch (detached HEAD?)');
    process.exit(1);
  }

  const { data } = await octokit.rest.pulls.create({
    owner: OWNER,
    repo: REPO,
    title,
    head,
    base,
    body,
  });

  console.log(
    JSON.stringify(
      {
        number: data.number,
        title: data.title,
        html_url: data.html_url,
        state: data.state,
        head: data.head.ref,
        base: data.base.ref,
      },
      null,
      2,
    ),
  );
}

/**
 * List all repository labels.
 * @param {import('octokit').Octokit} octokit
 */
async function labelList(octokit) {
  const all = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
    owner: OWNER,
    repo: REPO,
    per_page: 100,
  });

  const labels = all.map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description,
  }));

  console.log(JSON.stringify(labels, null, 2));
}

/**
 * Create a new repository label.
 * @param {import('octokit').Octokit} octokit
 */
async function labelCreate(octokit) {
  const name = getArg('--name');
  const color = getArg('--color');

  if (!name) {
    console.error('ERROR: --name is required for label create');
    process.exit(1);
  }
  if (!color) {
    console.error('ERROR: --color is required for label create (hex without #, e.g. ff0000)');
    process.exit(1);
  }

  const description = getArg('--description') ?? undefined;

  const { data } = await octokit.rest.issues.createLabel({
    owner: OWNER,
    repo: REPO,
    name,
    color,
    description,
  });

  console.log(
    JSON.stringify(
      {
        name: data.name,
        color: data.color,
        description: data.description,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Parse top-level subcommand and delegate to the appropriate handler.
 */
async function main() {
  const [resource, action, ...rest] = args;

  if (!resource || !action) {
    console.error(
      'Usage: gh-api.cjs <resource> <action> [options]\n' +
        '  issue list\n' +
        '  issue create --title "..." [--label "..."] [--body "..."]\n' +
        '  issue view <number>\n' +
        '  issue comment <number> --body "..."\n' +
        '  pr list\n' +
        '  pr create --title "..." [--base main] [--body "..."]\n' +
        '  label list\n' +
        '  label create --name "..." --color "rrggbb" [--description "..."]',
    );
    process.exit(1);
  }

  const octokit = createGitHubClient();

  if (resource === 'issue') {
    if (action === 'list') {
      await issueList(octokit);
    } else if (action === 'create') {
      await issueCreate(octokit);
    } else if (action === 'view') {
      const [numberStr] = rest;
      if (!numberStr) {
        console.error('ERROR: issue view requires an issue number');
        process.exit(1);
      }
      await issueView(octokit, numberStr);
    } else if (action === 'comment') {
      const [numberStr] = rest;
      if (!numberStr) {
        console.error('ERROR: issue comment requires an issue number');
        process.exit(1);
      }
      await issueComment(octokit, numberStr);
    } else {
      console.error(`ERROR: unknown issue action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'pr') {
    if (action === 'list') {
      await prList(octokit);
    } else if (action === 'create') {
      await prCreate(octokit);
    } else {
      console.error(`ERROR: unknown pr action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'label') {
    if (action === 'list') {
      await labelList(octokit);
    } else if (action === 'create') {
      await labelCreate(octokit);
    } else {
      console.error(`ERROR: unknown label action '${action}'`);
      process.exit(1);
    }
  } else {
    console.error(`ERROR: unknown resource '${resource}' — expected: issue, pr, label`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
