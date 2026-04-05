# Efficiency Review — hallucination-detector runtime scripts

Date: 2026-03-11
Scope: All runtime scripts in scripts/ as of commits through 2ee5adbe (v1.11.0)

---

## Finding 1: `loadConfig()` called on every Stop hook invocation with file-system stat + require

**File(s):** `scripts/hallucination-config.cjs:47-79`, called from `scripts/hallucination-audit-stop.cjs:841`

**Issue:** `loadConfig()` calls `fs.existsSync(rcPath)` followed by `require(rcPath)` on every single Stop hook invocation. `require()` caches modules in Node.js, but `fs.existsSync()` is an unconditional synchronous stat syscall on every run. More importantly, the config file path is built with `path.join(process.cwd(), '.hallucination-detectorrc.cjs')` — `process.cwd()` is stable for the lifetime of the process, so this path is constant but recomputed each time.

In the common case (no rc file), this is: one `path.join`, one `fs.existsSync` stat syscall, and a return of frozen default values — every invocation.

**Impact:** One stat syscall per Stop hook invocation (runs on every assistant response). On a fast SSD this is ~50–200 µs. Not catastrophic, but it is wasted work when the config file is absent (the typical case).

**Fix:** Module-level memoization. Compute the rcPath once at module load, stat it once, and cache the result. A simple `let _cachedConfig = null` guard at module scope eliminates all repeated work.

**Severity:** low

---

## Finding 2: `EVALUATIVE_DESIGN_TELLS` regex recompiled into a new `RegExp` object on every `findTriggerMatches()` call

**File(s):** `scripts/hallucination-audit-stop.cjs:505-508`

**Issue:** Every call to `findTriggerMatches()` executes:

```js
const edcFlags = EVALUATIVE_DESIGN_TELLS.flags.includes('g')
  ? EVALUATIVE_DESIGN_TELLS.flags
  : `${EVALUATIVE_DESIGN_TELLS.flags}g`;
const edcGlobal = new RegExp(EVALUATIVE_DESIGN_TELLS.source, edcFlags);
```

`EVALUATIVE_DESIGN_TELLS` is defined at module scope with the `g` flag already set (`/gi`). The flag check always evaluates to the already-present flags string, and `new RegExp(source, flags)` is called unconditionally on every invocation. This allocates a new `RegExp` object, recompiles the pattern, and is never reused.

`findTriggerMatches()` is called: once for the full message, and again for every sentence in `scoreText()` when introspection mode is active (once per sentence). On a response with 50 sentences, that is 51 `RegExp` allocations of this pattern.

**Impact:** Repeated regex recompilation per call. On a long message in introspection mode with sentence scoring enabled, this multiplies linearly with sentence count. Even in normal mode, one unnecessary allocation and compilation per response.

**Fix:** Define the global variant at module scope alongside `EVALUATIVE_DESIGN_TELLS`:

```js
const EVALUATIVE_DESIGN_TELLS_GLOBAL = new RegExp(EVALUATIVE_DESIGN_TELLS.source, 'gi');
```

Then use `EVALUATIVE_DESIGN_TELLS_GLOBAL` directly in `findTriggerMatches()`, removing the 4-line flag-check block entirely.

**Severity:** medium

---

## Finding 3: `splitIntoSentences` + `scoreSentence` + `findTriggerMatches` called per-sentence in introspection mode — full pipeline repeated N times

**File(s):** `scripts/hallucination-audit-stop.cjs:602-611` (`scoreText`), called at line 881

**Issue:** When `config.introspect` is true, `scoreText(lastAssistantText, config.weights)` runs `findTriggerMatches()` on every sentence individually. `findTriggerMatches()` itself calls:

- `normalizeForScan(text)` — `replace(/\r\n/g, '\n')`
- `stripLowSignalRegions(text)` — three regex replacements + a split/filter/join
- `haystack.toLowerCase()`

For a 50-sentence response, that is 50 executions of `stripLowSignalRegions`, 50 `toLowerCase` calls, and 50 full pattern scans. The full-message `findTriggerMatches` on `lastAssistantText` already ran at line 867. The sentence-level scores are computed entirely independently, with no sharing of the already-computed stripped/lowercased strings.

This is introspection-mode only, so it does not affect normal blocking behavior. But introspection mode is the path users enable when investigating hook behavior.

**Impact:** O(N) redundant string processing where N = sentence count. For a 100-sentence response, `stripLowSignalRegions` runs 100 times instead of once.

**Fix:** Accept pre-processed strings as optional parameters to `scoreSentence` / `findTriggerMatches`, or compute the stripped/lowercased haystack once in `scoreText` and pass it through. Alternatively, since sentence-level scoring operates on individual sentences (which are short), skip `stripLowSignalRegions` at the sentence level — code blocks and blockquotes cannot span a single sentence boundary.

**Severity:** low (introspection path only, not the blocking hot path)

---

## Finding 4: `isIndexWithinQuestion` computes four `lastIndexOf` + four `indexOf` calls — called in a tight loop

**File(s):** `scripts/hallucination-audit-stop.cjs:181-202`

**Issue:** `isIndexWithinQuestion` performs 8 string searches (4 `lastIndexOf` + 4 `indexOf`) to find sentence boundaries for every single match found in the text. It is called inside the causality phrase loop (up to 23 phrases × all occurrences), inside the completeness regex loop (5 patterns), and for every evaluative design match. For a text with many causal phrases, this function is called dozens of times, each time searching the full haystack string.

The sentence boundary computation is independent of the match kind — for a given position, the surrounding sentence boundaries are the same regardless of which pattern triggered. If two phrases match close together (e.g., "because" and "due to" in the same sentence), the sentence boundary is computed twice for the same region.

**Impact:** Redundant boundary searches for nearby matches. On a text with many trigger phrases, this scales as O(phrases × occurrences × text_length) for the `lastIndexOf`/`indexOf` operations.

**Fix:** Cache sentence boundary results keyed by approximate position (e.g., line number), or precompute sentence boundary positions once before the scan loops and binary-search for the containing sentence. The current implementation is correct; this is a micro-optimization that would matter most for very long responses.

**Severity:** low

---

## Finding 5: `speculationPhrases` loop uses only `indexOf` — finds only first occurrence, not all

**File(s):** `scripts/hallucination-audit-stop.cjs:271-284`

**Issue:** The speculation phrase loop calls `lower.indexOf(phrase)` and breaks after the first occurrence. This is intentional for the block decision (one match per phrase is sufficient to flag). However, the `may` permissive-pronoun check only inspects the first occurrence of "may". If a response contains permissive "you may use" followed later by epistemic "there may be an issue", the first occurrence is suppressed and the second is never found.

This is an existing behavior issue, not introduced in this diff, but the causal phrase loop (added/expanded in the recent commits) correctly iterates all occurrences with a `while(true)` loop. The speculation phrase loop does not.

**Impact:** Potential false negatives for "may" when the first occurrence is permissive but a later occurrence is epistemic. This is a correctness gap, not a performance issue, but it is flagged here because the fix (iterate all occurrences) would align speculation phrase scanning with the causal phrase scanning approach already in the same function.

**Fix:** Apply the same `while(true)` / `searchFrom` pattern used for causality phrases to the speculation phrase loop, or document why first-occurrence-only is intentional.

**Severity:** low (correctness, not performance)

---

## Finding 6: `stripLabeledClaimLines` splits and rejoins the full text via `text.split('\n').filter().join('\n')` — called even for unstructured responses

**File(s):** `scripts/hallucination-audit-stop.cjs:685-690`, called at line 854

**Issue:** `stripLabeledClaimLines` is called only in the structured branch (when `structureResult.structured` is true), so it does not run on every response. However, it performs a full `split('\n')`, `filter()` with two regex tests per line, and `join('\n')`. The two regexes (`LABELED_CLAIM_LINE_RE` and `METADATA_LINE_RE`) are already defined at module scope, so no recompilation occurs — this is well-implemented. The cost is proportional to response length, which is acceptable.

No issue with the current implementation. Noted for completeness.

**Severity:** N/A (no issue found)

---

## Finding 7: `loadLoopState` reads and parses a temp file, `saveLoopState` writes it — called multiple times per invocation in some paths

**File(s):** `scripts/hallucination-audit-stop.cjs:640-661`, called at lines 858-860 and within `blockAndExit` at line 742

**Issue:** In the structured+valid+no-matches path (lines 857-860), `loadLoopState` is called to get `statePath`, then `saveLoopState` is called to reset blocks to 0. This is correct. In the unstructured+introspect path, `loadLoopState` is called at line 871, then `saveLoopState` at line 874. No double-read.

However, in `blockAndExit` (line 741-749), `loadLoopState` reads the file again — even though the caller at line 863 (structured+valid+matches) has not previously called `loadLoopState`. The function always reads the file fresh. The temp file read is one synchronous `readFileSync` + `JSON.parse` per call, which is unavoidable for cross-invocation state. No issue beyond the inherent cost.

**Severity:** N/A (no redundancy found)

---

## Finding 8: `EVIDENCE_MARKERS` array contains stateful regex objects with the default (non-global) flag — safe, but the comment warning about this is missing for `BACKTICK_RE`

**File(s):** `scripts/hallucination-audit-stop.cjs:137-146`

**Issue:** `EVIDENCE_MARKERS` is an array of regex literals used with `.some((re) => re.test(window))`. None have the `g` flag, so `re.lastIndex` is not mutated between calls — this is correct. `BACKTICK_RE` at line 146 also has no `g` flag. No statefulness issue.

The `EVALUATIVE_DESIGN_TELLS` regex at line 151 has the `g` flag and is used with `matchAll()` after being copied into a new `RegExp` at line 508. Using a `g`-flagged regex with `.test()` or direct iteration would cause `lastIndex` drift. The current code creates a new `RegExp` copy for each `matchAll` call, which avoids this. However, if the code were refactored to use `EVALUATIVE_DESIGN_TELLS` directly with `matchAll`, the stateful `lastIndex` would cause incorrect results after the first use.

**Impact:** The module-scope `g`-flagged regex is a latent trap. The current workaround (copy into new RegExp) is correct but wasteful (see Finding 2). The right fix is to define a module-scope copy with `g` flag for `matchAll` use, eliminating both the trap and the per-call allocation.

**Fix:** Same as Finding 2 — define `EVALUATIVE_DESIGN_TELLS_GLOBAL` at module scope. This resolves both the performance issue and the latent `lastIndex` trap.

**Severity:** medium (latent correctness risk + performance; same fix as Finding 2)

---

## Summary

| #   | File                                  | Issue                                                                            | Severity          |
| --- | ------------------------------------- | -------------------------------------------------------------------------------- | ----------------- |
| 1   | hallucination-config.cjs              | `loadConfig()` stat syscall on every invocation                                  | low               |
| 2   | hallucination-audit-stop.cjs:505-508  | `new RegExp` recompilation on every `findTriggerMatches()` call                  | medium            |
| 3   | hallucination-audit-stop.cjs:602-611  | Per-sentence pipeline repetition in introspection mode                           | low               |
| 4   | hallucination-audit-stop.cjs:181-202  | `isIndexWithinQuestion` 8-search boundary computation called per match           | low               |
| 5   | hallucination-audit-stop.cjs:271-284  | Speculation phrase loop only finds first occurrence of "may"                     | low (correctness) |
| 6   | N/A                                   | `stripLabeledClaimLines` — no issue                                              | N/A               |
| 7   | N/A                                   | `loadLoopState` — no redundancy found                                            | N/A               |
| 8   | hallucination-audit-stop.cjs:151, 505 | Module-scope `g`-flagged regex is a latent `lastIndex` trap (subsumes Finding 2) | medium            |

**Highest-priority fix:** Findings 2 and 8 are the same root issue. Define `EVALUATIVE_DESIGN_TELLS_GLOBAL` at module scope, remove the 4-line per-call `new RegExp` block. One-line change, eliminates a recompilation on every response and removes a latent correctness trap.
