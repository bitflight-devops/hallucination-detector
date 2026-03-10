'use strict';

/**
 * Structured claim annotation validator for hallucination-detector.
 *
 * Parses labeled sections from assistant message text, extracts claim IDs and
 * labels, validates required metadata fields per label, validates the MEMORY
 * WRITE section, and returns machine-readable validation errors.
 *
 * No stdout side effects. Exports only.
 */

const { RETAINABLE_LABELS } = require('./hallucination-memory-gate.cjs');

// Canonical alternation string for valid claim labels — single source of truth.
// All regexes that match label brackets are built from this constant.
const CLAIM_LABEL_ALTERNATION = 'VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED';

// Regex to detect any label bracket in a line
const LABEL_RE = new RegExp(`\\[(${CLAIM_LABEL_ALTERNATION})\\]`, 'g');

// Regex to detect a structured response (has at least one label)
const STRUCTURED_RE = new RegExp(`\\[(${CLAIM_LABEL_ALTERNATION})\\]`);

// Timing-only evidence patterns: sentences dominated by temporal correlation with no mechanism
// These patterns match the full structure of a timing-only claim so we can identify it
// even when surrounded by filler words like "The outage ... with the deploy timing."
const TIMING_WORDS_RE =
  /\b(?:timing|same\s+time|around\s+the\s+same|coincided|after\s+(?:the\s+)?deploy|before\s+(?:the\s+)?deploy)\b/i;

// Additional timing-correlation pattern: "X coincided with Y" or "X happened around the same time as Y"
const TIMING_CORRELATION_RE =
  /\b(?:coincided?\s+with|happened?\s+(?:around|at)\s+the\s+same\s+time|occurred?\s+(?:around|at)\s+the\s+same\s+time|around\s+the\s+same\s+time\s+(?:as|when))\b/i;

// Causal verbs that flag [CORRELATED] claims phrased as causal
const CAUSAL_VERBS_RE = /\b(?:caused|because|due\s+to|led\s+to|resulted\s+in)\b/i;

// Mechanism indicators for CAUSAL evidence quality check (tool output, errors, experiments, etc.)
const MECHANISM_RE =
  /\b(?:explain|analysis|output|returned|showed|log|trace|stack|error|exception|metric|benchmark|test|experiment|measured|profil|query|explain\s+analyze)\b/i;

// Substantive claim detection heuristics for ANSWER section
const CLAIM_VERBS_RE =
  /\b(?:causes|caused|fails|failed|returns|broke|is\s+broken|is\s+missing|does\s+not|cannot|will\s+not|was\s+introduced|was\s+changed)\b/i;
const CLAIM_ARCHITECTURAL_RE = /(?:the\s+.{0,30}\s+is\s+.{0,30}because|the\s+root\s+cause)/i;

/**
 * Parse claim lines from a block of text.
 * Returns array of { id, label, text, lineIndex, allLabels } objects.
 *
 * @param {string[]} lines
 * @returns {Array<{id: string, label: string, text: string, lineIndex: number, allLabels: string[]}>}
 */
function parseClaimLines(lines) {
  const claims = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Find all labels on this line
    const labelsFound = [];
    for (const m of line.matchAll(LABEL_RE)) {
      labelsFound.push(m[1]);
    }
    if (labelsFound.length === 0) continue;

    // Check for claim ID [cN]
    const idMatch = line.match(/\[c(\d+)\]/);
    if (!idMatch) continue;

    const claimId = `c${idMatch[1]}`;
    // Primary label is the first one found
    const label = labelsFound[0];

    // Extract claim text (after the last bracket group)
    const afterBrackets = line.replace(/^\s*-?\s*(?:\[[\w\d]+\])+\s*/, '');

    claims.push({
      id: claimId,
      label,
      text: afterBrackets.trim(),
      lineIndex: i,
      allLabels: labelsFound,
    });
  }
  return claims;
}

/**
 * Find the metadata line (Evidence:, Basis:, etc.) for a claim.
 * Looks at the lines immediately following the claim line.
 *
 * @param {string[]} lines
 * @param {number} claimLineIndex
 * @param {string} metadataKey - e.g. 'Evidence:', 'Basis:', 'Missing:', 'Contradicted by:'
 * @returns {string|null}
 */
function findMetadataLine(lines, claimLineIndex, metadataKey) {
  // Search up to 3 lines after the claim line for the metadata field
  const keyLower = metadataKey.toLowerCase();
  for (let i = claimLineIndex + 1; i < Math.min(claimLineIndex + 4, lines.length); i++) {
    const line = lines[i];
    if (line.trim().toLowerCase().startsWith(keyLower)) {
      return line.trim();
    }
    // Stop if we hit another claim line or a blank section header
    if (STRUCTURED_RE.test(line) && /\[c\d+\]/.test(line)) break;
    // Stop at blank lines that precede a new section (two blanks = new section)
    if (line.trim() === '' && i + 1 < lines.length && lines[i + 1].trim() === '') break;
  }
  return null;
}

/**
 * Parse the MEMORY WRITE section from lines.
 * Returns { allowed: string[], blocked: string[], found: boolean }
 *
 * @param {string[]} lines
 * @returns {{ allowed: string[], blocked: string[], found: boolean }}
 */
function parseMemoryWriteSection(lines) {
  let inSection = false;
  const allowed = [];
  const blocked = [];
  let found = false;

  for (const line of lines) {
    if (/^MEMORY\s+WRITE\s*$/i.test(line.trim())) {
      inSection = true;
      found = true;
      continue;
    }
    if (!inSection) continue;

    // Stop at the next all-caps section header
    if (/^[A-Z][A-Z\s]+$/.test(line.trim()) && line.trim().length > 0 && !/^-/.test(line)) {
      break;
    }

    const allowedMatch = line.match(/^\s*-\s*Allowed:\s*(.+)/i);
    if (allowedMatch) {
      const ids = allowedMatch[1]
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^c\d+$/.test(s));
      allowed.push(...ids);
      continue;
    }

    const blockedMatch = line.match(/^\s*-\s*Blocked:\s*(.+)/i);
    if (blockedMatch) {
      const ids = blockedMatch[1]
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^c\d+$/.test(s));
      blocked.push(...ids);
    }
  }

  return { allowed, blocked, found };
}

/**
 * Extract the ANSWER section text from lines.
 * Returns lines between ANSWER header and the next section header.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function extractAnswerLines(lines) {
  let inAnswer = false;
  const answerLines = [];

  for (const line of lines) {
    if (/^ANSWER\s*$/i.test(line.trim())) {
      inAnswer = true;
      continue;
    }
    if (inAnswer) {
      // Stop at the next all-caps section header (not a list item)
      if (
        /^[A-Z][A-Z\s]+$/.test(line.trim()) &&
        line.trim().length > 0 &&
        !line.trim().startsWith('-')
      ) {
        break;
      }
      answerLines.push(line);
    }
  }

  return answerLines;
}

/**
 * Detect substantive unlabeled claims in ANSWER section lines.
 *
 * Conservative heuristic: only flag sentences that are:
 * - longer than 60 chars
 * - not list items (starting with - or *)
 * - contain claim-indicating verbs or architectural root-cause phrasing
 *
 * @param {string[]} answerLines
 * @returns {string[]} Array of flagged sentences
 */
function detectUnlabeledClaims(answerLines) {
  const flagged = [];
  for (const line of answerLines) {
    const trimmed = line.trim();
    if (trimmed.length <= 60) continue;
    if (trimmed.startsWith('-') || trimmed.startsWith('*')) continue;
    if (CLAIM_VERBS_RE.test(trimmed) || CLAIM_ARCHITECTURAL_RE.test(trimmed)) {
      flagged.push(trimmed);
    }
  }
  return flagged;
}

/**
 * Validate the structure of a labeled claim response.
 *
 * @param {string} text - The full assistant message text.
 * @returns {{
 *   valid: boolean,
 *   structured: boolean,
 *   claims: Array<{id: string, label: string}>,
 *   errors: Array<{code: string, claimId?: string, label?: string, message: string}>
 * }}
 */
function validateClaimStructure(text) {
  // Check if structured
  if (!STRUCTURED_RE.test(text)) {
    return { valid: true, structured: false, claims: [], errors: [] };
  }

  const lines = text.split('\n');
  const errors = [];

  // Parse all claim lines
  const claims = parseClaimLines(lines);

  // Check for duplicate claim IDs
  const seenIds = new Map();
  for (const claim of claims) {
    if (seenIds.has(claim.id)) {
      errors.push({
        code: 'duplicate_claim_id',
        claimId: claim.id,
        label: claim.label,
        message: `Duplicate claim ID ${claim.id}`,
      });
    } else {
      seenIds.set(claim.id, claim);
    }
  }

  // Check for multiple labels on a single claim
  for (const claim of claims) {
    if (claim.allLabels.length > 1) {
      errors.push({
        code: 'multiple_labels',
        claimId: claim.id,
        label: claim.label,
        message: `Claim ${claim.id} has multiple labels: ${claim.allLabels.join(', ')}`,
      });
    }
  }

  // Validate metadata fields per label (skip duplicates — already flagged)
  const validatedIds = new Set();
  for (const claim of claims) {
    if (validatedIds.has(claim.id)) continue;
    validatedIds.add(claim.id);

    if (claim.allLabels.length > 1) continue; // multiple_labels already flagged; skip metadata

    switch (claim.label) {
      case 'VERIFIED':
      case 'CORRELATED': {
        const evidenceLine = findMetadataLine(lines, claim.lineIndex, 'evidence:');
        if (!evidenceLine) {
          errors.push({
            code: 'missing_evidence',
            claimId: claim.id,
            label: claim.label,
            message: `${claim.label} claims require Evidence:`,
          });
        }
        break;
      }

      case 'CAUSAL': {
        const evidenceLine = findMetadataLine(lines, claim.lineIndex, 'evidence:');
        if (!evidenceLine) {
          errors.push({
            code: 'missing_evidence',
            claimId: claim.id,
            label: 'CAUSAL',
            message: 'CAUSAL claims require Evidence:',
          });
        } else {
          // Check for timing-only evidence: the evidence sentence contains timing
          // correlation patterns but no mechanism indicators.
          const evidenceContent = evidenceLine.replace(/^evidence:\s*/i, '').trim();
          const hasTiming =
            TIMING_WORDS_RE.test(evidenceContent) || TIMING_CORRELATION_RE.test(evidenceContent);
          if (hasTiming) {
            const hasMechanism = MECHANISM_RE.test(evidenceContent);
            if (!hasMechanism) {
              errors.push({
                code: 'weak_causal_evidence',
                claimId: claim.id,
                label: 'CAUSAL',
                message: `CAUSAL claim ${claim.id} has timing-only evidence (not mechanism or controlled comparison)`,
              });
            }
          }
        }
        break;
      }

      case 'INFERRED':
      case 'SPECULATION': {
        const basisLine = findMetadataLine(lines, claim.lineIndex, 'basis:');
        if (!basisLine) {
          errors.push({
            code: 'missing_basis',
            claimId: claim.id,
            label: claim.label,
            message: `${claim.label} claims require Basis:`,
          });
        }
        break;
      }

      case 'UNKNOWN': {
        const missingLine = findMetadataLine(lines, claim.lineIndex, 'missing:');
        if (!missingLine) {
          errors.push({
            code: 'missing_missing',
            claimId: claim.id,
            label: 'UNKNOWN',
            message: `UNKNOWN claims require Missing:`,
          });
        }
        break;
      }

      case 'REJECTED': {
        const contradictedLine = findMetadataLine(lines, claim.lineIndex, 'contradicted by:');
        if (!contradictedLine) {
          errors.push({
            code: 'missing_contradicted_by',
            claimId: claim.id,
            label: 'REJECTED',
            message: `REJECTED claims require Contradicted by:`,
          });
        }
        break;
      }
    }

    // Check [CORRELATED] for causal verb phrasing in the claim text
    if (claim.label === 'CORRELATED' && CAUSAL_VERBS_RE.test(claim.text)) {
      errors.push({
        code: 'correlated_as_causal',
        claimId: claim.id,
        label: 'CORRELATED',
        message: `CORRELATED claim ${claim.id} uses causal language (caused, because, due to, led to, resulted in)`,
      });
    }
  }

  // Check for missing MEMORY WRITE section
  const memWrite = parseMemoryWriteSection(lines);
  if (!memWrite.found) {
    errors.push({
      code: 'missing_memory_write_section',
      message: 'Structured response has labeled claims but no MEMORY WRITE section',
    });
  } else {
    // Validate MEMORY WRITE: non-retainable IDs must not appear in Allowed
    for (const id of memWrite.allowed) {
      const claim = seenIds.get(id);
      if (claim && !RETAINABLE_LABELS.has(claim.label)) {
        errors.push({
          code: 'invalid_memory_write',
          claimId: id,
          label: claim.label,
          message: `non-retainable claim ${id} [${claim.label}] listed in MEMORY WRITE Allowed`,
        });
      }
    }

    // Validate MEMORY WRITE: non-retainable claim IDs must appear in Blocked
    for (const [id, claim] of seenIds) {
      if (!RETAINABLE_LABELS.has(claim.label)) {
        if (!memWrite.blocked.includes(id)) {
          errors.push({
            code: 'missing_memory_write_blocked',
            claimId: id,
            label: claim.label,
            message: `non-retainable claim ${id} [${claim.label}] must appear in MEMORY WRITE Blocked`,
          });
        }
      }
    }
  }

  // Check ANSWER section for unlabeled substantive claims
  const answerLines = extractAnswerLines(lines);
  const unlabeled = detectUnlabeledClaims(answerLines);
  for (const sentence of unlabeled) {
    errors.push({
      code: 'unlabeled_claim',
      message: `Unlabeled substantive claim in ANSWER: "${sentence.slice(0, 80)}..."`,
    });
  }

  return {
    valid: errors.length === 0,
    structured: true,
    claims: [...seenIds.values()].map((c) => ({ id: c.id, label: c.label })),
    errors,
  };
}

module.exports = {
  validateClaimStructure,
  CLAIM_LABEL_ALTERNATION,
  // Internal exports for testing
  parseClaimLines,
  parseMemoryWriteSection,
  extractAnswerLines,
  detectUnlabeledClaims,
};
