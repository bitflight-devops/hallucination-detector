# Code Reuse Review — simplify-reuse.md

Reviewed files:

- `scripts/hallucination-claim-structure.cjs` (new)
- `scripts/hallucination-memory-gate.cjs` (new)
- `scripts/hallucination-audit-stop.cjs` — new functions: `stripLabeledClaimLines`, `buildStructuralBlockReason`, `STRUCTURED_BLOCK_FORMAT`, and new branching in `main()`
- `tests/hallucination-claim-structure.test.cjs` (new)

Cross-referenced against:

- `scripts/hallucination-config.cjs`
- `scripts/hallucination-annotate.cjs`

---

## Finding 1 — Duplicated JSONL parsing logic

**Location:** `hallucination-annotate.cjs` lines 65–83 (`readJsonlFile`) vs. `hallucination-audit-stop.cjs` lines 43–55 (`parseJsonl`)

**Pattern:** Both functions split text on `'\n'`, trim each line, skip blanks, `JSON.parse` each line, and silently skip malformed lines. The logic is structurally identical. The only difference is that `readJsonlFile` also reads the file from disk (`fs.readFileSync`) whereas `parseJsonl` operates on a pre-read string.

**Existing utility:** `parseJsonl` in `hallucination-audit-stop.cjs` is already exported (`module.exports`). `readJsonlFile` in `hallucination-annotate.cjs` is a hand-rolled duplicate that adds only the `fs.readFileSync` call on top.

**Recommendation:** `hallucination-annotate.cjs` should import `parseJsonl` from `hallucination-audit-stop.cjs` (or from a shared helper module) and compose it with a `safeReadFileText` call (which is already exported from `hallucination-audit-stop.cjs`). Eliminates ~18 lines of duplicate parse logic. No behavior change — both versions are functionally identical on well-formed and malformed input.

---

## Finding 2 — Duplicated JSONL append logic

**Location:** `hallucination-annotate.cjs` lines 92–94 (`appendJsonlEntry`) vs. `hallucination-audit-stop.cjs` lines 624–631 (`appendIntrospectionLog`)

**Pattern:** Both write `${JSON.stringify(entry)}\n` to a file with `fs.appendFileSync`. The only difference is that `appendIntrospectionLog` wraps the write in a `try/catch` (silent failure is required for the hook path), while `appendJsonlEntry` lets errors propagate (correct for the CLI tool path).

**Assessment:** These serve different failure modes intentionally. The silent-failure wrapper in `appendIntrospectionLog` is load-bearing — a crash there disables the hook. The propagating version in `appendJsonlEntry` is correct for the annotation CLI. **No consolidation recommended.** Document the distinction in a comment to prevent future merging of the two.

---

## Finding 3 — Duplicated `RETAINABLE_LABELS` constant

**Location:** `hallucination-claim-structure.cjs` line 14 (`const RETAINABLE_LABELS = new Set(['VERIFIED', 'CAUSAL'])`) vs. `hallucination-memory-gate.cjs` line 13 (`const RETAINABLE = new Set(['VERIFIED', 'CAUSAL'])`)

**Pattern:** Same set membership, same purpose, different variable names. `hallucination-claim-structure.cjs` already imports `computeMemoryGate` from `hallucination-memory-gate.cjs` (line 436) — the import relationship exists. `RETAINABLE_LABELS` in `hallucination-claim-structure.cjs` is used independently in the `validateClaimStructure` validation loop (lines 380, 395–397). The `RETAINABLE` set in `hallucination-memory-gate.cjs` is used inside `computeMemoryGate`.

**Recommendation:** Export the `RETAINABLE` set from `hallucination-memory-gate.cjs` as a named export (`RETAINABLE_LABELS`) and import it into `hallucination-claim-structure.cjs` to replace the local definition. This is the highest-priority consolidation: if the retainable label set changes (e.g., adding `CORRELATED` to retainable), it currently requires two edits in two files and the test surface does not catch divergence.

**Risk:** Low. One export added, one `require()` added, one `const` removed. No logic changes.

---

## Finding 4 — `stripLabeledClaimLines` regex vs. `LABEL_RE` / `STRUCTURED_RE` in `hallucination-claim-structure.cjs`

**Location:** `hallucination-audit-stop.cjs` lines 673–679 (`stripLabeledClaimLines`) defines:

```js
const LABELED_CLAIM_LINE_RE =
  /^\s*-?\s*(?:\[(?:VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\])+\[c\d+\].*/;
```

`hallucination-claim-structure.cjs` lines 17–20 define:

```js
const LABEL_RE = /\[(VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\]/g;
const STRUCTURED_RE = /\[(VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED)\]/;
```

**Pattern:** The label enumeration `VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED` is copy-pasted verbatim across three regex definitions in two files. Adding a new label currently requires editing three separate regex literals.

**Recommendation:** Centralise the label list as an exported constant string in `hallucination-claim-structure.cjs`:

```js
const CLAIM_LABEL_ALTERNATION = 'VERIFIED|INFERRED|UNKNOWN|SPECULATION|CORRELATED|CAUSAL|REJECTED';
```

Then construct all three regexes from it using `new RegExp(...)`. `stripLabeledClaimLines` in `hallucination-audit-stop.cjs` would import `CLAIM_LABEL_ALTERNATION` and construct its regex from it. This is the highest-value mechanical reuse: the alternation is a data structure (the set of valid labels), not a pattern that should be repeated.

**Risk:** Low. Pure construction-time change. Regex semantics are unchanged.

---

## Finding 5 — `main()` loop-state block pattern repeated three times

**Location:** `hallucination-audit-stop.cjs` — the loop-guard pattern appears at:

- Lines 818–831 (structured + invalid path)
- Lines 844–856 (structured + valid + matches path)
- Lines 904–918 (unstructured + matches path)

**Pattern:** Each block:

1. Calls `loadLoopState(sessionId)`
2. Reads `data.blocks`, coerces to number
3. Increments to `nextBlocks`
4. Checks `nextBlocks > 2 && stopHookActive` → `saveLoopState` + `process.exit(0)`
5. Calls `saveLoopState` + emits block JSON + `process.exit(0)`

The guard (`nextBlocks > 2 && stopHookActive`) and the state read/increment/write sequence are identical across all three sites.

**Recommendation:** Extract a helper function:

```js
/**
 * Apply loop guard and emit a block decision if the limit has not been reached.
 * Always calls process.exit(0).
 * @param {string} sessionId
 * @param {boolean} stopHookActive
 * @param {string} reason
 */
function blockOrAllowAndExit(sessionId, stopHookActive, reason) {
  const { statePath, data } = loadLoopState(sessionId);
  const nextBlocks = Number(data.blocks || 0) + 1;
  saveLoopState(statePath, { blocks: nextBlocks });
  if (nextBlocks > 2 && stopHookActive) {
    process.exit(0);
  }
  emitJson({ decision: 'block', reason });
  process.exit(0);
}
```

This is not about line count — it is about correctness. The three sites diverge in subtle ways (e.g., the structured-valid path does not call `saveLoopState` before the early exit at line 848, but the other two paths do). A single implementation eliminates that class of divergence.

**Risk:** Medium. The refactor touches `main()` directly. Requires regression testing of the loop-guard behavior across all three branches. Existing tests for loop state should cover this if they test the `stopHookActive` guard in each branch.

---

## Finding 6 — `hallucination-annotate.cjs` reinvents section-boundary detection

**Location:** `hallucination-annotate.cjs` — no section-boundary logic is present. `hallucination-claim-structure.cjs` lines 127–128 and 173–178 use the pattern:

```js
if (/^[A-Z][A-Z\s]+$/.test(line.trim()) && line.trim().length > 0 && !line.trim().startsWith('-')) {
  break;
}
```

to detect all-caps section headers (e.g., `MEMORY WRITE`, `ANSWER`, `VERIFIED`).

**Assessment:** `hallucination-annotate.cjs` does not parse the structured format, so it does not need this pattern. No duplication issue here. **No action required.**

---

## Finding 7 — `buildStructuralBlockReason` and `buildBlockReason` share identical header/footer boilerplate

**Location:** `hallucination-audit-stop.cjs` lines 727–747 (`buildStructuralBlockReason`) and lines 755–777 (`buildBlockReason`)

**Pattern:** Both functions start with `'Hallucination-detector STOP HOOK blocked this response.'` and construct a `[...].join('\n')` array. The header string is copy-pasted.

**Assessment:** The header is a single string constant, not structural logic. Extracting it to `const BLOCK_HEADER = 'Hallucination-detector STOP HOOK blocked this response.'` and referencing it from both functions would eliminate the duplication. Low effort, low risk.

**Recommendation:** Extract `BLOCK_HEADER` as a module-level constant shared by both builders.

---

## Finding 8 — `hallucination-claim-structure.cjs` re-exports `computeMemoryGate` via a side-channel `require()`

**Location:** `hallucination-claim-structure.cjs` line 436:

```js
computeMemoryGate: require('./hallucination-memory-gate.cjs').computeMemoryGate,
```

This is an inline `require()` inside `module.exports` — not a top-of-file import. It works but breaks the convention established by every other file in the codebase (all `require()` calls at the top of the file). It also means `hallucination-claim-structure.cjs` silently takes a hard dependency on `hallucination-memory-gate.cjs` without declaring it at the top where dependencies are visible.

**Recommendation:** Move the `require()` to the top of `hallucination-claim-structure.cjs` alongside the other imports (or remove the re-export entirely if callers can import directly from `hallucination-memory-gate.cjs`). The re-export is used only in `tests/hallucination-claim-structure.test.cjs` line 4, which already imports `computeMemoryGate` directly from `hallucination-memory-gate.cjs` — making the re-export redundant.

**Risk:** None to behavior. The test already imports from the source directly.

---

## Priority Summary

| Finding                                           | Files affected                                                       | Effort  | Risk   | Recommendation                                             |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------- | ------ | ---------------------------------------------------------- |
| 3 — `RETAINABLE_LABELS` duplication               | `hallucination-memory-gate.cjs`, `hallucination-claim-structure.cjs` | Low     | Low    | Do it — correctness risk if labels diverge                 |
| 4 — Label alternation string repeated 3×          | `hallucination-claim-structure.cjs`, `hallucination-audit-stop.cjs`  | Low     | Low    | Do it — adding a label currently requires 3 edits          |
| 8 — Inline `require()` in `module.exports`        | `hallucination-claim-structure.cjs`                                  | Trivial | None   | Do it — move to top                                        |
| 7 — `BLOCK_HEADER` constant                       | `hallucination-audit-stop.cjs`                                       | Trivial | None   | Do it — eliminate string duplication                       |
| 5 — Loop-guard pattern in `main()`                | `hallucination-audit-stop.cjs`                                       | Medium  | Medium | Do it — three divergent sites, correctness risk            |
| 1 — `parseJsonl` / `readJsonlFile`                | `hallucination-annotate.cjs`, `hallucination-audit-stop.cjs`         | Low     | Low    | Do it — identical parse logic                              |
| 2 — `appendJsonlEntry` / `appendIntrospectionLog` | Same                                                                 | None    | N/A    | Do not consolidate — intentionally different failure modes |
| 6 — Section-boundary detection                    | N/A                                                                  | None    | N/A    | No action — not duplicated across files                    |
