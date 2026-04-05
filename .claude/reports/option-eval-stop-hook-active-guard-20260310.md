# Option Evaluation: `stop_hook_active` Guard

**Option slug:** stop-hook-active-guard
**Date:** 2026-03-10
**Problem being solved:** The stop hook self-triggers — its own block reason text (injected back into the transcript as an assistant message by Claude Code) contains the flagged phrases it just emitted, causing the next hook invocation to fire on its own output.

---

## 1. Mechanical Description — What the Option Does Step by Step

### What the option proposes

When `stop_hook_active: true` is present in the stdin JSON, skip `findTriggerMatches()` entirely and exit cleanly (allow the response through).

### What the code currently does with `stop_hook_active`

`stop_hook_active` is already read from stdin. Evidence:

**`scripts/hallucination-audit-stop.cjs`, line 623:**

```js
const stopHookActive = Boolean(input.stop_hook_active);
```

It is used in exactly one place — the loop-break condition at **line 690:**

```js
if (nextBlocks > 2 && stopHookActive) {
  saveLoopState(statePath, { blocks: nextBlocks });
  process.exit(0);
}
```

The current logic is: allow through only when the block count exceeds 2 **AND** `stop_hook_active` is true. `stopHookActive` alone does not cause an early exit; it is a modifier on the loop-break threshold.

### What the proposed option would change mechanically

The proposed guard would add an early-exit branch **before** `findTriggerMatches()` is called:

```
read stdin → parse → if stop_hook_active: true → exit 0 (allow)
                      else → run findTriggerMatches() → block or allow
```

This is a change from the current behavior where `stop_hook_active` only participates in the post-match loop-break condition.

### `stop_hook_active` is not currently used as a standalone guard

A search for `stopHookActive` in `tests/hallucination-audit-stop.test.cjs` returns no matches. There are no tests covering the `stop_hook_active` path at all. The flag is read (line 623) but its only effect today is as a conjunct in the `nextBlocks > 2` condition (line 690).

---

## 2. What This Option Protects Against / Solves

The self-triggering loop happens because:

1. Hook fires, detects speculation language, emits a block with `reason` text.
2. Claude Code injects the block reason as an assistant message into the transcript.
3. The block reason text contains the flagged phrases (e.g., `probably`, `likely`, `because`) quoted in the evidence snippets section.
4. Next hook invocation reads the transcript, finds the injected reason text as the last assistant message, and fires again on its own output.

The `stop_hook_active` guard breaks this loop at step 4: when Claude Code is already in a hook-driven continuation turn (a rewrite triggered by a prior block), it sets `stop_hook_active: true`. The guard would skip detection entirely for that invocation and allow the response through unconditionally.

**This correctly targets the self-trigger scenario.** The hook only self-triggers during hook-driven continuation turns, which is precisely when `stop_hook_active` is true.

---

## 3. What This Option Leaves Unprotected / Unsolved

### Rewrites that still contain speculation language

If Claude rewrites a response after a block but the rewrite still contains speculation language, **this option misses it entirely.**

When `stop_hook_active` is true, the guard exits before running `findTriggerMatches()`. A rewrite saying "The test probably fails because the mock is wrong" would pass through unchecked.

This is the central trade-off: the guard eliminates false positives (self-trigger on the hook's own reason text) but also eliminates true positives (genuine speculation in the rewrite).

### The structural reason the self-trigger occurs is not removed

The block reason text at **lines 703–718** contains the flagged evidence phrases embedded in its `evidenceSnippets` section:

```
- speculation_language: `probably`
- causality_language: `because`
```

These phrases are present verbatim (not wrapped in backticks in the JSON payload, only in the human-readable reason string). The hook's instruction at line 714 tells Claude to wrap flagged phrases in backticks in rewrites — but the hook's _own reason text_ does not suppress those phrases through `stripLowSignalRegions` because `stripLowSignalRegions` only strips code blocks, inline code, and blockquotes, not the block reason injected by Claude Code as a plain assistant message.

The guard does not fix this root cause. It bypasses detection during the turn where self-triggering occurs, but the structural condition that causes self-triggering (the hook's reason text containing flagged phrases as a plain assistant message) remains in place.

### `stop_hook_active` semantics are Claude Code internals

The guard's correctness depends entirely on Claude Code setting `stop_hook_active: true` during every hook-driven continuation turn and only during those turns. This contract is not documented in the codebase. The existing report at `.claude/reports/hook-mechanism-analysis-20260310.md` and `.claude/reports/prompt-hook-stop-schema.md` may contain the schema, but the hook itself has no verification of this assumption. If Claude Code's behavior changes (e.g., the flag is not set in some hook-driven turn variants), the self-trigger reoccurs.

### Introspection mode is not affected

The `config.introspect` branch at **lines 643–677** runs `findTriggerMatches()` and logs results regardless of `stopHookActive`. The proposed guard, if placed before the introspect branch, would suppress introspection logging during hook-driven turns. If placed after the introspect branch, it would allow self-triggered blocks while logging them — inconsistent behavior. The option evaluation does not specify placement relative to the introspect branch.

---

## 4. Failure Modes

### False negative on genuine rewrites

As described in §3: any speculation language in a rewrite is invisible to the hook when `stop_hook_active` is true. The hook cannot distinguish "this is a hook-driven turn where the assistant's response is the hook's own reason text" from "this is a hook-driven turn where the assistant produced a new response with real speculation." Both cases get the same unconditional pass.

### Silent disable if flag is absent

If Claude Code does not set `stop_hook_active` in some hook-driven continuation variant (e.g., a future Claude Code version, a different hook event type, or a platform where the flag behaves differently), the guard is ineffective and the self-trigger loop recurs. The current loop-break at `nextBlocks > 2` (line 690) provides a floor; the proposed guard provides no such floor on its own if `stopHookActive` is false.

### Interaction with the existing loop-break

The current code at **lines 690–693** has a compound condition: `nextBlocks > 2 && stopHookActive`. If the proposed guard exits before this branch is reached, the block counter (`nextBlocks`) is still incremented at line 695 on every non-guarded invocation. The loop-break on line 690 would never be reached for `stop_hook_active: true` turns (the guard exits first), which means the `blocks` counter would be incremented for every blocked turn and never for guarded turns. This is not a regression — it preserves the existing counter semantics — but it makes the loop-break condition at line 690 effectively dead code for the `stopHookActive` case, creating a logic artifact that future maintainers cannot understand without this conversation.

### No test coverage for `stop_hook_active`

A grep of `tests/hallucination-audit-stop.test.cjs` for `stop_hook_active` and `stopHookActive` returns no matches. The proposed option introduces behavior that cannot be verified by the existing test suite. If the option is implemented, tests must be added; otherwise the guard's correctness is unverified.

---

## 5. Evidence From the Codebase Supporting or Arguing Against This Option

### Supporting

**The flag is already read (line 623):** `const stopHookActive = Boolean(input.stop_hook_active);`
The infrastructure for this guard already exists. Implementation cost is minimal — one conditional before the `findTriggerMatches()` call.

**The existing loop-break already uses `stopHookActive` as a trust signal (line 690):** The codebase already treats `stop_hook_active: true` as a signal that normal blocking should be suppressed. The proposed guard extends this trust to an earlier point in the flow — consistent with the established pattern.

**The self-trigger is a documented loop concern (lines 13–14):** "Uses a small per-session counter in OS tempdir to avoid infinite loops." The counter at lines 592–613 is the current mitigation. The proposed guard is an alternative, earlier mitigation.

### Against

**The root cause is not addressed.** The hook's own reason text (lines 703–718) contains flagged phrases embedded in `evidenceSnippets`. The guard suppresses detection during self-trigger turns; it does not prevent the reason text from containing flagged phrases. If the guard fails (flag absent, wrong placement), the loop resumes.

**Unconditional pass on `stop_hook_active` creates a blind spot.** The current design always runs detection and uses the block counter as a circuit breaker. The proposed guard creates a turn class where detection never runs. Genuine speculation in a rewrite goes undetected. The existing counter-based approach (lines 685–693) at least runs detection and counts the block; the guard removes detection entirely.

**The `nextBlocks > 2 && stopHookActive` condition at line 690 becomes partially dead.** The compound condition was written to require both "we've blocked many times" and "we're in a hook-driven turn" before allowing through. The proposed guard exits before line 690 for all `stopHookActive` turns, making the `stopHookActive` conjunct at line 690 reachable only when... `stopHookActive` is false, which makes the conjunct vacuously suppressive (the condition can never be true when `stopHookActive` is false and `nextBlocks > 2`). This is a logic inconsistency introduced by adding the guard without removing or revising the existing condition.

**No tests exist for this path.** Grep of `tests/hallucination-audit-stop.test.cjs` confirms zero coverage of `stop_hook_active`. The option requires new tests to be verifiable.

---

## Summary

| Dimension                | Assessment                                                 |
| ------------------------ | ---------------------------------------------------------- |
| Solves self-trigger loop | Yes — when `stop_hook_active: true` is set by Claude Code  |
| Root cause addressed     | No — hook reason text still contains flagged phrases       |
| Genuine rewrites checked | No — unconditional pass on `stop_hook_active: true`        |
| Implementation cost      | Low — flag already read at line 623                        |
| Test coverage required   | Yes — currently zero coverage for this path                |
| Logic consistency        | Partial — creates dead code in line 690 compound condition |
| Correctness dependency   | Claude Code always sets flag during hook-driven turns      |
