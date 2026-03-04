---
name: gh
description: "GitHub CLI setup and project management automation for the hallucination-detector repo. Provides gh CLI auto-installer with SHA256 verification, and octokit-based project management (labels, milestones, issues, Projects V2). Use when gh command not found, need GitHub API access, or managing issues/milestones/projects."
---
# GitHub CLI (gh) — Setup and Usage

## Purpose

Ensures the GitHub CLI (`gh`) is available and provides project management automation using `octokit` (full SDK) for the hallucination-detector repository.

## When to Use

- `gh` command not found
- Need to interact with GitHub API (issues, PRs, releases, workflows)
- Managing GitHub Issues, Milestones, or Labels
- Syncing issues to Projects V2

---

## Installation

If `gh` is not installed, run the setup script:

```bash
node .claude/skills/gh/scripts/setup-gh.cjs
```

The script:

1. Checks if `gh` is already installed via PATH lookup
2. Detects platform (Linux, macOS, Windows) and architecture
3. Fetches the latest release from GitHub Releases API
4. Downloads the correct archive with SHA256 verification
5. Extracts and installs the binary to a writable PATH directory
6. Uses `GITHUB_TOKEN` for authenticated requests; falls back to anonymous on 401/403

**CLI options:**

```text
--force     Reinstall even if already at latest version
--dry-run   Show what would happen without installing
--bin-dir   Override install directory (default: auto-detect from PATH)
```

---

## Authentication

`GITHUB_TOKEN` environment variable provides automatic authentication for both `gh` CLI and `octokit` scripts. No manual `gh auth login` needed.

```bash
# Verify authentication
gh auth status
```

---

## Project Management — Automation Script

For multi-step operations (label setup, milestone management, issue management), use the octokit-based automation script:

```bash
# Full project setup (labels + next-steps instructions)
node .claude/skills/gh/scripts/github-project-setup.cjs setup

# Labels only
node .claude/skills/gh/scripts/github-project-setup.cjs labels
node .claude/skills/gh/scripts/github-project-setup.cjs labels --force

# Milestone management
node .claude/skills/gh/scripts/github-project-setup.cjs milestone list
node .claude/skills/gh/scripts/github-project-setup.cjs milestone create --title "v1.0" --due 2026-03-31
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 1
node .claude/skills/gh/scripts/github-project-setup.cjs milestone start --number 1 --dry-run
node .claude/skills/gh/scripts/github-project-setup.cjs milestone close --number 1

# Issue management
node .claude/skills/gh/scripts/github-project-setup.cjs issue list
node .claude/skills/gh/scripts/github-project-setup.cjs issue list --priority p1
node .claude/skills/gh/scripts/github-project-setup.cjs issue create --title "feat: add feature X" --priority-label priority:p1 --type-label type:feature
node .claude/skills/gh/scripts/github-project-setup.cjs issue create --title "fix: bug Y" --body "Details" --milestone 1
```

The script uses `octokit` (full SDK, already in devDependencies) for all GitHub API calls. No CLI wrappers.

---

## Common gh CLI Commands

These require `gh` to be installed (run `setup-gh.cjs` first).

### Issues

```bash
# List issues
gh issue list -R bitflight-devops/hallucination-detector

# List by label
gh issue list -R bitflight-devops/hallucination-detector --label "priority:p1" --state open

# Create issue
gh issue create -R bitflight-devops/hallucination-detector \
  --title "feat: add feature X" \
  --label "priority:p1" --label "type:feature" \
  --milestone "v1.0"

# View issue
gh issue view <number> -R bitflight-devops/hallucination-detector
```

### Pull Requests

```bash
# List open PRs
gh pr list -R bitflight-devops/hallucination-detector

# View PR details
gh pr view <number> -R bitflight-devops/hallucination-detector

# Check PR CI status
gh pr checks <number> -R bitflight-devops/hallucination-detector
```

### Labels

```bash
# List all labels
gh label list -R bitflight-devops/hallucination-detector

# Create label
gh label create "priority:p1" --color "E99695" \
  --description "High priority" -R bitflight-devops/hallucination-detector
```

### Milestones

```bash
# List milestones
gh api repos/bitflight-devops/hallucination-detector/milestones

# Create milestone
gh api repos/bitflight-devops/hallucination-detector/milestones \
  -X POST -f title="v1.0" -f due_on="2026-03-31T00:00:00Z"
```

### Workflow Runs

```bash
# List recent runs
gh run list -R bitflight-devops/hallucination-detector --limit 5

# View failed job logs
gh run view <run-id> -R bitflight-devops/hallucination-detector --log-failed
```

---

## Programmatic Usage (octokit)

For scripted operations in `.cjs` files, use `octokit` directly:

```javascript
const { Octokit } = require('octokit');
const { OWNER, REPO } = require('../../scripts/lib/story-helpers.cjs');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// REST API
const allIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
  owner: OWNER,
  repo: REPO,
  state: 'open',
  per_page: 100,
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

---

## Output Formatting

```bash
# JSON output
gh pr list -R bitflight-devops/hallucination-detector --json number,title,state

# JQ filtering
gh issue list -R bitflight-devops/hallucination-detector --json number,title --jq '.[].title'
```

---

## Reference Files

- [labels.md](./references/labels.md) — Label taxonomy, color codes, bulk setup
- [milestones.md](./references/milestones.md) — Milestone CRUD, naming conventions
- [projects-v2.md](./references/projects-v2.md) — GitHub Projects V2 commands, GraphQL queries
- [issue-stories.md](./references/issue-stories.md) — Issue as story format, body template, lifecycle

---

## Existing Project Scripts

These scripts in `.claude/scripts/` also use octokit for GitHub operations:

- `sync-issues-to-project.cjs` — Sync issues to Projects V2 board
- `rebuild-issue-bodies.cjs` — Rebuild issue bodies from backlog items
- `repair-from-original-register.cjs` — Repair issue data from original register

---

## Sources

- [GitHub CLI Manual](https://cli.github.com/manual) — official reference
- [GitHub CLI Releases](https://github.com/cli/cli/releases) — binary downloads
- [GitHub REST API — Issues](https://docs.github.com/en/rest/issues) — milestones, labels, issues
- [GitHub Projects V2 API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) — GraphQL API
- [Octokit.js](https://github.com/octokit/octokit.js) — full SDK
