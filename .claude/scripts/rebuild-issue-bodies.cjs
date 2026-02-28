#!/usr/bin/env node
'use strict';

/**
 * Rebuild GitHub issue bodies from backlog per-item files into proper story format.
 *
 * Reads .claude/backlog/*.md files with YAML frontmatter, matches them to open
 * GitHub issues by normalized title, and updates each issue body to follow the
 * story template.
 *
 * Usage:
 *   node .claude/scripts/rebuild-issue-bodies.cjs --dry-run
 *   node .claude/scripts/rebuild-issue-bodies.cjs
 *
 * Required env vars:
 *   GITHUB_TOKEN — GitHub personal access token with repo scope
 */

const { readdir, readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

const { Octokit } = require('octokit');
const matter = require('gray-matter');
const { OWNER, REPO, ROLE_MAP, BENEFIT_MAP, normalizeTitle } = require('./lib/story-helpers.cjs');

const BACKLOG_DIR = join(__dirname, '..', 'backlog');

// ---------------------------------------------------------------------------
// Backlog file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a backlog item Markdown file and extract its YAML frontmatter and optional body into a flat data object.
 *
 * @param {string} filePath - Absolute path to the Markdown file.
 * @returns {Record<string,string>|null} Object with keys `name`, `description`, `source`, `added`, `priority`, `type`, and optional `extraBody`; `null` if the file cannot be parsed or the frontmatter is invalid.
 */
async function parseBacklogFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = matter(text);
  } catch {
    return null;
  }

  const fm = parsed.data;
  if (!fm || typeof fm !== 'object') {
    return null;
  }

  const metadata = fm.metadata ?? {};
  const extraBody = parsed.content?.trim() ?? '';

  /** @type {Record<string, string>} */
  const result = {
    name: String(fm.name ?? ''),
    description: String(fm.description ?? ''),
    source: String(metadata.source ?? 'Not specified'),
    added: String(metadata.added ?? 'Unknown'),
    priority: String(metadata.priority ?? 'Unknown'),
    type: String(metadata.type ?? 'Feature'),
  };

  if (extraBody) {
    result.extraBody = extraBody;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extra field extraction
// ---------------------------------------------------------------------------

/**
 * Parse structured fields from the Markdown body text that follows YAML frontmatter.
 *
 * The function looks for lines prefixed with **Research first**:, **Suggested location**:, and **Files**:
 * and extracts their values. Any other non-empty, non-delimiter lines are collected as `notes`.
 *
 * @param {string} extra - The body text following frontmatter.
 * @returns {Record<string, string>} An object containing any of: `researchFirst`, `suggestedLocation`, `files`, and `notes` (where `notes` is the remaining lines joined by newlines).
function extractExtraFields(extra) {
  /** @type {Record<string, string>} */
  const fields = {};
  const notesLines = [];

  for (const rawLine of extra.split('\n')) {
    if (rawLine.startsWith('**Research first**:')) {
      const idx = rawLine.indexOf(':');
      fields.researchFirst = idx >= 0 ? rawLine.slice(idx + 1).trim() : '';
    } else if (rawLine.startsWith('**Suggested location**:')) {
      const idx = rawLine.indexOf(':');
      fields.suggestedLocation = idx >= 0 ? rawLine.slice(idx + 1).trim() : '';
    } else if (rawLine.startsWith('**Files**:')) {
      const idx = rawLine.indexOf(':');
      fields.files = idx >= 0 ? rawLine.slice(idx + 1).trim() : '';
    } else if (rawLine.trim() && !rawLine.startsWith('---')) {
      notesLines.push(rawLine);
    }
  }

  if (notesLines.length > 0) {
    fields.notes = notesLines.join('\n');
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Story body builder
// ---------------------------------------------------------------------------

/**
 * Constructs a standardized story-formatted Markdown body for a GitHub issue from a parsed backlog item.
 *
 * Builds sections including Story, Description, optional Files and Suggested Location, a Context block
 * (Source, Priority, Added, Research questions), and optional Notes based on the item's fields.
 *
 * @param {Record<string,string>} item - Parsed backlog item (expected fields: `name`, `description`, `type`,
 * `source`, `priority`, `added`, and `extraBody` containing any additional structured notes).
 * @returns {string} The assembled Markdown issue body.
 */
function buildStoryBody(item) {
  const title = item.name || 'No title';
  const description = item.description || title;
  const itemType = item.type || 'Feature';
  const role = ROLE_MAP[itemType] ?? 'developer using Claude Code skills';
  const benefit = BENEFIT_MAP[itemType] ?? 'the product improves';
  const goal = title.replace(/\.$/, '');

  const extraFields = extractExtraFields(item.extraBody ?? '');

  const sections = [
    `## Story\n\nAs a **${role}**, I want to **${goal.toLowerCase()}** so that **${benefit}**.`,
    `## Description\n\n${description}`,
  ];

  if (extraFields.files) {
    sections.push(`## Files\n\n${extraFields.files}`);
  }

  if (extraFields.suggestedLocation) {
    sections.push(`## Suggested Location\n\n${extraFields.suggestedLocation}`);
  }

  const contextLines = [
    `- **Source**: ${item.source ?? 'Not specified'}`,
    `- **Priority**: ${item.priority ?? 'Unknown'}`,
    `- **Added**: ${item.added ?? 'Unknown'}`,
    `- **Research questions**: ${extraFields.researchFirst ?? 'None'}`,
  ];
  sections.push(`## Context\n\n${contextLines.join('\n')}`);

  if (extraFields.notes) {
    sections.push(`## Notes\n\n${extraFields.notes}`);
  }

  return `${sections.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Rebuilds GitHub issue bodies from backlog Markdown files and updates matching open issues.
 *
 * Reads backlog items from the configured BACKLOG_DIR, matches them to open issues in OWNER/REPO
 * by normalized title (exact match or substring), and replaces issue bodies with a standardized
 * story-format body built from each backlog item. Requires GITHUB_TOKEN in the environment;
 * exits with an error if the token is missing. Operates in read-only mode when run with
 * --dry-run, skips pull requests and issues already containing a "## Story" section, and logs
 * counts of updated, skipped, and unmatched issues.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('ERROR: GITHUB_TOKEN is not set');
    process.exit(1);
  }

  // Graceful exit if .claude/backlog/ doesn't exist
  if (!existsSync(BACKLOG_DIR)) {
    console.log(`Backlog directory not found: ${BACKLOG_DIR} — nothing to do`);
    return;
  }

  // Load and parse all non-completed backlog items
  const allEntries = await readdir(BACKLOG_DIR);
  const mdFiles = allEntries.filter((f) => f.endsWith('.md') && !f.startsWith('completed-'));

  /** @type {Map<string, Record<string, string>>} */
  const items = new Map();

  for (const filename of mdFiles.toSorted()) {
    const filePath = join(BACKLOG_DIR, filename);
    const data = await parseBacklogFile(filePath);
    if (data?.name) {
      items.set(data.name.toLowerCase().trim(), data);
    }
  }

  console.log(`Loaded ${items.size} backlog item(s) from ${BACKLOG_DIR}`);

  const octokit = new Octokit({ auth: token });

  const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    state: 'open',
    per_page: 100,
  });

  const openIssues = allIssues.filter((i) => !i.pull_request);
  console.log(`Found ${openIssues.length} open GitHub issue(s) in ${OWNER}/${REPO}`);

  if (dryRun) {
    console.log('(dry-run mode — no changes will be made)\n');
  }

  let updated = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const issue of openIssues) {
    const key = normalizeTitle(issue.title);

    // Exact match first, then substring match
    let item = items.get(key);
    if (!item) {
      for (const [itemKey, itemData] of items) {
        if (itemKey.includes(key) || key.includes(itemKey)) {
          item = itemData;
          break;
        }
      }
    }

    if (!item) {
      console.log(`  SKIP #${issue.number}: no backlog match — ${issue.title}`);
      noMatch += 1;
      continue;
    }

    // Already in story format — skip
    if (issue.body?.includes('## Story')) {
      skipped += 1;
      continue;
    }

    const newBody = buildStoryBody(item);

    if (dryRun) {
      console.log(`  WOULD UPDATE #${issue.number}: ${issue.title}`);
    } else {
      await octokit.rest.issues.update({
        owner: OWNER,
        repo: REPO,
        issue_number: issue.number,
        body: newBody,
      });
      console.log(`  UPDATED #${issue.number}: ${issue.title}`);
    }

    updated += 1;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} already story format, ${noMatch} no match`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
