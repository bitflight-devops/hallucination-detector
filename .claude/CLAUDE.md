# Hallucination Detector — Project Guide

## What This Project Is

A Claude Code stop-hook plugin that audits assistant output for speculation, ungrounded causality, pseudo-quantification, and completeness overclaims. Zero runtime dependencies. Two hooks (Stop and SessionStart), six CJS scripts, regex-based detection with structured claim annotation and configurable weights.

## Architecture

### Runtime files

| File                                              | Role                                                                                                                                                                                                                         |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/hallucination-audit-stop.cjs`            | **Stop hook** — core detection. Reads stdin JSON from Claude Code, parses JSONL transcript, extracts last assistant message, runs `findTriggerMatches()`, emits `{ "decision": "block", "reason": "..." }` or exits cleanly. |
| `scripts/hallucination-framing-session-start.cjs` | **SessionStart hook** — injects behavioral framing text into session context at startup.                                                                                                                                     |
| `scripts/hallucination-claim-structure.cjs`       | Structured claim annotation — classifies claims and annotates with evidence requirements.                                                                                                                                    |
| `scripts/hallucination-annotate.cjs`              | Annotation pipeline — marks up text with detected patterns and structured metadata.                                                                                                                                          |
| `scripts/hallucination-config.cjs`                | Configuration loading — `loadConfig()`, `loadWeights()`, `DEFAULT_WEIGHTS`, `DEFAULT_CONFIG`.                                                                                                                                |
| `scripts/hallucination-memory-gate.cjs`           | Memory gate — `computeMemoryGate()` with `RETAINABLE_LABELS` for persistence gating.                                                                                                                                         |
| `hooks/hooks.json`                                | Registers both hooks with Claude Code.                                                                                                                                                                                       |

### Detection categories (4 active)

1. `speculation_language` — "I think", "probably", "likely", etc.
2. `causality_language` — "because", "caused by", "due to" without evidence nearby
3. `pseudo_quantification` — quality scores (N/10), ungrounded percentages
4. `completeness_claim` — "all files checked", "fully resolved", etc.

### Key function: `findTriggerMatches(text)`

Defined in `scripts/hallucination-audit-stop.cjs` and exported via `module.exports.findTriggerMatches`. Returns `[{ kind, evidence, offset }]`.

### Suppression mechanisms

- `stripLowSignalRegions(text)` — removes code blocks, inline code, blockquotes before matching
- `isIndexWithinQuestion(text, index)` — exempts sentences containing "?"
- `hasEvidenceNearby(text, rawText, index)` — 150-char window check for evidence markers
- `hasEnumerationNearby(text, index)` — 200-char preceding window for numbered/bulleted lists

### State mechanism

One temp file per session: `${os.tmpdir()}/claude-hallucination-audit-${sessionId}.json` storing `{ blocks: N }`. Prevents infinite loops — after 2 blocks, allows through. No cleanup (relies on OS temp cleanup).

### Claude Code Plugin Architecture

This project is a **Claude Code plugin**. Understanding the hook system is essential for all changes.

**Plugin registration:** `hooks/hooks.json` declares two hooks. Claude Code reads this file when the plugin is installed. The `${CLAUDE_PLUGIN_ROOT}` variable resolves to this repo's root directory at runtime.

**Hook events used:**

| Event          | Script                                    | I/O Contract                                                                                                                            |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionStart` | `hallucination-framing-session-start.cjs` | Receives JSON on stdin with `session_id`, `transcript_path`, `source`, `model`. Emits plain text on stdout — added to Claude's context. |
| `Stop`         | `hallucination-audit-stop.cjs`            | Receives JSON on stdin with `session_id`, `transcript_path`, `stop_hook_active`. Emits JSON on stdout (see below) or nothing.           |

**Stop hook stdout contract — the most critical invariant:**

- `{ "decision": "block", "reason": "..." }` — blocks Claude from completing. `reason` is fed back to Claude.
- No output (empty stdout, exit 0) — allows Claude to complete.

Any change that alters this stdout shape silently disables the entire hook. Claude Code treats hook crashes as "allow" (fail-open). The `stop_hook_active` field is `true` when Claude is already retrying after a previous block — the state mechanism uses this plus a temp file counter to prevent infinite loops.

**Environment variables available to hook scripts:**

| Variable             | Value                                    |
| -------------------- | ---------------------------------------- |
| `CLAUDE_PLUGIN_ROOT` | Absolute path to this repo's root        |
| `CLAUDE_PROJECT_DIR` | Absolute path to the user's project root |

**Exit codes:** Exit 0 for success (stdout processed as JSON or text). Exit 2 for blocking errors (stderr shown to Claude for Stop hooks). Any other exit code is a non-blocking error (logged in verbose mode only).

## Development

### Stack

- **Runtime hooks:** Node.js built-ins only (`node:fs`, `node:os`, `node:path`). Zero `dependencies` in package.json. This constraint applies ONLY to the hook scripts that end users install — not to dev tooling.
- **Dev/utility scripts:** Use proper npm packages freely. Install as `devDependencies` with pnpm. Never shell out to CLI tools when a native library exists (e.g., use `@octokit/rest` not `child_process.execSync('gh ...')`).
- **Package manager:** pnpm (not npm, not yarn)
- **Module system:** CommonJS (`.cjs` files)
- **Linter/formatter:** Biome (`npx biome check .`)
- **Tests:** Vitest (`vitest run`), config in `vitest.config.cjs`, coverage via `@vitest/coverage-v8`
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
pnpm test                              # Run all tests (vitest run)
pnpm exec vitest run tests/FILE.cjs    # Run a single test file
pnpm exec vitest run -t "test name"    # Run tests matching a name pattern
pnpm exec vitest --coverage            # Run tests with coverage report
pnpm run lint                          # Biome check
pnpm run lint:fix                      # Biome auto-fix
pnpm run format                        # Biome format
pnpm add -D <pkg>                      # Add a dev dependency
```

### Coverage thresholds (CI-enforced)

Defined in `vitest.config.cjs`. CI fails below these:

| Metric    | Threshold |
| --------- | --------- |
| Lines     | 75%       |
| Branches  | 60%       |
| Functions | 80%       |

### Post-push workflow

After every push, follow this sequence:

1. **Watch CI until completion:**

   ```bash
   node .claude/scripts/gh-api.cjs run list --limit 1
   ```

   If `status` is not `completed`, wait and re-check. Once completed, check `conclusion` — if `failure`, investigate:

   ```bash
   # Find the failing job
   node .claude/scripts/gh-api.cjs run logs <run-id>
   # Get annotations for a failing check
   node .claude/scripts/gh-api.cjs checks list <pr-number>
   node .claude/scripts/gh-api.cjs checks annotations <check-run-id>
   ```

   Fix failures and push again. Do not leave CI red.

2. **Read CodeRabbit review feedback:**

   ```bash
   node .claude/scripts/gh-api.cjs issue comment search <pr-number> \
     --user "coderabbitai[bot]" \
     --section "Prompt for AI Agents" \
     --source reviews
   ```

   Each result contains a `content` field with a specific, actionable prompt. Evaluate each against the current code — CodeRabbit may reference stale line numbers after subsequent pushes. Verify the finding still applies before acting on it.

3. **Check for review comments (code annotations):**

   ```bash
   node .claude/scripts/gh-api.cjs review-comment list <pr-number>
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

```text
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

| Agent               | When to use                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `code-review`       | Only when explicitly requested. Reviews for LLM slop, security, pattern adherence.     |
| `fact-checker`      | Verify a single factual claim against primary sources. MUST use WebFetch/WebSearch/gh. |
| `doc-drift-auditor` | Compare documentation claims against code reality. Git forensics.                      |
| `javascript-pro`    | Implementation work. Knows this project's CJS/Biome/vitest stack.                      |

## Issue Management

See `.claude/rules/issue-management.md` for the full label taxonomy, sub-issue hierarchy, issue creation process, and templates.

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
