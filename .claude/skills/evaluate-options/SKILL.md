---
name: evaluate-options
description: Research and evaluate implementation options before presenting a recommendation. Use when multiple approaches exist for a problem and a decision is needed. Launches one background research agent per option in parallel, collects evidence-backed findings, then presents a recommendation grounded in observed data — not assertions. Triggers include "what are the options", "how should we approach", "which is better", "compare these approaches", or any moment where options have been identified but a decision has not yet been made.
---

# Evaluate Options

Do not present options to the user without evidence. Every recommendation must be grounded in research, not assertion.

## Phase 1: Identify Options

State each candidate option as a concrete, implementable approach. If options are not yet identified, identify them before proceeding.

## Phase 2: Launch Parallel Research Agents

Launch one `option-researcher` agent per option in a single message so they run concurrently. Each agent is defined at `.claude/skills/evaluate-options/agents/option-researcher.md`.

Pass this exact input block to each agent:

```text
PROBLEM: {problem statement and constraints}
OPTION: {option name and one-sentence description}
OPTION_SLUG: {short-identifier-for-filename}
CONTEXT_PATHS:
  - scripts/hallucination-audit-stop.cjs
  - {any other relevant file paths or doc URLs}
OUTPUT_PATH: .claude/reports/option-eval-{option-slug}-{YYYYMMDD}.md
```

Example — evaluating two approaches to sentence splitting:

```text
# Agent 1 task
PROBLEM: Add sentence-level scoring to findTriggerMatches() without breaking the hook contract (stdout must remain empty or valid JSON block).
OPTION: Inline regex splitter — split text on sentence boundaries using /[.!?]\s+/ before iterating trigger patterns
OPTION_SLUG: inline-regex-splitter
CONTEXT_PATHS:
  - scripts/hallucination-audit-stop.cjs
  - tests/hallucination-audit-stop.test.cjs
  - hooks/hooks.json
OUTPUT_PATH: .claude/reports/option-eval-inline-regex-splitter-20260310.md

# Agent 2 task
PROBLEM: Add sentence-level scoring to findTriggerMatches() without breaking the hook contract (stdout must remain empty or valid JSON block).
OPTION: Segmenter API — use Intl.Segmenter with granularity "sentence" to split text before iterating trigger patterns
OPTION_SLUG: intl-segmenter
CONTEXT_PATHS:
  - scripts/hallucination-audit-stop.cjs
  - tests/hallucination-audit-stop.test.cjs
  - hooks/hooks.json
OUTPUT_PATH: .claude/reports/option-eval-intl-segmenter-20260310.md
```

Each agent answers for its option:

1. What does this option do — mechanically, step by step?
2. What does it protect against or solve?
3. What does it leave unprotected or unsolved?
4. What are the failure modes?
5. What evidence from the codebase or documentation supports or argues against this option? (cite file paths and line numbers)

## Phase 3: Aggregate and Recommend

Wait for all agents to complete. Read each findings file. Build a comparison table:

| Option | Solves | Leaves open | Failure modes | Evidence |
| ------ | ------ | ----------- | ------------- | -------- |

State a recommendation with:

- Which option is recommended
- The specific evidence that supports it (file paths, line numbers, doc sections)
- What the recommended option does NOT solve (honest scope)
- Whether any options should be combined

If evidence is insufficient to recommend, state that explicitly and identify what additional research is needed.

## Rules

- No option may be called "better", "cleaner", "simpler", or "right" without citing specific evidence
- If an agent returns no findings file, re-launch it before aggregating
- The recommendation must be falsifiable — state what evidence would change it
