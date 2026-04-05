# Code Quality Review — 24h Diff

Reviewed files: all 6 runtime scripts in `scripts/`, test files in `tests/`, `.claude/CLAUDE.md`, `.claude/rules/issue-management.md`, `.claude/agents/javascript-pro.md`, `vitest.config.cjs`, `biome.json`, `package.json`, CI workflows, plugin.json files.

---

## Finding 1: Duplicated evidence-prefix list across three files

**File(s):**

- `scripts/hallucination-claim-structure.cjs:55–56` — `EVIDENCE_PREFIX_RE`
- `scripts/hallucination-framing-session-start.cjs:86` — inline string literal
- `.claude/CLAUDE.md` (lines 57 and ~174) — two separate prose listings

**Issue:** The set of recognized evidence prefixes (`File:`, `Log:`, `Test:`, `Doc:`, `Tool:`, `User:`, `Transcript:`, `Code:`, `Command:`, `Output:`, `Error:`, `Config:`, `Trace:`, `Repro:`) is encoded in three places independently:

1. The runtime regex `EVIDENCE_PREFIX_RE` in `hallucination-claim-structure.cjs`
2. A backtick-delimited inline string at the end of `FRAMING_TEXT` in `hallucination-framing-session-start.cjs`
3. The "Recognized prefixes" line in `.claude/CLAUDE.md`

The framing text (which is injected into every Claude session) will silently diverge from the validator when prefixes are added or removed. There is no test that checks the framing text prefix list matches the regex. The CLAUDE.md listing is doc drift risk.

**Fix:** Export the prefix list as an array constant from `hallucination-claim-structure.cjs` (e.g., `EVIDENCE_PREFIXES`), build `EVIDENCE_PREFIX_RE` from it programmatically, and import it in `hallucination-framing-session-start.cjs` to build the framing text dynamically. CLAUDE.md can then say "see `EVIDENCE_PREFIXES` in `hallucination-claim-structure.cjs`" instead of duplicating the list.

**Severity:** medium

---

## Finding 2: Duplicated JSONL-parsing logic across two scripts

**File(s):**

- `scripts/hallucination-audit-stop.cjs:46–58` — `parseJsonl(text)`
- `scripts/hallucination-annotate.cjs:65–83` — `readJsonlFile(logPath)`

**Issue:** Both functions split on `\n`, trim each line, skip empty lines, call `JSON.parse`, and silently swallow parse errors. The only difference is that `parseJsonl` accepts a string and `readJsonlFile` reads a file first. The parsing loop bodies are structurally identical copy-paste. When the JSONL format or error handling changes in one, the other will not be updated.

**Fix:** Extract the shared string-to-objects parsing logic into a shared helper module (e.g., `scripts/hallucination-shared.cjs`) as `parseJsonlText(text)`. Both callers import and use it. `readJsonlFile` becomes a thin wrapper: `return parseJsonlText(fs.readFileSync(logPath, 'utf-8'))`.

**Severity:** low

---

## Finding 3: `fabricated_source` weight key has no corresponding detection category

**File(s):**

- `scripts/hallucination-config.cjs:27` — `DEFAULT_WEIGHTS`
- `scripts/hallucination-audit-stop.cjs:246–514` — `findTriggerMatches()`

**Issue:** `DEFAULT_WEIGHTS` defines six categories: `speculation_language`, `causality_language`, `pseudo_quantification`, `completeness_claim`, `fabricated_source`, and `evaluative_design_claim`. The runtime `findTriggerMatches()` only detects five of these — there is no detection block for `fabricated_source`. The key exists in `DEFAULT_WEIGHTS`, is iterated by `scoreSentence()` and `aggregateWeightedScore()`, and appears in the `categoryTotals` computed by `hallucination-annotate.cjs`, but it will always produce a count of zero because no match ever sets `kind: 'fabricated_source'`.

This is a structural inconsistency: `DEFAULT_WEIGHTS` is the authoritative registry of categories, but it includes a category that the detector does not implement. The scoring code (`scoreSentence`, `aggregateWeightedScore`) silently treats it as perpetually zero, which skews normalized scores by including it in the weight denominator (0.1 weight always contributes to `weightSum` without ever contributing to `total`).

**Fix:** Either (a) remove `fabricated_source` from `DEFAULT_WEIGHTS` until the detection block is implemented, or (b) add a comment to `DEFAULT_WEIGHTS` marking it as `// reserved — not yet implemented` so future readers understand it is intentional dead weight. Option (a) is the cleaner choice.

**Severity:** medium

---

## Finding 4: `computeMemoryGate` has a local alias for its own module-level constant

**File(s):**

- `scripts/hallucination-memory-gate.cjs:16`

**Issue:** The function body opens with `const RETAINABLE = RETAINABLE_LABELS;` and then uses `RETAINABLE` throughout. `RETAINABLE_LABELS` is already a module-level constant in the same file. The alias is redundant indirection with no benefit — it adds a name for a reader to track without adding information.

**Fix:** Remove the alias. Use `RETAINABLE_LABELS` directly in the function body.

**Severity:** low

---

## Finding 5: `unnormalized_evidence` error code described as "warning" in CLAUDE.md but treated as a block-triggering error in code

**File(s):**

- `.claude/CLAUDE.md` line 88 — "VERIFIED, CAUSAL, or CORRELATED evidence present but no recognized prefix (warning)"
- `.claude/CLAUDE.md` line 59 — "CORRELATED also accepts normalized prefixes but triggers a warning (not a block) when absent"
- `scripts/hallucination-claim-structure.cjs:312–319` — `unnormalized_evidence` pushed to `errors` array for VERIFIED
- `scripts/hallucination-claim-structure.cjs:358–365` — `unnormalized_evidence` pushed to `errors` array for CAUSAL
- `scripts/hallucination-audit-stop.cjs:847–849` — `structureResult.valid` is `false` when `errors.length > 0`, causing `blockAndExit`

**Issue:** The CLAUDE.md documentation says `unnormalized_evidence` is a "warning (not a block)". The actual code behavior is that any error in the `errors` array — including `unnormalized_evidence` — sets `valid: false`, which causes the stop hook to call `blockAndExit`. There is no separate "warning" path in `validateClaimStructure` or in `main()`. The distinction documented in CLAUDE.md does not exist in the implementation.

Additionally, the CLAUDE.md error code table column header says `missing_claim_id` but the actual code uses `missing_evidence`, `missing_basis`, `missing_missing`, and `missing_contradicted_by` as the error codes for absent metadata — the generic `missing_metadata` code listed in the table does not appear in the codebase at all.

**Fix:**

1. Either implement a true warning path in `validateClaimStructure` (a separate `warnings` array that does not affect `valid`) and handle it in `main()`, or update CLAUDE.md to state that `unnormalized_evidence` is a blocking error, not a warning.
2. Correct the CLAUDE.md error code table: replace `missing_claim_id` and `missing_metadata` with the actual codes used in the implementation.

**Severity:** high — the documentation actively misleads about hook behavior. A developer who reads CLAUDE.md will believe `unnormalized_evidence` is non-blocking and write tests accordingly.

---

## Finding 6: `findTriggerMatches` return type documented as `[{ kind, evidence, offset }]` but `offset` is never set

**File(s):**

- `.claude/CLAUDE.md` line 103 — "Returns `[{ kind, evidence, offset }]`"
- `scripts/hallucination-audit-stop.cjs:244` — JSDoc: "Returns `Array<{kind: string, evidence: string}>`"
- `scripts/hallucination-audit-stop.cjs:282,308,319,383,388,394,419,427,434,496,511` — all `matches.push(...)` calls

**Issue:** The CLAUDE.md key functions table says `findTriggerMatches` returns `[{ kind, evidence, offset }]`. The JSDoc on the function itself says `Array<{kind: string, evidence: string}>` (no `offset`). Every `matches.push()` call in the function body omits `offset`. The property does not exist on any returned object. The CLAUDE.md description is wrong.

**Fix:** Remove `offset` from the CLAUDE.md key functions table description. If `offset` is a planned future field, add a comment in the code saying so. Do not document a field that is not returned.

**Severity:** low — documentation-only error, but CLAUDE.md is used by agents to understand the interface.

---

## Finding 7: `hallucination-annotate.cjs` usage string lists 4 detection categories, not 5

**File(s):**

- `scripts/hallucination-annotate.cjs:275` — `printUsage()`

**Issue:** The usage string lists: "Categories: speculation_language, causality_language, pseudo_quantification, completeness_claim". It omits `evaluative_design_claim`, which was added as the fifth active detection category. A user running `--add-negative --category evaluative_design_claim` would succeed (the code does not validate category names against the list), but the help text gives no indication this category exists.

**Fix:** Add `evaluative_design_claim` to the categories line in `printUsage()`. Derive it from `Object.keys(DEFAULT_WEIGHTS)` if possible, or update the static string.

**Severity:** low

---

## Finding 8: Stringly-typed error codes in `validateClaimStructure` — strings repeated across code and tests

**File(s):**

- `scripts/hallucination-claim-structure.cjs:261,276,298,307,313,328,337,351,359,375,389,400,414,426,432,450` — error `code` values as raw string literals
- `tests/hallucination-claim-structure.test.cjs` — `.some(e => e.code === 'vague_verified_evidence')` etc.

**Issue:** Error codes like `'vague_verified_evidence'`, `'unnormalized_evidence'`, `'duplicate_claim_id'`, `'weak_causal_evidence'`, `'correlated_as_causal'` are raw string literals scattered across the validator and its tests. There is no single definition point. Adding a new code, renaming one, or checking whether a code is valid requires a text search. A typo in a test assertion would not be caught at definition time.

**Fix:** Define an `ERROR_CODES` object at the top of `hallucination-claim-structure.cjs` mapping symbolic names to string values, export it, and use the constants throughout the validator and tests. This is a standard stringly-typed pattern fix.

**Severity:** low

---

## Finding 9: Stale doc claim — `findTriggerMatches` JSDoc describes old 4-category return but code returns 5 kinds

**File(s):**

- `scripts/hallucination-audit-stop.cjs:244` — JSDoc for `findTriggerMatches`

**Issue:** The JSDoc comment lists the return `kind` values as: `speculation_language`, `causality_language`, `pseudo_quantification`, `completeness_claim`, `evaluative_design_claim`. That is 5 values, which matches the code. However, the description text says "Detects linguistic signals that suggest uncertainty, causal claims, uncited quantification, completeness assertions, or evaluative-design statements" — that matches too. This one is actually correct.

Cross-checking against `DEFAULT_WEIGHTS`: `fabricated_source` is in `DEFAULT_WEIGHTS` but absent from both the JSDoc list and from `findTriggerMatches()` detection — consistent with Finding 3 (it is an unimplemented category that leaked into the weight registry).

No action needed for this finding specifically; it is subsumed by Finding 3.

**Severity:** n/a (absorbed by Finding 3)

---

## Summary

| #   | Title                                                                          | Severity |
| --- | ------------------------------------------------------------------------------ | -------- |
| 1   | Duplicated evidence-prefix list across three files                             | medium   |
| 2   | Duplicated JSONL-parsing logic across two scripts                              | low      |
| 3   | `fabricated_source` weight key has no detection category                       | medium   |
| 4   | `computeMemoryGate` redundant local alias for module constant                  | low      |
| 5   | `unnormalized_evidence` documented as warning but implemented as block         | high     |
| 6   | `findTriggerMatches` CLAUDE.md return type includes nonexistent `offset` field | low      |
| 7   | `hallucination-annotate.cjs` usage string omits 5th detection category         | low      |
| 8   | Stringly-typed error codes across validator and tests                          | low      |
