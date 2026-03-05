---
name: gh
description: "GitHub API access and project management automation for the hallucination-detector repo. Uses octokit with proxy-aware client for all GitHub operations — issues, PRs, labels, milestones, Projects V2. No gh CLI required."
---
# GitHub API — Setup and Usage

## Purpose

Provides programmatic GitHub API access for the hallucination-detector repo using `octokit` (full SDK) with automatic proxy support. All operations use Node.js scripts — no `gh` CLI binary is needed.

## When to Use

- Need to interact with GitHub API (issues, PRs, labels, milestones)
- Creating or listing pull requests
- Managing GitHub Issues, Projects V2, or Labels
- Running in a proxy environment where direct DNS to `api.github.com` is unavailable

---

## Authentication

`GITHUB_TOKEN` environment variable provides authentication. All scripts read it automatically via `createGitHubClient()`.

```javascript
const { createGitHubClient, OWNER, REPO } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();
```

The client auto-detects `HTTPS_PROXY` / `HTTP_PROXY` env vars and routes requests through the egress proxy via `undici.ProxyAgent`. No manual proxy configuration needed.

---

## Scripts

### General-purpose GitHub API — `gh-api.cjs`

```bash
# Issues
node .claude/scripts/gh-api.cjs issue list
node .claude/scripts/gh-api.cjs issue create --title "feat: add X" --label "type:feature" --label "priority:p1"
node .claude/scripts/gh-api.cjs issue view 42
node .claude/scripts/gh-api.cjs issue comment 42 --body "Implemented in PR #45."

# Pull Requests
node .claude/scripts/gh-api.cjs pr list
node .claude/scripts/gh-api.cjs pr create --title "feat: add X" --base main --body "Details"

# Labels
node .claude/scripts/gh-api.cjs label list
node .claude/scripts/gh-api.cjs label create --name "priority:p0" --color "D73A4A" --description "Critical"
```

All output is JSON to stdout. Errors go to stderr with exit code 1.

### Pull Request creation — `create-pr.cjs`

```bash
# Auto-generates body from commit log
node .claude/scripts/create-pr.cjs --title "feat: add proxy support"

# Explicit body
node .claude/scripts/create-pr.cjs --title "fix: timeout" --base main --body "Details here"

# Body from file (supports stdin piping)
node .claude/scripts/create-pr.cjs --title "chore: deps" --body-file ./pr-body.md
```

Auto-detects the current branch as `head`. Prints the PR URL to stdout on success.

### Project management — `github-project-setup.cjs`

```bash
# Full project setup (labels + instructions)
node .claude/skills/gh/scripts/github-project-setup.cjs setup

# Labels
node .claude/skills/gh/scripts/github-project-setup.cjs labels
node .claude/skills/gh/scripts/github-project-setup.cjs labels --force

# Milestones
node .claude/skills/gh/scripts/github-project-setup.cjs milestone list
node .claude/skills/gh/scripts/github-project-setup.cjs milestone create --title "v1.0" --due 2026-03-31
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 1
node .claude/skills/gh/scripts/github-project-setup.cjs milestone close --number 1

# Issues
node .claude/skills/gh/scripts/github-project-setup.cjs issue list
node .claude/skills/gh/scripts/github-project-setup.cjs issue create --title "feat: add X" --priority-label priority:p1 --type-label type:feature
```

---

## Shared Client — `github-client.cjs`

All scripts import from `.claude/scripts/lib/github-client.cjs`:

```javascript
const { createGitHubClient, OWNER, REPO } = require('./.claude/scripts/lib/github-client.cjs');
const octokit = createGitHubClient();

// REST API
const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
  owner: OWNER, repo: REPO, state: 'open', per_page: 100,
});

// GraphQL (for Projects V2)
const result = await octokit.graphql(`
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`, { projectId, contentId: issueNodeId });
```

The client handles:
- `GITHUB_TOKEN` validation (exits with error if missing)
- Proxy detection (`HTTPS_PROXY` / `HTTP_PROXY` env vars)
- `undici.ProxyAgent` configuration for environments where DNS to `api.github.com` is unavailable

---

## Existing Project Scripts

These scripts in `.claude/scripts/` also use the shared client:

- `sync-issues-to-project.cjs` — Sync issues to Projects V2 board
- `rebuild-issue-bodies.cjs` — Rebuild issue bodies from backlog items
- `repair-from-original-register.cjs` — Repair issue data from original register

---

## Reference Files

- [labels.md](./references/labels.md) — Label taxonomy, color codes, bulk setup
- [milestones.md](./references/milestones.md) — Milestone CRUD, naming conventions
- [projects-v2.md](./references/projects-v2.md) — GitHub Projects V2, GraphQL queries
- [issue-stories.md](./references/issue-stories.md) — Issue as story format, body template, lifecycle

---

## Sources

- [GitHub REST API — Issues](https://docs.github.com/en/rest/issues) — milestones, labels, issues
- [GitHub Projects V2 API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) — GraphQL API
- [Octokit.js](https://github.com/octokit/octokit.js) — full SDK
