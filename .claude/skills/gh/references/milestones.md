# GitHub Milestones — Management

`gh` has no native `milestone` subcommand. Use `gh api` (REST) for quick operations or `octokit` in scripts.

## When to Use What

| Context | Tool |
|---------|------|
| Quick one-off | `gh api repos/{owner}/{repo}/milestones` |
| Scripted / multi-step | `octokit` (full SDK) via `.cjs` scripts |

---

## gh CLI (REST) — Quick Commands

### List Milestones

```bash
gh api repos/bitflight-devops/hallucination-detector/milestones \
  --jq '.[] | [.number, .title, .state, .open_issues, .due_on] | @tsv'
```

### Create a Milestone

```bash
gh api repos/bitflight-devops/hallucination-detector/milestones \
  -X POST \
  -f title="v1.0 — Detection Foundation" \
  -f description="Core detection patterns and config system" \
  -f due_on="2026-03-31T00:00:00Z" \
  -f state="open"
```

Returns JSON with `number` field — use this to assign issues.

### Update a Milestone

```bash
gh api repos/bitflight-devops/hallucination-detector/milestones/1 \
  -X PATCH -f due_on="2026-04-15T00:00:00Z"
```

### Assign Milestone to Issue

```bash
# -F sends value as integer (required for milestone field)
gh api repos/bitflight-devops/hallucination-detector/issues/42 \
  -X PATCH -F milestone=1

# Remove milestone
gh api repos/bitflight-devops/hallucination-detector/issues/42 \
  -X PATCH -F milestone=null
```

### List Issues in a Milestone

```bash
gh issue list -R bitflight-devops/hallucination-detector \
  --milestone "v1.0 — Detection Foundation" \
  --json number,title,state,labels
```

---

## Octokit — Scripted Operations (JavaScript)

```javascript
const { Octokit } = require('octokit');
const { OWNER, REPO } = require('../../scripts/lib/story-helpers.cjs');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Create milestone
const { data: milestone } = await octokit.rest.issues.createMilestone({
  owner: OWNER,
  repo: REPO,
  title: 'v1.0 — Detection Foundation',
  due_on: '2026-03-31T00:00:00Z',
});

// Assign milestone to issue
await octokit.rest.issues.update({
  owner: OWNER,
  repo: REPO,
  issue_number: 42,
  milestone: milestone.number,
});

// List milestones
const { data: milestones } = await octokit.rest.issues.listMilestones({
  owner: OWNER,
  repo: REPO,
  state: 'all',
});
```

---

## Automation Script

```bash
node .claude/skills/gh/scripts/github-project-setup.cjs milestone list
node .claude/skills/gh/scripts/github-project-setup.cjs milestone create \
  --title "v1.0 — Detection Foundation" --due 2026-03-31
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 3
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 3 --dry-run
```

---

## Milestone Naming Conventions

```text
v1.0 — Detection Foundation     # initial stable release
v1.1 — Config System            # config foundation (phase 2)
v2.0 — Scoring Architecture     # scoring rebuild (phase 4)
Backlog Grooming — 2026-Q1      # quarterly grooming milestone
```

SOURCE: GitHub REST API — Milestones — <https://docs.github.com/en/rest/issues/milestones> (accessed 2026-02-21)
SOURCE: Octokit.js REST — <https://octokit.github.io/rest.js/v20#issues-create-milestone> (accessed 2026-02-21)
