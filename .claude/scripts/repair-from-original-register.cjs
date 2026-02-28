#!/usr/bin/env node
'use strict';

/**
 * Repair truncated backlog items and GitHub issues from the original register.
 *
 * Reads .claude/original-backlog-register.md (pre-migration BACKLOG.md with full
 * untruncated descriptions), maps each item to its GitHub issue number, updates
 * per-item files in .claude/backlog/ with correct descriptions, then rebuilds
 * GitHub issue bodies with proper story format including groomed content.
 *
 * Usage:
 *   node .claude/scripts/repair-from-original-register.cjs --dry-run
 *   node .claude/scripts/repair-from-original-register.cjs
 *
 * Required environment variable:
 *   GITHUB_TOKEN — GitHub personal access token with repo scope
 */

const { readFileSync, writeFileSync, existsSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { Octokit } = require('octokit');
const matter = require('gray-matter');
const yaml = require('yaml');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { OWNER, REPO, ROLE_MAP, BENEFIT_MAP, normalizeTitle } = require('./lib/story-helpers.cjs');

const REPO_ROOT = resolve(__dirname, '..', '..');
const REGISTER_PATH = join(REPO_ROOT, '.claude', 'original-backlog-register.md');
const BACKLOG_DIR = join(REPO_ROOT, '.claude', 'backlog');

// Bold-key field prefix → dict key mapping.
// Keys are the literal bold-prefix as it appears in the markdown (colon included).
const FIELD_MAP = {
  '**Source**:': 'source',
  '**Added**:': 'added',
  '**Priority**:': 'priority_field',
  '**Description**:': 'description',
  '**Research first**:': 'research_first',
  '**Suggested location**:': 'suggested_location',
  '**Files**:': 'files',
  '**Plan**:': 'plan',
  '**Completed**:': 'completed',
  '**Status**:': 'status',
  '**Type**:': 'type',
  '**Issue**:': 'issue_field',
};

// Fields whose values may span multiple lines — content continues until next
// bold-key field or end of body.
const MULTILINE_FIELDS = new Set([
  '**Description**:',
  '**Files**:',
  '**Status**:',
  '**Citations**:',
]);

const SEPARATOR_LINE_RE = /^---+\s*$/gm;

// ---------------------------------------------------------------------------
// Register parsing
// ---------------------------------------------------------------------------

/**
 * Detect the current priority section from an H2 heading line.
 *
 * @param {string} line
 * @param {string} current
 * @returns {string}
 */
function detectPriority(line, current) {
  const PRIORITY_PREFIXES = {
    '## P0': 'P0',
    '## P1': 'P1',
    '## P2': 'P2',
    '## Ideas': 'Ideas',
    '## Completed': 'Completed',
  };
  for (const [prefix, priority] of Object.entries(PRIORITY_PREFIXES)) {
    if (line.startsWith(prefix)) {
      return priority;
    }
  }
  return current;
}

/**
 * Match a stripped line against known bold-key field prefixes.
 *
 * @param {string} stripped
 * @returns {{ prefix: string|null, key: string|null }}
 */
function matchFieldPrefix(stripped) {
  for (const [prefix, key] of Object.entries(FIELD_MAP)) {
    if (stripped.startsWith(prefix)) {
      return { prefix, key };
    }
  }
  return { prefix: null, key: null };
}

/**
 * Check whether a stripped line starts with any recognized bold-key field prefix.
 *
 * @param {string} stripped
 * @returns {boolean}
 */
function isBoldKeyLine(stripped) {
  return matchFieldPrefix(stripped).prefix !== null;
}

/**
 * Collect a multi-line field value from consecutive lines.
 *
 * Reads continuation lines until the next bold-key field or end of body.
 *
 * @param {string[]} lines
 * @param {number} start - index of the first continuation line (after the field header)
 * @param {string} firstValue - value text from the header line itself
 * @returns {{ value: string, nextIndex: number }}
 */
function collectMultilineValue(lines, start, firstValue) {
  const valueLines = firstValue ? [firstValue] : [];
  let i = start;
  while (i < lines.length) {
    if (isBoldKeyLine(lines[i].trim())) {
      break;
    }
    if (lines[i].trim()) {
      valueLines.push(lines[i].trimEnd());
    } else if (valueLines.length > 0) {
      valueLines.push('');
    }
    i += 1;
  }
  return { value: valueLines.join('\n').trim(), nextIndex: i };
}

/**
 * Extract bold-key fields from item body text, including multi-line values.
 *
 * Mutates `item` in place with all extracted field values.
 *
 * @param {string} body
 * @param {Record<string, string>} item
 */
function extractFields(body, item) {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length) {
    const stripped = lines[i].trim();
    const { prefix, key } = matchFieldPrefix(stripped);

    if (!prefix || !key) {
      i += 1;
      continue;
    }

    const firstLineValue = stripped.slice(prefix.length).trim();

    // Extract issue number from **Issue**: field
    if (key === 'issue_field') {
      const issueMatch = firstLineValue.match(/#(\d+)/);
      if (issueMatch) {
        item.issue_number = issueMatch[1];
      }
      i += 1;
      continue;
    }

    // For multi-line fields, collect continuation lines
    if (MULTILINE_FIELDS.has(prefix)) {
      const { value, nextIndex } = collectMultilineValue(lines, i + 1, firstLineValue);
      item[key] = value;
      i = nextIndex;
    } else {
      item[key] = firstLineValue;
      i += 1;
    }
  }
}

/**
 * Parse the original backlog register into structured items.
 *
 * Captures both extracted fields AND the full raw body text so that
 * non-standard content (sub-issues, validation steps, citations, etc.)
 * is never lost.
 *
 * @returns {Record<string, string>[]}
 */
function parseRegister() {
  const text = readFileSync(REGISTER_PATH, 'utf8');
  /** @type {Record<string, string>[]} */
  const items = [];
  let currentPriority = '';

  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    currentPriority = detectPriority(line, currentPriority);

    if (line.startsWith('### ')) {
      const title = line.slice(4).trim();
      /** @type {Record<string, string>} */
      const item = { title, priority: currentPriority };

      i += 1;
      const bodyLines = [];
      while (i < lines.length && !lines[i].startsWith('### ') && !lines[i].startsWith('## ')) {
        bodyLines.push(lines[i]);
        i += 1;
      }

      const body = bodyLines.join('\n').trim();
      item.full_body = body;
      extractFields(body, item);
      items.push(item);
      continue;
    }

    i += 1;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Title normalization and issue matching
// ---------------------------------------------------------------------------

/**
 * Fuzzy match a key against an issue map by substring containment.
 *
 * @param {string} key
 * @param {Map<string, object>} issueMap
 * @returns {object|null}
 */
function fuzzyMatch(key, issueMap) {
  for (const [issueKey, issue] of issueMap) {
    if (issueKey.includes(key) || key.includes(issueKey)) {
      return issue;
    }
  }
  return null;
}

/**
 * Match register items to GitHub issues by normalized title.
 * First tries exact normalized match, then fuzzy substring containment.
 *
 * @param {Record<string, string>[]} items
 * @param {object[]} issues
 * @returns {Array<[Record<string, string>, object|null]>}
 */
function matchItemsToIssues(items, issues) {
  /** @type {Map<string, object>} */
  const issueMap = new Map();
  for (const issue of issues) {
    const key = normalizeTitle(issue.title);
    issueMap.set(key, issue);
  }

  return items.map((item) => {
    const key = normalizeTitle(item.title);
    const matched = issueMap.get(key) ?? fuzzyMatch(key, issueMap) ?? null;
    return [item, matched];
  });
}

// ---------------------------------------------------------------------------
// Per-item backlog file helpers
// ---------------------------------------------------------------------------

/**
 * Find the per-item backlog file for a register item.
 *
 * Search order:
 *   1. `{priority}-{slug[:30]}*.md`
 *   2. `*{slug[:20]}*.md`
 *
 * @param {Record<string, string>} item
 * @returns {string|null}
 */
function findPerItemFile(item) {
  if (!existsSync(BACKLOG_DIR)) {
    return null;
  }

  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const priority = item.priority.toLowerCase();

  const allFiles = readdirSync(BACKLOG_DIR).filter((f) => f.endsWith('.md'));

  // Pattern 1: {priority}-{slug[:30]}*.md
  const p1Prefix = `${priority}-${slug.slice(0, 30)}`;
  const match1 = allFiles.find((f) => f.startsWith(p1Prefix));
  if (match1) {
    return join(BACKLOG_DIR, match1);
  }

  // Pattern 2: *{slug[:20]}*.md
  const slugPrefix = slug.slice(0, 20);
  const match2 = allFiles.find((f) => f.includes(slugPrefix));
  if (match2) {
    return join(BACKLOG_DIR, match2);
  }

  return null;
}

/**
 * Read groomed content from a per-item backlog file.
 *
 * Extracts everything from the first '## Groomed' heading to end of file.
 *
 * @param {string} filePath
 * @returns {string}
 */
function readGroomedContent(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const match = text.match(/## Groomed[\s\S]*/);
  return match ? match[0].trim() : '';
}

/**
 * Extract content from full_body not covered by extracted fields.
 *
 * Removes lines already captured by extractFields (bold-key metadata lines)
 * and returns everything else: sub-issues, bullet lists, numbered steps,
 * citations, free-form paragraphs, etc.
 *
 * @param {Record<string, string>} item
 * @returns {string}
 */
function extractAdditionalContent(item) {
  const fullBody = item.full_body ?? '';
  if (!fullBody) {
    return '';
  }

  const coveredPrefixes = new Set([...Object.keys(FIELD_MAP), '**Issue**:']);
  const resultLines = [];
  const lines = fullBody.split('\n');
  let i = 0;

  while (i < lines.length) {
    const stripped = lines[i].trim();
    const isCovered = [...coveredPrefixes].some((p) => stripped.startsWith(p));

    if (isCovered) {
      // Skip this line and its multi-line continuation if applicable
      const isMultiline = [...MULTILINE_FIELDS].some((p) => stripped.startsWith(p));
      i += 1;
      if (isMultiline) {
        while (i < lines.length && !isBoldKeyLine(lines[i].trim())) {
          i += 1;
        }
      }
      continue;
    }

    resultLines.push(lines[i].trimEnd());
    i += 1;
  }

  const content = resultLines.join('\n').trim();
  // Remove separator lines (---)
  return content.replace(SEPARATOR_LINE_RE, '').trim();
}

// ---------------------------------------------------------------------------
// Story body builder
// ---------------------------------------------------------------------------

/**
 * Build a proper story-format GitHub issue body from a register item.
 *
 * Includes ALL content from the original register: structured fields
 * in their proper sections, plus any additional free-text content
 * (sub-issues, validation steps, citations, etc.) that doesn't fit
 * into a named field.
 *
 * @param {Record<string, string>} item
 * @param {string} [groomedContent]
 * @returns {string}
 */
function buildStoryBody(item, groomedContent = '') {
  const title = item.title ?? 'No title';
  const description = item.description ?? title;
  const itemType = item.type ?? 'Feature';
  const priority = item.priority ?? 'Unknown';
  const role = ROLE_MAP[itemType] ?? 'developer using the hallucination-detector plugin';
  const benefit = BENEFIT_MAP[itemType] ?? 'the project improves';
  const goal = title.replace(/\.$/, '');

  const sections = [
    `## Story\n\nAs a **${role}**, I want to **${goal.toLowerCase()}** so that **${benefit}**.`,
    `## Description\n\n${description}`,
  ];

  const additional = extractAdditionalContent(item);
  if (additional) {
    sections.push(`## Details\n\n${additional}`);
  }

  if (item.files) {
    sections.push(`## Files\n\n${item.files}`);
  }

  if (item.suggested_location) {
    sections.push(`## Suggested Location\n\n${item.suggested_location}`);
  }

  const contextLines = [
    `- **Source**: ${item.source ?? 'Not specified'}`,
    `- **Priority**: ${priority}`,
    `- **Added**: ${item.added ?? 'Unknown'}`,
    `- **Research questions**: ${item.research_first ?? 'None'}`,
  ];
  if (item.status) {
    contextLines.push(`- **Status**: ${item.status}`);
  }
  sections.push(`## Context\n\n${contextLines.join('\n')}`);

  if (item.plan) {
    sections.push(`## Plan\n\n${item.plan}`);
  }

  if (groomedContent) {
    sections.push(groomedContent);
  }

  return `${sections.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Per-item file update
// ---------------------------------------------------------------------------

/**
 * Update the per-item backlog file with an untruncated description.
 *
 * Uses gray-matter to read frontmatter and yaml (v2) to write it back.
 * Only writes if the new description is longer than the existing one.
 *
 * @param {Record<string, string>} item
 * @param {string|null} [resolvedPath] - Pre-resolved file path (avoids re-scanning)
 * @returns {boolean} true if a file was updated
 */
function updatePerItemFile(item, resolvedPath) {
  const filePath = resolvedPath ?? findPerItemFile(item);
  if (!filePath) {
    return false;
  }

  const fileContents = readFileSync(filePath, 'utf8');
  const { data: fm, content: bodyContent } = matter(fileContents);

  if (!fm || typeof fm !== 'object') {
    return false;
  }

  const oldDesc = String(fm.description ?? '');
  const newDesc = item.description ?? oldDesc;

  if (newDesc.length <= oldDesc.length) {
    return false;
  }

  fm.description = newDesc;

  // Update source in metadata if it was previously unspecified
  if (
    item.source &&
    fm.metadata &&
    typeof fm.metadata === 'object' &&
    fm.metadata.source === 'Not specified'
  ) {
    fm.metadata.source = item.source;
  }

  const newFrontmatter = yaml.stringify(fm).trimEnd();
  const trimmedBody = bodyContent.trim();
  const newFileContents = trimmedBody
    ? `---\n${newFrontmatter}\n---\n\n${trimmedBody}\n`
    : `---\n${newFrontmatter}\n---\n`;

  writeFileSync(filePath, newFileContents, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Process a single pair
// ---------------------------------------------------------------------------

/**
 * Process a single register-item / issue pair.
 *
 * @param {Record<string, string>} item
 * @param {object|null} issue
 * @param {import('octokit').Octokit} octokit
 * @param {boolean} dryRun
 * @returns {Promise<{ filesUpdated: number, issuesUpdated: number, noIssue: number }>}
 */
async function processPair(item, issue, octokit, dryRun) {
  const { title } = item;
  let groomedContent = '';

  const perItemPath = findPerItemFile(item);
  if (perItemPath) {
    groomedContent = readGroomedContent(perItemPath);
  }

  if (dryRun) {
    const issueStr = issue ? `#${issue.number}` : 'NO MATCH';
    const groomedStr = groomedContent ? ' [groomed]' : '';
    console.log(`  ${issueStr}\t${title}${groomedStr}`);
    return { filesUpdated: 0, issuesUpdated: issue ? 1 : 0, noIssue: issue ? 0 : 1 };
  }

  const filesUpdated = updatePerItemFile(item, perItemPath) ? 1 : 0;

  if (issue) {
    const newBody = buildStoryBody(item, groomedContent);
    await octokit.rest.issues.update({
      owner: OWNER,
      repo: REPO,
      issue_number: issue.number,
      body: newBody,
    });
    const groomedStr = groomedContent ? ' [+groomed]' : '';
    console.log(`  UPDATED #${issue.number}: ${title}${groomedStr}`);
    return { filesUpdated, issuesUpdated: 1, noIssue: 0 };
  }

  console.log(`  NO ISSUE: ${title}`);
  return { filesUpdated, issuesUpdated: 0, noIssue: 1 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * @returns {Promise<void>}
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!existsSync(REGISTER_PATH)) {
    console.error(`ERROR: ${REGISTER_PATH} not found`);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('ERROR: GITHUB_TOKEN is not set');
    process.exit(1);
  }

  const registerItems = parseRegister();
  const activeItems = registerItems.filter(
    (item) =>
      item.priority !== 'Completed' &&
      !Object.hasOwn(item, 'completed') &&
      !item.title.includes('~~') &&
      !item.status?.toUpperCase().startsWith('DONE') &&
      !item.status?.toUpperCase().startsWith('RESOLVED'),
  );
  console.log(`Parsed ${registerItems.length} items from register (${activeItems.length} active)`);

  const octokit = new Octokit({ auth: token });

  const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: OWNER,
    repo: REPO,
    state: 'open',
    per_page: 100,
  });
  const openIssues = allIssues.filter((issue) => !issue.pull_request);
  console.log(`Found ${openIssues.length} open GitHub issues`);

  if (dryRun) {
    console.log('(dry-run mode — no changes will be made)\n');
  }

  const pairs = matchItemsToIssues(activeItems, openIssues);

  let totalFilesUpdated = 0;
  let totalIssuesUpdated = 0;
  let totalNoIssue = 0;

  for (const [item, issue] of pairs) {
    const counts = await processPair(item, issue, octokit, dryRun);
    totalFilesUpdated += counts.filesUpdated;
    totalIssuesUpdated += counts.issuesUpdated;
    totalNoIssue += counts.noIssue;
  }

  console.log(
    `\nDone: ${totalFilesUpdated} files updated, ${totalIssuesUpdated} issues updated, ${totalNoIssue} no match`,
  );
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
