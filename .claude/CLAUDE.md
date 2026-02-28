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

- **Runtime hooks:** Node.js built-ins only (`node:fs`, `node:os`, `node:path`). Zero `dependencies` in package.json. This constraint applies ONLY to the hook scripts that end users install — not to dev tooling.
- **Dev/utility scripts:** Use proper npm packages freely. Install as `devDependencies` with pnpm. Never shell out to CLI tools when a native library exists (e.g., use `@octokit/rest` not `child_process.execSync('gh ...')`).
- **Package manager:** pnpm (not npm, not yarn)
- **Module system:** CommonJS (`.cjs` files)
- **Linter/formatter:** Biome (`npx biome check .`)
- **Tests:** Node.js built-in test runner (`node --test 'tests/**/*.test.cjs'`)
- **Versioning:** semantic-release
- **Git hooks:** husky (pre-commit, commit-msg via commitlint)

### Agent delegation rules

These rules exist because they were violated in the past. Follow them exactly.

1. **Do not edit JavaScript files directly.** Delegate all JS implementation to the `javascript-pro` agent. It has project-specific rules for CJS conventions, Biome compliance, and codebase patterns that the orchestrator does not.
2. **Spec first, then delegate.** Before delegating to an agent, write out the spec: what to change, what the interface should look like, what consistency rules to follow, and what files to create or modify. The agent develops from the spec — not from vague instructions.
3. **Shared modules over duplication.** When multiple scripts need the same constants, types, or functions, tell the agent to create a shared helper module and import from it. Specify the module path, exports, and which consumers should import it.
4. **One agent per coherent unit of work.** Don't split a tightly coupled change across multiple agents (they can't coordinate). Don't merge unrelated changes into one agent (it loses focus).

### Dev tooling rules

These rules exist because they were violated in the past. Follow them exactly.

1. **Runtime vs. dev dependency boundary.** The runtime hooks (`scripts/hallucination-audit-stop.cjs`, `scripts/hallucination-framing-session-start.cjs`) MUST have zero `dependencies` — they run on end-user machines. Everything else (utility scripts, tests, CI) can use any `devDependencies` needed.
2. **Use native libraries, not CLI wrappers.** Do not shell out to CLI tools (`gh`, `git`, `curl`) via `child_process` when a proper Node.js library exists. Use `octokit` (full SDK) for GitHub API, `gray-matter` for frontmatter parsing, `yaml` for YAML serialization, etc. Shelling out is fragile, hard to test, and loses type information. Research the best modern library for a task before picking one — prefer recently released, actively maintained packages that cover the most functionality.
3. **pnpm only.** Use `pnpm add -D` to install packages. Do not use `npm install` or `yarn add`. Run scripts with `pnpm run` or `pnpm exec`.
4. **devDependencies are not restricted.** The dev environment can have as many packages as needed. Do not artificially constrain dev tooling to match the zero-dependency runtime constraint.

### Commands

```bash
pnpm test          # Run tests
pnpm run lint      # Biome check
pnpm run lint:fix  # Biome auto-fix
pnpm run format    # Biome format
pnpm add -D <pkg>  # Add a dev dependency
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
4. Run `pnpm test` and `pnpm run lint` before committing

## `.claude/` Directory Structure

```
.claude/
├── CLAUDE.md          ← This file (project guide, tracked in git)
├── agents/            ← Subagent definitions (tracked in git)
│   ├── code-review.md
│   ├── doc-drift-auditor.md
│   ├── fact-checker.md
│   └── javascript-pro.md
├── rules/             ← Reusable rule files (tracked in git, created as needed)
├── skills/            ← Skill definitions (tracked in git, created as needed)
├── commands/          ← Custom slash commands (tracked in git, created as needed)
└── scripts/           ← Utility scripts for issue management, etc. (tracked in git)
```

The `.gitignore` ignores `.claude/` by default but has explicit exceptions for `agents/`, `rules/`, `skills/`, `commands/`, `scripts/`, and `CLAUDE.md`. Other directories under `.claude/` (caches, local state, worktrees) remain ignored.

### Source repo

The agents, rules, skills, and commands in `.claude/` originate from [Jamie-BitFlight/claude_skills](https://github.com/Jamie-BitFlight/claude_skills). To browse or pull updates from the source:

```bash
# Clone into the ignored worktrees directory
git clone https://github.com/Jamie-BitFlight/claude_skills.git .claude/worktrees/claude_skills
# Browse available agents, rules, skills, commands, scripts
ls .claude/worktrees/claude_skills/.claude/{agents,rules,skills,commands,scripts}/
```

When bringing in new files from the source repo, copy them into the appropriate `.claude/` subdirectory in this project and commit. Adapt any hardcoded repo names or paths (the source scripts reference `Jamie-BitFlight/claude_skills` and its project IDs).

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

## Working Process

Every task follows this sequence. Do not skip steps. Do not jump to implementation.

### 1. Understand the problem

Break the task into its constituent parts. What are the inputs, outputs, constraints, and dependencies? What existing code/systems does it touch? Read the relevant files.

### 2. Research how this problem is solved

Search for how other repositories and projects solve the same problem. Find several concrete examples (3+). Use WebSearch, WebFetch, and Explore agents. Look at:
- Popular open-source projects that face the same challenge
- npm packages that encapsulate the solution (prefer recent, maintained, feature-rich libraries over writing code ourselves)
- Existing patterns in this codebase or the claude_skills source repo

### 3. State objectives

Write out the specific objectives the solution must achieve. These are acceptance criteria, not vague goals. Each one must be testable.

### 4. Gap analysis

Compare the research findings against the objectives. Identify gaps — things the research doesn't cover, trade-offs between approaches, risks. If there are gaps, go back to step 2 and research more. Do not proceed with gaps.

### 5. Develop

Only now write code. Follow the strategy that emerged from steps 1–4. Use the libraries and patterns identified in research. Delegate implementation to javascript-pro agents when appropriate.

### 6. Verify

Run lints, tests, and manual checks. Confirm each objective from step 3 is met with evidence, not assertions.

## Behavioral Rules

See the root `CLAUDE.md` for behavioral framing rules that apply to all assistant output in this project. Key points:

- No speculation language ("I think", "probably", "likely")
- Verify claims with tools before stating them
- Frame uncertainty as hypotheses with verification steps
- Do not claim completeness without enumeration
