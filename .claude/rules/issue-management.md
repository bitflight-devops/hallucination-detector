# Issue Management

## Label taxonomy (3 dimensions + topic)

Every issue gets one label from each of these dimensions:

**Impact type** — what kind of change is it:

| Label                    | Meaning                                                    | Example                                      |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| `impact: additive`       | New patterns in existing pipeline. No architecture change. | Adding a regex category                      |
| `impact: structural`     | Changes pipeline architecture. Existing tests may break.   | Sentence splitting, scoring layers           |
| `impact: contract`       | Changes stdin/stdout contract with Claude Code.            | JSON output format, new decision types       |
| `impact: infrastructure` | Adds new subsystem. New failure modes.                     | Config loading, MCP server, state management |
| `impact: external`       | Requires network calls, APIs, or new runtimes.             | RAG verification, Exa.ai                     |

**Risk level** — how dangerous is it:

| Label            | Meaning                                               |
| ---------------- | ----------------------------------------------------- |
| `risk: low`      | Additive, backward-compatible, trivial rollback       |
| `risk: medium`   | New subsystem or structural change, moderate rollback |
| `risk: high`     | Contract change, deadlock potential, or external deps |
| `risk: critical` | Can silently disable the hook if misimplemented       |

**Implementation phase** — when to do it:

| Label                          | Phase | What                                        | Can start         |
| ------------------------------ | ----- | ------------------------------------------- | ----------------- |
| `phase: 1-additive-patterns`   | 1     | Zero-risk additive regex patterns           | Now               |
| `phase: 2-config-foundation`   | 2     | Config system (unlocks phases 4-8)          | Now               |
| `phase: 3-sentence-infra`      | 3     | Sentence splitting infrastructure           | Now               |
| `phase: 4-scoring-rebuild`     | 4     | Scoring architecture (changes match shape)  | After phase 2     |
| `phase: 5-output-pipeline`     | 5     | Output format (must preserve hook contract) | After phases 2, 4 |
| `phase: 6-stateful-escalation` | 6     | Escalation logic (highest internal risk)    | After phases 2, 4 |
| `phase: 7-external-isolated`   | 7     | External deps, separate packages            | After phase 2     |
| `phase: 8-opt-in-advanced`     | 8     | Opt-in features requiring config            | After phase 2     |

**Topic** — what area it covers (for filtering/discovery):

`topic: detection-patterns`, `topic: source-credibility`, `topic: sentence-processing`, `topic: scoring`, `topic: output`, `topic: config`, `topic: platform-integration`, `topic: verification`

## Sub-issue hierarchy (current)

```text
#10 (config) <- FOUNDATION
  ├── #11 (RAG verification)
  ├── #12 (confidence scoring)
  ├── #13 (suggested fixes)
  ├── #15 (cognitive bias detection)
  ├── #17 (JSON output)
  └── #21 (sentence-level scoring)
        └── #14 (escalation)

#18 (fabricated sources)
  ├── #6 (source advisory)
  └── #8 (false attribution)

#19 (negation polarity / sentence splitter)
  ├── #4 (self-contradiction)
  └── #20 (degenerate repetition)

Standalone: #1 (MCP), #2, #3, #5, #7, #9
```

## Creating a new issue

Use this process to classify a new issue before filing it:

### Step 1: Determine impact type

Ask these questions in order:

1. Does it need network calls, API keys, or a new runtime? -> `impact: external`
2. Does it change what stdout looks like to Claude Code? -> `impact: contract`
3. Does it change the pipeline architecture (new processing stages, different return shapes)? -> `impact: structural`
4. Does it add a new subsystem (config, state, server)? -> `impact: infrastructure`
5. Does it add patterns to the existing `findTriggerMatches()` without changing its interface? -> `impact: additive`

### Step 2: Determine risk level

| If the impact type is... | Default risk is... | Upgrade to higher risk if...                                    |
| ------------------------ | ------------------ | --------------------------------------------------------------- |
| `additive`               | `low`              | High false-positive rate expected                               |
| `structural`             | `medium`           | Changes `findTriggerMatches()` return shape (breaks tests)      |
| `infrastructure`         | `medium`           | Failure crashes the hook (fail-open = detection disabled)       |
| `contract`               | `high`             | Changes stdout format (can silently disable hook) -> `critical` |
| `external`               | `high`             | Introduces async into the synchronous pipeline                  |

### Step 3: Determine phase

- No dependencies on other issues? -> `phase: 1` (if additive) or appropriate standalone phase
- Depends on config (#10)? -> `phase: 4` through `phase: 8`
- Depends on sentence splitting (#19)? -> `phase: 3` or later
- Depends on scoring (#21)? -> `phase: 5` or later

### Step 4: Assign topic

Pick the most specific topic label. An issue can have multiple topic labels.

### Step 5: Write the deep analysis comment

After creating the issue, add a comment covering:

```markdown
## Deep Analysis: Implementation Impact

### Classification
- **Impact type:** [from step 1]
- **Risk:** [from step 2]
- **Phase:** [from step 3]

### [Key concern for this issue — name the specific risk]
[Explain WHY this risk exists, citing specific lines/functions/contracts in the codebase]

### State requirements
[Does it read/write cross-invocation state? Does it share state between hooks?]

### Contract impact
[Does it change stdin/stdout? Does it change the match object shape?]

### Dependencies
- Blocked by: [issue numbers]
- Blocks: [issue numbers]
- Implement together with: [issue numbers]

### Failure modes
[What happens if this feature breaks — does the hook crash (fail-open)? Block incorrectly? Deadlock?]

### Files touched
[Specific files that would be modified]
```

### Step 6: Link the issue

- If it depends on another issue, add it as a sub-issue of the parent using the GitHub UI or:

  ```bash
  gh api graphql -f query='
    mutation {
      addSubIssue(input: {issueId: "<PARENT_NODE_ID>", subIssueId: "<CHILD_NODE_ID>"}) {
        issue { number }
        subIssue { number }
      }
    }
  '
  ```

- GitHub sub-issues only allow one parent. For secondary dependencies, add a cross-reference comment:

  ```markdown
  ### Cross-reference: also depends on #N
  [Explain the secondary dependency]
  ```

- Get node IDs with:

  ```bash
  gh api graphql -f query='{
    repository(owner: "bitflight-devops", name: "hallucination-detector") {
      issue(number: N) { id }
    }
  }'
  ```

## Issue body template

Use this structure for new feature issues:

```markdown
## Summary

[1-2 sentences: what this adds/changes]

## Current Behavior

[What happens today]

## Proposed Behavior

[What should happen after implementation, with code examples if applicable]

## Detection Patterns (if adding a new category)

| Pattern | Regex | Example |
|---------|-------|---------|
| ... | `/.../` | "..." |

## Suppression Rules

**Suppressed when:**
- [condition 1]
- [condition 2]

**Examples — Flagged:**
- "**trigger phrase** in context"

**Examples — Suppressed:**
- "trigger phrase with evidence nearby: `error code 127`"

## Category

New kind: `your_category_name`

## Acceptance Criteria

- [ ] [specific, testable criterion]
- [ ] Tests cover positive and negative cases
- [ ] `pnpm test` passes
- [ ] `pnpm run lint` passes

## References

- [links to prior art, research, related repos]
```

## Running the deep analysis process on new issues

When reviewing a batch of new issues (or re-evaluating existing ones), use parallel research agents to analyze across these dimensions:

1. **External dependencies** — Does it need npm packages, API keys, new runtimes? Does it break zero-dependency?
2. **State/storage** — Does it read/write cross-invocation state? Race conditions? Cleanup?
3. **Workflow/ordering** — Does it change entry point, decision logic, stdout contract, or hook sequencing?
4. **Risk/blast radius** — What's the change type, failure mode, test impact, rollback difficulty?

These four dimensions cut across topic groupings. Two issues in the same topic area can have completely different risk profiles (e.g., #15 cognitive bias is `additive/low` while #11 RAG is `external/high`, despite both being "advanced detection").
