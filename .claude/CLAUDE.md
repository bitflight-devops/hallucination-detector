# Hallucination Detector — Project Guide

## What This Project Is

A Claude Code stop-hook plugin that audits assistant output for speculation, ungrounded causality, pseudo-quantification, and completeness overclaims. Zero runtime dependencies. Two hooks, two CJS scripts, regex-based detection.

## Architecture

### Runtime files

| File | Role |
|------|------|
| `scripts/hallucination-audit-stop.cjs` | **Stop hook** — core detection. Reads stdin JSON from Claude Code, parses JSONL transcript, extracts last assistant message, runs `findTriggerMatches()`, emits `{ "decision": "block", "reason": "..." }` or exits cleanly. |
| `scripts/hallucination-framing-session-start.cjs` | **SessionStart hook** — injects behavioral framing text into session context at startup. |
| `hooks/hooks.json` | Registers both hooks with Claude Code. |

### Detection categories (4 active)

1. `speculation_language` — "I think", "probably", "likely", etc.
2. `causality_language` — "because", "caused by", "due to" without evidence nearby
3. `pseudo_quantification` — quality scores (N/10), ungrounded percentages
4. `completeness_claim` — "all files checked", "fully resolved", etc.

### Key function: `findTriggerMatches(text)`

Located at `scripts/hallucination-audit-stop.cjs` lines 214–456. Returns `[{ kind, evidence, offset }]`. Exported via `module.exports` for testing and reuse.

### Suppression mechanisms

- `stripLowSignalRegions(text)` — removes code blocks, inline code, blockquotes before matching
- `isIndexWithinQuestion(text, index)` — exempts sentences containing "?"
- `hasEvidenceNearby(text, rawText, index)` — 150-char window check for evidence markers
- `hasEnumerationNearby(text, index)` — 200-char preceding window for numbered/bulleted lists

### State mechanism

One temp file per session: `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` storing `{ blocks: N }`. Prevents infinite loops — after 2 blocks, allows through. No cleanup (relies on OS temp cleanup).

### Hook contract with Claude Code

**This is the most critical invariant.** The Stop hook's stdout MUST be either:
- `{ "decision": "block", "reason": "..." }` (block the response)
- Nothing (allow the response)

Any change that alters this stdout shape silently disables the entire hook. Claude Code treats hook crashes as "allow" (fail-open).

## Development

### Stack

- **Runtime:** Node.js built-ins only (`node:fs`, `node:os`, `node:path`). Zero `dependencies` in package.json.
- **Module system:** CommonJS (`.cjs` files)
- **Linter/formatter:** Biome (`npx biome check .`)
- **Tests:** Node.js built-in test runner (`node --test 'tests/**/*.test.cjs'`)
- **Versioning:** semantic-release
- **Git hooks:** husky (pre-commit, commit-msg via commitlint)

### Commands

```bash
npm test          # Run tests
npm run lint      # Biome check
npm run lint:fix  # Biome auto-fix
npm run format    # Biome format
```

### Adding a new detection category

This is the most common type of change. Follow this pattern exactly:

1. Add a new block inside `findTriggerMatches()` in `scripts/hallucination-audit-stop.cjs`
2. Use the same structure as existing categories:
   - Define trigger phrases or regex patterns
   - Iterate over text, find matches
   - Apply suppression rules (questions, evidence, enumeration)
   - Push `{ kind: 'your_category', evidence, offset }` to matches array
3. Add tests in `tests/hallucination-audit-stop.test.cjs`:
   - Test positive matches (text that should trigger)
   - Test negative matches (text that should NOT trigger — suppression cases)
4. Run `npm test` and `npm run lint` before committing

## Subagents (`.claude/agents/`)

| Agent | When to use |
|-------|------------|
| `code-review` | Only when explicitly requested. Reviews for LLM slop, security, pattern adherence. |
| `fact-checker` | Verify a single factual claim against primary sources. MUST use WebFetch/WebSearch/gh. |
| `doc-drift-auditor` | Compare documentation claims against code reality. Git forensics. |
| `javascript-pro` | Implementation work. Knows this project's CJS/Biome/node:test stack. |

## Issue Management

### Label taxonomy (3 dimensions + topic)

Every issue gets one label from each of these dimensions:

**Impact type** — what kind of change is it:

| Label | Meaning | Example |
|-------|---------|---------|
| `impact: additive` | New patterns in existing pipeline. No architecture change. | Adding a regex category |
| `impact: structural` | Changes pipeline architecture. Existing tests may break. | Sentence splitting, scoring layers |
| `impact: contract` | Changes stdin/stdout contract with Claude Code. | JSON output format, new decision types |
| `impact: infrastructure` | Adds new subsystem. New failure modes. | Config loading, MCP server, state management |
| `impact: external` | Requires network calls, APIs, or new runtimes. | RAG verification, Exa.ai |

**Risk level** — how dangerous is it:

| Label | Meaning |
|-------|---------|
| `risk: low` | Additive, backward-compatible, trivial rollback |
| `risk: medium` | New subsystem or structural change, moderate rollback |
| `risk: high` | Contract change, deadlock potential, or external deps |
| `risk: critical` | Can silently disable the hook if misimplemented |

**Implementation phase** — when to do it:

| Label | Phase | What | Can start |
|-------|-------|------|-----------|
| `phase: 1-additive-patterns` | 1 | Zero-risk additive regex patterns | Now |
| `phase: 2-config-foundation` | 2 | Config system (unlocks phases 4–8) | Now |
| `phase: 3-sentence-infra` | 3 | Sentence splitting infrastructure | Now |
| `phase: 4-scoring-rebuild` | 4 | Scoring architecture (changes match shape) | After phase 2 |
| `phase: 5-output-pipeline` | 5 | Output format (must preserve hook contract) | After phases 2, 4 |
| `phase: 6-stateful-escalation` | 6 | Escalation logic (highest internal risk) | After phases 2, 4 |
| `phase: 7-external-isolated` | 7 | External deps, separate packages | After phase 2 |
| `phase: 8-opt-in-advanced` | 8 | Opt-in features requiring config | After phase 2 |

**Topic** — what area it covers (for filtering/discovery):

`topic: detection-patterns`, `topic: source-credibility`, `topic: sentence-processing`, `topic: scoring`, `topic: output`, `topic: config`, `topic: platform-integration`, `topic: verification`

### Sub-issue hierarchy (current)

```
#10 (config) ← FOUNDATION
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

### Creating a new issue

Use this process to classify a new issue before filing it:

#### Step 1: Determine impact type

Ask these questions in order:

1. Does it need network calls, API keys, or a new runtime? → `impact: external`
2. Does it change what stdout looks like to Claude Code? → `impact: contract`
3. Does it change the pipeline architecture (new processing stages, different return shapes)? → `impact: structural`
4. Does it add a new subsystem (config, state, server)? → `impact: infrastructure`
5. Does it add patterns to the existing `findTriggerMatches()` without changing its interface? → `impact: additive`

#### Step 2: Determine risk level

| If the impact type is... | Default risk is... | Upgrade to higher risk if... |
|--------------------------|-------------------|------------------------------|
| `additive` | `low` | High false-positive rate expected |
| `structural` | `medium` | Changes `findTriggerMatches()` return shape (breaks tests) |
| `infrastructure` | `medium` | Failure crashes the hook (fail-open = detection disabled) |
| `contract` | `high` | Changes stdout format (can silently disable hook) → `critical` |
| `external` | `high` | Introduces async into the synchronous pipeline |

#### Step 3: Determine phase

- No dependencies on other issues? → `phase: 1` (if additive) or appropriate standalone phase
- Depends on config (#10)? → `phase: 4` through `phase: 8`
- Depends on sentence splitting (#19)? → `phase: 3` or later
- Depends on scoring (#21)? → `phase: 5` or later

#### Step 4: Assign topic

Pick the most specific topic label. An issue can have multiple topic labels.

#### Step 5: Write the deep analysis comment

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

#### Step 6: Link the issue

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

### Issue body template

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
- [ ] `npm test` passes
- [ ] `npm run lint` passes

## References

- [links to prior art, research, related repos]
```

### Running the deep analysis process on new issues

When reviewing a batch of new issues (or re-evaluating existing ones), use parallel research agents to analyze across these dimensions:

1. **External dependencies** — Does it need npm packages, API keys, new runtimes? Does it break zero-dependency?
2. **State/storage** — Does it read/write cross-invocation state? Race conditions? Cleanup?
3. **Workflow/ordering** — Does it change entry point, decision logic, stdout contract, or hook sequencing?
4. **Risk/blast radius** — What's the change type, failure mode, test impact, rollback difficulty?

These four dimensions cut across topic groupings. Two issues in the same topic area can have completely different risk profiles (e.g., #15 cognitive bias is `additive/low` while #11 RAG is `external/high`, despite both being "advanced detection").

## Behavioral Rules

See the root `CLAUDE.md` for behavioral framing rules that apply to all assistant output in this project. Key points:

- No speculation language ("I think", "probably", "likely")
- Verify claims with tools before stating them
- Frame uncertainty as hypotheses with verification steps
- Do not claim completeness without enumeration
