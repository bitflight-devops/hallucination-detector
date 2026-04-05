# Hallucination Detector — Milestone Roadmap

**Date:** 2026-04-04  
**Baseline captured:** 2026-02-15 to 2026-04-04 (48 days)

---

## Why This Work Was Started

The hallucination-detector stop hook was deployed and running. Over 48 days it fired on 3,927 stop events and issued 540 blocks — catching real violations that would otherwise have reached the user. But an audit of those 540 blocks revealed that only 35% were true positives. The remaining 65% were false positives or impossible-to-comply blocks: cases where the hook objected to language the agent could not have changed without making the output worse, or cases where the trigger phrase was used in a perfectly valid way that the hook's regex did not distinguish.

The immediate consequences were concrete. 119 of the 540 blocks hit compact agents — sessions whose sole job is to summarize existing conversation content. Blocking a compact agent and forcing a retry does not produce a more accurate summary. It produces a less accurate one, because the agent is being asked to rephrase words from a conversation it is describing. The fail-open limit was documented as 2 blocks per session, but a bug in the loop counter made the allow-through branch unreachable on the first call of each turn, causing counters to accumulate across turns. One session ran up 14 consecutive blocks before failing open, burning $8.08 in wasted Opus cache re-read tokens. The total wasted cost over the 48 days was $73.09, running at $45.68/month.

A parallel kaizen analysis of the broader claude-skills project revealed the deeper motivation for doing this work well rather than just patching the immediate bugs: **rules that have mechanical enforcement (hooks) are followed; rules that rely on model self-governance are violated in the majority of applicable sessions.** The hallucination-detector is the only mechanically enforced rule in a system where three other critical rules — pre-existing issue accountability, falsification before root cause, and skill-wrapper usage — have zero enforcement. The kaizen data showed 64 sessions with pre-existing issues dismissed without action, ~30 sessions with root-cause claims lacking any falsification statement, and 8 documented user corrections for direct MCP tool calls. The correct response to fixing the hallucination-detector is not just to reduce its false positive rate but to establish the enforcement model that the other rules can later follow.

---

## What We Measure (and How)

### Telemetry database

Hook events are written to a SQLite database at:

```
~/.hd/telemetry/hallucination-detector.db
```

Each block event records: session ID, timestamp, trigger category, trigger phrase, session type (top-level, compact agent, task subagent, etc.), model, estimated token cost (output + cache re-read), and whether the session's fail-open limit was reached.

### Querying telemetry

```sql
-- Total blocks this week
SELECT COUNT(*) FROM blocks
WHERE timestamp > datetime('now', '-7 days');

-- Blocks by category
SELECT category, COUNT(*) AS n
FROM blocks
GROUP BY category ORDER BY n DESC;

-- Estimated cost this month
SELECT SUM(cost_usd) AS monthly_cost
FROM blocks
WHERE timestamp > datetime('now', '-30 days');

-- Top trigger phrases
SELECT trigger_phrase, COUNT(*) AS n
FROM blocks
GROUP BY trigger_phrase ORDER BY n DESC LIMIT 10;

-- Sessions with 3+ blocks (runaway indicator)
SELECT session_id, COUNT(*) AS block_count
FROM blocks
GROUP BY session_id HAVING block_count >= 3
ORDER BY block_count DESC;
```

### A/B protocol

Each new detection rule follows this protocol before being activated in blocking mode:

1. **Shadow mode (7 days):** `dryRun: true` config option. New rules log would-block decisions to `~/.hd/telemetry/shadow-log.jsonl` without blocking. Zero token cost during shadow period.
2. **Sample classification:** Classify 20 samples from the shadow log as TP / FP / impossible to comply.
3. **Gate:** New FP rate must be less than the current rate AND new TP rate must not drop below current TP rate minus 5 percentage points.
4. **Enable blocking mode.**
5. **Measure same period after:** Re-run audit against baseline schema. Write results to `.claude/reports/audit-YYYY-MM-DD.yaml`.

### Re-run audit query

After each fix, delegate this prompt to `agentskill-kaizen:transcript-analyst`:

> "Compare block patterns against baseline at `.claude/reports/baseline-2026-04-04.yaml`. Use the same DuckDB methodology. Report: total blocks, blocks by session type, blocks by category, top 5 trigger phrases, estimated FP rate from 20-sample, sessions with 3+ blocks, max blocks in single session."

Write comparison results to `.claude/reports/audit-YYYY-MM-DD.yaml` in the same schema as the baseline.

---

## Baseline Metrics (T0)

Captured 2026-02-15 to 2026-04-04 (48 days). Source: `.claude/reports/baseline-2026-04-04.yaml`.

### Corpus

| Metric                        | Value                    |
| ----------------------------- | ------------------------ |
| Total session files audited   | 8,043                    |
| Top-level sessions            | 713                      |
| Subagent sessions             | 7,330                    |
| Stop hook firings with output | 3,927                    |
| Stop hook firing rate         | 51.2% of all stop events |

### Blocks

| Metric                        | Value            |
| ----------------------------- | ---------------- |
| Total blocks                  | 540              |
| Affected sessions             | 197              |
| Block rate of firings         | 7.0% (540/7,665) |
| Top-level sessions with block | 114              |
| Top-level block rate          | 16.0% (114/713)  |

### Blocks by session type

| Session type           | Blocks |
| ---------------------- | ------ |
| Top-level orchestrator | 337    |
| Compact agent          | 119    |
| Task subagent          | 58     |
| Aside/question agent   | 20     |
| Orphan agent           | 6      |

### Blocks by category

| Category                      | Blocks |
| ----------------------------- | ------ |
| speculation_language (sole)   | 250    |
| completeness_claim (sole)     | 96     |
| causality_language (sole)     | 60     |
| internal_contradiction (sole) | 41     |
| structural_validation         | 16     |
| multi-category                | 25     |
| unparseable                   | 48     |

### Top trigger phrases

| Phrase            | Blocks |
| ----------------- | ------ |
| may               | 79     |
| could be          | 26     |
| assume            | 21     |
| likely            | 20     |
| because           | 16     |
| since             | 16     |
| all complete      | 12     |
| should be         | 12     |
| fully implemented | 6      |
| fully groomed     | 6      |
| all tests pass    | 3      |

### Quality and cost

| Metric                               | Value                                     |
| ------------------------------------ | ----------------------------------------- |
| Estimated true positive rate         | 35% (7/20 sampled)                        |
| Estimated false positive rate        | 40% (8/20 sampled)                        |
| Estimated impossible-compliance rate | 25% (5/20 sampled)                        |
| Total FP + impossible                | 65%                                       |
| Single-retry resolution rate         | 38.6% (76/197 sessions)                   |
| Sessions with 3+ blocks              | 32.5% (64/197 sessions)                   |
| Max blocks in single session         | 14                                        |
| Documented fail-open limit           | 2                                         |
| Total estimated cost (48 days)       | $73.09                                    |
| Monthly run rate                     | $45.68/month                              |
| Blocked output cost                  | $13.76                                    |
| Retry cache re-read cost (dominant)  | $54.66                                    |
| Per-block average cost               | $0.19                                     |
| Per-retry cache re-read tokens       | 152,892                                   |
| Worst session cost                   | $8.08 (session dfa8310d, 14 blocks, Opus) |

---

## Milestone Status

### Phase 1 — Stop Active Harms — COMPLETE

**Commits:** `37100c0` (fix(detection): exempt compact agents and fix fail-open loop counter)

**What was fixed:**

Two bugs with no shadow mode requirement — both were straightforward correctness issues, not detection tuning.

**Bug 1 — Fail-open loop counter:** The state file `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` stored `{ blocks: N }`. The counter was checked after incrementing rather than before, and it accumulated across turns rather than being scoped to a single turn's retry. This made the allow-through branch unreachable on the first call of any turn. Sessions could accumulate up to 14 blocks against a documented limit of 2. Fix: check the count before the block decision; track "has this specific turn already been retried" separately from the total session block count.

**Bug 2 — Compact agent exemption:** 119 blocks were issued against compact agents — sessions whose only job is to summarize existing conversation content. These agents cannot rephrase trigger words that appear in the content they are summarizing; blocking them produces less accurate summaries. Fix: on startup, read the first human message from the transcript; if it matches a compaction directive pattern, skip all trigger scanning.

**Expected impact:**

- Max blocks per session: 14 → ≤2
- Sessions with 3+ blocks: 64 → <20
- Compact agent blocks: 119 → 0
- Projected cost saving: ~$22.50 (loop counter ~$14.00 + compact exemption ~$8.50)

---

### Phase 2 — Reduce False Positive Rate — COMPLETE

**Commits:** `b28c2ab` (fix(detection): reduce false positives and improve block UX, merged PR #44), `09723b6` (fix(hooks): timeouts, compact exemption, SubagentStop, telemetry enrichment), `5949eb2` (feat(telemetry): log hook events with cost to ~/.hd/telemetry/hallucination-detector.db)

**What was changed:**

**Context-aware suppression for over-broad triggers:** Four phrases accounted for ~134 blocks with high FP rates. Each received suppression rules targeting its legitimate use:

- `may` (79 blocks): Deontic "you may use this" and documentation "the parameter may be omitted" suppressed. Epistemic "the fix may work" (speculation without verification) still blocks.
- `because`/`since` (32 blocks): Evidence window expanded from 150 to 300 chars; suppression added when followed within 50 chars by a file path, error message, or tool output reference. `since` suppressed when followed by a time reference or a past-tense clause referencing a completed action.
- `assume` (21 blocks): Suppressed when preceded by "I will", "I'll", "assuming", or used in a conditional construction.

**Completeness claim evidence proximity (Fix 4):** `completeness_claim` category received a `hasEvidenceNearby` check (previously only `causality_language` had this). Evidence markers: test count patterns (`\d+\/\d+\s*(?:passing|tests?)`), exit code 0, code spans within 200 chars, test runner invocations (`pnpm test`, `vitest run`, `pytest`) within 300 chars before the claim.

**SQLite telemetry added:** Hook events now write to `~/.hd/telemetry/hallucination-detector.db` with cost, category, model, and session type per event. This is the measurement infrastructure that allows Phase 4's incremental audit service to replace the one-time DuckDB audit.

**Hook schema improvements:** Timeouts added to hook declarations; `SubagentStop` event type supported; matcher-level refinements.

**Expected impact:**

- `may` blocks: 79 → <10
- `because`/`since` blocks: 32 → <8
- `assume` blocks: 21 → <5
- `all tests pass` blocks: 3 → 0
- Estimated FP rate: 65% → ~40%
- Projected cost saving (narrow triggers): ~$22.00

---

### Phase 3 — Observation Expression Templates — COMPLETE

**Commit:** `866c3f0` (feat(detection): Phase 3 — observation expression templates + structural validator)

**What was changed:**

**Three templates injected at SessionStart framing (`hallucination-framing-session-start.cjs`):**

```
TOOL RUN
Command: [exact command]
Observed: [specific output]
Scope: [what this covers]
Does not cover: [what this does not establish]
```

```
AGENT REPORT (from: [agent name/task ID])
Reported: [what the agent said]
Independently verified: [yes — what was verified | no]
```

```
COMMITTED [hash]
Changes: [what was changed]
Validation: [what was run | none run]
```

**Structural validator in stop hook (`hallucination-audit-stop.cjs`):** Detects presence of any template block at response start. If present, validates all required fields are non-empty. If valid: fast-path that suppresses `ungrounded_behavioral_assertion` trigger scanning. If invalid: blocks naming the specific missing field. The `hasValidTemplate` flag is set on the session state for Phase 3c gating.

**What this establishes:** The expression contract. When agents have a template to follow, they reach for the correct structure rather than defaulting to bare assertions ("it works", "fixed", "done"). The contract addresses all three core failure modes:

- Bare behavioral assertion → COMMITTED requires `Validation:` field
- Tool-check over-generalization → TOOL RUN requires `Does not cover:` field
- Agent-report relay → AGENT REPORT requires attribution and independence disclosure

**Phase 3c (`ungrounded_behavioral_assertion` trigger category) is in place** in the code but gated: it activates only after measurement confirms FP rate is confirmed below 25%. The `hasValidTemplate` suppression path is already implemented so that responses using a valid template are not blocked by this category.

---

### Phase 4 — Measurement Infrastructure — PENDING

**Gate for Phase 3c activation:** FP rate must be confirmed below 25% (via 20-sample audit) before the `ungrounded_behavioral_assertion` trigger category enables in blocking mode.

**What needs to be built:**

**Incremental audit service (PostToolUse hook):** Processes each session file as it completes rather than requiring a full re-scan of all 8,043 files. State file tracks `last_run` timestamp. DuckDB queries only new files modified after `last_run`. Appends cumulative totals and per-run delta records to `~/.hd/telemetry/audit-state.json`. Schema matches baseline YAML for direct diff.

**Shadow mode config option:** `dryRun: true` in the hallucination-detector config. New detection rules log would-block decisions to `~/.hd/telemetry/shadow-log.jsonl` without issuing blocks. Shadow log schema matches block schema for direct comparison. Zero token cost during shadow period.

**Audit comparison tooling:** Script that diffs a new `audit-YYYY-MM-DD.yaml` against `baseline-2026-04-04.yaml` and produces a delta table with directional arrows.

**Files to be created/modified:**

- New PostToolUse hook in `hooks/hooks.json`
- New hook script `scripts/hallucination-audit-incremental.cjs`
- Shadow mode flag in `scripts/hallucination-config.cjs` (`DEFAULT_CONFIG`)
- Shadow log write path in `scripts/hallucination-audit-stop.cjs`

---

### Phase 5 — Activate Behavioral Assertion Detection — PENDING

**Prerequisite:** Phase 4 shadow mode must be operational AND FP rate confirmed below 25% via 20-sample audit.

**What activates:**

The `ungrounded_behavioral_assertion` trigger category, which is already present in the code gated by `hasValidTemplate`. This category catches:

- Bare "it works" / "the fix works" / "done" without any template block
- "Fixed." / "Resolved." without a COMMITTED block
- Capability claims ("the feature works", "it handles X correctly") without a TOOL RUN block

**Fast-path interaction:** Responses using a valid TOOL RUN, AGENT REPORT, or COMMITTED block will not be blocked by this category — the `hasValidTemplate` flag suppresses scanning. The category only fires on prose responses that make behavioral claims without any structured observation.

**Acceptance criteria (from fix-sequence-spec.md):**

- Responses with valid TOOL RUN structure: 0 blocks for behavioral assertions
- Responses with TOOL RUN missing required fields: blocked with specific field name
- Bare "it works" / "the fix works": blocked
- "I ran X and observed Y" (prose, no template): allowed if both run and observation are present

**A/B protocol:** 7-day shadow mode → classify 20 samples → gate check → enable.

---

### Phase 6 — Expand to Other Rules — PENDING

**Prerequisite:** Phase 4 measurement infrastructure (shadow mode, incremental audit).

Three rules identified in the kaizen analysis with zero mechanical enforcement. Each follows the same architecture: proactive framing + reactive detection + shadow → gate → enable → measure protocol.

**Rule 1 — Pre-existing accountability hook**

Observed violation: 64 sessions identified pre-existing issues; 0 resulted in a backlog item or user query. Current compliance rate: 0%.

Hook design: PostToolUse or Stop hook. When assistant text contains "pre-existing" AND no `backlog_add`/`backlog_create_sam_task` tool call follows within 2 turns, inject:

> "PRE-EXISTING ACCOUNTABILITY: You identified a pre-existing issue. Create a backlog item or explicitly ask the user how to handle it. Do not dismiss."

Measurement: Track "pre-existing + backlog_add within 2 turns" rate. Baseline: 0%.

**Rule 2 — Falsification requirement hook**

Observed violation: ~30 sessions with root-cause claims containing no falsification statement.

Hook design: Stop hook or PostToolUse. When assistant text contains "root cause" without "falsif" in the same response, inject the falsification template:

> "FALSIFICATION GATE: State what would disprove this root cause before proceeding."

Measurement: Track "root cause + falsification stated in same response" rate.

**Rule 3 — Skill-wrapper enforcement hook**

Observed violation: 8 documented user corrections in 5 sessions (undercount — corrections only surface when users catch it).

Hook design: PreToolUse. Gate specific MCP tool calls (e.g., `backlog_add`) behind a check for whether the corresponding skill wrapper was loaded in the session. If not, inject:

> "SKILL GATE: Use /dh:create-backlog-item instead of calling backlog_add directly. The skill includes required quality gates."

Measurement: Track direct tool calls vs. skill-mediated calls per tool.

---

## Target Outcomes

| Metric                                 | Baseline (T0) | Target     |
| -------------------------------------- | ------------- | ---------- |
| First-attempt compliance rate          | 86.2%         | >95%       |
| Estimated FP rate                      | 65%           | <25%       |
| Monthly wasted cost                    | $45.68/month  | <$18/month |
| Compact agent blocks                   | 119           | 0          |
| Max blocks per session                 | 14            | ≤2         |
| Sessions with 3+ blocks                | 64            | <20        |
| `speculation_language` blocks          | 250           | <80        |
| `may` blocks                           | 79            | <10        |
| Single-retry resolution rate           | 38.6%         | >65%       |
| Pre-existing accountability compliance | 0%            | >90%       |

**Projected cost savings by fix:**

- Fix 1 (loop counter): ~$14.00 (eliminates runaway retry sessions)
- Fix 2 (compact exemption): ~$8.50
- Fix 3 (narrow triggers): ~$22.00
- Total projected: ~$44.50/48 days (~61% reduction)

---

## Design Decisions Worth Preserving

### Why the template fast-path inverts the enforcement model

The traditional approach is purely reactive: scan everything and block what looks bad. The template fast-path changes this: when a response contains a valid structured observation block, skip the behavioral assertion scan entirely. The model that says "I ran X and observed Y, scope is Z, does not cover W" is rewarded with a pass, not scrutinized. This produces better signal than blocking-only: instead of training agents to avoid trigger words, it trains them to reach for the correct structure.

The key insight is that the hook cannot require that the right thing was run or that the observation is sufficient — it can only require that an observation is present. A COMMITTED block with `Validation: none run` is honest and passes. A bare "done" is not.

### Why hooks enforce and self-governance does not

From the kaizen analysis: the hallucination-detector is the only mechanically enforced rule. "No speculation language" — enforced by hook — showed consistent compliance. "Pre-existing issues require action", "falsification before root cause", "use skill wrappers" — none enforced — showed near-zero compliance. The data covers 64 sessions for pre-existing accountability with 0 compliant. Self-governance through prompt framing produces compliance that decays over session length and degrades under cognitive load. Hooks run on every Stop event regardless of session state.

### Why cache re-read is the dominant cost driver

The per-block average cost is $0.19, but the breakdown is asymmetric: $54.66 of the $73.09 total came from cache re-read tokens on retries, not from output tokens. Each Opus retry re-reads ~152,892 cached tokens at $1.50/M. One runaway session (session dfa8310d, 14 blocks) cost $8.08 — more than 40 Sonnet blocks combined ($1.84 estimated). Eliminating a single runaway Opus session saves more than eliminating dozens of Sonnet blocks. This is why the loop counter bug fix (Phase 1) has the highest projected individual saving at ~$14.00.

### Why compact agents must be exempt

Compact agents summarize existing conversation content. The agent's job is fidelity to what was said, not rephrasing. When a prior turn used "may" correctly and the compact agent includes it in a summary, the summary is accurate. Blocking it forces the agent to produce a summary that misrepresents the prior turn's epistemic state. The block does not improve the output — it degrades it. Detection must be scoped to generative assertions, not faithful summarization.

### The honest limit of this system

The expression contract requires `Command: [exact command]`, `Observed: [specific output]`, `Scope: [what this covers]`, `Does not cover: [what this does not establish]`. It cannot require that the command was the right command to run, or that the scope is adequate to prove the claim, or that the observation is sufficient to support the conclusion drawn. Those judgments require a human. The system's job is to ensure the human receives an observation to judge rather than a conclusion to accept.

---

## Appendix: Source Documents

| File                                            | Contents                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `.claude/reports/holistic-design-2026-04-04.md` | Full three-pillar architecture design, problem space analysis, kaizen findings     |
| `.claude/reports/baseline-2026-04-04.yaml`      | Complete block, compliance, and cost baseline in machine-readable form             |
| `.claude/reports/fix-sequence-spec.md`          | Per-fix specs with acceptance criteria, suppression rules, and dependency ordering |
| `/tmp/hook-block-audit.md`                      | Full audit data underlying the baseline (not committed — temp file)                |
| `/tmp/cost-baseline.yaml`                       | Token cost breakdown by category and model (not committed — temp file)             |
| `/tmp/session-behavior-analysis.md`             | Session-level analysis with verbatim evidence (not committed — temp file)          |
