'use strict';

const { validateClaimStructure } = require('../scripts/hallucination-claim-structure.cjs');
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
// Valid structured responses
// =============================================================================
describe('validateClaimStructure — valid structured responses', () => {
  it('well-formed VERIFIED + INFERRED + MEMORY WRITE passes', () => {
    const text = `ANSWER
- Direct response to the task.

VERIFIED
- [VERIFIED][c1] The config file is at /etc/app.json
  Evidence: Read tool confirmed the file exists at that path.

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
  Evidence: Both metrics spike at the same time in the dashboard.

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
  Evidence: EXPLAIN ANALYZE output shows Seq Scan on orders (cost=0.00..45231.00).

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
  Evidence: curl output showed HTTP/1.1 200 OK.

CAUSAL
- [CAUSAL][c2] The missing index causes full table scans
  Evidence: EXPLAIN ANALYZE shows Seq Scan.

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
