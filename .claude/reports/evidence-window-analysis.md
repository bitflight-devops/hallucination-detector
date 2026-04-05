# Evidence Window Analysis: `hasEvidenceNearby()` False Positive Rate

**Date**: 2026-03-11
**File analyzed**: `scripts/hallucination-audit-stop.cjs`
**Tests analyzed**: `tests/hallucination-audit-stop.test.cjs`

---

## Current Behavior

`hasEvidenceNearby(text, idx, rawText, windowSize = 150)` checks a `±150` character window centered on the match index. It tests six EVIDENCE_MARKER patterns in the stripped text and a backtick pattern in the raw text.

The six markers:

1. Quoted text (`"..."` or `'...'`, 3+ chars)
2. Error/exit codes (`error code 127`, `exit 1`)
3. Linter codes (`E501`, `W291`)
4. Observed-output verbs (`returned`, `reported`, `showed`, `output`, `printed`, `logged`, `threw`, `raised`, `exited`, `failed`)
5. Stream/trace nouns (`stdout`, `stderr`, `traceback`, `exception`, `stack trace`)
6. File:line references (`src/foo.py:42`)

Backtick inline code is checked separately against `rawText` (because `stripLowSignalRegions` removes backticks before the marker scan runs).

---

## The Three Confirmed False Positives

### FP1 and FP2: `"because"` in grounded code explanations

Both involve an assistant explaining observed behavior by referencing a function name, data structure, or architectural pattern that was cited earlier in the same message. The causal word (`because`) and the supporting evidence are in the same message but the evidence appears more than 150 characters before the `because` match index.

Example structure (FP1):

```
The `_create_app()` function performs a synchronous build of the page shell.
[... several sentences of explanation ...]
The HTML page loads before the async data because the build step runs synchronously.
```

The word `_create_app()` in the raw text is a backtick span — an evidence signal — but it is >150 chars before the `because` index, so `BACKTICK_RE.test(rawWindow)` does not find it.

### FP3: `"The underlying cause"` in instructional/definitional context

The NOMINALIZED_CAUSALITY regex `/\bthe\s+(?:likely|probable|possible|main|primary|underlying)\s+(?:cause|reason|explanation)\b/i` fires on `"The underlying cause"` even when it is used pedagogically ("The underlying cause of this class of bug is X") rather than to diagnose a specific unverified bug in the current session. No evidence check suppresses this because the match goes through the IMPLICIT/NOMINALIZED/PASSIVE loop which also calls `hasEvidenceNearby` at the match index — and the instructional context has no local evidence markers within ±150 chars.

---

## Approach A: Expand the Evidence Window

### How far would the window need to reach?

For FP1 and FP2, the evidence (a function name or data structure reference in backticks) appears in the same message but earlier. A typical assistant explanation paragraph is 400–800 characters. The `because` clause appears at the end of the explanation. So the evidence is roughly 300–600 characters before the `because` index.

A window of **500 characters lookback** (asymmetric: 500 back, 150 forward) would cover the common case where the assistant summarizes earlier-stated evidence in a causal conclusion sentence.

An asymmetric window matters here: evidence for a causal claim typically precedes it (the reasoning that leads to "because X"), not follows it. The 150-char forward window can remain unchanged.

### Risk: over-suppression (false negatives)

Expanding the lookback from 150 to 500 chars increases the probability that a distant, unrelated code span suppresses a genuine speculation flag. Consider:

```
Here is the relevant code: `myFunction()`.

This is a different topic. The test probably fails because the mock is misconfigured.
```

If `myFunction()` appears within 500 chars before the `because`, the genuine speculation would be suppressed. The current 150-char window correctly flags this; a 500-char window would not.

### Impact on existing true-positive tests

The current positive test case:

```
'The test fails because the mock is wrong.'
```

No evidence markers anywhere in this short string. Window size is irrelevant — this still flags correctly at any window size.

The current suppressed test case:

```
'The test fails because `error code 127` was returned by the process.'
```

Evidence is within ~30 chars of `because`. Still suppressed at any window size.

No existing test case would flip from true-positive to false-negative under a 500-char expansion, because all existing positive test inputs are short (< 150 chars total) and contain no evidence markers at all.

### FP3 impact

Expanding the window does not fix FP3 (`"The underlying cause"` in instructional context). The instructional text has no evidence markers in the sentence, regardless of window size.

### Implementation complexity

Low. Change the `windowSize` default from `150` to use an asymmetric call:

```js
// Current:
function hasEvidenceNearby(text, idx, rawText, windowSize = 150) {
  const start = Math.max(0, idx - windowSize);
  const end = Math.min(text.length, idx + windowSize);

// Proposed asymmetric form:
function hasEvidenceNearby(text, idx, rawText, lookback = 500, lookahead = 150) {
  const start = Math.max(0, idx - lookback);
  const end = Math.min(text.length, idx + lookahead);
```

All existing call sites pass no explicit `windowSize`, so changing the default signature is backward compatible. The rawText window should use the same asymmetric bounds.

### Risk summary

| Risk                                   | Assessment                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixes FP1 and FP2                      | Yes, if evidence appears within 500 chars before `because`                                                                                   |
| Fixes FP3                              | No                                                                                                                                           |
| Flips existing true-positive tests     | No (test inputs are too short to have distant code refs)                                                                                     |
| Over-suppression risk in real messages | Moderate — any code reference within 500 chars before a causal phrase suppresses the flag, even if the code reference is topically unrelated |

---

## Approach B: Message-Level Evidence Check

### Mechanism

Instead of (or in addition to) the local window check, count evidence marker occurrences across the entire stripped + raw message text. If the total count meets a threshold, suppress causality matches in that message.

Logic:

```
messageHasRichEvidence(text, rawText) → boolean
  count = (EVIDENCE_MARKERS matches in text) + (backtick spans in rawText)
  return count >= threshold
```

### Threshold selection

The three false positives all come from code-explanation messages where the assistant described function calls, data structures, or architectural components. These messages typically contain 3–8 backtick spans and 1–3 observed-output verbs.

A genuine speculation message ("The test probably fails because the mock is wrong") contains zero evidence markers.

A threshold of **3 total evidence signals** in the message appears to separate the two populations cleanly:

- FP1: contains `_create_app()` (1 backtick span) + function call descriptions + "synchronous build" mentions — likely 2–4 backtick spans total → above threshold
- FP2: contains data structure references in backticks, method names → above threshold
- FP3: instructional text with no code references → 0 or 1 backtick spans → below threshold (does not help FP3 either)
- True positive "The test fails because the mock is wrong." → 0 evidence signals → below threshold → still flagged correctly

### OR vs AND interaction with local window

**OR (either local window OR message-level)**: Suppresses causality when either the local window finds evidence OR the whole message is evidence-rich. This maximizes suppression of false positives at the cost of more false negatives. Any message containing 3+ code references anywhere would suppress all causality flags in that message.

**AND (both local window AND message-level)**: Both conditions must be true to suppress. This is strictly tighter than the current behavior and would not fix FP1/FP2 (the local window already fails them — adding a second required condition makes suppression harder, not easier).

Correct interaction for fixing the false positives is **OR**.

### Risk: over-suppression with OR

With OR, a message that contains 3+ backtick spans anywhere and also contains a genuine speculative causal claim will be suppressed. Example:

```
Here is the code: `foo()`, `bar()`, `baz()`.
The test probably fails because the mock is misconfigured.
```

Three backtick spans → message-level threshold met → the genuine speculation on the second sentence is suppressed. This is a meaningful false-negative risk.

The risk is highest in messages that mix code display with genuine speculation — which is exactly the pattern that produces both false positives and the most important true positives.

### FP3 impact

Does not fix FP3. The instructional `"The underlying cause"` text contains no evidence markers, so message-level threshold is not met.

### Implementation complexity

Moderate. Requires a new function that counts evidence markers across full text:

```js
function messageEvidenceCount(text, rawText) {
  let count = 0;
  for (const re of EVIDENCE_MARKERS) {
    const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (matches) count += matches.length;
  }
  // Count backtick spans in rawText
  const backtickMatches = rawText.match(/`[^`\n]+`/g);
  if (backtickMatches) count += backtickMatches.length;
  return count;
}
```

Then modify the causality loop to check `messageEvidenceCount(...) >= 3` as an OR condition alongside `hasEvidenceNearby`.

### Impact on existing true-positive tests

The existing test `'The test fails because the mock is wrong.'` contains zero evidence markers (no backticks, no error codes, no observed-output verbs). Message count = 0, below threshold. Still flagged correctly.

The suppressed test `'The test fails because \`error code 127\` was returned by the process.'`contains one backtick span and the verb`returned` (an EVIDENCE_MARKERS match). Message count ≥ 2, below threshold of 3 — so message-level suppression would NOT fire here. But local window suppression still fires, so the net result is unchanged: still suppressed.

No existing test would flip.

### Risk summary

| Risk                               | Assessment                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| Fixes FP1 and FP2                  | Partially — only if the message contains ≥3 evidence signals     |
| Fixes FP3                          | No                                                               |
| Flips existing true-positive tests | No (test inputs have 0–1 evidence signals)                       |
| Over-suppression risk              | High for messages that mix code display with genuine speculation |

---

## FP3: Neither Approach Addresses It

FP3 (`"The underlying cause"` in instructional/definitional context) is a different problem. The NOMINALIZED_CAUSALITY regex fires on the phrase structure alone. The context is not a code explanation — it is a pedagogical statement. No evidence markers are nearby.

The correct fix for FP3 is not window expansion or message-level counting. It is a phrase-level exclusion: instructional/definitional uses of `"the underlying cause"` can be identified by the absence of a specific referent. Patterns like `"The underlying cause of this class of bug"` or `"The underlying cause in general"` are definitional; `"The underlying cause of the test failure"` is diagnostic. This requires a separate, targeted exclusion, not covered by either approach above.

---

## Comparison Table

| Criterion                                           | Approach A (expanded window, asymmetric 500/150)          | Approach B (message-level count ≥3, OR)                             |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Fixes FP1 (`because`, evidence earlier in message)  | Yes, if within 500 chars                                  | Partially, if message has ≥3 signals                                |
| Fixes FP2 (`because`, evidence earlier in message)  | Yes, if within 500 chars                                  | Partially, if message has ≥3 signals                                |
| Fixes FP3 (`"The underlying cause"`, instructional) | No                                                        | No                                                                  |
| Flips existing true-positive tests                  | No                                                        | No                                                                  |
| False-negative risk                                 | Moderate (distant code ref suppresses nearby speculation) | High (rich-evidence messages suppress all causality flags)          |
| Implementation complexity                           | Low (change default parameter, asymmetric bounds)         | Moderate (new counting function, OR condition)                      |
| Explainability                                      | High (easy to reason about: "evidence within N chars")    | Low (global message state affecting local match decisions)          |
| Determinism                                         | Local and predictable                                     | Non-local: one part of the message changes behavior at another part |

---

## Recommendation

**Approach A (asymmetric window expansion) is the better choice for FP1 and FP2.**

Rationale:

- The false positives occur because the evidence-to-causal-conclusion distance in natural code explanations (~300–500 chars) exceeds the current window (150 chars). The fix is calibrated to that actual distance.
- The false-negative risk is concrete but bounded: a code reference must appear within 500 chars before a causal phrase, which is a tighter constraint than a whole-message count.
- Implementation is a one-line parameter change. No new state, no new functions, no non-local effects.
- Existing tests pass unchanged.

**FP3 requires a separate targeted fix** — a phrase-level exclusion in the NOMINALIZED_CAUSALITY section, not covered by either approach. It should be tracked as a distinct issue.

**Approach B is not recommended** in its OR form: the non-local effect (evidence anywhere in a long message suppresses flags elsewhere in the same message) produces unpredictable behavior that is hard to reason about and harder to test. A message with a code block at the top and a speculative diagnosis at the bottom would silently pass through — which is exactly the failure mode the hook exists to catch.

If Approach B were implemented, it should use AND (requiring both message-level richness and local window evidence), making it strictly harder to suppress than the current behavior. That would not fix the false positives but would reduce noise from pathological cases where the local window fires on code-rich messages.

---

## Proposed Window Values

For Approach A:

- **Lookback**: 500 characters (covers a typical explanation paragraph before a causal conclusion)
- **Lookahead**: 150 characters (unchanged — forward evidence is less common and less relevant)

These values are estimates based on the described false positive structure. A calibration pass against a larger transcript corpus would sharpen them. The default parameter change keeps backward compatibility for any callers that pass an explicit `windowSize`.
