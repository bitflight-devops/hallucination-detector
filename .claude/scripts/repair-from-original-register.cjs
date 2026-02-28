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
 * Determine the priority label indicated by an H2 heading line or return the provided fallback.
 * @param {string} line - A single line of text (typically a Markdown H2) to inspect for a priority heading.
 * @param {string} current - Fallback priority to return if the line does not contain a recognized heading.
 * @returns {string} The detected priority (`P0`, `P1`, `P2`, `Ideas`, `Completed`) or `current` if no match is found.
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
 * Identify whether a line begins with a known bold-key prefix and return the matching prefix and mapped key.
 *
 * @param {string} stripped - A line trimmed of surrounding whitespace.
 * @returns {{ prefix: string|null, key: string|null }} An object with `prefix` set to the matched FIELD_MAP prefix and `key` to its mapped internal key; both are `null` if no prefix matches.
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
 * Determine whether a trimmed line begins with a recognized bold-key field prefix.
 *
 * @param {string} stripped - The line with surrounding whitespace removed.
 * @returns {boolean} `true` if the line starts with a known bold-prefixed field, `false` otherwise.
 */
function isBoldKeyLine(stripped) {
  return matchFieldPrefix(stripped).prefix !== null;
}

/**
 * Collects a field value that spans multiple lines until the next bold-key field or the end of the input.
 *
 * Preserves internal blank lines, trims leading/trailing whitespace from the combined result, and returns
 * the collected text along with the index of the line where collection stopped (the first line that is a new field header or end of lines).
 *
 * @param {string[]} lines - All lines of the source text.
 * @param {number} start - Index of the first continuation line (immediately after the header line).
 * @param {string} firstValue - Text captured on the header line itself (may be empty).
 * @returns {{ value: string, nextIndex: number }} value is the collected multiline text; nextIndex is the index at which parsing should resume.
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
 * Parse and extract recognized bold-prefixed metadata fields from a register item body into the given item object.
 *
 * Extracted fields (including multi-line values) are written directly onto `item`. The special **Issue** field,
 * if present, will set `item.issue_number` to the numeric issue id found (without the `#`).
 *
 * @param {string} body - The raw markdown body of a register item.
 * @param {Record<string, string>} item - Destination object to receive extracted fields; mutated in place.
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
 * Parse the original backlog register into an array of structured item objects.
 *
 * Each item includes extracted metadata fields (e.g., title, priority, description, source, added, status)
 * and a `full_body` property containing the raw Markdown body for that item so any non-standard content is preserved.
 *
 * @returns {Record<string, string>[]} An array of item objects with parsed fields and a `full_body` string for each item.
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
 * Map register items to their corresponding GitHub issues by normalized title, falling back to a fuzzy substring match.
 * @param {Record<string, string>[]} items - Register items; each item must include a `title` property.
 * @param {object[]} issues - GitHub issue objects; each issue must include a `title` property.
 * @returns {Array<[Record<string, string>, object|null]>} An array of pairs [item, issue|null] where the second element is the matched issue object or `null` if no match was found.
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
 * Retrieve the content of the first "## Groomed" section from a backlog file.
 *
 * @param {string} filePath - Path to the per-item backlog Markdown file.
 * @returns {string} The "## Groomed" heading and its following content, trimmed; returns an empty string if no such section exists.
 */
function readGroomedContent(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const match = text.match(/## Groomed[\s\S]*/);
  return match ? match[0].trim() : '';
}

/**
 * Extracts the free-form content from an item's original register body that isn't part of recognized metadata fields.
 *
 * @param {Record<string,string>} item - Object produced by parseRegister with a `full_body` property containing the raw register text.
 * @returns {string} The remaining content (paragraphs, lists, sub-issues, citations, etc.) with separator lines removed and trimmed.
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
 * Update a per-item backlog file's frontmatter description when the provided item's description is longer than the existing one.
 *
 * @param {Record<string, string>} item - Parsed register item; should include `description` and may include `source`.
 * @param {string|null} [resolvedPath] - Optional full path to the backlog file to update (skips locating the file).
 * @returns {boolean} `true` if a file was updated, `false` otherwise.
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
 * Process a single register item paired with a GitHub issue: update per-item backlog file if needed and update the issue body to a rebuilt story when an issue is present.
 *
 * @param {Record<string,string>} item - Parsed register item containing fields like title, description, priority, and other metadata.
 * @param {object|null} issue - Matching GitHub issue object (or `null` if no match); when present the issue's `number` is used to perform an update.
 * @param {import('octokit').Octokit} octokit - Authenticated Octokit client used to update GitHub issues.
 * @param {boolean} dryRun - If true, simulate actions and only log intended changes without writing files or updating issues.
 * @returns {Promise<{ filesUpdated: number, issuesUpdated: number, noIssue: number }>} Counts of actions performed: `filesUpdated` for per-item files modified, `issuesUpdated` for issues updated, and `noIssue` for items with no matching issue.
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
 * Orchestrates repairing backlog items from the original register by matching parsed items to open GitHub issues, updating per-item backlog files, and rebuilding issue bodies into a groomed story format.
 *
 * When invoked with --dry-run, simulates actions without writing files or updating GitHub issues.
 *
 * Exits the process with code 1 if the register file is missing or the GITHUB_TOKEN environment variable is not set.
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
