# GitHub Labels — Taxonomy and Management

## When to Use What

| Context               | Tool                                                             |
| --------------------- | ---------------------------------------------------------------- |
| Quick one-off         | `node .claude/scripts/gh-api.cjs label list` / `label create`    |
| Scripted / multi-step | `createGitHubClient()` in `.cjs` scripts                         |
| Bulk setup            | `node .claude/skills/gh/scripts/github-project-setup.cjs labels` |

---

## Project Label Taxonomy

This project uses **four axes**: impact, risk, phase, and topic (defined in `.claude/CLAUDE.md`).

The automation script also manages the standard **three-axis** labels below.

### Priority Labels

| Label           | Color     | Description                          |
| --------------- | --------- | ------------------------------------ |
| `priority:p0`   | `#D73A4A` | Critical — blocks work or production |
| `priority:p1`   | `#E99695` | High — should be done next           |
| `priority:p2`   | `#F9D0C4` | Medium — do when P0/P1 are clear     |
| `priority:idea` | `#BFD4F2` | Unscoped — future consideration      |

### Type Labels

| Label           | Color     | Description                              |
| --------------- | --------- | ---------------------------------------- |
| `type:feature`  | `#0E8A16` | New capability                           |
| `type:bug`      | `#B60205` | Something is broken                      |
| `type:refactor` | `#5319E7` | Internal improvement, no behavior change |
| `type:docs`     | `#0075CA` | Documentation only                       |
| `type:chore`    | `#EDEDED` | Maintenance, tooling, CI                 |

### Status Labels

| Label                   | Color     | Description                       |
| ----------------------- | --------- | --------------------------------- |
| `status:in-progress`    | `#1D76DB` | Actively being worked             |
| `status:done`           | `#0E8A16` | Work complete, milestone closing  |
| `status:blocked`        | `#B60205` | Waiting on external dependency    |
| `status:needs-grooming` | `#FEF2C0` | Captured but not yet groomed      |
| `status:needs-review`   | `#D876E3` | Implementation done, needs review |

---

## Quick Commands

```bash
# List all labels
node .claude/scripts/gh-api.cjs label list

# Create a label
node .claude/scripts/gh-api.cjs label create --name "priority:p1" --color "E99695" --description "High priority"
```

---

## Scripted Operations (JavaScript)

```javascript
const { createGitHubClient, OWNER, REPO } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();

// Create a label
await octokit.rest.issues.createLabel({
  owner: OWNER,
  repo: REPO,
  name: 'priority:p1',
  color: 'E99695',
  description: 'High priority — should be done next',
});

// Apply label to issue
await octokit.rest.issues.addLabels({
  owner: OWNER,
  repo: REPO,
  issue_number: 42,
  labels: ['status:in-progress'],
});

// Remove label
await octokit.rest.issues.removeLabel({
  owner: OWNER,
  repo: REPO,
  issue_number: 42,
  name: 'status:needs-grooming',
});
```

---

## Bulk Label Setup

```bash
node .claude/skills/gh/scripts/github-project-setup.cjs labels
node .claude/skills/gh/scripts/github-project-setup.cjs labels --force
```

---

## Backlog Item Priority → Issue Label Mapping

| Per-item file priority | Issue label     |
| ---------------------- | --------------- |
| P0                     | `priority:p0`   |
| P1                     | `priority:p1`   |
| P2                     | `priority:p2`   |
| Ideas                  | `priority:idea` |

SOURCE: Octokit.js REST — <https://github.com/octokit/rest.js> (accessed 2026-02-21)
