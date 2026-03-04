# GitHub Projects V2 — Management

GitHub Projects V2 is the current projects system (board, table, roadmap views). Managed via `gh project` CLI or GraphQL API.

**Scope requirement**: `GITHUB_TOKEN` needs `project` scope. Verify with:

```bash
gh auth status
```

## When to Use What

| Context | Tool |
|---------|------|
| Quick one-off | `gh project` CLI |
| Scripted / multi-step | GraphQL via `octokit.graphql()` in `.cjs` scripts |

---

## gh CLI — Quick Commands

### Project Lifecycle

```bash
# Create for an org
gh project create --owner bitflight-devops --title "Hallucination Detector Backlog"

# List projects
gh project list --owner bitflight-devops

# Link project to repository
gh project link 1 --owner bitflight-devops --repo bitflight-devops/hallucination-detector

# View project
gh project view 1 --owner bitflight-devops
```

### Custom Fields

```bash
# List fields
gh project field-list 1 --owner bitflight-devops --format json

# Create Priority single-select field
gh project field-create 1 --owner bitflight-devops \
  --name "Priority" \
  --data-type SINGLE_SELECT \
  --single-select-options "P0,P1,P2,Idea"

# Create Status field
gh project field-create 1 --owner bitflight-devops \
  --name "Status" \
  --data-type SINGLE_SELECT \
  --single-select-options "Backlog,Grooming,In Progress,Review,Done"
```

### Adding Items

```bash
# Add issue to project
gh project item-add 1 --owner bitflight-devops \
  --url https://github.com/bitflight-devops/hallucination-detector/issues/42

# List items
gh project item-list 1 --owner bitflight-devops --format json
```

### Editing Item Fields

Field values require node IDs — retrieve from `field-list` and `item-list`.

```bash
gh project item-edit \
  --project-id <project-node-id> \
  --id <item-node-id> \
  --field-id <field-node-id> \
  --single-select-option-id <option-node-id>
```

---

## GraphQL — Get Node IDs

```bash
# Get project node ID and field option IDs (try org first, then user)
gh api graphql -f query='
{
  organization(login: "bitflight-devops") {
    projectV2(number: 1) {
      id
      fields(first: 20) {
        nodes {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
}'
```

---

## Octokit — Scripted Operations (JavaScript)

Use `octokit.graphql()` for Projects V2 operations.

```javascript
const { Octokit } = require('octokit');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// Add issue to project
const { addProjectV2ItemById } = await octokit.graphql(`
  mutation AddItem($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`, {
  projectId: 'PVT_kwXXX',
  contentId: 'I_kwXXX',  // issue node ID
});

// Set single-select field value
await octokit.graphql(`
  mutation SetField($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId
      itemId: $itemId
      fieldId: $fieldId
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`, { projectId: '...', itemId: '...', fieldId: '...', optionId: '...' });
```

---

## Automation Script

```bash
# Discover project IDs and field options
node .claude/scripts/sync-issues-to-project.cjs --discover

# Sync issues to project (dry-run)
node .claude/scripts/sync-issues-to-project.cjs --dry-run

# Full project setup (labels + instructions)
node .claude/skills/gh/scripts/github-project-setup.cjs setup
```

---

## Standard Project Structure

```text
Project: "Hallucination Detector Backlog"
  Fields:
    - Status: Backlog | Grooming | In Progress | Review | Done
    - Priority: P0 | P1 | P2 | Idea
    - Type: Feature | Bug | Refactor | Docs | Chore
  Views:
    - Board (grouped by Status)
    - Table (all fields visible)
    - Roadmap (grouped by Milestone)
```

SOURCE: GitHub CLI Projects documentation — <https://cli.github.com/manual/gh_project> (accessed 2026-02-21)
SOURCE: GitHub Projects V2 GraphQL API — <https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects> (accessed 2026-02-21)
SOURCE: Octokit GraphQL — <https://github.com/octokit/graphql.js> (accessed 2026-02-21)
