# GitHub Issues as User Stories — Workflow and Templates

## Issue as Story Model

Each issue represents one backlog item and follows a story format with:

- **Title**: short, imperative, `[type]: description` prefix (conventional commits style)
- **Body**: user story + acceptance criteria + context
- **Labels**: priority + type + status (see [labels.md](./labels.md))
- **Milestone**: release or theme grouping (see [milestones.md](./milestones.md))
- **Project**: board item for visualization (see [projects-v2.md](./projects-v2.md))

---

## Issue Title Convention

```text
feat: add priority labels to issue taxonomy
fix: correct task_output variable reference in log_functions.sh
refactor: replace hardcoded corporate URL in validate_glfm.py
docs: document GitHub Projects V2 workflow
chore: bump marketplace.json version after plugin removal
```

Mirrors Conventional Commits to link commits to issues naturally.

---

## Issue Body Template

```markdown
## Story

As a **{role}**, I want **{goal}** so that **{benefit}**.

## Description

{detailed description from backlog item}

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}
- [ ] {criterion 3}

## Context

- **Source**: {where this item came from}
- **Priority**: {P0 / P1 / P2 / Idea}
- **Added**: {YYYY-MM-DD}
- **Research questions**: {any open questions, or "None"}

## Notes

{optional: links to related issues, PRs, skills, or research}
```

---

## Issue Lifecycle

```text
Open → label: status:needs-grooming
  ↓ after grooming
  label: status:in-progress (when work starts)
  ↓ during work
  PR created → PR body: "Closes #N"
  ↓ PR merged
  Issue auto-closed by GitHub
  Milestone completion tracked
```

---

## Quick Commands

```bash
# Create issue
node .claude/scripts/gh-api.cjs issue create \
  --title "fix: correct task_output variable" \
  --label "priority:p1" --label "type:bug" --label "status:needs-grooming" \
  --body "## Story ..."

# List open issues
node .claude/scripts/gh-api.cjs issue list

# View issue
node .claude/scripts/gh-api.cjs issue view 42

# Add comment
node .claude/scripts/gh-api.cjs issue comment 42 --body "Implemented in PR #45."
```

---

## Scripted Operations (JavaScript)

```javascript
const { createGitHubClient, OWNER, REPO } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();

// Create issue with labels and milestone
const { data: issue } = await octokit.rest.issues.create({
  owner: OWNER,
  repo: REPO,
  title: 'fix: correct task_output variable',
  body: '## Story\n\nAs a developer...',
  labels: ['priority:p1', 'type:bug', 'status:needs-grooming'],
  milestone: 1,
});

// Close issue
await octokit.rest.issues.update({
  owner: OWNER,
  repo: REPO,
  issue_number: 42,
  state: 'closed',
});
```

---

## Automation Script

```bash
node .claude/skills/gh/scripts/github-project-setup.cjs issue list --priority p1
node .claude/skills/gh/scripts/github-project-setup.cjs issue create \
  --title "fix: correct task_output variable" \
  --priority-label priority:p1 \
  --type-label type:bug \
  --milestone 1
```

---

## Backlog Item ↔ GitHub Issue Field Mapping

| Per-item file field                        | GitHub Issue field          |
| ------------------------------------------ | --------------------------- |
| `name` frontmatter                         | Issue title                 |
| `metadata.priority` frontmatter (P0/P1/P2) | `priority:*` label          |
| Item description body                      | Issue body                  |
| `metadata.status` frontmatter              | `status:*` label            |
| `metadata.plan` frontmatter                | Issue body Notes section    |
| `metadata.issue` frontmatter               | Issue number (written back) |
| `last-completed` frontmatter               | Issue closed date           |

SOURCE: GitHub Issues documentation — <https://docs.github.com/en/issues/tracking-your-work-with-issues> (accessed 2026-02-21)
SOURCE: Octokit.js REST — <https://octokit.github.io/rest.js/v20#issues-create> (accessed 2026-02-21)
