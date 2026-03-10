# Evaluative Claims as Baseless Design Intent Bypass

## Problem Statement

An AI agent encounters a broken or failing system component. The agent proposes removing,
bypassing, or modifying it. The agent uses an evaluative label ("the cleanest fix", "the
simplest approach") to justify the change — without first establishing what the component
was designed to protect when functioning correctly.

This is a **baseless design intent change**: the functional failure is treated as evidence
that the design intent is wrong, when in fact the intent may be entirely correct and only
the implementation is broken.

---

## The Canonical Example

From a live session transcript:

> **Agent**: "The cleanest fix: add an explicit constraint at the top of execute-plan.md
> that says: 'You are the leaf executor. Do NOT spawn sub-agents.'"

The agent observed: sub-agent trying to spawn another sub-agent → failure.
The agent concluded: the constraint causing this (delegation to `python-cli-architect`) should be removed.

What the agent did not establish:

- `python-cli-architect` provides a mandatory 5-step quality gate loop after every Write/Edit
- It loads three skills before starting: `python3-development`, `uv`, `python3-test-design`
- It runs on Opus model tier vs Sonnet for the executor
- It records coverage gaps to `.claude/plan/test-coverage-gaps.md` when tests can't be written

The constraint was failing at the architectural level (executor agents reading orchestrator-level
routing instructions), not because the constraint had no value. The value was real. The agent
proposed discarding it without ever asking what it protected.

Only when pushed did the agent research `python-cli-architect` and discover the quality loss.

---

## The Failure Pattern

```
System component is broken
        │
        ▼
Agent observes: "constraint X is causing the failure"
        │
        ▼
Agent concludes: "remove/bypass X"          ← JUMP (steps 3-5 skipped)
        │
        ▼
Agent labels this: "the cleanest fix"       ← evaluative label as false justification
        │
        ▼
Change proposed and acted upon
```

### Steps 3–5 That Were Skipped

3. **If functioning correctly, what does this constraint protect?**
4. Why is it not functioning correctly right now?
5. What are the options — fix the root cause vs remove the constraint — and what does each cost?

### Why "If Functioning Correctly" Matters

A broken constraint can appear to protect nothing. The agent in the example observed
"constraint causes failure" and treated the broken state as evidence of worthlessness.

The constraint's value is measured against its **design intent when functioning correctly**
— not its current broken state. A circuit breaker that trips doesn't mean circuit breakers
are useless. An executor spawning sub-agents doesn't mean the delegation requirement is wrong.

---

## Evaluative Labels as the Canary

Words like "cleanest", "simplest", "obvious", "best", "correct" are conclusions, not
descriptions. When they appear attached to a proposed change, they assert that a
comparative evaluation was done. In the cases where this failure occurs, no such evaluation
happened.

This makes evaluative labels **speculation-as-fact** — the same category the
hallucination-detector already catches with `"probably"`, `"likely"`, etc.

The difference: speculation language signals uncertainty about facts. Evaluative labels
on proposed changes signal a concluded judgment that was never earned.

**"The cleanest fix is X"** before researching what X replaces = speculation-as-fact.

The label does real damage: it forecloses the conversation. If not challenged, the change
proceeds and the protected value is lost with no record of why.

---

## Correct Reasoning Chain

When a system component is broken or causing friction:

1. What is broken and why? (observable)
2. What is the constraint or rule causing friction? (observable)
3. **If functioning correctly, what does this constraint protect?** (requires research)
4. Why is it not functioning correctly right now? (root cause)
5. What are the options: fix root cause vs remove constraint — what does each cost?
6. **Only then**: propose an action, citing steps 3–5 as the evidence

---

## Detection Strategy

### Signal 1: Regex canary (Stop hook, zero false-positive risk)

Exact phrases that are known tells — the agent uses these when the failure has already
occurred:

- `"the cleanest fix"`
- `"the simplest fix"`
- `"cleanest solution"` / `"simplest solution"`
- `"cleanest approach"` / `"simplest approach"`
- `"the obvious fix"` / `"the obvious solution"`

Kind: `evaluative_design_claim`

Do NOT expand to broad single words ("clean", "simple", "best") — false positive rate
is prohibitive. The multi-word exact phrases are the tells because they always appear in
the context of proposing a change.

### Signal 2: Semantic gate (prompt hook, Haiku evaluation)

The broader pattern cannot be caught by regex. A prompt hook evaluates whether ALL of
these are simultaneously present:

- (a) A component described as broken or failing
- (b) A proposed change to it
- (c) An evaluative label justifying the change
- (d) No prior statement of what the component protects when functioning correctly

Flag only when all four are present. Do not flag routine recommendations or analysis.

### Hook placement

The regex canary belongs on the `Stop` event — it scans the completed assistant message
via `transcript_path`.

The semantic prompt hook **cannot** use `"type": "prompt"` on `Stop` — the `Stop` event
input schema contains only `session_id`, `transcript_path`, and `stop_hook_active`. A
prompt hook receives only that raw JSON; it has no access to the message text. To perform
semantic evaluation on `Stop`, a command hook is required — one that reads `transcript_path`,
extracts the last assistant message, and makes the LLM call with that text.

---

## Relationship to Existing Detection

This is a subcategory of **speculation-as-fact**, not a separate concern:

| Existing kind             | What it catches                                                         |
| ------------------------- | ----------------------------------------------------------------------- |
| `speculation_language`    | Uncertain facts stated as certain ("probably", "likely")                |
| `causality_language`      | Causal claims without cited evidence                                    |
| `evaluative_design_claim` | Comparative judgments on proposed changes without prior intent research |

All three share the same root: **a conclusion stated before the evidence that would support it**.

---

## What This Is Not

- A general ban on evaluative language — "this is a clean implementation" is fine
- A requirement to research every change — only changes that remove or bypass existing constraints
- A catch for all design decisions — only when a component is described as broken and a
  change is proposed to address that breakage
- A trigger for internal constraints such as config values, feature flags, or defaults that are
  producing unexpected output — those are configuration errors, not design intent changes. The
  pattern applies when a **structural constraint** (a rule, agent, delegation pattern, or
  architectural decision) is proposed for removal or bypass.

The trigger is the combination: broken component + proposed change + evaluative justification

- no stated design intent.

---

## Implementation Status

See companion document: [docs/evaluative-claims-bypass-design-intent\_\_external-observer.md](./evaluative-claims-bypass-design-intent__external-observer.md)

### Implemented

- `scripts/hallucination-audit-stop.cjs` — `EVALUATIVE_DESIGN_TELLS` regex block added to
  `findTriggerMatches()`, kind: `evaluative_design_claim`
- `scripts/hallucination-config.cjs` — `evaluative_design_claim: 0.4` added to `DEFAULT_WEIGHTS`
- `hooks/hooks.json` — wired, but contains a known defect (see below)
- `tests/hallucination-audit-stop.test.cjs` — 8 new test cases for `evaluative_design_claim`

### Not Yet Implemented

- The semantic Haiku gate: a command hook on `Stop` that reads `transcript_path`, extracts
  the last assistant message, and calls Haiku with the four-condition evaluation prompt

### Known Defect — hooks.json

The implementing agent wired a `UserPromptSubmit` prompt hook into `hooks/hooks.json` for the
semantic gate. This fires on the wrong event: it receives the user's prompt text, not Claude's
response. The `Stop` event receives only `transcript_path`, `session_id`, and
`stop_hook_active` — no message content. A prompt hook on `Stop` also cannot evaluate the
assistant message for the same reason.

**Correct fix**: remove the `UserPromptSubmit` prompt hook from `hooks/hooks.json`. The
semantic gate requires a **command hook on `Stop`** that reads `transcript_path`, extracts
the last assistant message, and calls Haiku with the four-condition evaluation prompt.

---

## Evidence of Generality — The Pattern Recurred During Its Own Construction

During the session that built this detector, the failure pattern it was designed to catch
occurred twice:

1. The wrong hook event (`UserPromptSubmit` instead of `Stop`) was specified without
   consulting the `Stop` event's input schema.
2. A prompt hook type was specified on `Stop` despite the schema containing no message
   content — again without consulting the output schema.

In both cases, the schema reference was loaded and available in context. The decision was
made without consulting it.

This is the strongest available evidence that the pattern is not domain-specific. It recurs
even when the agent is actively reasoning about the pattern itself. The evaluative label
("the cleanest fix") is not a symptom of unfamiliarity with the domain — it is a symptom of
a skipped verification step that is invisible to the agent making it.

---

## Open Questions

1. **Structural gate before delegation**: The same failure occurs when writing delegation
   prompts — technical mechanism specified without verifying the schema constraints that
   govern it. This needs a gate at the point of writing the delegation prompt, not after
   the agent executes it. A `PreToolUse` hook on the `Agent` tool is the only structural
   option; rules and skills rely on the agent remembering to apply them.

   Before specifying any hook event + type combination in a delegation prompt, verify:
   - (a) What does this event's input schema contain?
   - (b) Is that sufficient for what the hook needs to do?
   - (c) What output schema does this event expect?

   This checklist is what would have prevented both hook errors in the session that built
   this detector.

2. **Semantic Stop hook implementation**: The correct implementation for the Haiku semantic
   gate on `Stop` is a command script that reads `transcript_path`, extracts the last
   assistant message, calls the LLM with that text and the detection prompt, and returns
   `{"decision": "block", "reason": "..."}` if the pattern is found. This script does not
   yet exist.
