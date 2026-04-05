# Option Evaluation: Backtick Escaping

**Option slug:** backtick-escaping
**Date:** 2026-03-10
**Files examined:**

- `scripts/hallucination-audit-stop.cjs`
- `tests/hallucination-audit-stop.test.cjs`

---

## 1. What does this option do — mechanically, step by step?

The option exploits the existing `stripLowSignalRegions()` function to neutralize trigger words before `findTriggerMatches()` scans the block reason string.

Step by step:

**Step 1 — Evidence snippets are wrapped in backticks when emitted.**
In `main()`, lines 698–701, each evidence string is placed inside a backtick inline-code span in the `evidenceSnippets` string:

```js
const evidenceSnippets = matches
  .slice(0, 6)
  .map((m) => `- ${m.kind}: \`${m.evidence}\``)
  .join('\n');
```

So a match whose `evidence` is `"probably"` becomes the text `- speculation_language: \`probably\`` in the emitted block reason.

**Step 2 — Static instruction text uses backticks around example trigger words.**
Lines 712–715 in the `reason` array contain the static rules text. Trigger words that appear as examples are already wrapped in backticks:

```
'- Remove speculative hedging (e.g., `probably`, `likely`, `seems`). Replace with verification steps or uncertainty statements.',
'- If you need to reference or discuss a flagged phrase in your rewrite, wrap it in backticks (e.g., `probably`, `because`) so the hook does not re-trigger on the explanation.',
'- If an evaluative label (`cleanest`, `simplest`, `obvious`) appears on a proposed change: state what the changed component protects when functioning correctly before proposing to change it.',
```

**Step 3 — When the block reason re-enters the transcript, `stripLowSignalRegions()` removes the backtick spans.**
`stripLowSignalRegions()` at line 117 removes all inline code spans matching ``/`[^`\n]*`/`` before `findTriggerMatches()` scans the text. This means `\`probably\`` is deleted from the haystack before any pattern matching runs. The trigger word is therefore invisible to the detector.

**Step 4 — The stripped haystack is what all detection categories scan.**
`findTriggerMatches()` at lines 221–225 runs all detection over `haystack` (the stripped version), not `rawText`. Evidence snippets wrapped in backticks are not present in `haystack`.

---

## 2. What does it protect against or solve?

The option directly prevents the self-trigger loop for the specific trigger words that are emitted as `evidence` in evidence snippets.

**Protected:**

- Every phrase drawn from `speculationPhrases` (line 229–242): `i think`, `i believe`, `probably`, `likely`, `it seems`, `seems like`, `i assume`, `assume`, `maybe`, `might be`, `could be`, `presumably`
- Every phrase drawn from `causalityPhrases` (lines 298–324): `caused by`, `due to`, `because`, `as a result`, `therefore`, `this means`, `consequently`, `as a consequence`, `hence`, `thus`, `it follows that`, `this suggests that`, `this indicates that`, `this implies that`, `which is why`, `which means`, `which explains`, `the root cause`, `stems from`, `results from`, `resulted in`, `led to`, `attributable to`, `given that`, `since`
- Special-cased evidence strings: `should be (epistemic)`, `should be`, `because (hedged)`
- Evaluative design tell phrases: `cleanest`, `simplest`, `obvious` (wrapped in the static instruction line at line 715)
- Regex-derived match strings from IMPLICIT_CAUSALITY, NOMINALIZED_CAUSALITY, PASSIVE_CAUSALITY (lines 362–382) — their `m[0].trim()` values are also wrapped in backticks via the same `evidenceSnippets` format

**Test coverage:** `tests/hallucination-audit-stop.test.cjs` lines 665–833 contain a dedicated `describe('block reason self-trigger regression')` block that:

- Builds the exact block reason string using the same `buildBlockReason()` helper that mirrors `main()` (lines 672–694)
- Asserts `findTriggerMatches(reason)` returns zero matches for all speculation phrases (lines 805–833) and all causality phrases (lines 763–803), plus individual phrase spot-checks (lines 696–761)

---

## 3. What does it leave unprotected or unsolved?

### 3a. Bare trigger words in static prose that are NOT wrapped in backticks

The static `reason` text (lines 703–718) contains prose that is not wrapped in backticks. Examining each line:

- Line 704: `'Hallucination-detector STOP HOOK blocked this response.'` — no trigger words
- Line 706: `'Detected trigger language in your last assistant message:'` — no trigger words
- Line 709: `'Rewrite the response to follow these rules:'` — no trigger words
- Line 710: `'- Only state actions you actually took and what you actually observed.'` — no trigger words
- Line 711: `'- If information is missing, say "I don\'t know yet" / "I don\'t have that information" / "I can check using my tools".'` — no trigger words
- Line 712: `'- Do not assert causality unless you explicitly cite the observed evidence that supports it.'` — no trigger words. "causality" is not in any detection phrase list
- Line 713: `'- Remove speculative hedging (e.g., \`probably\`, \`likely\`, \`seems\`). Replace with verification steps or uncertainty statements.'`— trigger words wrapped:`probably`, `likely`, `seems` protected
- Line 714: `'- If you need to reference or discuss a flagged phrase in your rewrite, wrap it in backticks (e.g., \`probably\`, \`because\`) so the hook does not re-trigger on the explanation.'`—`probably`, `because` protected
- Line 715: `'- If an evaluative label (\`cleanest\`, \`simplest\`, \`obvious\`) appears on a proposed change...'`—`cleanest`, `simplest`, `obvious` protected

**No bare trigger words found in the current static text.** The protection appears complete for the current static prose.

### 3b. The `Kinds flagged:` line at line 717

```js
`Kinds flagged: ${uniqueKinds.join(', ')}`,
```

`uniqueKinds` contains values like `speculation_language`, `causality_language`, `completeness_claim`, `pseudo_quantification`, `evaluative_design_claim`. These are category names, not trigger phrases from the detection lists. None of the category names match any entry in `speculationPhrases`, `causalityPhrases`, `completenessPhrases`, or the regex patterns. This line is currently safe.

### 3c. Completeness category evidence strings

`completenessPhrases` (lines 400–434) includes strings like `'all files checked'`, `'probably'` does not appear there, but multi-word completeness phrases like `'fully resolved'`, `'all issues fixed'`, `'everything works'` appear as evidence. If a response triggers a completeness match, the evidence (e.g., `'fully resolved'`) is wrapped in backticks in `evidenceSnippets`. The re-emitted reason would contain `- completeness_claim: \`fully resolved\``which is stripped by`stripLowSignalRegions()`. This is protected.

However: the completeness regex patterns at lines 445–451 can produce arbitrary substrings as evidence via `m[0].trim()`. For example, `/\b(?:fully|completely)\s+\w+(?:ed|d)\b/i` could match `"fully implemented"` from user text. That match string is then placed in backticks in the emitted reason. This is protected by the same mechanism.

### 3d. Future detection categories — the critical unprotected gap

This is the primary unprotected surface. The backtick-escaping mechanism works correctly only if every piece of evidence that ends up in `evidenceSnippets` is a string that, when read back from the transcript, would trigger a detection match. The mechanism assumes the evidence string is the exact phrase the detector looks for.

**New regex-based categories with complex match strings:** If a new category produces a long evidence string (e.g., `"The root cause of this failure was a configuration error"` from a regex match), that full string is placed in backticks in `evidenceSnippets`. When `stripLowSignalRegions()` removes the backtick span, the entire multi-word string is removed from the haystack — that works correctly.

**New category whose trigger is NOT the exact evidence string:** If a new category emits an evidence string that is shorter or different from the actual matched text (e.g., evidence is `"root cause"` but the trigger regex fires on `"The root cause of"`), then after stripping the backtick span the remaining prose could still contain enough of the trigger pattern to match. This is a theoretical gap but does not exist for the current `findTriggerMatches()` patterns because all existing evidence values are either exact phrase list members or `m[0].trim()` from the regex match.

### 3e. The `evidenceSnippets` slice limit of 6

Lines 698–701 slice matches to the first 6:

```js
const evidenceSnippets = matches
  .slice(0, 6)
  .map((m) => `- ${m.kind}: \`${m.evidence}\``)
  .join('\n');
```

If more than 6 matches fire, the 7th and beyond are not included in `evidenceSnippets`. Their evidence strings are not wrapped in backticks. However, the `Kinds flagged:` line only shows category names (not evidence strings), so evidence from matches 7+ does not appear unprotected in the reason text. This is not a gap.

### 3f. What the option does not address: the architectural source of the problem

The backtick-escaping option does not prevent the block reason from being re-scanned in the first place. The infinite-loop guard at lines 690–693 already handles the case where `nextBlocks > 2 && stopHookActive`, allowing pass-through after 2 consecutive blocks. The backtick-escaping option addresses a different failure mode: where the hook blocks on its own output, not because of a true re-trigger but because the evidence text itself contains trigger words.

The option does not solve re-triggering caused by the assistant's legitimate rewrite still containing trigger language. It only solves re-triggering caused by the hook's own reason string.

---

## 4. Failure modes

### 4a. New detection category with bare evidence in static instruction text

If a developer adds a new detection category (e.g., `fabricated_source`) and updates the static instruction text with an unprotected example phrase — say, changing line 709 to include `"Do not cite sources that don't exist"` — and that phrase happens to match a new `fabricated_source` pattern, the reason string would re-trigger. The mechanism provides no systematic enforcement that static text must use backticks around trigger words. It relies entirely on authorial discipline.

**Failure mode:** A future developer adding a new detection category and updating the static `reason` array without wrapping examples in backticks would silently reintroduce the self-trigger bug. There is no runtime check, no test that validates the full static text against all patterns, and no lint rule.

### 4b. Evidence string format change that breaks the backtick span

The `evidenceSnippets` format is `- ${m.kind}: \`${m.evidence}\``. If the evidence value itself contains a backtick (e.g., a regex match captures a code-containing phrase), the backtick span would be malformed:

```
- causality_language: `the `foo` was caused by`
```

`stripLowSignalRegions()` uses `/`[^`\n]\*`/g` which matches from the first backtick to the next non-newline backtick. In the malformed case, the match would be `` `the ` `` and `foo` was caused by``would remain in the haystack, potentially re-triggering. However: current detection categories operate on stripped text (code spans already removed), so evidence values from`findTriggerMatches()` will not contain backticks. This is a theoretical gap for future categories that might operate on raw text.

### 4c. New causality evidence with regex-derived substring not matching detection

The PASSIVE_CAUSALITY and NOMINALIZED_CAUSALITY patterns (lines 366–374) produce `m[0].trim()` as evidence — this is the full regex match text, e.g., `"was caused by"` or `"the likely cause"`. These strings are placed in backticks. When stripped, the exact matched phrase is removed. A new pattern that uses a lookahead or captures a group differently could produce evidence that does not fully cover the trigger text, leaving a residual fragment.

### 4d. Static `reason` array maintenance — not enforced by tests

The test suite's `buildBlockReason()` function at lines 672–694 is a copy of the production code's `reason` array. If the production `reason` array in `main()` is modified (e.g., a line is added, a backtick is dropped), the test helper is not automatically updated. The tests would continue to pass while the production code has the vulnerability. This is a maintenance synchronization gap: the test validates the helper's output, not the production code's output.

**Observed:** `buildBlockReason()` in the test file (lines 679–693) matches the production `reason` array in `main()` (lines 703–718) character-for-character in the current snapshot. But this is not enforced structurally.

---

## 5. Evidence from the codebase supporting or arguing against this option

### Supporting evidence

**S1.** `stripLowSignalRegions()` at line 117 already removes inline code spans for false-positive suppression of code examples. Reusing it for self-trigger suppression adds no new mechanism — it extends an existing one to a new use case.

**S2.** The test suite at lines 665–833 exhaustively verifies self-trigger suppression for every phrase in `speculationPhrases` and `causalityPhrases` by constructing the exact block reason string and asserting zero second-pass matches. This is direct empirical validation that the mechanism works for the current phrase corpus.

**S3.** The `evidenceSnippets` format `- ${m.kind}: \`${m.evidence}\`` (lines 699–701) wraps every evidence string in backtick spans in a uniform, mechanical way. There is no per-phrase handling required; any new phrase added to existing detection lists is automatically protected by the same format.

**S4.** The static instruction text at lines 712–715 correctly uses backticks around the example trigger words `probably`, `likely`, `seems`, `because`, `cleanest`, `simplest`, `obvious`. The current static text does not introduce any unprotected trigger words.

### Arguing against

**A1.** The mechanism is implicit and depends on authorial awareness. When adding a new detection category, there is no tooling, lint rule, or test that enforces backtick-wrapping of example trigger words in the static `reason` text. The bug can silently re-enter.

**A2.** The test helper `buildBlockReason()` duplicates the production `reason` array (compare test lines 679–693 with production lines 703–718). This duplication means the tests validate a copy, not the production code. A divergence between the two would leave the production code unvalidated. An approach that imports the production `reason`-building logic and tests that directly would be more robust.

**A3.** The fix has no defense-in-depth for novel match formats from future regex categories. The mechanism works correctly for the current category implementations because evidence strings are always either exact phrase-list members or full regex match captures (`m[0].trim()`). If a future category emits partial evidence (e.g., a named capture group) that does not fully cover the detection trigger, the backtick span may not neutralize the entire trigger.

**A4.** The option does not eliminate the possibility of self-triggering from completeness-phrase evidence strings that happen to contain trigger words from other categories. For example, if a completeness evidence string were `"everything is probably fixed"`, and this were emitted as evidence in backticks, stripping the span would remove the entire phrase — but this is a hypothetical edge case not present in the current phrase lists.

---

## Summary

The backtick-escaping option is mechanically sound for the current codebase: it reuses the existing `stripLowSignalRegions()` inline-code stripping path, applies it uniformly to all evidence strings via the `evidenceSnippets` format, and the test suite validates the behavior exhaustively for the current phrase corpus. The principal vulnerability is a maintenance gap: no tooling enforces that new static instruction text or new detection category examples use backtick-wrapping. A developer adding a new category and updating the reason text without wrapping trigger-word examples would silently reintroduce the self-trigger bug, and the existing tests would not catch it because they validate a copy of the reason-building logic rather than the production function itself.
