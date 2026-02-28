'use strict';

/**
 * Shared constants and helpers for issue management scripts.
 */

const OWNER = 'bitflight-devops';
const REPO = 'hallucination-detector';

const ROLE_MAP = {
  Feature: 'developer using the hallucination-detector plugin',
  Bug: 'developer relying on the hallucination-detector',
  Refactor: 'maintainer of the hallucination-detector codebase',
  Docs: 'developer reading the hallucination-detector documentation',
  Chore: 'maintainer of the project infrastructure',
};

const BENEFIT_MAP = {
  Feature: 'the detection pipeline becomes more capable and complete',
  Bug: 'the stop-hook works correctly and reliably',
  Refactor: 'the code is cleaner and more maintainable',
  Docs: 'documentation is accurate and trustworthy',
  Chore: 'the project infrastructure stays healthy',
};

/**
 * Normalize an issue or backlog title by removing conventional commit and priority prefixes and converting to lowercase.
 * @param {string} title - Raw issue or backlog item title.
 * @returns {string} Title with conventional commit prefixes (e.g. "feat:", "fix:", "chore:", "docs:", "refactor:") and priority prefixes ("P0:", "P1:", "P2:") removed, lowercased and trimmed.
 */
function normalizeTitle(title) {
  let clean = title.replace(/^(?:feat|fix|chore|docs|refactor):\s*/i, '');
  clean = clean.replace(/^P[012]:\s*/i, '');
  return clean.toLowerCase().trim();
}

module.exports = {
  OWNER,
  REPO,
  ROLE_MAP,
  BENEFIT_MAP,
  normalizeTitle,
};
