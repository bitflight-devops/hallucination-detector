'use strict';

const {
  validateClaimStructure,
  hasConcreteSubstance,
  STRUCTURED_RE,
} = require('../scripts/hallucination-claim-structure.cjs');
const { computeMemoryGate } = require('../scripts/hallucination-memory-gate.cjs');

// =============================================================================
// validateClaimStructure — structured vs unstructured detection
// =============================================================================
describe('validateClaimStructure — structured detection', () => {
  it('unstructured response returns structured:false, valid:true', () => {
    const text = 'The server is running on port 3000. I checked the logs and found no errors.';
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('response with [VERIFIED] label is detected as structured', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][c1] The config file exists at /etc/app/config.json
  Evidence: Read tool output showed the file at that path.

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(true);
  });

  it('response with [INFERRED] label is detected as structured', () => {
    const text = `ANSWER
- Direct answer.

INFERRED
- [INFERRED][c1] The process is likely OOM-killed
  Basis: memory usage was near the limit before restart.

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(true);
  });
});

// =============================================================================
// STRUCTURED_RE — bare label does not trigger structured mode
// =============================================================================
describe('validateClaimStructure — bare label adoption cliff fix', () => {
  it('STRUCTURED_RE does not match a bare [VERIFIED] without claim ID', () => {
    expect(STRUCTURED_RE.test('[VERIFIED] The symlinks are gone')).toBe(false);
  });

  it('STRUCTURED_RE matches [VERIFIED][c1] with claim ID', () => {
    expect(STRUCTURED_RE.test('[VERIFIED][c1] The symlinks are gone')).toBe(true);
  });

  it('bare [VERIFIED] without claim ID returns structured:false, valid:true', () => {
    const text = 'The symlinks are gone. [VERIFIED] The directory listing is clean.';
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('multiple bare labels without claim IDs return structured:false', () => {
    const text = [
      'The fix is in place.',
      '[VERIFIED] The symlinks are gone.',
      '[INFERRED] The service will restart cleanly.',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('mixed bare and formal labels: at least one [LABEL][cN] returns structured:true', () => {
    const text = [
      'ANSWER',
      '- Task acknowledged.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The config file exists at /etc/app.json',
      '  Evidence: File: /etc/app.json confirmed via Read tool.',
      '',
      '[INFERRED] The service may restart — bare label, no ID.',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: (none)',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.structured).toBe(true);
  });

  it('informal [VERIFIED] label in prose does not block (regression: adoption cliff)', () => {
    const text = [
      'I checked the directory.',
      '[VERIFIED] The symlinks are gone.',
      'No further action needed.',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    // Must not produce missing_memory_write_section
    expect(result.errors.some((e) => e.code === 'missing_memory_write_section')).toBe(false);
  });
});

// =============================================================================
// Valid structured responses
// =============================================================================
describe('validateClaimStructure — valid structured responses', () => {
  it('well-formed VERIFIED + INFERRED + MEMORY WRITE passes', () => {
    const text = `ANSWER
- Direct response to the task.

VERIFIED
- [VERIFIED][c1] The config file is at /etc/app.json
  Evidence: Tool: Read tool confirmed the file exists at that path.

INFERRED
- [INFERRED][c2] The service restarts on config change
  Basis: systemd unit file has Restart=on-failure.

MEMORY WRITE
- Allowed: c1
- Blocked: c2`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.claims.length).toBe(2);
  });

  it('[UNKNOWN] without speculative phrasing passes', () => {
    const text = `ANSWER
- Direct answer.

UNKNOWN
- [UNKNOWN][c1] Whether the database is replicated
  Missing: No replication config found in the codebase.

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('[SPECULATION] present and blocked from memory passes', () => {
    const text = `ANSWER
- Direct answer.

SPECULATION
- [SPECULATION][c1] A misconfigured timeout could cause retries
  Basis: The timeout value is unusually low compared to network latency.

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('[CORRELATED] present and not phrased causally passes', () => {
    const text = `ANSWER
- Direct answer.

CORRELATED
- [CORRELATED][c1] High memory usage and slow response times co-occur
  Evidence: Log: Both metrics spike at the same time in the dashboard.

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('[CAUSAL] with mechanism evidence passes', () => {
    const text = `ANSWER
- Direct answer.

CAUSAL
- [CAUSAL][c1] The missing index causes full table scans
  Evidence: Output: EXPLAIN ANALYZE output shows Seq Scan on orders (cost=0.00..45231.00).

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('MEMORY WRITE containing only [VERIFIED] and [CAUSAL] passes', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][c1] The endpoint returns 200
  Evidence: Command: curl output showed HTTP/1.1 200 OK.

CAUSAL
- [CAUSAL][c2] The missing index causes full table scans
  Evidence: Output: EXPLAIN ANALYZE shows Seq Scan.

MEMORY WRITE
- Allowed: c1, c2
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

// =============================================================================
// Invalid structured responses — error codes
// =============================================================================
describe('validateClaimStructure — invalid structured responses', () => {
  it('[VERIFIED] without Evidence: produces missing_evidence', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][c1] The config file exists at /etc/app.json

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'missing_evidence');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
    expect(err.label).toBe('VERIFIED');
  });

  it('[CAUSAL] with timing-only evidence produces weak_causal_evidence', () => {
    const text = `ANSWER
- Direct answer.

CAUSAL
- [CAUSAL][c1] The deploy caused the outage
  Evidence: The outage coincided with the deploy timing.

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'weak_causal_evidence');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('[CORRELATED] phrased as causal produces correlated_as_causal', () => {
    const text = `ANSWER
- Direct answer.

CORRELATED
- [CORRELATED][c1] High memory caused slow responses
  Evidence: Both metrics spike at the same time.

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'correlated_as_causal');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('[INFERRED] listed in Allowed: produces invalid_memory_write', () => {
    const text = `ANSWER
- Direct answer.

INFERRED
- [INFERRED][c1] The process is OOM-killed
  Basis: memory near limit before restart.

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'invalid_memory_write');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('retainable claim missing from Blocked: produces missing_memory_write_blocked', () => {
    // c1 is INFERRED (non-retainable) — it must appear in Blocked but does not
    const text = `ANSWER
- Direct answer.

INFERRED
- [INFERRED][c1] The process is OOM-killed
  Basis: memory near limit before restart.

MEMORY WRITE
- Allowed: (none)
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'missing_memory_write_blocked');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('duplicate claim IDs produce duplicate_claim_id', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][c1] Claim one
  Evidence: tool output showed it.

INFERRED
- [INFERRED][c1] Claim two (same ID)
  Basis: reasoning from context.

MEMORY WRITE
- Allowed: c1
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'duplicate_claim_id');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('[UNKNOWN] without Missing: produces missing_missing', () => {
    const text = `ANSWER
- Direct answer.

UNKNOWN
- [UNKNOWN][c1] Whether the database is replicated

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'missing_missing');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('[REJECTED] without Contradicted by: produces missing_contradicted_by', () => {
    const text = `ANSWER
- Direct answer.

REJECTED
- [REJECTED][c1] The config was missing

MEMORY WRITE
- Allowed: (none)
- Blocked: c1`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'missing_contradicted_by');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });

  it('structured response with no MEMORY WRITE section produces missing_memory_write_section', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][c1] The file exists
  Evidence: Read tool output confirmed.`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'missing_memory_write_section');
    expect(err).toBeDefined();
  });

  it('multiple labels on one claim produce multiple_labels', () => {
    const text = `ANSWER
- Direct answer.

VERIFIED
- [VERIFIED][INFERRED][c1] Ambiguous claim
  Evidence: some evidence here.

MEMORY WRITE
- Allowed: c1
- Blocked: (none)`;
    const result = validateClaimStructure(text);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === 'multiple_labels');
    expect(err).toBeDefined();
    expect(err.claimId).toBe('c1');
  });
});

// =============================================================================
// detectUnlabeledClaims — strengthened ANSWER section validation
// =============================================================================
describe('validateClaimStructure — strengthened unlabeled_claim detection', () => {
  it('ANSWER containing a recommendation produces unlabeled_claim', () => {
    const text = [
      'ANSWER',
      'Both items should be corrected before the next release to avoid regression in production.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The config file exists at /app/config.yml',
      '  Evidence: File: /app/config.yml confirmed via Read tool',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.some((e) => e.code === 'unlabeled_claim')).toBe(true);
  });

  it('ANSWER with claim ID reference does not produce unlabeled_claim', () => {
    const text = [
      'ANSWER',
      '- Request acknowledged. See claims c1 and c2 below for details on what should change.',
      '',
      'VERIFIED',
      '- [VERIFIED][c1] The config uses 4-space indentation',
      '  Evidence: File: /app/.editorconfig line 3',
      '',
      'INFERRED',
      '- [INFERRED][c2] The linter expects 2-space indentation',
      '  Basis: Default eslint config pattern',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked: c2',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unlabeled_claim')).toHaveLength(0);
  });
});

// =============================================================================
// vague_verified_evidence — evidence quality check
// =============================================================================
describe('validateClaimStructure — vague_verified_evidence', () => {
  it('VERIFIED with vague evidence produces vague_verified_evidence', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] All prompt hooks are on SubagentStop',
      '  Evidence: Explore agent findings reported in this session',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.some((e) => e.code === 'vague_verified_evidence')).toBe(true);
  });

  it('VERIFIED with concrete evidence does not produce vague_verified_evidence', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The handler returns 400 before any DB call',
      '  Evidence: File: src/handlers/create.js line 47',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'vague_verified_evidence')).toHaveLength(0);
  });
});

// =============================================================================
// unnormalized_evidence — evidence prefix validation
// =============================================================================
describe('validateClaimStructure — unnormalized_evidence', () => {
  it('VERIFIED with unprefixed vague evidence produces unnormalized_evidence', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The retry logic has a nil dereference',
      '  Evidence: the analysis confirmed the finding',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.some((e) => e.code === 'unnormalized_evidence')).toBe(true);
  });

  it('VERIFIED with prefixed evidence does not produce unnormalized_evidence', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The retry logic has a nil dereference',
      '  Evidence: Trace: stack trace shows panic at line 88',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unnormalized_evidence')).toHaveLength(0);
  });
});

// =============================================================================
// hasConcreteSubstance — unit tests
// =============================================================================
describe('hasConcreteSubstance', () => {
  it('returns true for tool name + numeric result', () => {
    expect(hasConcreteSubstance('Glob output shows 18 files returned')).toBe(true);
  });

  it('returns true for stack trace + line reference', () => {
    expect(hasConcreteSubstance('stack trace shows panic at line 88')).toBe(true);
  });

  it('returns true for file path', () => {
    expect(hasConcreteSubstance('/etc/app/config.json exists and contains the key')).toBe(true);
  });

  it('returns true for HTTP status code + observation verb', () => {
    expect(hasConcreteSubstance('HTTP 404 returned from the endpoint')).toBe(true);
  });

  it('returns false for vague check phrase', () => {
    expect(hasConcreteSubstance('I checked and it looks correct')).toBe(false);
  });

  it('returns false for vague analysis phrase', () => {
    expect(hasConcreteSubstance('the analysis confirmed the finding')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasConcreteSubstance('')).toBe(false);
  });
});

// =============================================================================
// unnormalized_evidence — integration tests with hasConcreteSubstance fallback
// =============================================================================
describe('validateClaimStructure — unnormalized_evidence with concrete substance fallback', () => {
  it('VERIFIED with "Glob output shows 18 files returned" (no prefix, has substance) passes', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The agents directory contains 18 files',
      '  Evidence: Glob output shows 18 files returned',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unnormalized_evidence')).toHaveLength(0);
  });

  it('VERIFIED with "I checked and it\'s fine" (no prefix, no substance) produces unnormalized_evidence', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The configuration is correct',
      "  Evidence: I checked and it's fine",
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.some((e) => e.code === 'unnormalized_evidence')).toBe(true);
  });

  it('VERIFIED with "Tool: Glob shows 18 files" (has prefix) passes', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The agents directory contains 18 files',
      '  Evidence: Tool: Glob shows 18 files',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unnormalized_evidence')).toHaveLength(0);
  });

  it('new prefix Glob: passes', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] The agents directory contains 18 files',
      '  Evidence: Glob: .claude/agents/*.md returned 18 files',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unnormalized_evidence')).toHaveLength(0);
  });

  it('new prefix Observation: passes', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] No symlinks are present in the directory',
      '  Evidence: Observation: directory listing shows no symlinks',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.filter((e) => e.code === 'unnormalized_evidence')).toHaveLength(0);
  });

  it('vague evidence still produces vague_verified_evidence (regression)', () => {
    const text = [
      'VERIFIED',
      '- [VERIFIED][c1] All prompt hooks are on SubagentStop',
      '  Evidence: Explore agent findings reported in this session',
      '',
      'MEMORY WRITE',
      '- Allowed: c1',
      '- Blocked:',
    ].join('\n');
    const result = validateClaimStructure(text);
    expect(result.errors.some((e) => e.code === 'vague_verified_evidence')).toBe(true);
  });
});

// =============================================================================
// computeMemoryGate
// =============================================================================
describe('computeMemoryGate', () => {
  it('puts VERIFIED claims in allowed', () => {
    const claims = [{ id: 'c1', label: 'VERIFIED' }];
    const gate = computeMemoryGate(claims);
    expect(gate.allowed).toContain('c1');
    expect(gate.blocked).not.toContain('c1');
  });

  it('puts CAUSAL claims in allowed', () => {
    const claims = [{ id: 'c1', label: 'CAUSAL' }];
    const gate = computeMemoryGate(claims);
    expect(gate.allowed).toContain('c1');
    expect(gate.blocked).not.toContain('c1');
  });

  it('puts INFERRED claims in blocked', () => {
    const claims = [{ id: 'c1', label: 'INFERRED' }];
    const gate = computeMemoryGate(claims);
    expect(gate.blocked).toContain('c1');
    expect(gate.allowed).not.toContain('c1');
  });

  it('puts UNKNOWN claims in blocked', () => {
    const claims = [{ id: 'c1', label: 'UNKNOWN' }];
    const gate = computeMemoryGate(claims);
    expect(gate.blocked).toContain('c1');
  });

  it('puts SPECULATION claims in blocked', () => {
    const claims = [{ id: 'c1', label: 'SPECULATION' }];
    const gate = computeMemoryGate(claims);
    expect(gate.blocked).toContain('c1');
  });

  it('puts CORRELATED claims in blocked', () => {
    const claims = [{ id: 'c1', label: 'CORRELATED' }];
    const gate = computeMemoryGate(claims);
    expect(gate.blocked).toContain('c1');
  });

  it('puts REJECTED claims in blocked', () => {
    const claims = [{ id: 'c1', label: 'REJECTED' }];
    const gate = computeMemoryGate(claims);
    expect(gate.blocked).toContain('c1');
  });

  it('handles mixed claims correctly', () => {
    const claims = [
      { id: 'c1', label: 'VERIFIED' },
      { id: 'c2', label: 'INFERRED' },
      { id: 'c3', label: 'CAUSAL' },
      { id: 'c4', label: 'SPECULATION' },
    ];
    const gate = computeMemoryGate(claims);
    expect(gate.allowed).toEqual(['c1', 'c3']);
    expect(gate.blocked).toEqual(['c2', 'c4']);
  });

  it('returns empty arrays for empty input', () => {
    const gate = computeMemoryGate([]);
    expect(gate.allowed).toEqual([]);
    expect(gate.blocked).toEqual([]);
  });
});
