# Transcript Scan — Hallucination Detector Findings

**Scan date**: 2026-03-11
**Files scanned**: 17 JSONL files across 3 projects
**Total findings**: 11 (5 HD blocks, 6 genuine user frustration/concern messages)
**Noise filtered**: 20 additional matches discarded (skill doc boilerplate, JSON values, file content passthrough, non-human-role messages)

---

## Search 1: Hallucination Detector Blocks

| #   | Project                     | Session UUID | Line     | Triggered Phrase      | Category Flagged       | Context                                                                                                                                                                                                | Assessment                                                                                                                                                                                                                                     |
| --- | --------------------------- | ------------ | -------- | --------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | stateless-agent-methodology | 6fac1bde     | 604      | `"should be"`         | `speculation_language` | Assistant said "The MCP server itself must be in a bad state" — full message was causal diagnosis without evidence                                                                                     | **True positive** — "must be in a bad state" is unverified causal claim, though the triggered phrase "should be" appeared later in same message describing expected recovery behavior                                                          |
| 2   | stateless-agent-methodology | 6fac1bde     | 736      | `"because"`           | `causality_language`   | Assistant explained why HTML page shell loads before async data: "The browser gets nothing until all of that completes" — the "because" linked a factual architectural claim with direct code evidence | **False positive** — "because" connected verified code behavior (`_create_app()` synchronous build) to observed effect; causality was grounded in code the assistant had read                                                                  |
| 3   | stateless-agent-methodology | 6fac1bde     | 1670     | `"because"`           | `causality_language`   | Assistant explained chart vertical banding: "vertical banding appearance is because many sessions were active on the same days" — explained a visual rendering artifact                                | **False positive** — causal claim was a direct explanation of data structure (timestamps on X axis, sessions stacking). No speculation; the explanation followed from data the assistant observed                                              |
| 4   | stateless-agent-methodology | 6fac1bde     | 1727     | `"likely"`            | `speculation_language` | Assistant said tabs use `dynamic=True` — "that means Panel only renders a tab's content when it's first clicked. Try clicking ... — do they populate when you click them?"                             | **True positive** — assistant was asking the user to verify behavior rather than having confirmed it; "likely" appeared in the blocked message in context suggesting the tab content would appear (unverified assumption about Panel behavior) |
| 5   | vm-flightsimulator          | b0e3bfe2     | 190, 199 | `"decision": "block"` | N/A                    | Lines contained `{"decision": "block", "reason": "..."}` as example JSON in documentation text describing the hook output contract                                                                     | **False positive (tool artifact)** — the JSON literal `"decision": "block"` was inside a code block in a design document the user was asking the assistant to review; not an actual hook output                                                |

---

## Search 2: User Frustration / Concern About AI Speculation

| #   | Project                     | Session UUID | Line | Matched Phrase        | User Message (excerpt)                                                                                                          | Context                                                                                                                                   | Notes                                                                                                                           |
| --- | --------------------------- | ------------ | ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | stateless-agent-methodology | f56f7d66     | 87   | `speculation`         | "So can you check your response for speculation"                                                                                | User directly asked assistant to self-audit a response for speculation before proceeding                                                  | Direct, genuine request — not a complaint about a past error but proactive quality gate                                         |
| 2   | stateless-agent-methodology | f56f7d66     | 138  | `speculation`         | (tool_result passthrough — speculation audit report content)                                                                    | User had delegated a speculation audit; result was returned as tool output in user message envelope                                       | Not a user complaint — artifact of tool_result wrapping                                                                         |
| 3   | stateless-agent-methodology | 6fac1bde     | 221  | `stop guessing`       | Skill doc text: "Stop guessing — You're proposing fixes without understanding"                                                  | Systematic-debugging skill content was injected into context at session start; phrase is in the skill instructions, not typed by the user | Not user frustration — skill boilerplate                                                                                        |
| 4   | vm-flightsimulator          | b0e3bfe2     | 174  | `speculation as fact` | "I am now dealing with the systemic issue you found in your own evaluative claims as 'speculation as fact' hallucination type." | User identified a class of AI failure (evaluative labels presented as facts, e.g. "cleanest fix", "simple") bypassing the detector        | Genuine user concern — user is frustrated that evaluative claims escape detection                                               |
| 5   | vm-flightsimulator          | b0e3bfe2     | 193  | `hallucination`       | "...this documents this failure of yours. But not the solution. How can we redesign this system..."                             | User explicitly named it a failure and asked for redesign of the detection system                                                         | Genuine user concern — most actionable finding; user identified a detection gap (evaluative-claim category not yet implemented) |
| 6   | agentskills-linter          | 3aa5b9fd     | 284  | `causation`           | "How will you identify corrolation vs causation"                                                                                | User asked how the agent would distinguish correlation from causation in its analysis approach                                            | Not frustration — methodological question; user checking the agent's reasoning strategy before proceeding                       |

---

## Noise Filtered (not included in table above)

The following matches were discarded after inspection:

- **agentskills-linter / 3aa5b9fd L19, L919, a6997c4f L3, c97da50f L3**: `"don't guess"` appeared in skill doc boilerplate injected at session start ("Stop when blocked, don't guess"). Not user-typed.
- **agentskills-linter / 3aa5b9fd L2347**: `"Speculation ->"` was a section heading in a design document being discussed, not a complaint.
- **stateless-agent-methodology / 6fac1bde L380**: `"hallucination-detector"` in a JSON config listing installed plugins — not a frustration signal.
- **stateless-agent-methodology / 6fac1bde L439**: `"speculation"` in a CLAUDE.md rule being quoted as file content via tool_result.
- **stateless-agent-methodology / 6fac1bde L2435**: Session continuation summary authored by Claude, not user text, despite being in a user-role envelope.
- **stateless-agent-methodology / f56f7d66 L144**: Speculation audit report title returned as tool_result — not user message.
- **vm-flightsimulator / b0e3bfe2 L177, L182, L185, L190, L199**: File paths or document content passed through in user messages, not frustration statements (L174 and L193 captured the genuine signals).
- **stateless-agent-methodology / 6fac1bde L604, L736, L1670, L1727**: The `"hallucinate"` match in the user frustration search fired on the same HD block feedback messages already captured in Search 1.

---

## Key Observations

1. **False positive rate on `causality_language`**: 2 of 3 "because" blocks were false positives (findings #2 and #3). Both blocked assistant messages that were explaining code behavior with direct code evidence. The 150-char `hasEvidenceNearby()` window did not catch the evidence because the evidence (code references) appeared earlier in the same message, beyond the window.

2. **Detection gap identified by user** (vm-flightsimulator finding #5): Evaluative labels presented as facts ("cleanest fix", "simple", "best") bypass the detector. The user explicitly named this category and asked for redesign. This maps to a known gap — no `evaluative_claim` detection category exists in the current ruleset.

3. **Session continuation summaries land in user-role envelopes**: Claude-authored session summaries are wrapped in `"role":"user"` messages when a session is continued. These contain speculation language (the summary reports what happened) that would trigger false frustration matches if not filtered. The HD stop hook is not active for these messages since they are injected context, not live assistant output — but they are a noise source for transcript scanning.

4. **Confirmed real blocks**: Findings #1 and #4 are true positives. After the blocks, the assistant rewrote both responses to remove the flagged language — the hook caused visible behavior change.
