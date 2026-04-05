# Option Evaluation: Sentinel Marker

**Date:** 2026-03-10
**Option slug:** sentinel-marker
**Files examined:**

- `scripts/hallucination-audit-stop.cjs` (all line references below are to this file)
- `tests/hallucination-audit-stop.test.cjs`
- `hooks/hooks.json`

---

## 1. What does this option do — mechanically, step by step?

1. The `reason` string assembled at lines 703–718 would have a fixed prefix or UUID appended (e.g., every block reason begins with `HALLUCINATION-DETECTOR-BLOCK-REASON:` or contains a unique UUID injected at construction time).
2. On the next hook invocation, `getLastAssistantText()` (lines 86–102) extracts the last assistant message from the transcript. If Claude Code has written the block reason back into the transcript as an assistant message, that text is now the candidate for scanning.
3. Before calling `findTriggerMatches()` at line 641, the code checks whether `lastAssistantText` contains the sentinel string. If present, the hook exits cleanly (no block) without scanning.
4. The sentinel is only present in text that originated as a block reason — no real assistant response would contain the prefix by accident.

The sentinel check can be placed either inside `getLastAssistantText()` (returning `''` so main proceeds to `process.exit(0)` at line 636) or between lines 635 and 641 in `main()`.

---

## 2. What does it protect against or solve?

The sentinel solves the **self-trigger loop**: after the hook emits `{ "decision": "block", "reason": "..." }`, Claude Code appends the reason text to the transcript as a new assistant message. On the next Stop hook invocation, `getLastAssistantText()` reads that reason string. The reason contains evidence phrases verbatim in backtick-protected form (e.g., `` `probably` ``, `` `because` ``). Those backticks are stripped by `stripLowSignalRegions()` (lines 108–126) before matching, so the stripped phrases re-trigger `findTriggerMatches()`.

The sentinel makes the hook skip its own output entirely, regardless of what evidence phrases the reason string contains. It is identity-based rather than content-based: instead of trying to ensure every possible evidence phrase is suppressed in every possible reason-string arrangement, the hook recognizes "this is my own output" and stops.

The existing block-count loop guard (lines 689–693) provides a partial fallback: after 2 blocks in a session it allows through. But it does not prevent the 2 re-triggers from happening; the sentinel prevents all re-triggers.

---

## 3. What does it leave unprotected or unsolved?

**The hallucinating-rewrite-after-block gap.** When the hook blocks a response and injects the reason, the model rewrites. If the rewrite contains new hallucination triggers, the hook should fire on the rewrite — not skip it. The sentinel addresses this correctly _only if_ the transcript position is: `[...model rewrite as assistant message]` and not `[...block reason as assistant message]`. Whether this is safe depends on how Claude Code orders transcript entries after a block:

- If Claude Code writes the block reason as the last assistant entry and the model's rewrite comes after it, `getLastAssistantText()` (iterating from the end) returns the rewrite — sentinel absent, scanning proceeds normally. Correct.
- If Claude Code writes the block reason as the last assistant entry and never writes a separate rewrite entry (i.e., the rewrite is the same entry, overwriting the reason), then `getLastAssistantText()` returns the rewrite text. Sentinel absent, scanning proceeds. Also correct.
- If the block reason is stored as the last assistant entry at the point the _next_ Stop hook fires (before any rewrite), the sentinel skips it. Correct — nothing has been rewritten yet.

The gap is: **the sentinel cannot distinguish between "this is my own block reason" and "a legitimate assistant response that happens to contain the sentinel string."** In practice this is near-zero risk because the sentinel is chosen to be unscannable by normal assistant output. But it is not formally impossible.

The option also leaves unsolved the **cause** of why the reason self-triggers: the `stripLowSignalRegions()` call removes backtick protection from evidence phrases in the reason text. A sentinel skips the scan entirely and does not fix that suppression gap. If the sentinel approach is later removed or fails, the underlying vulnerability remains.

---

## 4. What are the failure modes?

### 4a. Claude Code truncates or reformats the reason text

The hook emits `JSON.stringify({ decision: 'block', reason })` (line 720). Claude Code receives this JSON. When it writes the block reason back into the transcript, it controls the format. Observed failure modes:

- **Prefix stripped**: If Claude Code strips a prefix like `HALLUCINATION-DETECTOR-BLOCK-REASON:` from the reason before writing to transcript (e.g., because it formats the reason for display), the sentinel is absent in the transcript entry and the hook scans the reason text again. Self-trigger resumes.
- **UUID variant**: If a UUID is embedded mid-reason, truncation is less likely to remove it — but Claude Code could still reformat the JSON block in ways that drop embedded markers from the prose. The UUID approach is more resilient than a prefix because it can be embedded anywhere in the string, but it is not immune to reformatting.
- **Encoding**: `JSON.stringify` escapes Unicode if the sentinel contains non-ASCII characters. This is safe if the sentinel is ASCII.
- **Hook output not written to transcript**: If Claude Code does not write the block reason into the transcript at all (i.e., the reason field is only used to prompt the model out-of-band), then the self-trigger problem does not exist and the sentinel is unnecessary. The test suite at lines 665–833 exists because the self-trigger was observed in practice, confirming that the reason does appear in the transcript.

### 4b. Sentinel string collision

A fixed prefix like `HALLUCINATION-DETECTOR-BLOCK-REASON:` is distinctive enough that legitimate assistant text will not contain it. A UUID is even safer. This failure mode is negligible in practice.

### 4c. Sentinel present in introspection mode

In introspection mode (lines 643–677), the hook never blocks but still logs. If a block reason from a previous non-introspection session appears in the transcript and introspection is now active, the sentinel check (if placed before the introspection branch) would skip logging for that entry. Whether this is desired depends on intent. If the sentinel check is placed after the introspection branch, this does not arise.

### 4d. Session-boundary state

The block-count state file is keyed by `sessionId` (line 595). The sentinel is keyed by text content. If a session reuses transcript entries from a previous session (edge case in Claude Code), the sentinel would still fire correctly because the sentinel is in the text itself, not in external state.

---

## 5. Evidence from the codebase supporting or arguing against this option

### Supporting

**The self-trigger problem is confirmed by existing tests.** The test suite at `tests/hallucination-audit-stop.test.cjs` lines 665–833 contains a full `describe('block reason self-trigger regression', ...)` block. These tests reproduce the exact reason string the hook emits and assert `findTriggerMatches(reason).length === 0`. The existence of this test block (added to address an observed regression) confirms that the self-trigger occurred and was considered important enough to test.

**The current fix is content-based, not identity-based.** The tests at lines 696–833 pass because the reason embeds evidence phrases in backticks (e.g., `` `probably` ``, `` `because` ``), and `stripLowSignalRegions()` at lines 108–126 removes inline code before scanning. The sentinel approach would replace this fragile per-phrase mechanism with a single identity check.

**The reason string does reach `getLastAssistantText()`.** The test at line 706 calls `buildBlockReason(originalMatches)` and feeds it directly into `findTriggerMatches()`. This mirrors the actual runtime path: if the tests are valid, the reason string is what `getLastAssistantText()` returns on the next invocation.

**Evidence phrases inside the reason are stripped of their backtick protection.** `stripLowSignalRegions()` (lines 114–117) removes inline code spans. The reason wraps evidence in backticks (lines 699–701: `` - ${m.kind}: \`${m.evidence}\` ``). After stripping, the raw phrase is exposed again. The current tests pass because the stripped phrase happens to land in a suppression-eligible position (e.g., inside an inline code explanation line). A sentinel would make this structural fragility irrelevant.

### Against

**The current content-based tests already pass.** Lines 696–833 show that the backtick-wrapping approach currently suppresses self-triggers for all known causality and speculation phrases. The sentinel adds resilience for edge cases but solves a problem that is currently handled.

**The sentinel check adds a code path that cannot be exercised by the existing tests.** The test suite tests `findTriggerMatches()` directly, not `main()`. A sentinel placed in `main()` at lines 635–641 would not be covered by any existing test. A new integration test exercising `main()` with a mocked transcript would be required.

**The hook contract is sensitive.** Per the project CLAUDE.md: "Any change that alters this stdout shape silently disables the entire hook." A sentinel implementation that introduces a bug (e.g., sentinel check fires on legitimate text) would cause silent allow-through. The sentinel check itself is simple enough to be safe, but it is another conditional in a critical path.

**The underlying suppression gap is not fixed.** If the sentinel is removed later (or silently fails due to Claude Code reformatting the reason), the self-trigger vulnerability returns. The sentinel is a bypass, not a repair of the `stripLowSignalRegions()` + backtick interaction.

---

## Summary verdict

The sentinel marker option is mechanically sound and directly addresses the self-trigger problem. Its primary risk is Claude Code reformatting or truncating the reason text before writing it to the transcript, which would silently re-expose the vulnerability. A UUID embedded in the middle of the reason string (not a prefix) is more resilient to prefix-stripping than a leading tag. The option is an identity-based bypass rather than a structural fix to the underlying `stripLowSignalRegions()` suppression gap — that gap remains latent. The option requires a new test covering `main()` with a sentinel-carrying transcript entry to be verifiable.
