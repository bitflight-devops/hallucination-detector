# GitHub Milestones — Management

## When to Use What

| Context | Tool |
|---------|------|
| Quick one-off | `github-project-setup.cjs milestone list` |
| Scripted / multi-step | `createGitHubClient()` in `.cjs` scripts |

---

## Quick Commands

```bash
# List milestones
node .claude/skills/gh/scripts/github-project-setup.cjs milestone list

# Create milestone
node .claude/skills/gh/scripts/github-project-setup.cjs milestone create \
  --title "v1.0 — Detection Foundation" --due 2026-03-31

# Start milestone (transition issues from needs-grooming to in-progress)
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 1
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 1 --dry-run

# Close milestone
node .claude/skills/gh/scripts/github-project-setup.cjs milestone close --number 1
```

---

## Scripted Operations (JavaScript)

```javascript
const { createGitHubClient, OWNER, REPO } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();

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

## Milestone Naming Conventions

```text
v1.0 — Detection Foundation     # initial stable release
v1.1 — Config System            # config foundation (phase 2)
v2.0 — Scoring Architecture     # scoring rebuild (phase 4)
Backlog Grooming — 2026-Q1      # quarterly grooming milestone
```

SOURCE: GitHub REST API — Milestones — <https://docs.github.com/en/rest/issues/milestones> (accessed 2026-02-21)
SOURCE: Octokit.js REST — <https://octokit.github.io/rest.js/v20#issues-create-milestone> (accessed 2026-02-21)
