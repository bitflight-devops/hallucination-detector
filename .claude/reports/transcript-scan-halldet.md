# Transcript Scan: Hallucination Detector Blocks and User Frustration

**Scan date:** 2026-03-11
**Files scanned:** 5 target JSONL files (see paths below)
**Method:** JSONL parsed line-by-line; text-type content blocks only; tool_result content excluded

---

## Files Scanned

| UUID                                   | Short name  |
| -------------------------------------- | ----------- |
| `0fd5c759-3e70-4ade-86bd-14091b2b3b61` | Session-0FD |
| `1b2340c4-1789-4260-b4e8-ff7469e77601` | Session-1B2 |
| `45f77a53-5158-432b-b9cf-1e0e4e6ad8c9` | Session-45F |
| `d3c249ec-bdd2-444d-9f5f-e223fb053f23` | Session-D3C |
| `f8e4a016-f734-4af0-b3d9-945b7c3888b7` | Session-F8E |

**Sessions with zero findings:** Session-0FD, Session-1B2, Session-45F — no block events, no user frustration signals in any of their messages.

---

## Search 1: Hallucination Detector Block Events

Pattern matched: `STOP HOOK blocked` in user or assistant message text (blocks appear embedded in user turn content because Claude Code writes the hook error into the next user turn).

| #   | Session     | Line     | Triggered phrase / hook category                                                                                             | Preceding assistant content (what got blocked)                                                                                                                                                                                               | Assessment                                                                                                                                                                                                                                                                                                                   |
| --- | ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Session-D3C | 6–7      | `Hallucination-detector STOP HOOK blocked this response` — no phrase detail visible (session start, no prior assistant turn) | No preceding assistant turn — block occurred before any response in session. Hook is reading its own prior block output from the transcript.                                                                                                 | **False positive / self-trigger loop.** The hook was reading its own previous block `reason` text from the JSONL transcript and re-triggering on causality words embedded in that reason string. Root cause: `getLastAssistantText()` was reading hook output rather than only clean assistant messages.                     |
| 2   | Session-D3C | 59       | `causality_language: "since"`                                                                                                | Assistant line 57: _"You're right. The hook's own block message contains … so the hook does not re-trigger on the explanation … That line contains 'since'"_ — the assistant's self-analysis text contained the word "since" in plain prose. | **False positive / self-trigger loop.** `"since"` appeared in the hook's own injected block reason text, not in a speculative causal claim. The hook re-read this from the transcript and re-blocked.                                                                                                                        |
| 3   | Session-D3C | 328, 336 | `N/A` — hook text embedded inside a `task-notification` user message (no explicit reason string surfaced in text layer)      | Assistant line 325/333: empty (assistant said nothing — these are auto-injected task notification entries).                                                                                                                                  | **Ambiguous / infrastructure noise.** The pattern matched on a task-notification wrapper that referenced prior block content. Not a genuine block of assistant speculation.                                                                                                                                                  |
| 4   | Session-F8E | 13       | `causality_language` — phrase `"The underlying cause"` (reported by assistant at line 14 as the trigger)                     | Assistant line 11: _"What false positives are you seeing? Please describe: 1. The text that triggered a block …"_ — a clarifying question asking the user to describe false positives.                                                       | **False positive.** The assistant's response (line 11) used `"The underlying cause"` in a conceptual/definitional context (explaining a detection category), not as an ungrounded causal assertion about observed system behavior. The `causality_language` detector lacks suppression for instructional/definitional usage. |
| 5   | Session-F8E | 352      | `N/A` — hook text in task-notification wrapper                                                                               | Assistant line 349: _"Two done, waiting for reuse review."_ — routine status message.                                                                                                                                                        | **Ambiguous / infrastructure noise.** Pattern matched on task-notification content referencing prior hook output, not a genuine speculation block.                                                                                                                                                                           |

**Genuine block events:** 3 (entries 1, 2, 4)
**Infrastructure/noise matches:** 2 (entries 3, 5)

---

## Search 2: User Frustration About Speculation / AI Errors

Pattern matched: `speculate`, `speculation`, `causation`, `correlation`, `made up`, `invent`, `fabricat`, `hallucin`, `baloney`, `nonsense`, `stop guessing`, `don't guess`, `not true`, `making things up`, `pulling that from` in user-role messages.

| #   | Session     | Line | User complaint (excerpt)                                                                                                                                | What the user was reacting to                                                                                                                                                        | Assessment                                                                                                                                                                                                        |
| --- | ----------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Session-D3C | 53   | _"WHy do you state something as true withoiut evidence?"_                                                                                               | Assistant had asserted "the hook is reading the wrong message" as a diagnosis without any supporting evidence from the transcript.                                                   | **Legitimate complaint.** The assistant made an ungrounded causal claim. This is exactly what the detector is designed to catch — the detector should have blocked it.                                            |
| 2   | Session-D3C | 56   | _"You can see that the Assistant response does not contain any `since` but the HOOKS OWN FUCKING OUTPUT CONTAINS IT"_                                   | User was pointing out the self-triggering loop: the word `"since"` was in the hook's own block message, not in the assistant's actual response.                                      | **Legitimate complaint / self-trigger bug.** User correctly identified the root cause of false positive blocks before the assistant did.                                                                          |
| 3   | Session-D3C | 59   | _"Are you fucking broken?"_ (followed by another block event)                                                                                           | Assistant (line 57) was mid-analysis, still hadn't identified the fix, then got blocked again by the same self-trigger loop. User frustration at repeated blocks without resolution. | **Legitimate frustration.** Three consecutive failures: wrong diagnosis, another block, slow convergence on root cause.                                                                                           |
| 4   | Session-D3C | 62   | _"Okay, so what? Thats exactly my first request to you. and you only just realized it. now… you are sitting there doing nothing. And not researching."_ | Assistant correctly identified the root cause at line 60 but then paused without acting.                                                                                             | **Legitimate frustration.** Assistant identified the issue but stalled rather than proceeding to fix. Not a hallucination complaint per se — a workflow complaint.                                                |
| 5   | Session-D3C | 95   | _"But, why are the hallucination reports to the AI showing up in this way, and why is it scanning itself at all?"_                                      | User asking why the hook's block output text was appearing in the transcript and getting re-scanned.                                                                                 | **Conceptual question about self-triggering behavior**, not frustration at AI speculation. Relevant to the root cause being investigated.                                                                         |
| 6   | Session-F8E | 16   | _"the phrase 'the underlying cause' is not even observable"_                                                                                            | Assistant (line 14) had asserted that `"The underlying cause"` was in the detected patterns as the triggering phrase. User contested this.                                           | **Legitimate correction.** The assistant stated a specific phrase as the trigger without verifying it against the actual regex patterns — exactly the kind of ungrounded specificity the detector targets.        |
| 7   | Session-F8E | 26   | _"How come when you say stuff like 'may not' or 'may' this system isn't blocking you for speculation?"_                                                 | The assistant (line 23) had used `"may not"` and `"may"` in an explanation, and these were not blocked. User questioning coverage gaps.                                              | **Gap report, not frustration.** User is correctly noting that hedging words `may`, `may not` are not in the detector's `speculation_language` patterns, which only covers: "I think", "probably", "likely", etc. |
| 8   | Session-F8E | 92   | _"guessed causes get reused as facts / pattern-matched fixes get treated as verified / partial log readings become 'root cause'"_                       | User articulating the failure modes they want the detector to address — part of a feature discussion about structured claim annotation.                                              | **Feature motivation statement.** Not a complaint about current assistant behavior — a design requirement statement.                                                                                              |

**Genuine AI-speculation complaints:** 3 (entries 1, 2, 6)
**Frustration at workflow/behavior:** 2 (entries 3, 4)
**Conceptual/coverage questions:** 3 (entries 5, 7, 8)

---

## Summary of Findings

**Total findings: 13** (5 block events + 8 user frustration entries)

### Key patterns

1. **Self-trigger loop (root cause of most blocks in Session-D3C):** The hook's own `reason` text was being written back into the JSONL transcript and re-read by `getLastAssistantText()` on the next Stop invocation. The `reason` string contained trigger words (`"since"` in `causality_language`), causing repeated blocks of legitimate responses. This was the primary bug in Session-D3C. It was subsequently fixed (commit history shows `bc20244` and related work).

2. **False positive on definitional/instructional causal language (Session-F8E, entry 4):** The `causality_language` detector fired on `"The underlying cause"` used in a conceptual explanation, not an ungrounded diagnostic claim. The current suppression rules (question sentences, evidence markers, enumeration) do not cover definitional/instructional context. This is an open false-positive category.

3. **Coverage gap: hedging words `may`, `may not` not covered (Session-F8E, entry 7):** User correctly observed that `may` and `may not` pass through unblocked despite being standard hedging language. These are absent from `speculation_language` patterns.

4. **One true positive confirmed:** Session-D3C line 53 — user called out the assistant for stating a diagnosis (`"the hook is reading the wrong message"`) without evidence. The detector did not block this (the self-trigger loop was causing indiscriminate blocking of other turns instead). The false positives were drowning out the one case where a block would have been appropriate.

---

_Files:_

- `/home/ubuntulinuxqa2/.claude/projects/-home-ubuntulinuxqa2-repos-hallucination-detector/d3c249ec-bdd2-444d-9f5f-e223fb053f23.jsonl`
- `/home/ubuntulinuxqa2/.claude/projects/-home-ubuntulinuxqa2-repos-hallucination-detector/f8e4a016-f734-4af0-b3d9-945b7c3888b7.jsonl`
