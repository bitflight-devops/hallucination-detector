#!/usr/bin/env node
'use strict';

/**
 * Create a GitHub pull request from the current branch.
 *
 * Auto-detects the head branch and generates a body from the commit log when
 * no explicit body is provided.
 *
 * Usage:
 *   node .claude/scripts/create-pr.cjs --title "feat: add proxy support"
 *   node .claude/scripts/create-pr.cjs --title "fix: timeout" --base main --body "Details here"
 *   node .claude/scripts/create-pr.cjs --title "chore: deps" --body-file ./pr-body.md
 *
 * Required env vars:
 *   GITHUB_TOKEN — GitHub personal access token with repo scope
 */

const { execSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const { createGitHubClient, OWNER, REPO } = require('./lib/github-client.cjs');
const { createArgParser, requireArg } = require('./lib/cli-args.cjs');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const { getArg } = createArgParser(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Run a git command synchronously and return trimmed stdout.
 * @param {string} cmd - The full command string to pass to execSync.
 * @returns {string}
 */
function git(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

/**
 * Detect the current git branch name.
 * @returns {string}
 */
function currentBranch() {
  return git('git branch --show-current');
}

/**
 * Return one-line commit summaries for commits in head that are not in base.
 * @param {string} base - The base branch name.
 * @returns {string[]} Array of "<hash> <subject>" strings, oldest-first.
 */
function commitsSinceBase(base) {
  const log = git(`git log origin/${base}..HEAD --format='%h %s'`);
  return log ? log.split('\n').filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// Body generation
// ---------------------------------------------------------------------------

/**
 * Build a PR body string from a list of commit summary lines.
 * @param {string[]} commits - Array of "<hash> <subject>" strings.
 * @returns {string}
 */
function bodyFromCommits(commits) {
  if (commits.length === 0) {
    return 'No commits found since base branch.';
  }
  const lines = commits.map((c) => `- ${c}`).join('\n');
  return `## Changes\n\n${lines}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Parse CLI args, resolve head branch, build PR body, and create the PR via
 * the GitHub REST API. Prints the PR URL to stdout on success.
 */
async function main() {
  const title = requireArg(getArg, '--title', '--title is required');

  const base = getArg('--base') ?? 'main';
  const head = currentBranch();

  if (!head) {
    console.error('ERROR: could not detect current branch (detached HEAD?)');
    process.exit(1);
  }

  if (head === base) {
    console.error(`ERROR: head branch '${head}' is the same as base branch '${base}'`);
    process.exit(1);
  }

  // Resolve PR body: explicit --body, --body-file, or auto-generate from log
  let body;
  const bodyArg = getArg('--body');
  const bodyFile = getArg('--body-file');

  if (bodyArg) {
    body = bodyArg;
  } else if (bodyFile) {
    body = readFileSync(bodyFile, 'utf8');
  } else {
    const commits = commitsSinceBase(base);
    body = bodyFromCommits(commits);
  }

  const octokit = createGitHubClient();

  const { data: pr } = await octokit.rest.pulls.create({
    owner: OWNER,
    repo: REPO,
    title,
    head,
    base,
    body,
  });

  console.log(pr.html_url);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
