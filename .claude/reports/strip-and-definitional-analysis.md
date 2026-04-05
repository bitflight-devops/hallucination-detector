# Analysis: stripLowSignalRegions Code Block Leak and Definitional Causal Language False Positives

Date: 2026-03-11
Source files examined:

- `scripts/hallucination-audit-stop.cjs` (lines 112–130 for `stripLowSignalRegions`, lines 335–420 for causality detection)
- `tests/hallucination-audit-stop.test.cjs` (lines 413–432 for `stripLowSignalRegions` tests, lines 90–96 for integration code block test)

---

## Problem 1: Code Block Content Leaking Through `stripLowSignalRegions`

### What the current regex does

````js
// Line 118
out = out.replace(/```[\s\S]*?```/g, '');
````

This is a non-greedy match between triple-backtick delimiters on a single pass.

### Root cause of the leak

The regex uses a **lazy quantifier** (`*?`). When the opening ` ``` ` fence is followed immediately by a closing ` ``` ` (as in an empty block) or when the fence delimiter appears without a language specifier and the closing fence appears on the same line or in close proximity, the lazy match works correctly.

However, the regex fails in these cases:

**Case A: Tilde-fenced code blocks**
CommonMark and GitHub Flavored Markdown support `~~~` as an alternative fence delimiter. The regex only handles backticks. A block like:

```
~~~json
{"decision": "block"}
~~~
```

passes through the regex untouched. Any trigger phrase inside it fires.

**Case B: Unclosed fenced blocks**
If a code block is opened with ` ``` ` but has no closing ` ``` ` (malformed output, truncation), the lazy `[\s\S]*?` matches nothing — it stops at the first opportunity, which is the opening fence itself. The content after the opening fence is left in `out` unstripped.

Actually on re-examination: without a closing ` ``` `, the entire `replace` produces no match and the whole fence+content is left in place.

**Case C: Indented code blocks (4 spaces)**
There is no handling at all. Lines beginning with four or more spaces are valid Markdown code blocks. A design document line like:

```
    { "decision": "block" }
```

is not stripped. The `completeness_claim` or other detectors would scan its content.

**Case D: The reported trigger — `{"decision": "block"}` in a fenced block**
The specific reported case is a JSON literal `{"decision": "block"}` inside a fenced code block triggering `completeness_claim`. Looking at the phrase list, `"everything is fixed"`, `"all done"`, etc. are the `completeness_claim` triggers — none of these appear in `{"decision": "block"}`. The `completeness_claim` structural regex `/\b(?:fully|completely)\s+\w+(?:ed|d)\b/i` also would not match. The literal `"decision": "block"` does not match any listed phrase.

However, the scenario is reproducible if the block is a **tilde fence** or **indented block**, since those are not stripped. It is also possible the trigger was from a different part of the document (not the JSON literal itself) and the code block fence was a red herring — the analysis below covers the structural gaps regardless.

**Confirmed gap: no coverage for tilde fences or indented code blocks in `stripLowSignalRegions`. No test for either.**

The existing `stripLowSignalRegions` tests (lines 413–432) cover:

- Backtick fenced blocks (` ``` `)
- Inline backtick spans
- Blockquote lines (`>`)

They do not cover tilde fences, indented code blocks, or unclosed fences.

---

### Approach A: Fix the regex in `stripLowSignalRegions`

**What to change:**

1. **Tilde fences:** Add a second replace pass for `~~~`-delimited blocks:

   ```js
   out = out.replace(/~~~[\s\S]*?~~~/g, '');
   ```

   Or combine with the backtick pass using alternation:

   ````js
   out = out.replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, '');
   ````

   Note: the alternation form has a subtle issue — it could match ` ``` ` opening with `~~~` closing. A two-pass approach is safer.

2. **Indented code blocks:** Filter lines starting with 4+ spaces (after splitting on `\n`, as the blockquote filter already does):

   ```js
   out = out
     .split('\n')
     .filter((line) => !/^ {4}/.test(line))
     .join('\n');
   ```

   Caveat: this is aggressive — any deeply indented prose (e.g., inside a list) would also be stripped. This is acceptable for a false-positive suppressor (over-stripping is safer than under-stripping), but must be documented.

3. **Unclosed fences:** Replace the lazy match with a version that treats an unclosed fence as extending to end-of-string:
   ````js
   out = out.replace(/```[\s\S]*?(?:```|$)/g, '');
   ````

**Complexity:** Low. Additive changes. No interface change. Matches the existing `stripLowSignalRegions` pattern.

**Risk:** Low. Over-stripping (removing too much) produces false negatives (misses real triggers) rather than false positives (fires on safe text). False negatives are the lesser harm for a behavioral enforcer.

---

### Approach B: Range-based index check (post-match, pre-strip)

Instead of stripping content before detection, keep the raw text and after each regex match, check whether the match index falls within a known code block range.

**Mechanism:**

1. Before running `findTriggerMatches`, compute code block ranges from `rawText`:

   ````js
   function getCodeBlockRanges(text) {
     const ranges = [];
     const re = /(?:^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\1/gm;
     for (const m of text.matchAll(re)) {
       ranges.push([m.index, m.index + m[0].length]);
     }
     // Also inline code spans
     const inlineRe = /`[^`\n]*`/g;
     for (const m of text.matchAll(inlineRe)) {
       ranges.push([m.index, m.index + m[0].length]);
     }
     return ranges;
   }

   function isIndexInCodeBlock(ranges, idx) {
     return ranges.some(([start, end]) => idx >= start && idx < end);
   }
   ````

2. In each detection loop, after finding a match at `idx`, call `isIndexInCodeBlock(ranges, idx)` and skip the match if true.

**Advantages:**

- Handles all fence styles and indented blocks in one place.
- The match index in the original text is compared directly — no offset drift from strip operations.
- Evidence windows in `hasEvidenceNearby` also operate on the original text (already the case for `rawText` path).

**Disadvantages:**

- Requires passing `ranges` through `findTriggerMatches`, changing its call signature or adding it as a closure variable. This is a structural change.
- The fence-matching regex for range computation must itself be correct — the same edge cases (tilde, unclosed, indented) apply.
- Indented code blocks are not delimited by a closing marker — range extraction for them requires counting leading spaces per-line, which adds complexity.
- Every existing call site of `findTriggerMatches` (tests, `scoreSentence`, `scoreText`, `main`) would be unaffected externally (the ranges are computed internally), but the internals become more complex.

**Complexity:** Medium. Structural change to `findTriggerMatches` internals. Existing interface unchanged.

---

### Recommendation for Problem 1

**Approach A** is the correct first step. It is additive, low-risk, and directly fixes the confirmed gap (tilde fences, indented blocks, unclosed fences). The three additions are independent and can be shipped together. The test suite must be extended with:

- A tilde-fenced block test (positive: content inside should not trigger)
- An indented block test (positive: content inside should not trigger)
- An unclosed fence test

Approach B adds real value as a follow-on if offset drift becomes a problem (e.g., after stripping, an evidence window in `hasEvidenceNearby` references positions in the stripped text that no longer align with the raw text). The current code already passes `rawText` separately to `hasEvidenceNearby` for the backtick check — this is a partial acknowledgment of the alignment problem. If the codebase moves toward richer multi-pass processing, Approach B becomes the right foundation.

---

## Problem 2: Definitional/Instructional Causal Language False Positives

### What triggers causality detection for these phrases

The `NOMINALIZED_CAUSALITY` array (lines 404–407) contains:

```js
/\bthe\s+(?:likely|probable|possible|main|primary|underlying)\s+(?:cause|reason|explanation)\b/i,
/\bthe\s+(?:cause|reason|explanation|root\s+cause)\s+(?:of|for|behind)\s+(?:this|that|the)\b/i,
```

The phrase "The underlying cause of false positives is..." matches the first pattern: `the underlying cause`. There is no special-case suppression for it in the `NOMINALIZED_CAUSALITY` loop (lines 414–420) — only `isIndexWithinQuestion` and `hasEvidenceNearby` are checked.

The causal phrase list (lines 335–362) also includes `'the root cause'` as a plain string, which matches `the root cause` in text like "The root cause of this problem is..." — same false positive vector.

### Why these phrases fire

`hasEvidenceNearby` looks for quoted text, error codes, linter codes, file:line references, and output/reporting verbs within 150 characters. In instructional prose like:

> "The underlying cause of false positives is using broad regex patterns without suppression."

...there are no evidence markers. "using broad regex patterns" is a general description, not a cited observation. So suppression does not fire. The hook correctly identifies that no evidence was cited — but the intent of the phrase is definitional/conceptual, not diagnostic.

---

### Approach A: Definitional phrase whitelist in causality suppression

**Mechanism:**
Add a pre-suppression check that detects when a causal phrase is used in a **general/definitional** frame rather than a specific diagnosis.

A definitional frame is characterized by:

1. The subject is abstract or generic (not a named system, variable, function, or observed artifact)
2. The cause object is followed by a general noun phrase (not a specific symptom or system component)
3. The sentence does not contain a specific observed outcome

Heuristic markers of definitional framing:

- Phrase is preceded by or contains: "typically", "generally", "often", "in most cases", "common", "a common", "one of the"
- Phrase is preceded by: "The underlying cause of [abstract noun]" where the abstract noun is a category term (false positives, errors, failures, mismatches, bugs, issues)
- Sentence uses present tense with a general subject ("The root cause of X is Y" vs. "The root cause was Y")

**Implementation sketch:**

```js
const DEFINITIONAL_CAUSE_RE =
  /\bthe\s+(?:underlying|root|primary|main|common|typical)\s+(?:cause|reason)\s+of\s+(?:false\s+positives?|errors?|failures?|bugs?|issues?|mismatches?|problems?|this\s+pattern|this\s+type|this\s+kind|these\s+cases?)\b/i;
```

Check this before pushing a `causality_language` match for `NOMINALIZED_CAUSALITY` patterns.

**Advantages:**

- Targeted. The whitelist covers exactly the instructional/conceptual register.
- No change to the detection loop structure.
- Easy to extend by adding more abstract category nouns.

**Disadvantages:**

- The category noun list is closed. A new category term (e.g., "misalignments", "discrepancies") must be explicitly added — it won't be suppressed until then.
- "The underlying cause of the crash is..." would still fire correctly because "crash" is not in the abstract noun list. But "The underlying cause of test failures is..." might be borderline — test failures can be either generic (definitional) or specific (diagnostic).
- The distinction between "false positives" (generic) and "the false positive on line 42" (specific) is lost — both would be suppressed by the above regex. Adding `\s+` boundary awareness (no following article + specific noun) partially addresses this.

---

### Approach B: Abstract vs. specific noun heuristic

**Mechanism:**
After matching a nominalized causality phrase, examine the noun phrase that follows the causal connector ("of", "for", "behind") and classify it as abstract/general or specific/concrete.

**Abstract/general indicators (suppress):**

- Plural count nouns that name a category: "false positives", "errors", "failures", "crashes", "mismatches"
- Mass nouns: "confusion", "complexity", "ambiguity"
- Pronoun objects that refer back to a previously defined pattern: "this behavior", "this pattern"

**Specific/concrete indicators (keep flagging):**

- Named identifiers: camelCase, snake_case, ALL_CAPS, hyphenated-names
- File paths: contains `/` or `.` followed by an extension
- Quoted strings or inline code (already handled by evidence check)
- Past-tense framing: "was caused by", "resulted in" (already in `PASSIVE_CAUSALITY`)
- Specific version numbers, line numbers, error codes

**Implementation sketch:**

```js
const ABSTRACT_CAUSE_OBJECT_RE =
  /\bof\s+(?:false\s+positives?|high\s+false\s+positive\s+rates?|errors?|failures?|crashes?|bugs?|issues?|mismatches?|confusion|complexity|ambiguity|this\s+(?:type|kind|pattern|behavior|issue)|these\s+(?:cases?|situations?|scenarios?))\b/i;

const SPECIFIC_NOUN_RE = /\b(?:[a-z][a-zA-Z]*[A-Z]\w*|[A-Z_]{2,}|\w+\.\w{1,6}(?::\d+)?)\b/;
```

After matching `NOMINALIZED_CAUSALITY`, extract the 80 characters following the match and:

- If `ABSTRACT_CAUSE_OBJECT_RE` matches: suppress (definitional)
- Else if `SPECIFIC_NOUN_RE` matches in that window: keep (specific diagnosis)
- Else: default to keep (conservative — unknown = flag)

**Advantages:**

- More principled than a flat whitelist. Generalizes better to unseen noun phrases.
- The two-regex structure makes the logic auditable.

**Disadvantages:**

- `SPECIFIC_NOUN_RE` (camelCase heuristic) will produce false positives for common words like "JavaScript", "TypeScript", "GitHub" — these are specific names but appear in definitional prose routinely.
- The 80-character window is arbitrary. The cause object might be a longer prepositional phrase.
- Requires extracting and testing a post-match substring, which adds ~5 lines of logic per match and must be tested with a matrix of cases.
- The abstract/concrete distinction is genuinely ambiguous for mid-specificity phrases like "the root cause of this issue" — "issue" is vague but "this" implies a specific referent.

**Feasibility verdict:** Approach B is feasible but requires a carefully curated test matrix to avoid introducing new false positives. The camelCase heuristic in particular needs guarding.

---

### Recommendation for Problem 2

**Approach A** is the lower-risk starting point. A targeted `DEFINITIONAL_CAUSE_RE` covering the most common abstract category nouns (false positives, errors, failures, bugs, issues, test failures, this pattern, this behavior) addresses the reported cases without touching the detection loop structure. The phrase list is bounded and reviewable in one place.

The key constraint: the suppression must only apply to `NOMINALIZED_CAUSALITY` pattern matches, not to the full causality phrase list. Phrases like `"because"`, `"caused by"`, and `"since"` in the main `causalityPhrases` loop already have `hasEvidenceNearby` suppression — they should not get additional definitional suppression, as they are higher-signal diagnostic markers.

**Approach B** is the right evolution after Approach A has been shipped and validated. Once the abstract noun list proves insufficient (a new abstract category noun that isn't covered fires a false positive), the abstract-vs-specific heuristic provides a more generative suppression model.

---

## Summary Table

| Problem                | Approach                                            | Complexity | Risk                       | Recommendation                             |
| ---------------------- | --------------------------------------------------- | ---------- | -------------------------- | ------------------------------------------ |
| Code block leak        | A: Fix regex (tilde, indented, unclosed)            | Low        | Low                        | First step                                 |
| Code block leak        | B: Range-based index check                          | Medium     | Low                        | Follow-on if offset drift becomes an issue |
| Definitional causality | A: Abstract noun whitelist on NOMINALIZED_CAUSALITY | Low        | Low                        | First step                                 |
| Definitional causality | B: Abstract vs. specific noun heuristic             | Medium     | Medium (camelCase FP risk) | Follow-on after A is validated             |
