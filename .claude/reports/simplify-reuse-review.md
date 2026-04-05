# Code Reuse Review — 24-hour diff

Reviewed diff file: `/home/ubuntulinuxqa2/.claude/projects/-home-ubuntulinuxqa2-repos-hallucination-detector/23943de9-ce68-444e-a4ec-9b7d29fb2fc2/tool-results/b0lf1vqqo.txt`

Changed files examined: `scripts/hallucination-audit-stop.cjs`, `scripts/hallucination-claim-structure.cjs`, `scripts/hallucination-memory-gate.cjs`, `scripts/hallucination-framing-session-start.cjs`, `tests/hallucination-audit-stop.test.cjs`, `tests/hallucination-claim-structure.test.cjs`, `vitest.config.cjs`, `.claude/CLAUDE.md`, `.claude/agents/javascript-pro.md`, `.claude/rules/issue-management.md`.

---

## Finding 1: Duplicate `evidenceLine.replace(/^evidence:\s*/i, '').trim()` inline — two callsites, no helper

**File(s):** `scripts/hallucination-claim-structure.cjs:304`, `scripts/hallucination-claim-structure.cjs:334`

**Issue:** The expression `evidenceLine.replace(/^evidence:\s*/i, '').trim()` appears verbatim on both lines 304 and 334 inside `validateClaimStructure()` — once in the `VERIFIED`/`CORRELATED` branch and once in the `CAUSAL` branch. Both then pass the result to `VAGUE_EVIDENCE_RE.test()` and `EVIDENCE_PREFIX_RE.test()`. The logic for extracting and checking evidence content is copy-pasted rather than shared.

**Existing utility:** None yet. Extract a one-line helper `extractEvidenceContent(line)` returning `line.replace(/^evidence:\s*/i, '').trim()`, then call it from both sites. This is the minimal change: the two identical expressions collapse to one named function.

**Severity:** low

---

## Finding 2: Evidence quality checks (`VAGUE_EVIDENCE_RE` + `EVIDENCE_PREFIX_RE`) duplicated across two `switch` branches

**File(s):** `scripts/hallucination-claim-structure.cjs:305–318` (VERIFIED/CORRELATED branch), `scripts/hallucination-claim-structure.cjs:336–362` (CAUSAL branch)

**Issue:** The sequence — (1) strip the `Evidence:` prefix, (2) check `VAGUE_EVIDENCE_RE`, (3) if not vague, check `EVIDENCE_PREFIX_RE` — is structurally identical in both branches. The only difference is the hardcoded label string in the error message (`VERIFIED`/`CORRELATED` vs `CAUSAL`). The error codes (`vague_verified_evidence`, `unnormalized_evidence`) and the error object shape are the same in both.

The CAUSAL branch adds a third check (timing-only evidence via `TIMING_WORDS_RE` + `MECHANISM_RE`) that runs after the vague/unnormalized checks, but the first two checks are pure duplication.

**Existing utility:** The two new regex constants `VAGUE_EVIDENCE_RE` and `EVIDENCE_PREFIX_RE` are the right start — they're module-level constants. The missing step is extracting the compound check into a shared function, e.g.:

```js
function checkEvidenceQuality(evidenceContent, claimId, label) {
  const errors = [];
  if (VAGUE_EVIDENCE_RE.test(evidenceContent)) {
    errors.push({ code: 'vague_verified_evidence', claimId, label,
      message: `${label} evidence must cite a concrete source ..., not "${evidenceContent}"` });
  } else if (!EVIDENCE_PREFIX_RE.test(evidenceContent)) {
    errors.push({ code: 'unnormalized_evidence', claimId, label,
      message: `${label} evidence should use a normalized prefix ...` });
  }
  return errors;
}
```

Both the VERIFIED/CORRELATED branch and the CAUSAL branch call this function, then the CAUSAL branch runs its additional timing check only when `errors.length === 0`.

**Severity:** medium

---

## Finding 3: `makeTempTranscript` in test file duplicates the transcript-building pattern used in loop-guard tests

**File(s):** `tests/hallucination-audit-stop.test.cjs:1503–1514` (new `makeTempTranscript` helper), `tests/hallucination-audit-stop.test.cjs:1860–1864` (loop-guard tests also call `makeTempTranscript`)

**Issue:** This is not a duplication — `makeTempTranscript` was correctly extracted as a shared helper and is reused by both the structured-valid and loop-guard test suites. Noted here for completeness: the pattern is correct.

**Severity:** N/A — no issue

---

## Finding 4: `BLOCK_HEADER` constant defined in `hallucination-audit-stop.cjs` but the framing text in `hallucination-framing-session-start.cjs` repeats the evidence prefix list inline

**File(s):** `scripts/hallucination-audit-stop.cjs` (new `BLOCK_HEADER` constant), `scripts/hallucination-framing-session-start.cjs` (framing text string, line ~344), `.claude/CLAUDE.md` (documentation table)

**Issue:** The list of recognized evidence prefixes (`File:`, `Log:`, `Test:`, `Doc:`, `Tool:`, `User:`, `Transcript:`, `Code:`, `Command:`, `Output:`, `Error:`, `Config:`, `Trace:`, `Repro:`) appears in three places:

1. `EVIDENCE_PREFIX_RE` in `hallucination-claim-structure.cjs` (the authoritative regex)
2. Prose in error messages in `validateClaimStructure()` (two callsites: lines ~308 and ~343, listing only a subset — `File:`, `Log:`, `Test:`, `Doc:`, `Tool:`, `User:`, `Transcript:`)
3. The framing text string in `hallucination-framing-session-start.cjs`

The error messages in `validateClaimStructure()` list 7 prefixes (`File:`, `Log:`, `Test:`, `Doc:`, `Tool:`, `User:`, `Transcript:`) while `EVIDENCE_PREFIX_RE` and the framing text list 14. This is a divergence introduced by the new evidence quality checks. When a new prefix is added to `EVIDENCE_PREFIX_RE`, the error message prose will silently go stale.

**Existing utility:** `EVIDENCE_PREFIX_RE` is already the authoritative source. The error messages should either derive the list from a shared constant (e.g., a `RECOGNIZED_EVIDENCE_PREFIXES` array that both the regex and the prose reference), or the prose in error messages should state "a recognized prefix" rather than enumerating them.

**Severity:** medium

---

## Finding 5: `STRUCTURED_BLOCK_FORMAT` template string in `hallucination-audit-stop.cjs` duplicates the structured format example already maintained in `hallucination-framing-session-start.cjs`

**File(s):** `scripts/hallucination-audit-stop.cjs` (new `STRUCTURED_BLOCK_FORMAT` constant, lines ~2124–2161 in diff), `scripts/hallucination-framing-session-start.cjs` (framing text contains identical structured format example)

**Issue:** The block reason emitted by `buildStructuralBlockReason()` includes a full copy of the structured response format (ANSWER / VERIFIED / INFERRED / UNKNOWN / SPECULATION / CORRELATED / CAUSAL / REJECTED / NEXT VERIFICATION / MEMORY WRITE with all metadata fields). The session-start framing text in `hallucination-framing-session-start.cjs` also renders the same format for Claude's context. These are maintained separately. If a new label is added, both must be updated. There is no shared source.

**Existing utility:** None yet. The two uses serve different audiences (framing = instruction for Claude, block reason = corrective prompt). A shared constant is feasible — export `STRUCTURED_BLOCK_FORMAT` from `hallucination-claim-structure.cjs` (which already owns the label taxonomy) and import it into both scripts. This keeps the label taxonomy co-located with the validator that enforces it.

**Severity:** low — divergence is currently small because both were added in the same commit, but will drift as labels evolve.

---

## Finding 6: `CLAIM_LABEL_ALTERNATION` is exported from `hallucination-claim-structure.cjs` and consumed by `hallucination-audit-stop.cjs` — correct pattern, fully applied

**File(s):** `scripts/hallucination-claim-structure.cjs:17`, `scripts/hallucination-audit-stop.cjs` import

**Issue:** No issue. The pattern is implemented correctly — `CLAIM_LABEL_ALTERNATION` is the single source of truth for the label set, exported and imported. `LABELED_CLAIM_LINE_RE` and `STRUCTURED_RE` are both built from it. This is the right approach.

**Severity:** N/A — no issue

---

## Finding 7: `computeMemoryGate` in `hallucination-memory-gate.cjs` is not called from `hallucination-audit-stop.cjs`

**File(s):** `scripts/hallucination-memory-gate.cjs`, `scripts/hallucination-audit-stop.cjs`

**Issue:** `hallucination-memory-gate.cjs` exports `computeMemoryGate(claims)` to compute `{ allowed, blocked }` sets. `hallucination-audit-stop.cjs` imports `validateClaimStructure` from `hallucination-claim-structure.cjs`, which internally uses `RETAINABLE_LABELS` from `hallucination-memory-gate.cjs` to validate MEMORY WRITE. However, the stop hook itself never calls `computeMemoryGate`. The validation result `structureResult.claims` (an array of `{ id, label }`) is discarded after structural validation — `computeMemoryGate` is not called to gate actual persistence.

This is not a duplication issue, but it is a dead-utility issue: `computeMemoryGate` exists without a consumer in the enforcement path. Either the stop hook should call it (and use the result for something), or the utility is currently only useful for downstream callers outside this diff. Flagged for awareness.

**Severity:** low — the utility is tested in `tests/hallucination-claim-structure.test.cjs`, so it is not dead code in the test sense. But it has no wiring into the enforcement pipeline yet.

---

## Summary

| Finding                                                                                         | Files                                                                     | Severity |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| 1: Duplicate `evidenceContent` extraction expression                                            | `hallucination-claim-structure.cjs:304,334`                               | low      |
| 2: Evidence quality check sequence duplicated across VERIFIED and CAUSAL branches               | `hallucination-claim-structure.cjs:305–362`                               | medium   |
| 3: `makeTempTranscript` helper — correct reuse, no issue                                        | —                                                                         | N/A      |
| 4: Evidence prefix list in error messages diverges from `EVIDENCE_PREFIX_RE` (7 vs 14 prefixes) | `hallucination-claim-structure.cjs` error messages                        | medium   |
| 5: `STRUCTURED_BLOCK_FORMAT` duplicates framing text format                                     | `hallucination-audit-stop.cjs`, `hallucination-framing-session-start.cjs` | low      |
| 6: `CLAIM_LABEL_ALTERNATION` single-source pattern — correct, no issue                          | —                                                                         | N/A      |
| 7: `computeMemoryGate` exists but has no consumer in the enforcement path                       | `hallucination-memory-gate.cjs`                                           | low      |

The two medium-severity findings (2 and 4) are the highest-priority candidates for cleanup. Finding 2 is a direct code duplication that will grow as more evidence checks are added. Finding 4 is a silent divergence: the validator will reject evidence that the error message doesn't tell the user to add.
