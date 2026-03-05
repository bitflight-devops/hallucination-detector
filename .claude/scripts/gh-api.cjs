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
// PR Reviews
// ---------------------------------------------------------------------------

/**
 * List all reviews for a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 */
async function reviewList(octokit, prStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const all = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: OWNER,
    repo: REPO,
    pull_number,
    per_page: 100,
  });

  const reviews = all.map((r) => ({
    id: r.id,
    user: r.user?.login ?? null,
    state: r.state,
    submitted_at: r.submitted_at,
    body: r.body && r.body.length > 200 ? `${r.body.slice(0, 200)}…` : r.body,
  }));

  console.log(JSON.stringify(reviews, null, 2));
}

/**
 * Show a single review on a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 * @param {string} reviewStr - Review ID as a string from argv.
 */
async function reviewView(octokit, prStr, reviewStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const review_id = Number.parseInt(reviewStr, 10);
  if (Number.isNaN(review_id)) {
    console.error(`ERROR: invalid review ID '${reviewStr}'`);
    process.exit(1);
  }

  const { data } = await octokit.rest.pulls.getReview({
    owner: OWNER,
    repo: REPO,
    pull_number,
    review_id,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        user: data.user?.login ?? null,
        state: data.state,
        body: data.body,
        submitted_at: data.submitted_at,
        html_url: data.html_url,
        commit_id: data.commit_id,
      },
      null,
      2,
    ),
  );
}

/**
 * Submit a new review on a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 */
async function reviewSubmit(octokit, prStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const event = getArg('--event');
  if (!event) {
    console.error('ERROR: --event is required for review submit (APPROVE|REQUEST_CHANGES|COMMENT)');
    process.exit(1);
  }

  const validEvents = ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'];
  if (!validEvents.includes(event)) {
    console.error(`ERROR: --event must be one of: ${validEvents.join(', ')}`);
    process.exit(1);
  }

  const body = getArg('--body') ?? undefined;

  const { data } = await octokit.rest.pulls.createReview({
    owner: OWNER,
    repo: REPO,
    pull_number,
    event,
    body,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        user: data.user?.login ?? null,
        state: data.state,
        submitted_at: data.submitted_at,
        html_url: data.html_url,
      },
      null,
      2,
    ),
  );
}

/**
 * Dismiss a review on a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 * @param {string} reviewStr - Review ID as a string from argv.
 */
async function reviewDismiss(octokit, prStr, reviewStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const review_id = Number.parseInt(reviewStr, 10);
  if (Number.isNaN(review_id)) {
    console.error(`ERROR: invalid review ID '${reviewStr}'`);
    process.exit(1);
  }

  const message = getArg('--message');
  if (!message) {
    console.error('ERROR: --message is required for review dismiss');
    process.exit(1);
  }

  const { data } = await octokit.rest.pulls.dismissReview({
    owner: OWNER,
    repo: REPO,
    pull_number,
    review_id,
    message,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        state: data.state,
        submitted_at: data.submitted_at,
        html_url: data.html_url,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// PR Review Comments (code annotations)
// ---------------------------------------------------------------------------

/**
 * List all review comments on a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 */
async function reviewCommentList(octokit, prStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const all = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner: OWNER,
    repo: REPO,
    pull_number,
    per_page: 100,
  });

  const comments = all.map((c) => ({
    id: c.id,
    user: c.user?.login ?? null,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    body: c.body && c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body,
    created_at: c.created_at,
    in_reply_to_id: c.in_reply_to_id ?? null,
  }));

  console.log(JSON.stringify(comments, null, 2));
}

/**
 * Show a single review comment.
 * @param {import('octokit').Octokit} octokit
 * @param {string} commentStr - Comment ID as a string from argv.
 */
async function reviewCommentView(octokit, commentStr) {
  const comment_id = Number.parseInt(commentStr, 10);
  if (Number.isNaN(comment_id)) {
    console.error(`ERROR: invalid comment ID '${commentStr}'`);
    process.exit(1);
  }

  const { data } = await octokit.rest.pulls.getReviewComment({
    owner: OWNER,
    repo: REPO,
    comment_id,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        user: data.user?.login ?? null,
        path: data.path,
        line: data.line ?? null,
        original_line: data.original_line ?? null,
        diff_hunk: data.diff_hunk,
        body: data.body,
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
        in_reply_to_id: data.in_reply_to_id ?? null,
      },
      null,
      2,
    ),
  );
}

/**
 * Reply to an existing review comment on a pull request.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 * @param {string} commentStr - Comment ID as a string from argv.
 */
async function reviewCommentReply(octokit, prStr, commentStr) {
  const pull_number = Number.parseInt(prStr, 10);
  if (Number.isNaN(pull_number)) {
    console.error(`ERROR: invalid PR number '${prStr}'`);
    process.exit(1);
  }

  const comment_id = Number.parseInt(commentStr, 10);
  if (Number.isNaN(comment_id)) {
    console.error(`ERROR: invalid comment ID '${commentStr}'`);
    process.exit(1);
  }

  const body = getArg('--body');
  if (!body) {
    console.error('ERROR: --body is required for review-comment reply');
    process.exit(1);
  }

  const { data } = await octokit.rest.pulls.createReplyForReviewComment({
    owner: OWNER,
    repo: REPO,
    pull_number,
    comment_id,
    body,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        user: data.user?.login ?? null,
        path: data.path,
        body: data.body,
        created_at: data.created_at,
        html_url: data.html_url,
        in_reply_to_id: data.in_reply_to_id ?? null,
      },
      null,
      2,
    ),
  );
}

// ---------------------------------------------------------------------------
// CI Checks
// ---------------------------------------------------------------------------

/**
 * List check runs for a PR number or git ref/SHA.
 * @param {import('octokit').Octokit} octokit
 * @param {string} prOrRef - PR number or git ref/SHA from argv.
 */
async function checksList(octokit, prOrRef) {
  let ref = prOrRef;

  const prNumber = Number.parseInt(prOrRef, 10);
  if (!Number.isNaN(prNumber)) {
    ref = `refs/pull/${prNumber}/merge`;
  }

  const all = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner: OWNER,
    repo: REPO,
    ref,
  });

  const runs = all.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    started_at: r.started_at,
    completed_at: r.completed_at,
    html_url: r.html_url,
  }));

  console.log(JSON.stringify(runs, null, 2));
}

/**
 * Show details of a single check run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} checkRunStr - Check run ID as a string from argv.
 */
async function checksView(octokit, checkRunStr) {
  const check_run_id = Number.parseInt(checkRunStr, 10);
  if (Number.isNaN(check_run_id)) {
    console.error(`ERROR: invalid check run ID '${checkRunStr}'`);
    process.exit(1);
  }

  const { data } = await octokit.rest.checks.get({
    owner: OWNER,
    repo: REPO,
    check_run_id,
  });

  const summary = data.output?.summary ?? null;

  console.log(
    JSON.stringify(
      {
        id: data.id,
        name: data.name,
        status: data.status,
        conclusion: data.conclusion,
        output: {
          title: data.output?.title ?? null,
          summary: summary && summary.length > 500 ? `${summary.slice(0, 500)}…` : summary,
        },
        started_at: data.started_at,
        completed_at: data.completed_at,
        html_url: data.html_url,
      },
      null,
      2,
    ),
  );
}

/**
 * List annotations for a check run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} checkRunStr - Check run ID as a string from argv.
 */
async function checksAnnotations(octokit, checkRunStr) {
  const check_run_id = Number.parseInt(checkRunStr, 10);
  if (Number.isNaN(check_run_id)) {
    console.error(`ERROR: invalid check run ID '${checkRunStr}'`);
    process.exit(1);
  }

  const all = await octokit.paginate(octokit.rest.checks.listAnnotations, {
    owner: OWNER,
    repo: REPO,
    check_run_id,
    per_page: 100,
  });

  const annotations = all.map((a) => ({
    path: a.path,
    start_line: a.start_line,
    end_line: a.end_line,
    annotation_level: a.annotation_level,
    message: a.message,
    title: a.title ?? null,
  }));

  console.log(JSON.stringify(annotations, null, 2));
}

// ---------------------------------------------------------------------------
// CI Workflow Runs
// ---------------------------------------------------------------------------

/**
 * List recent workflow runs for the repository.
 * @param {import('octokit').Octokit} octokit
 */
async function runList(octokit) {
  const limitStr = getArg('--limit');
  const per_page = limitStr ? Number.parseInt(limitStr, 10) : 10;
  if (Number.isNaN(per_page)) {
    console.error(`ERROR: invalid --limit value '${limitStr}'`);
    process.exit(1);
  }

  const status = getArg('--status') ?? undefined;

  const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
    owner: OWNER,
    repo: REPO,
    per_page,
    status,
  });

  const runs = data.workflow_runs.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    head_branch: r.head_branch,
    event: r.event,
    created_at: r.created_at,
    html_url: r.html_url,
  }));

  console.log(JSON.stringify(runs, null, 2));
}

/**
 * Show details of a single workflow run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runView(octokit, runStr) {
  const run_id = Number.parseInt(runStr, 10);
  if (Number.isNaN(run_id)) {
    console.error(`ERROR: invalid run ID '${runStr}'`);
    process.exit(1);
  }

  const { data } = await octokit.rest.actions.getWorkflowRun({
    owner: OWNER,
    repo: REPO,
    run_id,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        name: data.name,
        status: data.status,
        conclusion: data.conclusion,
        head_branch: data.head_branch,
        head_sha: data.head_sha,
        event: data.event,
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
        run_attempt: data.run_attempt,
        run_started_at: data.run_started_at,
      },
      null,
      2,
    ),
  );
}

/**
 * Rerun a workflow run (full or failed jobs only).
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runRerun(octokit, runStr) {
  const run_id = Number.parseInt(runStr, 10);
  if (Number.isNaN(run_id)) {
    console.error(`ERROR: invalid run ID '${runStr}'`);
    process.exit(1);
  }

  const failedOnly = args.includes('--failed-only');

  if (failedOnly) {
    await octokit.rest.actions.reRunWorkflowFailedJobs({
      owner: OWNER,
      repo: REPO,
      run_id,
    });
  } else {
    await octokit.rest.actions.reRunWorkflow({
      owner: OWNER,
      repo: REPO,
      run_id,
    });
  }

  console.log(
    JSON.stringify({ id: run_id, status: 'pending', message: 'Rerun triggered' }, null, 2),
  );
}

/**
 * List jobs and steps for a workflow run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runLogs(octokit, runStr) {
  const run_id = Number.parseInt(runStr, 10);
  if (Number.isNaN(run_id)) {
    console.error(`ERROR: invalid run ID '${runStr}'`);
    process.exit(1);
  }

  const all = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
    owner: OWNER,
    repo: REPO,
    run_id,
    per_page: 100,
  });

  const jobs = all.map((j) => ({
    id: j.id,
    name: j.name,
    status: j.status,
    conclusion: j.conclusion,
    steps: (j.steps ?? []).map((s) => ({
      name: s.name,
      status: s.status,
      conclusion: s.conclusion,
    })),
  }));

  console.log(JSON.stringify(jobs, null, 2));
}

/**
 * Cancel a workflow run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runCancel(octokit, runStr) {
  const run_id = Number.parseInt(runStr, 10);
  if (Number.isNaN(run_id)) {
    console.error(`ERROR: invalid run ID '${runStr}'`);
    process.exit(1);
  }

  await octokit.rest.actions.cancelWorkflowRun({
    owner: OWNER,
    repo: REPO,
    run_id,
  });

  console.log(JSON.stringify({ id: run_id, message: 'Run cancelled' }, null, 2));
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
        '  label create --name "..." --color "rrggbb" [--description "..."]\n' +
        '  review list <pr-number>\n' +
        '  review view <pr-number> <review-id>\n' +
        '  review submit <pr-number> --event <APPROVE|REQUEST_CHANGES|COMMENT> [--body "..."]\n' +
        '  review dismiss <pr-number> <review-id> --message "..."\n' +
        '  review-comment list <pr-number>\n' +
        '  review-comment view <comment-id>\n' +
        '  review-comment reply <pr-number> <comment-id> --body "..."\n' +
        '  checks list <pr-number-or-ref>\n' +
        '  checks view <check-run-id>\n' +
        '  checks annotations <check-run-id>\n' +
        '  run list [--limit 10] [--status <queued|in_progress|completed>]\n' +
        '  run view <run-id>\n' +
        '  run rerun <run-id> [--failed-only]\n' +
        '  run logs <run-id>\n' +
        '  run cancel <run-id>',
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
  } else if (resource === 'review') {
    if (action === 'list') {
      const [prStr] = rest;
      if (!prStr) {
        console.error('ERROR: review list requires a PR number');
        process.exit(1);
      }
      await reviewList(octokit, prStr);
    } else if (action === 'view') {
      const [prStr, reviewStr] = rest;
      if (!prStr || !reviewStr) {
        console.error('ERROR: review view requires a PR number and a review ID');
        process.exit(1);
      }
      await reviewView(octokit, prStr, reviewStr);
    } else if (action === 'submit') {
      const [prStr] = rest;
      if (!prStr) {
        console.error('ERROR: review submit requires a PR number');
        process.exit(1);
      }
      await reviewSubmit(octokit, prStr);
    } else if (action === 'dismiss') {
      const [prStr, reviewStr] = rest;
      if (!prStr || !reviewStr) {
        console.error('ERROR: review dismiss requires a PR number and a review ID');
        process.exit(1);
      }
      await reviewDismiss(octokit, prStr, reviewStr);
    } else {
      console.error(`ERROR: unknown review action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'review-comment') {
    if (action === 'list') {
      const [prStr] = rest;
      if (!prStr) {
        console.error('ERROR: review-comment list requires a PR number');
        process.exit(1);
      }
      await reviewCommentList(octokit, prStr);
    } else if (action === 'view') {
      const [commentStr] = rest;
      if (!commentStr) {
        console.error('ERROR: review-comment view requires a comment ID');
        process.exit(1);
      }
      await reviewCommentView(octokit, commentStr);
    } else if (action === 'reply') {
      const [prStr, commentStr] = rest;
      if (!prStr || !commentStr) {
        console.error('ERROR: review-comment reply requires a PR number and a comment ID');
        process.exit(1);
      }
      await reviewCommentReply(octokit, prStr, commentStr);
    } else {
      console.error(`ERROR: unknown review-comment action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'checks') {
    if (action === 'list') {
      const [prOrRef] = rest;
      if (!prOrRef) {
        console.error('ERROR: checks list requires a PR number or git ref');
        process.exit(1);
      }
      await checksList(octokit, prOrRef);
    } else if (action === 'view') {
      const [checkRunStr] = rest;
      if (!checkRunStr) {
        console.error('ERROR: checks view requires a check run ID');
        process.exit(1);
      }
      await checksView(octokit, checkRunStr);
    } else if (action === 'annotations') {
      const [checkRunStr] = rest;
      if (!checkRunStr) {
        console.error('ERROR: checks annotations requires a check run ID');
        process.exit(1);
      }
      await checksAnnotations(octokit, checkRunStr);
    } else {
      console.error(`ERROR: unknown checks action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'run') {
    if (action === 'list') {
      await runList(octokit);
    } else if (action === 'view') {
      const [runStr] = rest;
      if (!runStr) {
        console.error('ERROR: run view requires a run ID');
        process.exit(1);
      }
      await runView(octokit, runStr);
    } else if (action === 'rerun') {
      const [runStr] = rest;
      if (!runStr) {
        console.error('ERROR: run rerun requires a run ID');
        process.exit(1);
      }
      await runRerun(octokit, runStr);
    } else if (action === 'logs') {
      const [runStr] = rest;
      if (!runStr) {
        console.error('ERROR: run logs requires a run ID');
        process.exit(1);
      }
      await runLogs(octokit, runStr);
    } else if (action === 'cancel') {
      const [runStr] = rest;
      if (!runStr) {
        console.error('ERROR: run cancel requires a run ID');
        process.exit(1);
      }
      await runCancel(octokit, runStr);
    } else {
      console.error(`ERROR: unknown run action '${action}'`);
      process.exit(1);
    }
  } else {
    console.error(
      `ERROR: unknown resource '${resource}' — expected: issue, pr, label, review, review-comment, checks, run`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
