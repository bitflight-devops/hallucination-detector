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
const { createArgParser, parseIntArg, requireArg } = require('./lib/cli-args.cjs');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const { getArg, getArgAll, args } = createArgParser(process.argv.slice(2));

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
  const title = requireArg(getArg, '--title', '--title is required for issue create');

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
  const issueNumber = parseIntArg(numberStr, 'issue number');

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
  const issueNumber = parseIntArg(numberStr, 'issue number');

  const body = requireArg(getArg, '--body', '--body is required for issue comment');

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
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * List all comments on an issue or PR.
 * @param {import('octokit').Octokit} octokit
 * @param {string} numberStr - Issue/PR number as a string from argv.
 */
async function issueCommentList(octokit, numberStr) {
  const issue_number = parseIntArg(numberStr, 'issue number');
  const userFilter = getArg('--user');

  const all = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: OWNER,
    repo: REPO,
    issue_number,
    per_page: 100,
  });

  const comments = userFilter ? all.filter((c) => c.user?.login === userFilter) : all;

  const result = comments.map((c) => ({
    id: c.id,
    user: c.user?.login ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    body: c.body && c.body.length > 200 ? `${c.body.slice(0, 200)}…` : c.body,
    reactions: {
      '+1': c.reactions?.['+1'] ?? 0,
      '-1': c.reactions?.['-1'] ?? 0,
      laugh: c.reactions?.laugh ?? 0,
      confused: c.reactions?.confused ?? 0,
      heart: c.reactions?.heart ?? 0,
      hooray: c.reactions?.hooray ?? 0,
      rocket: c.reactions?.rocket ?? 0,
      eyes: c.reactions?.eyes ?? 0,
    },
  }));

  console.log(JSON.stringify(result, null, 2));
}

/**
 * View a single issue comment by its ID (full body, no truncation).
 * @param {import('octokit').Octokit} octokit
 * @param {string} commentStr - Comment ID as a string from argv.
 */
async function issueCommentView(octokit, commentStr) {
  const comment_id = parseIntArg(commentStr, 'comment ID');

  const { data } = await octokit.rest.issues.getComment({
    owner: OWNER,
    repo: REPO,
    comment_id,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        user: data.user?.login ?? null,
        created_at: data.created_at,
        updated_at: data.updated_at,
        html_url: data.html_url,
        body: data.body,
      },
      null,
      2,
    ),
  );
}

// Valid GitHub reaction content values (API-supported set).
const VALID_REACTIONS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];

/**
 * Add a reaction to an issue comment.
 * @param {import('octokit').Octokit} octokit
 * @param {string} commentStr - Comment ID as a string from argv.
 */
async function issueCommentReact(octokit, commentStr) {
  const comment_id = parseIntArg(commentStr, 'comment ID');
  const content = requireArg(
    getArg,
    '--reaction',
    '--reaction is required for issue comment react',
  );

  if (!VALID_REACTIONS.includes(content)) {
    console.error(`ERROR: --reaction must be one of: ${VALID_REACTIONS.join(', ')}`);
    process.exit(1);
  }

  const { data } = await octokit.rest.reactions.createForIssueComment({
    owner: OWNER,
    repo: REPO,
    comment_id,
    content,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        content: data.content,
        user: data.user?.login ?? null,
        created_at: data.created_at,
      },
      null,
      2,
    ),
  );
}

/**
 * Add a reaction to a pull request review comment.
 * @param {import('octokit').Octokit} octokit
 * @param {string} commentStr - Comment ID as a string from argv.
 */
async function reviewCommentReact(octokit, commentStr) {
  const comment_id = parseIntArg(commentStr, 'comment ID');
  const content = requireArg(
    getArg,
    '--reaction',
    '--reaction is required for review-comment react',
  );

  if (!VALID_REACTIONS.includes(content)) {
    console.error(`ERROR: --reaction must be one of: ${VALID_REACTIONS.join(', ')}`);
    process.exit(1);
  }

  const { data } = await octokit.rest.reactions.createForPullRequestReviewComment({
    owner: OWNER,
    repo: REPO,
    comment_id,
    content,
  });

  console.log(
    JSON.stringify(
      {
        id: data.id,
        content: data.content,
        user: data.user?.login ?? null,
        created_at: data.created_at,
      },
      null,
      2,
    ),
  );
}

/**
 * Extract a named section from a body string, trying three patterns in order:
 * ATX headings, bold text, and HTML <details><summary> blocks.
 *
 * Returns the trimmed section content, or null if no pattern matches.
 *
 * @param {string} body - The comment or review body text.
 * @param {string} sectionHeading - The section heading to search for.
 * @returns {string | null}
 */
function extractSection(body, sectionHeading) {
  const escaped = escapeRegExp(sectionHeading);

  // Pattern 1: ATX heading (## Heading)
  const atxPattern = new RegExp(
    `^#{1,6}\\s*${escaped}[^\\n]*\\n([\\s\\S]*?)(?=^#{1,6}\\s|$)`,
    'mi',
  );
  let match = body.match(atxPattern);
  if (match) return match[1].trim();

  // Pattern 2: Bold text (**Heading**)
  const boldPattern = new RegExp(
    `\\*\\*${escaped}[^*]*\\*\\*[:\\s]*\\n?([\\s\\S]*?)(?=\\*\\*[A-Z]|^#{1,6}\\s|$)`,
    'mi',
  );
  match = body.match(boldPattern);
  if (match) return match[1].trim();

  // Pattern 3: HTML <details><summary> block — emoji/whitespace allowed before heading text
  const detailsPattern = new RegExp(
    `<details>\\s*<summary>[^<]*?${escaped}[^<]*?</summary>\\s*([\\s\\S]*?)\\s*</details>`,
    'mi',
  );
  match = body.match(detailsPattern);
  if (match) {
    // Strip markdown code fences that CodeRabbit wraps content in
    let content = match[1].trim();
    content = content
      .replace(/^```[^\n]*\n?/gm, '')
      .replace(/\n?```$/gm, '')
      .trim();
    return content;
  }

  return null;
}

/**
 * Search for a specific markdown section within issue/PR comments or PR review
 * bodies by a specific user.
 *
 * Flags:
 *   --user <login>       Required. Filter by GitHub login.
 *   --section <heading>  Required. Section heading to extract.
 *   --source <source>    Optional. "comments" (default) or "reviews".
 *
 * @param {import('octokit').Octokit} octokit
 * @param {string} numberStr - Issue/PR number as a string from argv.
 */
async function issueCommentSearch(octokit, numberStr) {
  const issue_number = parseIntArg(numberStr, 'issue/PR number');
  const userFilter = getArg('--user');
  const sectionHeading = getArg('--section');
  const source = getArg('--source') ?? 'comments';

  if (!userFilter) {
    console.error('ERROR: --user is required for issue comment search');
    process.exit(1);
  }
  if (!sectionHeading) {
    console.error('ERROR: --section is required for issue comment search');
    process.exit(1);
  }
  if (source !== 'comments' && source !== 'reviews') {
    console.error("ERROR: --source must be 'comments' or 'reviews'");
    process.exit(1);
  }

  const results = [];

  if (source === 'reviews') {
    // NOTE: The pulls.listReviews endpoint does not return reaction counts.
    // Reactions are not included in review results.
    const all = await octokit.paginate(octokit.rest.pulls.listReviews, {
      owner: OWNER,
      repo: REPO,
      pull_number: issue_number,
      per_page: 100,
    });

    const userReviews = all.filter((r) => r.user?.login === userFilter);

    for (const r of userReviews) {
      const content = extractSection(r.body ?? '', sectionHeading);
      if (content !== null) {
        results.push({
          review_id: r.id,
          user: r.user?.login ?? null,
          submitted_at: r.submitted_at,
          section: sectionHeading,
          content,
        });
      }
    }
  } else {
    const all = await octokit.paginate(octokit.rest.issues.listComments, {
      owner: OWNER,
      repo: REPO,
      issue_number,
      per_page: 100,
    });

    const userComments = all.filter((c) => c.user?.login === userFilter);

    for (const c of userComments) {
      const content = extractSection(c.body ?? '', sectionHeading);
      if (content !== null) {
        results.push({
          comment_id: c.id,
          user: c.user?.login ?? null,
          created_at: c.created_at,
          section: sectionHeading,
          content,
          reactions: {
            '+1': c.reactions?.['+1'] ?? 0,
            '-1': c.reactions?.['-1'] ?? 0,
            laugh: c.reactions?.laugh ?? 0,
            confused: c.reactions?.confused ?? 0,
            heart: c.reactions?.heart ?? 0,
            hooray: c.reactions?.hooray ?? 0,
            rocket: c.reactions?.rocket ?? 0,
            eyes: c.reactions?.eyes ?? 0,
          },
        });
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

/**
 * Merge a pull request, or enable auto-merge if it cannot be merged immediately.
 *
 * Flags:
 *   --method squash|merge|rebase  Merge method (default: squash)
 *   --auto                        Enable auto-merge via GraphQL if direct merge is blocked
 *
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 */
async function prMerge(octokit, prStr) {
  const pull_number = parseIntArg(prStr, 'PR number');
  const method = getArg('--method') ?? 'squash';
  const autoFlag = args.includes('--auto');

  const validMethods = ['squash', 'merge', 'rebase'];
  if (!validMethods.includes(method)) {
    console.error(`ERROR: --method must be one of: ${validMethods.join(', ')}`);
    process.exit(1);
  }

  if (autoFlag) {
    // Auto-merge requires the PR node ID — fetch it first.
    const { data: pr } = await octokit.rest.pulls.get({
      owner: OWNER,
      repo: REPO,
      pull_number,
    });

    // If checks already passed, enablePullRequestAutoMerge fails with
    // "Pull request is in clean status". Fall back to a direct merge.
    if (pr.mergeable_state === 'clean' || pr.mergeable_state === 'unstable') {
      await octokit.rest.pulls.merge({
        owner: OWNER,
        repo: REPO,
        pull_number,
        merge_method: method,
      });
      console.log(
        JSON.stringify(
          { merged: true, method: 'direct', mergeable_state: pr.mergeable_state },
          null,
          2,
        ),
      );
      return;
    }

    const mergeMethodGql = method.toUpperCase();

    await octokit.graphql(
      `mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
          pullRequest {
            number
            autoMergeRequest {
              mergeMethod
              enabledAt
            }
          }
        }
      }`,
      { pullRequestId: pr.node_id, mergeMethod: mergeMethodGql },
    );

    console.log(
      JSON.stringify(
        {
          number: pull_number,
          auto_merge: true,
          merge_method: method,
          html_url: pr.html_url,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Direct merge via REST.
  const { data } = await octokit.rest.pulls.merge({
    owner: OWNER,
    repo: REPO,
    pull_number,
    merge_method: method,
  });

  console.log(
    JSON.stringify(
      {
        merged: data.merged,
        message: data.message,
        sha: data.sha,
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

  const format = getArg('--format');
  if (format === 'table') {
    const COL = { NUMBER: 8, TITLE: 52, STATE: 10, HEAD_BRANCH: 50 };
    const pad = (s, n) =>
      String(s ?? '')
        .slice(0, n)
        .padEnd(n);
    const header = `${'NUMBER'.padEnd(COL.NUMBER)}  ${'TITLE'.padEnd(COL.TITLE)}  ${'STATE'.padEnd(COL.STATE)}  HEAD_BRANCH`;
    const divider = '-'.repeat(header.length);
    console.log(header);
    console.log(divider);
    for (const p of prs) {
      console.log(
        `${pad(p.number, COL.NUMBER)}  ${pad(p.title, COL.TITLE)}  ${pad(p.state, COL.STATE)}  ${pad(p.head, COL.HEAD_BRANCH)}`,
      );
    }
    return;
  }

  console.log(JSON.stringify(prs, null, 2));
}

/**
 * Show details of a single pull request.
 *
 * Without --json, prints a human-readable summary.
 * With --json field1,field2,..., outputs a JSON object with only those fields.
 *
 * Supported --json fields:
 *   number, title, state, mergedAt, mergeCommit, headRefName, baseRefName,
 *   author, url, body
 *
 * @param {import('octokit').Octokit} octokit
 * @param {string} prStr - PR number as a string from argv.
 */
async function prView(octokit, prStr) {
  const pull_number = parseIntArg(prStr, 'PR number');

  const { data } = await octokit.rest.pulls.get({
    owner: OWNER,
    repo: REPO,
    pull_number,
  });

  const full = {
    number: data.number,
    title: data.title,
    state: data.state,
    mergedAt: data.merged_at ?? null,
    mergeCommit: data.merge_commit_sha ?? null,
    headRefName: data.head.ref,
    baseRefName: data.base.ref,
    author: data.user?.login ?? null,
    url: data.html_url,
    body: data.body ?? null,
  };

  const jsonFields = getArg('--json');
  if (jsonFields) {
    const fields = jsonFields.split(',').map((f) => f.trim());
    const filtered = Object.fromEntries(
      fields.filter((f) => Object.hasOwn(full, f)).map((f) => [f, full[f]]),
    );
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  // Human-readable summary
  const lines = [
    `#${full.number}  ${full.title}`,
    `State:   ${full.state}`,
    `Author:  ${full.author ?? 'unknown'}`,
    `Branch:  ${full.headRefName} → ${full.baseRefName}`,
    `URL:     ${full.url}`,
  ];
  if (full.mergedAt) {
    lines.push(`Merged:  ${full.mergedAt}`);
  }
  console.log(lines.join('\n'));
}

/**
 * Create a pull request. Delegates arg resolution and branch detection to the
 * same logic used by create-pr.cjs, but inlined here to avoid exec overhead.
 * @param {import('octokit').Octokit} octokit
 */
async function prCreate(octokit) {
  const { execSync } = require('node:child_process');

  const title = requireArg(getArg, '--title', '--title is required for pr create');

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
  const name = requireArg(getArg, '--name', '--name is required for label create');
  const color = requireArg(
    getArg,
    '--color',
    '--color is required for label create (hex without #, e.g. ff0000)',
  );

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
  const pull_number = parseIntArg(prStr, 'PR number');

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
  const pull_number = parseIntArg(prStr, 'PR number');
  const review_id = parseIntArg(reviewStr, 'review ID');

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
  const pull_number = parseIntArg(prStr, 'PR number');

  const event = requireArg(
    getArg,
    '--event',
    '--event is required for review submit (APPROVE|REQUEST_CHANGES|COMMENT)',
  );

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
  const pull_number = parseIntArg(prStr, 'PR number');
  const review_id = parseIntArg(reviewStr, 'review ID');

  const message = requireArg(getArg, '--message', '--message is required for review dismiss');

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
  const pull_number = parseIntArg(prStr, 'PR number');

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
  const comment_id = parseIntArg(commentStr, 'comment ID');

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
  const pull_number = parseIntArg(prStr, 'PR number');
  const comment_id = parseIntArg(commentStr, 'comment ID');

  const body = requireArg(getArg, '--body', '--body is required for review-comment reply');

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
  const check_run_id = parseIntArg(checkRunStr, 'check run ID');

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
  const check_run_id = parseIntArg(checkRunStr, 'check run ID');

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
  const per_page = limitStr ? parseIntArg(limitStr, '--limit value') : 10;

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

  const format = getArg('--format');
  if (format === 'table') {
    const COL = { STATUS: 12, CONCLUSION: 12, BRANCH: 50, ID: 14 };
    const pad = (s, n) =>
      String(s ?? '')
        .slice(0, n)
        .padEnd(n);
    const header = `${'STATUS'.padEnd(COL.STATUS)}  ${'CONCLUSION'.padEnd(COL.CONCLUSION)}  ${'BRANCH'.padEnd(COL.BRANCH)}  ID`;
    const divider = '-'.repeat(header.length);
    console.log(header);
    console.log(divider);
    for (const r of runs) {
      console.log(
        `${pad(r.status, COL.STATUS)}  ${pad(r.conclusion ?? '', COL.CONCLUSION)}  ${pad(r.head_branch, COL.BRANCH)}  ${r.id}`,
      );
    }
    return;
  }

  console.log(JSON.stringify(runs, null, 2));
}

/**
 * Show details of a single workflow run.
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runView(octokit, runStr) {
  const run_id = parseIntArg(runStr, 'run ID');

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
  const run_id = parseIntArg(runStr, 'run ID');

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
  const run_id = parseIntArg(runStr, 'run ID');

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
  const run_id = parseIntArg(runStr, 'run ID');

  await octokit.rest.actions.cancelWorkflowRun({
    owner: OWNER,
    repo: REPO,
    run_id,
  });

  console.log(JSON.stringify({ id: run_id, message: 'Run cancelled' }, null, 2));
}

/**
 * Poll a workflow run until it reaches 'completed' status, then print the result.
 * @param {import('octokit').Octokit} octokit
 * @param {string} runStr - Run ID as a string from argv.
 */
async function runWait(octokit, runStr) {
  const run_id = parseIntArg(runStr, 'run ID');
  const timeout = parseInt(getArg('--timeout') ?? '300', 10);
  const interval = parseInt(getArg('--interval') ?? '10', 10);
  const format = getArg('--format') ?? 'table';
  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    const { data } = await octokit.rest.actions.getWorkflowRun({
      owner: OWNER,
      repo: REPO,
      run_id,
    });

    if (data.status === 'completed') {
      if (format === 'json') {
        console.log(JSON.stringify(data, null, 2));
      } else {
        const COL = { STATUS: 12, CONCLUSION: 12, BRANCH: 50, ID: 14 };
        const pad = (s, n) =>
          String(s ?? '')
            .slice(0, n)
            .padEnd(n);
        const header = `${'STATUS'.padEnd(COL.STATUS)}  ${'CONCLUSION'.padEnd(COL.CONCLUSION)}  ${'BRANCH'.padEnd(COL.BRANCH)}  ID`;
        const divider = '-'.repeat(header.length);
        console.log(header);
        console.log(divider);
        console.log(
          `${pad(data.status, COL.STATUS)}  ${pad(data.conclusion ?? '', COL.CONCLUSION)}  ${pad(data.head_branch, COL.BRANCH)}  ${data.id}`,
        );
      }

      const successConclusions = ['success', 'skipped', 'neutral'];
      process.exit(successConclusions.includes(data.conclusion) ? 0 : 1);
    }

    await new Promise((r) => setTimeout(r, interval * 1000));
  }

  console.error(`Timed out waiting for run ${run_id} after ${timeout}s`);
  process.exit(2);
}

/**
 * Get the latest release tag for any public GitHub repository.
 * @param {import('octokit').Octokit} octokit
 * @param {string} ownerRepo - Combined "owner/repo" string from argv.
 */
async function releaseLatest(octokit, ownerRepo) {
  const slashIndex = ownerRepo.indexOf('/');
  if (slashIndex === -1) {
    console.error(`ERROR: release latest requires <owner>/<repo>, got '${ownerRepo}'`);
    process.exit(1);
  }
  const owner = ownerRepo.slice(0, slashIndex);
  const repo = ownerRepo.slice(slashIndex + 1);

  let data;
  try {
    ({ data } = await octokit.rest.repos.getLatestRelease({ owner, repo }));
  } catch (err) {
    if (err.status === 404) {
      console.error(`No releases found for ${owner}/${repo}`);
      process.exit(1);
    }
    throw err;
  }

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          tag_name: data.tag_name,
          name: data.name,
          published_at: data.published_at,
          html_url: data.html_url,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (args.includes('--major')) {
    // Extract leading "vN" or "N" major prefix from tag_name
    const match = /^(v?\d+)/.exec(data.tag_name);
    console.log(match ? match[1] : data.tag_name);
    return;
  }

  console.log(data.tag_name);
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
        '  issue comment list <number> [--user <login>]\n' +
        '  issue comment view <comment-id>\n' +
        '  issue comment search <number> --user <login> --section <heading> [--source comments|reviews]\n' +
        '  issue comment react <comment-id> --reaction <+1|-1|laugh|confused|heart|hooray|rocket|eyes>\n' +
        '  pr list [--format table]\n' +
        '  pr view <number> [--json field1,field2,...]\n' +
        '  pr create --title "..." [--base main] [--body "..."]\n' +
        '  pr merge <number> [--method squash|merge|rebase] [--auto]\n' +
        '  label list\n' +
        '  label create --name "..." --color "rrggbb" [--description "..."]\n' +
        '  review list <pr-number>\n' +
        '  review view <pr-number> <review-id>\n' +
        '  review submit <pr-number> --event <APPROVE|REQUEST_CHANGES|COMMENT> [--body "..."]\n' +
        '  review dismiss <pr-number> <review-id> --message "..."\n' +
        '  review-comment list <pr-number>\n' +
        '  review-comment view <comment-id>\n' +
        '  review-comment reply <pr-number> <comment-id> --body "..."\n' +
        '  review-comment react <comment-id> --reaction <+1|-1|laugh|confused|heart|hooray|rocket|eyes>\n' +
        '  checks list <pr-number-or-ref>\n' +
        '  checks view <check-run-id>\n' +
        '  checks annotations <check-run-id>\n' +
        '  run list [--limit 10] [--status <queued|in_progress|completed>] [--format table]\n' +
        '  run view <run-id>\n' +
        '  run rerun <run-id> [--failed-only]\n' +
        '  run logs <run-id>\n' +
        '  run cancel <run-id>\n' +
        '  run wait <run-id> [--timeout 300] [--interval 10] [--format table|json]\n' +
        '  release latest <owner>/<repo> [--json] [--major]',
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
      const [subActionOrNumber, subArg] = rest;
      if (!subActionOrNumber) {
        console.error('ERROR: issue comment requires a subcommand or issue number');
        process.exit(1);
      }
      if (subActionOrNumber === 'list') {
        if (!subArg) {
          console.error('ERROR: issue comment list requires an issue number');
          process.exit(1);
        }
        await issueCommentList(octokit, subArg);
      } else if (subActionOrNumber === 'view') {
        if (!subArg) {
          console.error('ERROR: issue comment view requires a comment ID');
          process.exit(1);
        }
        await issueCommentView(octokit, subArg);
      } else if (subActionOrNumber === 'search') {
        if (!subArg) {
          console.error('ERROR: issue comment search requires an issue number');
          process.exit(1);
        }
        await issueCommentSearch(octokit, subArg);
      } else if (subActionOrNumber === 'react') {
        if (!subArg) {
          console.error('ERROR: issue comment react requires a comment ID');
          process.exit(1);
        }
        await issueCommentReact(octokit, subArg);
      } else {
        // Legacy: issue comment <number> --body "..."
        await issueComment(octokit, subActionOrNumber);
      }
    } else {
      console.error(`ERROR: unknown issue action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'pr') {
    if (action === 'list') {
      await prList(octokit);
    } else if (action === 'create') {
      await prCreate(octokit);
    } else if (action === 'view') {
      const [prStr] = rest;
      if (!prStr) {
        console.error('ERROR: pr view requires a PR number');
        process.exit(1);
      }
      await prView(octokit, prStr);
    } else if (action === 'merge') {
      const [prStr] = rest;
      if (!prStr) {
        console.error('ERROR: pr merge requires a PR number');
        process.exit(1);
      }
      await prMerge(octokit, prStr);
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
    } else if (action === 'react') {
      const [commentStr] = rest;
      if (!commentStr) {
        console.error('ERROR: review-comment react requires a comment ID');
        process.exit(1);
      }
      await reviewCommentReact(octokit, commentStr);
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
    } else if (action === 'wait') {
      const [runStr] = rest;
      if (!runStr) {
        console.error('ERROR: run wait requires a run ID');
        process.exit(1);
      }
      await runWait(octokit, runStr);
    } else {
      console.error(`ERROR: unknown run action '${action}'`);
      process.exit(1);
    }
  } else if (resource === 'release') {
    if (action === 'latest') {
      const [ownerRepo] = rest;
      if (!ownerRepo) {
        console.error('ERROR: release latest requires <owner>/<repo>');
        process.exit(1);
      }
      await releaseLatest(octokit, ownerRepo);
    } else {
      console.error(`ERROR: unknown release action '${action}'`);
      process.exit(1);
    }
  } else {
    console.error(
      `ERROR: unknown resource '${resource}' — expected: issue, pr, label, review, review-comment, checks, run, release`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
