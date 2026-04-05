# Holistic Design: Observation Enforcement System

**Date:** 2026-04-04  
**Status:** Design — pre-implementation  
**Scope:** hallucination-detector hook + broader rule-compliance enforcement

---

## Executive Summary

The hallucination-detector stop hook is working — it has caught 313–540 violations
that would otherwise have reached the user. But it is also spending 65% of its blocks
on false positives, costing ~$45/month in wasted tokens, and actively harming compact
agent output quality. Fixing this is the immediate priority.

The kaizen analysis of the claude-skills project reveals a broader pattern: **rules
that have mechanical enforcement (hooks) are followed. Rules that rely on model
self-governance are violated in the majority of applicable sessions.** The hallucination-
detector is the only enforced rule in a system where three other critical rules have
no enforcement at all.

The holistic approach:

1. Fix the hallucination-detector's accuracy and cost problems
2. Shift from reactive blocking to proactive expression contracts
3. Apply the same enforcement model to the other unenforced rules
4. Build shared measurement infrastructure that proves improvement across all hooks

**Target outcome:** Compliance rate >95%, monthly hook cost <$18, zero compact agent
blocks, and mechanical enforcement for pre-existing accountability, falsification
requirement, and skill-wrapper bypassing.

---

## 1. The Problem Space

### 1.1 What we are trying to enforce

Not "don't say bad words." The goal is **preventing data loss and meaning loss that
leads to actions taken on non-factual information.**

Three failure modes with real consequences:

| Failure                        | Pattern                                                      | Consequence                              |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| Bare behavioral assertion      | "It works." / "Fixed." / "Done."                             | User acts on unverified claim            |
| Tool-check over-generalization | "539 tests pass" → "the system works"                        | Capability not actually demonstrated     |
| Agent-report relay             | Subagent says X → orchestrator states X as own verified fact | Unattributed claim, no independent check |

The user's definition of "works": the product, when used in the scenario it is
designed for, demonstrates the new or modified capability correctly. This is
categorically different from "tests pass."

### 1.2 The rule-compliance gap (from kaizen analysis)

| Rule                                 | Sessions violated            | Enforcement   | Compliance |
| ------------------------------------ | ---------------------------- | ------------- | ---------- |
| No speculation language              | 104 sessions (313 blocks)    | Hook — active | Enforced   |
| Pre-existing = act, not dismiss      | 64 sessions, 0 backlog items | **None**      | Near zero  |
| Falsification before root cause      | ~30 sessions                 | **None**      | Near zero  |
| Use skill wrappers, not direct tools | 8 user corrections           | **None**      | Sporadic   |

The hallucination-detector proves the principle: mechanical enforcement works.
The three unenforced rules show what happens without it.

---

## 2. Three-Pillar Architecture

### Pillar 1 — Expression Contract (proactive, primary)

Shape output from the start. When agents have a template to follow, they reach for
the right structure rather than defaulting to "it works."

**SessionStart framing injects three templates:**

```
TOOL RUN
Command: [exact command]
Observed: [specific output]
Scope: [what this covers]
Does not cover: [what this does not establish]
```

```
AGENT REPORT (from: [agent name / task ID])
Reported: [what the agent said]
Independently verified: [yes — what was verified | no]
```

```
COMMITTED [hash]
Changes: [what was changed]
Validation: [what was run | none run]
```

**Stop hook fast-path:** when a valid template block is present, skip trigger scanning
for behavioral assertion category. Structural violations (missing required fields) →
block naming the specific missing field. This inverts the enforcement model: instead
of "block everything that looks bad," it becomes "allow everything that follows the
contract; block what does not."

**Template addresses all three failure modes:**

- Bare assertion → COMMITTED requires Validation field (even "none run" is valid — honesty is the goal)
- Tool-check over-generalization → TOOL RUN requires "Does not cover:" field
- Agent-report relay → AGENT REPORT requires attribution and independence disclosure

### Pillar 2 — Detection Accuracy (reactive backstop)

The current hook has a 65% false positive rate. Before adding new detection, fix
what is broken.

**Fix sequence (ordered by impact, each requires measurement gate before next):**

**Fix 1 — Loop counter bug** (Phase 1, no shadow needed)  
`stopHookActive` is `false` on the first call of each turn, making the allow-through
branch unreachable. Counter accumulates across turns. Result: up to 14 blocks per
session against a documented limit of 2. Fix: check count before the block decision,
not after. Separate "has this turn already been retried" from "total session blocks."

**Fix 2 — Compact agent exemption** (Phase 1, no shadow needed)  
119 blocks that actively degrade information quality. Compact agents summarize
existing conversation content — they cannot rephrase words from the conversation
they are summarizing. Removing "may" from a summary that accurately reflects a
prior message where "may" was used produces a less accurate summary. Fix: peek at
first human message in transcript on startup; if it matches a compaction directive
pattern, skip all trigger scanning.

**Fix 3 — Narrow over-broad triggers** (Phase 2, shadow mode required)  
Four phrases account for ~134 blocks with high FP rates:

- `may` (79 blocks) — epistemic ("it may fail") vs. deontic ("you may use this")
- `because`/`since` (32 blocks) — causal connector vs. temporal / standard English
- `assume` (21 blocks) — speculation vs. declared operating assumption ("I will assume default config")

Each needs context-aware suppression rules, not removal.

**Fix 4 — Completeness + evidence proximity** (Phase 2, shadow mode required)  
"All tests pass" after actual test runner output is a factual observation. Add
`hasEvidenceNearby` check to `completeness_claim` (already exists for
`causality_language`). Evidence markers: test count patterns, exit codes, code spans
within 200 chars.

**Fix 5 — Template structural validator + new trigger category** (Phase 3)  
Structural validator detects TOOL RUN / AGENT REPORT / COMMITTED blocks, validates
required fields, fast-paths valid ones. `ungrounded_behavioral_assertion` trigger
category is Active (shadow mode, 2026-04-05); shipped without shadow period. FP rate
measurement pending before switching to blocking mode.

### Pillar 3 — Measurement Infrastructure (continuous improvement)

**Incremental audit service**  
PostToolUse hook processes each session file as it completes. State file tracks:

- `last_run` timestamp
- Cumulative totals in same schema as baseline
- Per-run delta records

DuckDB queries only new files (modified after `last_run`). Zero re-processing of
historical data. Appends to `~/.hd/telemetry/audit-state.json`.

**Shadow mode**  
`dryRun: true` config option. New detection rules log would-block decisions to
`~/.hd/telemetry/shadow-log.jsonl` without blocking. Zero token cost during shadow
period. Shadow log schema matches block schema for direct comparison.

**A/B protocol per fix**

```
1. Shadow mode: 7 days, new rules log without blocking
2. Classify 20-sample from shadow log: TP / FP / impossible
3. Gate: new FP rate < current AND new TP rate >= current - 5%
4. Enable blocking mode
5. Measure same period after: compare to baseline schema
```

**Cost tracking as first-class metric**  
Each audit reports: total blocks, estimated wasted USD, monthly run rate.
Dominant cost driver is cache re-read on Opus retries (~$0.23/retry just for cache).
Eliminating one runaway retry session ($8.08) is worth more than preventing 40
Sonnet blocks ($1.84).

---

## 3. Measurement Baseline and Targets

| Metric                        | Baseline (48 days) | Target (after all fixes) |
| ----------------------------- | ------------------ | ------------------------ |
| First-attempt compliance rate | 86.2%              | >95%                     |
| Estimated FP rate             | 65%                | <25%                     |
| Monthly wasted cost           | $45.68             | <$18                     |
| Compact agent blocks          | 119                | 0                        |
| Max blocks per session        | 14                 | ≤2                       |
| speculation_language blocks   | 250                | <80                      |
| `may` blocks                  | 79                 | <10                      |

Projected cost savings by fix:

- Fix 1 (loop counter): ~$14.00 (eliminates runaway sessions)
- Fix 2 (compact exemption): ~$8.50
- Fix 3 (narrow triggers): ~$22.00
- **Total: ~$44.50/48 days (~61% reduction)**

---

## 4. Expanding to Other Rules

The hallucination-detector enforcement model applies directly to the three unenforced
rules identified in the kaizen analysis. Same architecture: proactive framing +
reactive detection + measurement.

### Pre-existing accountability hook

**Rule:** When a pre-existing issue is identified, it is a trigger to act — not a
justification to dismiss. Required response: log to backlog or ask user.

**Violation rate:** 64 sessions, 0 compliant (0% enforcement without a hook).

**Hook design:**  
PostToolUse (or Stop hook) — when assistant text contains "pre-existing" AND no
`backlog_add` / `backlog_create_sam_task` tool call follows within 2 turns, inject:

> "PRE-EXISTING ACCOUNTABILITY: You identified a pre-existing issue. Create a backlog
> item or explicitly ask the user how to handle it. Do not dismiss."

**Measurement:** Track "pre-existing + backlog_add within 2 turns" rate. Baseline: 0%.

### Falsification requirement hook

**Rule:** Before acting on a confirmed hypothesis, state the falsification test and
its result. If you cannot state the falsification test, you have not tested the
hypothesis.

**Violation rate:** ~30 sessions with root-cause claims and no falsification stated.

**Hook design:**  
Stop hook or PostToolUse — when assistant text contains "root cause" without
"falsif" in the same response, inject the falsification template:

> "FALSIFICATION GATE: State what would disprove this root cause before proceeding."

**Measurement:** Track "root cause + falsification stated in same response" rate.

### Skill-wrapper enforcement hook

**Rule:** Use project-specific skill wrappers rather than calling MCP tools directly.
The wrapper includes quality gates, problem-framing checks, and research requirements
that the direct call bypasses.

**Violation rate:** 8 user corrections in 5 sessions (likely undercount — corrections
only surface when users catch it).

**Hook design:**  
PreToolUse — gate specific MCP tool calls (e.g., `backlog_add`) behind a check for
whether the corresponding skill was loaded in the session. If not, inject:

> "SKILL GATE: Use /dh:create-backlog-item instead of calling backlog_add directly.
> The skill includes required quality gates."

---

## 5. Implementation Sequence

```
Phase 1 — Stop active harms (no shadow, clear correctness)
  Fix 1: Loop counter bug
  Fix 2: Compact agent exemption
  → Measure: compact_agent_blocks → 0, max_blocks → ≤2, cost delta

Phase 2 — Reduce FP rate (shadow mode required before enabling)
  Fix 3: Narrow may/because/since/assume (7-day shadow, then enable)
  Fix 4: Completeness + evidence proximity (7-day shadow, then enable)
  → Gate: FP rate < 30% confirmed before Phase 3

Phase 3 — Positive expression contract
  Fix 5a: TOOL RUN / AGENT REPORT / COMMITTED in SessionStart framing
  Fix 5b: Structural validator in stop hook
  Fix 5c: ungrounded_behavioral_assertion trigger category (Active, shadow mode, 2026-04-05; FP rate audit pending)
  → Measure: compliance rate, template adoption, cost delta

Phase 4 — Measurement infrastructure
  PostToolUse hook for per-session incremental accumulation
  Shadow mode config option (dryRun)
  Audit comparison tooling (diff against baseline schema)

Phase 5 — Expand to other rules
  Pre-existing accountability hook
  Falsification requirement hook
  Skill-wrapper enforcement hook
  → Each follows same shadow → gate → enable → measure protocol
```

---

## 6. What This System Can and Cannot Enforce

**Can enforce:**

- Observation language when making behavioral claims
- Attribution when relaying agent reports
- Template structure with required fields
- Pre-existing issues get logged
- Root cause claims accompanied by falsification
- Project tools used over direct MCP calls

**Cannot enforce:**

- That the cited observation actually proves the claimed capability
- That the agent ran the right scenario (can require language, not the right action)
- Scope qualification adequacy
- Quality of the observation itself

**The honest limit:** The expression contract requires "I ran X and observed Y." It
cannot require that X was the right thing to run or that Y is sufficient to prove
the claim. That boundary requires human judgment. The system's job is to ensure
the human receives an observation to judge, not a conclusion to accept.

---

## 7. Design Files

| File                                                                               | Purpose                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `docs/baseline-2026-04-04.yaml`                                                    | Block, compliance, and cost baseline for comparison       |
| `docs/fix-sequence-spec.md`                                                        | Detailed spec for each fix with acceptance criteria       |
| `/tmp/hook-block-audit.md`                                                         | Full audit data underlying the baseline                   |
| `/tmp/cost-baseline.yaml`                                                          | Token cost breakdown by category and model                |
| `/tmp/session-behavior-analysis.md`                                                | Session-level bad pattern analysis with verbatim evidence |
| `/home/ubuntulinuxqa2/repos/claude_skills/.planning/kaizen/analysis-2026-04-04.md` | Cross-project rule compliance analysis                    |
