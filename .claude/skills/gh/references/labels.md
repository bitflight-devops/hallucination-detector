# GitHub Labels — Taxonomy and Management

## When to Use What

| Context | Tool |
|---------|------|
| Quick one-off command | `gh label` CLI |
| Scripted / multi-step | `octokit` (full SDK) via `.cjs` scripts |

---

## Project Label Taxonomy

This project uses **four axes**: impact, risk, phase, and topic (defined in `.claude/CLAUDE.md`).

The automation script also manages the standard **three-axis** labels below.

### Priority Labels

| Label | Color | Description |
|-------|-------|-------------|
| `priority:p0` | `#D73A4A` | Critical — blocks work or production |
| `priority:p1` | `#E99695` | High — should be done next |
| `priority:p2` | `#F9D0C4` | Medium — do when P0/P1 are clear |
| `priority:idea` | `#BFD4F2` | Unscoped — future consideration |

### Type Labels

| Label | Color | Description |
|-------|-------|-------------|
| `type:feature` | `#0E8A16` | New capability |
| `type:bug` | `#B60205` | Something is broken |
| `type:refactor` | `#5319E7` | Internal improvement, no behavior change |
| `type:docs` | `#0075CA` | Documentation only |
| `type:chore` | `#EDEDED` | Maintenance, tooling, CI |

### Status Labels

| Label | Color | Description |
|-------|-------|-------------|
| `status:in-progress` | `#1D76DB` | Actively being worked |
| `status:done` | `#0E8A16` | Work complete, milestone closing |
| `status:blocked` | `#B60205` | Waiting on external dependency |
| `status:needs-grooming` | `#FEF2C0` | Captured but not yet groomed |
| `status:needs-review` | `#D876E3` | Implementation done, needs review |

---

## gh CLI — Quick Commands

```bash
# List all labels
gh label list -R bitflight-devops/hallucination-detector

# Create a label
gh label create "priority:p1" \
  --color "E99695" \
  --description "High priority — should be done next" \
  -R bitflight-devops/hallucination-detector

# Apply labels to an issue
gh issue edit 42 -R bitflight-devops/hallucination-detector \
  --add-label "status:in-progress" \
  --remove-label "status:needs-grooming"
```

---

## Octokit — Scripted Operations (JavaScript)

Use `octokit` (full SDK) in `.cjs` scripts — never shell out to `gh`.

```javascript
const { Octokit } = require('octokit');
const { OWNER, REPO } = require('../../scripts/lib/story-helpers.cjs');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

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

| Per-item file priority | Issue label |
|--------------------|-------------|
| P0 | `priority:p0` |
| P1 | `priority:p1` |
| P2 | `priority:p2` |
| Ideas | `priority:idea` |

SOURCE: GitHub CLI label documentation — <https://cli.github.com/manual/gh_label> (accessed 2026-02-21)
SOURCE: Octokit.js REST — <https://github.com/octokit/rest.js> (accessed 2026-02-21)
