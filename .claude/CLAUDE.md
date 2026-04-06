# Hallucination Detector — Project Guide

@docs/architecture.md

## Stack Constraints

- **Runtime hooks are zero-dependency.** `scripts/hallucination-audit-stop.cjs` and `scripts/hallucination-framing-session-start.cjs` run on end-user machines — no `dependencies` in package.json, Node.js built-ins only. Dev tooling has no such restriction.
- **pnpm only.** `pnpm add -D` to install. Do not use `npm install` or `yarn add`.
- **CommonJS only.** All scripts are `.cjs` files.
- **Native libraries, not CLI wrappers.** Use `octokit` for GitHub API, `gray-matter` for frontmatter, `yaml` for YAML. Never shell out via `child_process` when a Node.js library exists.

## Agent Delegation Rules

These rules exist because they were violated in the past.

1. **Do not edit JavaScript files directly.** Delegate all JS implementation to the `javascript-pro` agent.
2. **Spec first, then delegate.** Write the spec (interface, consistency rules, files to modify) before delegating. The agent develops from the spec — not from vague instructions.
3. **Shared modules over duplication.** When multiple scripts need the same constants or functions, specify a shared helper module, its exports, and which consumers import it.
4. **One agent per coherent unit of work.** Don't split tightly coupled changes across agents. Don't merge unrelated changes into one agent.

## Dev Tooling Rules

These rules exist because they were violated in the past.

1. **devDependencies are not restricted.** Do not artificially constrain dev tooling to match the zero-dependency runtime constraint.
2. **Coverage thresholds are CI-enforced** (defined in `vitest.config.cjs`): Lines 75%, Branches 60%, Functions 80%.

## Commands

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

## Post-Push Workflow

After every push:

1. **Watch CI until completion:**

   ```bash
   node .claude/scripts/gh-api.cjs run list --limit 1
   ```

   If `conclusion` is `failure`, investigate:

   ```bash
   node .claude/scripts/gh-api.cjs run logs <run-id>
   node .claude/scripts/gh-api.cjs checks list <pr-number>
   node .claude/scripts/gh-api.cjs checks annotations <check-run-id>
   ```

2. **Read CodeRabbit review feedback:**

   ```bash
   node .claude/scripts/gh-api.cjs issue comment search <pr-number> \
     --user "coderabbitai[bot]" \
     --section "Prompt for AI Agents" \
     --source reviews
   ```

   Verify each finding still applies before acting — CodeRabbit may reference stale line numbers after subsequent pushes.

3. **Check for review comments (code annotations):**

   ```bash
   node .claude/scripts/gh-api.cjs review-comment list <pr-number>
   ```

## Output Directory Boundary

**Never write output, reports, telemetry, or design artifacts to `.claude/`.**

| Output type                          | Correct location                                                          |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Runtime telemetry, audit state, logs | `~/.hd/telemetry/` (e.g. `hallucination-detector.db`, `shadow-log.jsonl`) |
| Periodic audit results               | `~/.hd/audits/` (e.g. `audit-YYYY-MM-DD.yaml`)                            |
| Design artifacts versioned with code | `docs/` in the repo root                                                  |
| Session working notes                | `/tmp/` (not committed)                                                   |

## Subagents (`.claude/agents/`)

| Agent               | When to use                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `code-review`       | Only when explicitly requested. Reviews for LLM slop, security, pattern adherence.     |
| `fact-checker`      | Verify a single factual claim against primary sources. MUST use WebFetch/WebSearch/gh. |
| `doc-drift-auditor` | Compare documentation claims against code reality. Git forensics.                      |
| `javascript-pro`    | Implementation work. Knows this project's CJS/Biome/vitest stack.                      |

## Issue Management

See `.claude/rules/issue-management.md` for the full label taxonomy, sub-issue hierarchy, issue creation process, and templates.

## `.claude/` Source Repo

The agents, rules, skills, commands, and scripts in `.claude/` originate from [Jamie-BitFlight/claude_skills](https://github.com/Jamie-BitFlight/claude_skills).

```bash
git clone https://github.com/Jamie-BitFlight/claude_skills.git .claude/worktrees/claude_skills
```

When bringing in new files, copy to the appropriate `.claude/` subdirectory and commit. Adapt hardcoded repo names and project IDs.
