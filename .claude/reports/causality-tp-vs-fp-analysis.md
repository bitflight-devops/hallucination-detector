# Causality Language: True Positive vs False Positive Analysis

**Analysis date:** 2026-03-11
**Data sources:** 3 transcript scan reports, 9 causality_language incidents total
**Transcript sessions examined:** 7 unique sessions across 3 projects

---

## 1. Incident Table

| #   | Session                  | Line  | Trigger Phrase         | Classification                        | Causal Claim                                                                                                                                                                                                              | Observable Basis                                                                                                                                                                                                                                                                                                                                                           | What Made It TP or FP                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------ | ----- | ---------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | D3C (halldet)            | L6    | "since"                | **FP — self-trigger**                 | N/A — hook's own block reason text contained "since"                                                                                                                                                                      | N/A                                                                                                                                                                                                                                                                                                                                                                        | Hook re-scanned its own output from transcript JSONL. No assistant causal claim existed.                                                                                                                                                                                                                                                                |
| 2   | D3C (halldet)            | L59   | "since"                | **FP — self-trigger**                 | N/A — same self-trigger loop as #1                                                                                                                                                                                        | N/A                                                                                                                                                                                                                                                                                                                                                                        | Identical root cause: hook's reason string in transcript re-triggers the hook.                                                                                                                                                                                                                                                                          |
| 3   | F8E (halldet)            | L13   | "The underlying cause" | **FP — definitional**                 | Assistant used "The underlying cause" in a conceptual explanation listing detection categories and asking clarifying questions.                                                                                           | The assistant was explaining how the detector works in response to user's question about false positives. No diagnostic claim about observed system behavior.                                                                                                                                                                                                              | Phrase used in **definitional/instructional** framing ("The underlying cause [of this class of problem] is..."), not as a diagnostic claim about a specific observed failure.                                                                                                                                                                           |
| 4   | 6fac1bde (stateless)     | L736  | "because"              | **FP — grounded code explanation**    | "The browser gets nothing until all of that completes" — explained why HTML page shell loads before async data.                                                                                                           | Assistant had read `_create_app()` source code, identified synchronous build on line 384, and `_register_periodic` onload callback. The causal chain: `_create_app()` builds synchronously -> browser waits -> nothing renders until complete.                                                                                                                             | The "because" connected code the assistant had **read and cited** (`_create_app()`, `_build_dashboard()`, `pn.state.onload`, line 384) to observed rendering behavior. Every link in the causal chain was grounded in specific code references in the same message.                                                                                     |
| 5   | 6fac1bde (stateless)     | L1670 | "because"              | **FP — grounded data explanation**    | "vertical banding appearance is because many sessions were active on the same days" — explained a chart rendering artifact.                                                                                               | Assistant was explaining a scatter plot where X=timestamp, Y=compound score. The "banding" is a direct consequence of the data structure (multiple sessions share dates).                                                                                                                                                                                                  | The causal claim follows **deductively from the data structure** the assistant was working with: timestamps on X axis + multiple sessions = vertical stacking. No speculation involved — this is how scatter plots work with shared X values.                                                                                                           |
| 6   | 31fb1dd0 (claude-skills) | L93   | "The underlying cause" | **FP — wrong message + definitional** | L86: "The underlying cause: the AI writing the instruction and the AI reading it have the same training data and reasoning capability."                                                                                   | This was a general principle about why Claude writes bad instructions for Claude — a design observation, not a diagnosis of a specific failure.                                                                                                                                                                                                                            | Two issues: (a) hook scanned L86 instead of L91 (the actual last assistant message), and (b) the phrase was **definitional** — explaining a general design principle, not asserting causality about an observed event.                                                                                                                                  |
| 7   | 714db3e4 (claude-skills) | L393  | "because"              | **FP — wrong message + grounded**     | L386: "The interop protocol is easier to design once you have a working harness with real artifacts flowing through it, because you'll know exactly what the stage boundaries look like."                                 | This was a design rationale statement — "do X first because then you'll know Y."                                                                                                                                                                                                                                                                                           | Two issues: (a) hook scanned L386 instead of L391 (the actual last assistant message, which had no "because"), and (b) the "because" expressed **design rationale** (why an approach makes sense), not a diagnostic claim about observed behavior.                                                                                                      |
| 8   | 79c86576 (claude-skills) | L221  | "since"                | **FP — grounded action report**       | L213: "The description is now redundant since the PNG conveys the same information visually."                                                                                                                             | Assistant had just been editing the file's references section, converting SVG to PNG references, and the user asked to remove a textual description. The assistant had worked with both the description text and the PNG.                                                                                                                                                  | The "since" connected two things the assistant had **directly observed and acted on in the same turn**: the description content and the PNG content. This is a post-action status report, not a speculative diagnosis.                                                                                                                                  |
| 9   | b8ba796c (claude-skills) | L424  | "because"              | **TP — ungrounded diagnostic**        | L417: "Because the agent synthesized the six-step reasoning chain from the conversation and numbered it, then referenced those numbers internally. The chain was never presented as a numbered list in our conversation." | The assistant asserted "The chain was never presented as a numbered list in our conversation" — a factual claim about conversation history. This was **wrong**: the user's next response (L421) challenged it, and the assistant corrected itself at L422: "Yes. The numbered steps were defined in our conversation — I introduced them after your correction of step 3." | The assistant made a **factual claim about observable data (conversation history) that was incorrect**. It asserted a negative ("was never presented") without verifying against the transcript. The causal chain ("Because the agent synthesized... The chain was never presented...") was built on an unverified premise that turned out to be false. |

---

## 2. Score Summary

- **True Positives:** 1 (incident #9)
- **False Positives:** 8 (incidents #1-8)
- **False Positive Rate:** 89% (8/9)

### FP Breakdown by Root Cause

| Root Cause                                 | Count | Incidents  |
| ------------------------------------------ | ----- | ---------- |
| Self-trigger (hook scans own output)       | 2     | #1, #2     |
| Wrong message scanned (not last assistant) | 2     | #6, #7     |
| Definitional/instructional usage           | 2     | #3, #6     |
| Grounded code/data explanation             | 3     | #4, #5, #8 |
| Design rationale                           | 1     | #7         |

Note: incidents #6 and #7 have two root causes each (wrong message + semantic).

---

## 3. Pattern Analysis

### 3.1 Linguistic Patterns That Distinguish TP from FP

**The single TP (incident #9) has these linguistic features:**

1. **Sentence-initial "Because"** — the response starts with "Because the agent synthesized..." This is a **diagnostic framing**: the user asked "Why is it mentioning steps 3-5?" and the assistant answered with an explanation that began with the causal word.

2. **Contains an unverifiable negative assertion** — "The chain was **never** presented as a numbered list in our conversation." This is a claim about the absence of something in observable data, stated as fact without verification.

3. **No in-sentence references to specific artifacts** — the claim about what "the agent" did is not accompanied by a citation (file path, line number, transcript line, tool output).

**The 6 semantic FPs (incidents #3-8, excluding self-trigger bugs) share these linguistic features:**

1. **Post-action reporting** — the assistant had just performed an action (read code, edited a file, analyzed data) and was explaining what it found or did. The causal word connects the action/observation to a conclusion.

2. **Specific references in the same message** — every FP contains concrete references near the causal word:
   - #4: `_create_app()`, `_build_dashboard()`, `pn.state.onload`, `line 384`
   - #5: "X axis is timestamp", "Y axis is compound score" (structural description of a chart the assistant built)
   - #7: "working harness with real artifacts flowing through it" (referencing artifacts discussed throughout the conversation)
   - #8: "the PNG conveys the same information" (referencing a file the assistant just edited)

3. **The causal claim is deductive, not diagnostic** — in every FP, the "because" connects two things that are both visible in the message. "X is because Y" where both X and Y are stated facts, and the connection is logical/structural rather than an inference about hidden causes.

### 3.2 Contextual Patterns

| Pattern                 | TP (incident #9)                                                                                       | FPs (incidents #3-8)                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Discourse function**  | Diagnostic: "Why did X happen?" -> "Because Y"                                                         | Explanatory: "X works this way" / "I did X because Y" / "X is redundant since Y"                                      |
| **Evidence in message** | No citations; claims about conversation history without quoting it                                     | Specific file paths, line numbers, function names, or structural descriptions                                         |
| **Verifiability**       | Contained a negative universal ("was never presented") that required checking all conversation history | Each claim was locally verifiable from artifacts named in the same message                                            |
| **Causal direction**    | Backward-looking diagnosis: "this happened because of what the agent did in the past"                  | Forward-looking rationale or structural explanation: "this is how it works" / "I removed this because it's redundant" |
| **User question type**  | "Why is it mentioning X?" (asking for root cause of a problem)                                         | Various: requests to edit, explain, or analyze                                                                        |

### 3.3 Definitional vs Diagnostic Distinction

Two FPs (#3, #6) used causal language in a **definitional** frame:

- "The underlying cause: the AI writing the instruction and the AI reading it have the same training data" — this is a **general principle**, not a claim about a specific observed failure.
- "The underlying cause" in explaining detection categories — conceptual framing.

The TP used causal language in a **diagnostic** frame:

- "Because the agent synthesized the six-step reasoning chain" — this is a claim about **what a specific agent did in a specific instance**, asserted without evidence.

---

## 4. Proposed Suppression Rules

Based on the patterns above, the following rules would correctly separate the TP from all FPs in this dataset.

### Rule 1: Suppress when the causal sentence contains a specific code/file reference

**Condition:** Suppress `causality_language` when the sentence containing the trigger word also contains at least one of:

- A file path (`/path/to/file` or `path.ext`)
- A function/method name (word followed by `()`)
- A line number reference (`line \d+`, `L\d+`)
- An inline code span (backtick-wrapped text)

**Rationale:** When the assistant cites specific artifacts in the same sentence as the causal claim, the claim is grounded by reference. This is different from the current `hasEvidenceNearby()` which uses a character window — the rule should be **same-sentence**, not character-distance.

**Would correctly handle:**

- FP #4: sentence contains `_create_app()`, `line 384`
- FP #8: sentence references "the PNG"
- TP #9: sentence contains no code references — would still fire

### Rule 2: Suppress when the causal word connects a completed action to its rationale

**Condition:** Suppress `causality_language` when the sentence matches the pattern:
`[past-tense verb or "is now"] ... [causal word] ... [observable state]`

Examples:

- "The description is now redundant **since** the PNG conveys..."
- "I removed X **because** Y already covers..."
- "This was changed **due to** the error at line 42"

**Implementation pattern (regex):**

```
/\b(?:is\s+now|removed|changed|updated|edited|fixed|added|deleted|replaced)\b.{0,60}\b(?:because|since|due\s+to)\b/i
```

**Rationale:** When a past-tense action verb or "is now" precedes the causal word, the sentence is reporting what was done and why — not diagnosing an unknown cause.

**Would correctly handle:**

- FP #8: "is now redundant since"
- TP #9: "Because the agent synthesized" — no past-tense action verb from the assistant; the assistant is diagnosing what someone else did

### Rule 3: Suppress definitional/general-principle framing

**Condition:** Suppress `causality_language` when the causal phrase appears in a sentence that:

- Contains "the underlying cause" or "the root cause" followed by a colon (`:`) — this signals a **definition**, not a diagnosis
- OR is inside a numbered/bulleted list that defines categories or principles

**Implementation:** Check if `the underlying cause:` or `the root cause:` pattern exists — the colon converts it from an assertion into a label.

**Would correctly handle:**

- FP #3: "The underlying cause" in a conceptual explanation
- FP #6: "The underlying cause: the AI writing the instruction..."
- TP #9: No colon after causal phrase; it's a direct assertion

### Rule 4: Flag sentence-initial "Because" answering a "why" question

**Condition:** When the trigger word is "because" AND it appears at the start of a sentence (or within the first 3 words), AND the preceding user message contains "why" — this is a **diagnostic response** pattern that should NOT be suppressed.

**Rationale:** This is the highest-risk pattern: user asks "Why?" and assistant starts with "Because..." — this is exactly where ungrounded causal claims appear. The TP in this dataset matches this pattern exactly.

**Implementation:**

```
/^because\b/i  — at sentence start
```

Combined with checking the preceding user message for `/\bwhy\b/i`.

### Rule 5: Flag unverifiable negative universals in causal claims

**Condition:** When a causal sentence contains a negative universal assertion — "never", "no X existed", "was not present", "has no" — flag it regardless of other suppression. These are claims about the absence of something, which require exhaustive verification the assistant did not perform.

**Implementation:** Within a sentence containing a causality trigger, check for:

```
/\b(?:never|no\s+\w+\s+(?:existed|was|were|appeared)|was(?:n't| not)\s+(?:present|defined|created|shown))\b/i
```

**Would correctly handle:**

- TP #9: "The chain was **never** presented as a numbered list" — negative universal, flagged
- All FPs: none contain negative universals

---

## 5. Recommended Implementation Priority

1. **Fix wrong-message scanning** (incidents #6, #7) — this is a bug, not a suppression rule. The hook must scan only the actual last assistant message, not previous messages. This alone eliminates 2 of 8 FPs.

2. **Fix self-trigger loop** (incidents #1, #2) — also a bug. Already addressed in commit `bc20244` per the scan report. Eliminates 2 more FPs.

3. **Implement Rule 1 (same-sentence code reference)** — replaces the character-window `hasEvidenceNearby()` with sentence-scoped evidence detection. This is the highest-impact suppression change.

4. **Implement Rule 4 (sentence-initial "Because" after "why")** — this is a flag-escalation rule, not a suppression rule. It identifies the highest-risk pattern.

5. **Implement Rule 5 (negative universals)** — supplements Rule 4 to catch the specific linguistic marker that distinguished the TP.

6. **Implement Rule 3 (definitional framing)** — handles the "underlying cause:" pattern.

7. **Implement Rule 2 (action-rationale)** — handles post-action reporting.

---

## 6. Key Insight

The current approach treats causality detection as a **lexical** problem (does the word "because" appear near evidence markers?). The data shows it is a **discourse** problem:

- **Grounded causality** = assistant connects two things it has observed/done, with references in the same sentence
- **Ungrounded causality** = assistant diagnoses a cause for something it hasn't directly verified, with no citations

The distinguishing signal is not token proximity but **sentence-level structure**: what role does the causal word play in the sentence, and does the sentence contain its own evidence?

The single TP in this dataset was detectable not by the word "because" alone, but by three co-occurring features:

1. Sentence-initial "Because" (diagnostic response pattern)
2. No code/artifact references in the same sentence
3. A negative universal claim ("was never") about observable data

A rule combining these three features would have caught the TP while suppressing all 6 semantic FPs.
