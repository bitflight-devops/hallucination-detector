# Fix Sequence Specification

# Hallucination Detector — FP Reduction + Template Structure

# Date: 2026-04-04

# Baseline: docs/baseline-2026-04-04.yaml

## Measurement Protocol

After each fix, run the same DuckDB audit used to produce the baseline:

- Search for exact block header text across all JSONL session files
- Extract category, trigger phrase, session type
- Sample 20 blocks for FP classification (same methodology as baseline)
- Compare against baseline numbers

Key metrics to move on each fix:

| Metric                       | Baseline | Direction |
| ---------------------------- | -------- | --------- |
| Compact agent blocks         | 119      | → 0       |
| `may` blocks                 | 79       | → <10     |
| `because`/`since` blocks     | 32       | → <8      |
| `assume` blocks              | 21       | → <5      |
| `all tests pass` blocks      | 3        | → 0       |
| Estimated FP rate            | 65%      | → <25%    |
| Sessions with 3+ blocks      | 64       | → <20     |
| Max blocks single session    | 14       | → ≤2      |
| Single-retry resolution rate | 38.6%    | → >65%    |

---

## Fix 1 — Fail-open loop counter (bug fix)

**Problem:** Documented limit is 2 blocks per session, but sessions show up to 14 blocks.
The state file `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` stores `{ blocks: N }`.

**Investigation needed before spec:** Read the state read/write/check logic in
`scripts/hallucination-audit-stop.cjs` to determine whether:

- The counter is checked before or after incrementing
- The counter resets on each turn (off-by-one in session vs. turn scope)
- The state file is being written correctly after each block

**Acceptance criteria:**

- No session accumulates more than 2 consecutive blocks on the same trigger
- After 2 blocks, the response passes through (fail-open as documented)
- State file is cleaned up or correctly scoped

**Metrics moved:** Max blocks single session 14 → ≤2, sessions with 3+ blocks 64 → <20

---

## Fix 2 — Exempt compact agents

**Problem:** 119 blocks on compact agents. Compact agents summarize existing conversation
content — they cannot rephrase words that were said in the conversation being summarized.
Blocking them forces less accurate summaries.

**Detection approach:** Compact agent sessions have a characteristic transcript structure —
the first human message is a compaction instruction from Claude Code (not a user message).
Need to verify this pattern by reading a compact agent JSONL.

The stop hook receives `transcript_path`. Reading the first few records of the transcript
will reveal whether this is a compaction session. If the first human message contains
a compaction directive, skip all trigger detection.

**Alternative approach:** Check the `source` field if it's present in stop hook stdin.
Research whether Claude Code sets a source field for compact sessions.

**Acceptance criteria:**

- Compact agent sessions: 0 blocks
- All other session types: unaffected

**Metrics moved:** Compact agent blocks 119 → 0, total blocks 540 → ~421

---

## Fix 3 — Context-aware suppression for "may", "because", "since", "assume"

**Problem:** These four phrases account for ~134 blocks (25% of total) with high FP rates.
Each has a legitimate use that the hook does not distinguish from the problematic use.

### "may" — epistemic vs. deontic

- Block: "The fix may work" (epistemic uncertainty — no verification)
- Allow: "You may provide X" / "the config may contain" / "users may encounter"
- Allow: Documentation language: "the parameter may be omitted"
- Suppression rule: when "may" is preceded by a second-person pronoun ("you may"),
  a definite article + noun describing a non-system entity, or is in a documentation
  context (the sentence contains "parameter", "option", "argument", "field", "value")

### "because" — grounded vs. ungrounded causality

- Block: "The test fails because the mock is wrong" (causal claim without test evidence)
- Allow: "I stopped because X" (self-description), "because of the config setting" (citing
  existing artifact), "because the output shows" (followed by evidence)
- Current: `hasEvidenceNearby` with 150-char window exists but is insufficient
- Suppression rule: expand evidence window to 300 chars; add suppression when "because"
  is followed within 50 chars by a file path, error message, or tool output reference

### "since" — causal vs. temporal

- Block: "Since this imports X, it cannot work" (unverified causal chain)
- Allow: "Since 2024" (temporal), "since the last commit" (temporal), "since we changed X"
  (referencing a known fact)
- Suppression rule: suppress when "since" is followed by a time reference or past tense
  clause that references a completed action

### "assume" — speculation vs. declared operating assumption

- Block: "I assume this is the correct behavior" (guess)
- Allow: "I will assume the default configuration" (explicit operating choice),
  "assuming X is set" (conditional framing), "I'll assume you want Y" (clarifying)
- Suppression rule: suppress when "assume" is preceded by "I will", "I'll", "assuming",
  or is in a conditional construction ("assuming X, then Y")

**Acceptance criteria:**

- `may` blocks reduced from 79 to <10
- `because`/`since` blocks reduced from 32 to <8
- `assume` blocks reduced from 21 to <5
- True positive rate for speculation_language does not decrease below 30%

**Metrics moved:** FP rate 65% → ~40%, total blocks ~421 → ~280

---

## Fix 4 — Allow completeness claims with adjacent tool run evidence

**Problem:** "All tests pass" / "fully implemented" / "all complete" get blocked even when
the response contains explicit tool output showing the test run.

**Current behavior:** `completeness_claim` has no evidence-proximity check.
`causality_language` has `hasEvidenceNearby` but completeness does not.

**Fix:** Add `hasEvidenceNearby` check to `completeness_claim` category.
Evidence markers specific to completeness context:

- Test counts: `/\d+\/\d+\s*(?:passing|tests?)/`
- Exit codes: `/exit\s*code\s*0/`
- Tool output references: the `` ` `` (code span) within 200 chars
- "pnpm test", "vitest run", "pytest" within 300 chars before the claim

**Acceptance criteria:**

- "All tests pass" blocked rate drops to ~0 when preceded by test runner output
- "Fully implemented" still blocks when no tool evidence present
- `all_tests_pass` blocks 3 → 0

**Metrics moved:** Total blocks ~280 → ~275, but quality of remaining blocks improves

---

## Fix 5 — Structured output fast-path (template system)

This is the forward-looking change. Fixes 1-4 reduce damage from the existing hook.
Fix 5 creates the positive expression contract.

### Three templates injected at SessionStart

**TOOL RUN** — required for any behavioral claim after running a command:

```
TOOL RUN
Command: [exact command]
Observed: [specific output]
Scope: [what this covers]
Does not cover: [what this does not establish]
```

**AGENT REPORT** — required when relaying subagent findings as status:

```
AGENT REPORT (from: [agent name/task ID])
Reported: [what the agent said]
Independently verified: [yes — what was verified | no]
```

**COMMITTED** — required after a git commit when claiming completion:

```
COMMITTED [hash]
Changes: [what was changed]
Validation: [what was run | none run]
```

### Hook changes

**Structural validator** (new function, runs before trigger scan):

1. Detect presence of any template block (`^TOOL RUN\n`, `^AGENT REPORT`, `^COMMITTED`)
2. If present: validate all required fields are non-empty
3. If valid: suppress `ungrounded_behavioral_assertion` trigger scan
4. If invalid: block with specific missing fields listed

**New trigger category: `ungrounded_behavioral_assertion`** — Active (shadow mode, 2026-04-05).
Shipped before Fixes 1-4 gate and before FP rate measurement. The FP < 25% gate still
applies before switching to blocking mode.

### Acceptance criteria:

- Responses using valid TOOL RUN structure: 0 blocks for behavioral assertions
- Responses using TOOL RUN with missing fields: blocked with specific field name
- Bare "it works" / "the fix works": blocked
- "I ran X and observed Y" (prose, no template): allowed if both run + observation present

**Metrics moved:** FP rate target <25%, single-retry resolution rate >65%

---

## Measurement re-run protocol

After each fix is deployed, re-run the audit with this exact question to the
agentskill-kaizen:transcript-analyst:

> "Compare block patterns against baseline at docs/baseline-2026-04-04.yaml.
> Use the same DuckDB methodology. Report: total blocks, blocks by session type,
> blocks by category, top 5 trigger phrases, estimated FP rate from 20-sample,
> sessions with 3+ blocks, max blocks in single session."

Write comparison results to `~/.hd/audits/audit-YYYY-MM-DD.yaml` in the same
schema as the baseline for direct diff.

---

## Sequence and dependencies

```
Fix 1 (loop counter) — no dependencies, do first
Fix 2 (compact exemption) — no dependencies, do in parallel with Fix 1
Fix 3 (narrow triggers) — after Fix 1 (ensures loop counter works before testing new suppressions)
Fix 4 (completeness + evidence) — after Fix 3 (same codebase area)
  → Measurement checkpoint: confirm FP rate below 30% before proceeding
Fix 5 (template system) — after checkpoint passes
  ⚠️ NOTE: Fix 5c (ungrounded_behavioral_assertion) shipped active (shadow mode, 2026-04-05)
  before this checkpoint. FP rate confirmation pending before switching to blocking mode.
```

## Files affected

| Fix | Files                                                                                     |
| --- | ----------------------------------------------------------------------------------------- |
| 1   | `scripts/hallucination-audit-stop.cjs` (state logic)                                      |
| 2   | `scripts/hallucination-audit-stop.cjs` (transcript read at startup)                       |
| 3   | `scripts/hallucination-audit-stop.cjs` (trigger categories)                               |
| 4   | `scripts/hallucination-audit-stop.cjs` (completeness_claim category)                      |
| 5   | `scripts/hallucination-audit-stop.cjs`, `scripts/hallucination-framing-session-start.cjs` |

All implementation delegated to `javascript-pro` agent per project rules.
Tests updated for each fix: `tests/hallucination-audit-stop.test.cjs`.
